/*
 * Le module derrière `bump_image_tag` — moment 5, l'exécution.
 *
 * ── POURQUOI CE FICHIER EXISTE ───────────────────────────────────────────────
 *
 * L'artefact `prep-delivery` déclare depuis le premier jour :
 *
 *     tools:
 *       - id: bump_image_tag
 *         mode: write
 *         executor: module      # imposé par l'invariant L005
 *
 * Il ne manquait pas une décision d'architecture : il manquait le MODULE derrière
 * l'identifiant. Le voici. `executor: module` désigne désormais du code réel, et
 * l'invariant cesse d'être une promesse — l'écriture est faite ici, pas par un LLM.
 *
 * La logique est reprise du module `livraison` du hub DevOps : même règle de bump, même
 * motif `IMAGE_TAG`, même réécriture d'overlays. Ce n'est pas une réimplémentation
 * approximative, c'est le même comportement, déplacé dans un produit différent et rendu
 * PUR — donc testable hors navigateur, ce que l'original ne permettait pas.
 *
 * Ce fichier ne fait AUCUN appel réseau. Il calcule un plan de modification ; c'est
 * l'appelant qui lit les fichiers et qui écrit. La séparation n'est pas cosmétique :
 * elle permet de montrer le plan à un humain AVANT d'écrire quoi que ce soit, ce qui est
 * exactement la confirmation qu'exige `P007`.
 */

/** `IMAGE_TAG: "1.4.2"` — les groupes préservent guillemets et espaces au réécriture. */
export const IMAGE_TAG_RX = /^(\s*IMAGE_TAG:\s*)(["']?)([^"'\n]+)(["']?)(\s*)$/m;

/** Un fichier Kustomize, à n'importe quelle profondeur. */
export const KUSTOMIZATION_RX = /(^|\/)kustomization\.ya?ml$/i;

/** Les fichiers de CI où chercher `IMAGE_TAG`, dans l'ordre de préférence. */
export const FICHIERS_CI = ['.gitlab-ci.yml', '.gitlab-ci.yaml', '.github/workflows/deploy.yml'];

export const BUMPS = ['major', 'minor', 'patch'];

/*
 * ── L'ENVIRONNEMENT, ET POURQUOI IL EST LU PLUTÔT QUE SAISI ──────────────────
 *
 * Le module d'origine liste ses overlays EN DUR :
 *
 *     'Manifests/overlays/development/kustomization.yaml',
 *     'Manifests/overlays/uat/kustomization.yaml'
 *
 * Deux environnements, écrits une fois pour toutes. Une équipe qui ajoute `preprod` voit
 * sa CI bumpée et son overlay laissé derrière — l'incohérence la plus chère, parce
 * qu'elle ne se voit qu'au déploiement.
 *
 * Ici les overlays sont DÉCOUVERTS dans l'arbre, et leur environnement se lit dans leur
 * chemin. La liste proposée à l'écran est donc celle du dépôt, pas la nôtre : personne
 * n'a à taper un nom d'environnement, et personne ne peut en taper un qui n'existe pas.
 *
 * On ne reconnaît QUE la convention `overlays/<env>/`. Un dépôt qui range autrement n'a
 * pas d'environnement nommé, l'écran le dit, et le filtre reste inerte — plutôt que de
 * deviner qu'un répertoire quelconque serait un environnement et de filtrer sur ce
 * pressentiment.
 */
const SEGMENT_OVERLAYS = /^overlays?$/i;

/** L'environnement d'un overlay : `Manifests/overlays/uat/kustomization.yaml` → `uat`. */
export function environnementDe(chemin) {
  const bouts = String(chemin || '').split('/');
  for (let i = 0; i < bouts.length - 1; i++) {
    if (SEGMENT_OVERLAYS.test(bouts[i]) && bouts[i + 1] && !KUSTOMIZATION_RX.test(bouts[i + 1])) {
      return bouts[i + 1];
    }
  }
  return '';                              // base, racine, ou toute autre disposition
}

/** Les environnements présents dans une liste de chemins, dédoublonnés et triés. */
export function environnements(chemins = []) {
  const vus = new Set();
  for (const c of chemins) {
    const e = environnementDe(c);
    if (e) vus.add(e);
  }
  return [...vus].sort();
}

/**
 * Incrémente une version SemVer.
 * @returns {string} la version cible, ou '' si l'entrée n'est pas du SemVer
 */
export function bumpVersion(version, type = 'patch') {
  const m = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return '';                      // non SemVer : on refuse de deviner
  let [, a, b, c] = m.map(Number);
  if (type === 'major') { a += 1; b = 0; c = 0; }
  else if (type === 'minor') { b += 1; c = 0; }
  else { c += 1; }
  return `${a}.${b}.${c}`;
}

/** La version courante lue dans un fichier de CI, ou '' si le motif est absent. */
export function versionCourante(contenuCI) {
  const m = String(contenuCI || '').match(IMAGE_TAG_RX);
  return m ? m[3].trim() : '';
}

/** Réécrit `IMAGE_TAG` en conservant guillemets et espacement d'origine. */
export function reecrireCI(contenu, cible) {
  return String(contenu).replace(IMAGE_TAG_RX, (_m, p, q, _v, q2, s) => p + q + cible + q2 + s);
}

/**
 * Réécrit un overlay : `newTag` et `APP_VERSION`.
 *
 * Un kustomization de base ne porte ni l'un ni l'autre — il ressort inchangé, et
 * l'appelant l'écartera du commit. C'est voulu : commiter un fichier identique salirait
 * l'historique et ferait croire à une modification.
 */
export function reecrireOverlay(contenu, cible) {
  return String(contenu)
    .replace(/^(\s*newTag:\s*).*$/gm, `$1"${cible}"`)
    .replace(/^(\s*-\s+APP_VERSION=).*$/gm, `$1${cible}`);
}

/**
 * Construit le PLAN de la livraison. Ne touche à rien.
 *
 * @param {object} entree
 *   @param {string} entree.branche       branche source
 *   @param {string} entree.brancheCible  branche de destination (défaut du dépôt)
 *   @param {string} entree.bump          major | minor | patch
 *   @param {string} entree.environnement  ne bumper que cet environnement ; '' = tous
 *   @param {{path:string, content:string}|null} entree.ci       le fichier de CI trouvé
 *   @param {Array<{path:string, content:string}>} entree.overlays  les kustomization lus
 * @returns {{ok, raison, courante, cible, fichiers, message, titreMR}}
 */
export function planifier({ branche, brancheCible = 'main', bump = 'patch', environnement = '',
                            ci, overlays = [] } = {}) {
  const refus = (raison) => ({ ok: false, raison, fichiers: [], courante: '', cible: '',
                               environnement, ecartes: [] });

  if (!branche) return refus('Aucune branche source choisie.');
  if (branche === brancheCible) {
    // Livrer depuis la branche cible vers elle-même ne produit pas de MR : l'opération
    // n'aurait pas de revue, donc pas de porte humaine.
    return refus(`La branche source et la cible sont les mêmes (\`${branche}\`) : il n'y aurait pas de merge request, donc pas de revue.`);
  }
  if (!ci) return refus(`Aucun fichier de CI trouvé sur \`${branche}\` (cherché : ${FICHIERS_CI.join(', ')}).`);

  const courante = versionCourante(ci.content);
  if (!courante) return refus(`\`IMAGE_TAG\` introuvable dans \`${ci.path}\` sur \`${branche}\`.`);

  const cible = bumpVersion(courante, bump);
  if (!cible) return refus(`Version courante \`${courante}\` non SemVer (x.y.z) : le bump est impossible sans deviner.`);

  const fichiers = [];

  const nouveauCI = reecrireCI(ci.content, cible);
  if (nouveauCI !== ci.content) fichiers.push({ path: ci.path, content: nouveauCI, quoi: 'IMAGE_TAG' });

  /*
   * Ce que le filtre laisse de côté est COMPTÉ, jamais escamoté.
   *
   * Livrer `uat` seul laisse le `newTag` de `production` à l'ancienne version. C'est le
   * réglage qui le veut — mais un plan qui montrerait « 2 fichiers » sans dire que trois
   * overlays existent laisserait croire à une livraison complète. Le nom des écartés
   * remonte donc jusqu'au texte que lit l'humain, et jusqu'à celui que lit l'agent.
   */
  const ecartes = [];
  for (const o of overlays) {
    const nouveau = reecrireOverlay(o.content, cible);
    // Seuls les fichiers réellement modifiés entrent au commit.
    const changerait = nouveau !== o.content;

    if (environnement && environnementDe(o.path) !== environnement) {
      /*
       * « Laissé en arrière » veut dire QUELQUE CHOSE, et il faut que ça reste vrai.
       *
       * Un `kustomization` de base ne porte ni `newTag` ni `APP_VERSION` : il ne serait
       * pas modifié même sans filtre. Le compter parmi les écartés faisait dire au plan
       * « 3 overlays gardent l'ancienne version » là où deux étaient concernés — une
       * alarme sur un fichier que la livraison n'aurait de toute façon pas touché.
       *
       * Vu à l'écran, sur un dépôt d'essai rangé en `base/` + `overlays/`.
       */
      if (changerait) ecartes.push(o.path);
      continue;
    }
    if (changerait) fichiers.push({ path: o.path, content: nouveau, quoi: 'overlay' });
  }

  /*
   * L'original du hub porte ici un garde « rien à modifier ». Il y est utile parce que la
   * version courante y vient d'un état d'écran qui peut avoir vieilli depuis la lecture
   * du fichier. Ici elle est lue dans le contenu qu'on réécrit, à l'instant : la cible
   * diffère donc toujours de la courante, et le cas ne peut pas se produire. Un garde
   * inatteignable est pire que pas de garde — il fait croire à une protection.
   */

  return {
    ok: true,
    raison: '',
    courante,
    cible,
    fichiers,
    environnement,
    ecartes,
    message: environnement
      ? `[Livraison] Bump IMAGE_TAG → ${cible} (${environnement})`
      : `[Livraison] Bump IMAGE_TAG → ${cible}`,
    titreMR: environnement ? `release ${cible} — ${environnement}` : `release ${cible}`,
    overlaysTouches: fichiers.filter((f) => f.quoi === 'overlay').length
  };
}

/** Résumé d'une ligne, pour la confirmation humaine. */
export function resumer(plan, { branche, brancheCible }) {
  if (!plan.ok) return plan.raison;
  const portee = plan.environnement ? ` · ${plan.environnement} seul` : '';
  const laisses = plan.ecartes?.length ? ` · ${plan.ecartes.length} overlay(s) laissé(s) en arrière` : '';
  return `${branche} → ${brancheCible} · IMAGE_TAG ${plan.courante} → ${plan.cible} · `
       + `${plan.fichiers.length} fichier(s), dont ${plan.overlaysTouches} overlay(s)${portee}${laisses}`;
}

export default { bumpVersion, versionCourante, reecrireCI, reecrireOverlay, planifier, resumer,
                 environnementDe, environnements,
                 BUMPS, FICHIERS_CI, IMAGE_TAG_RX, KUSTOMIZATION_RX };
