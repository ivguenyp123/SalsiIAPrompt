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

/**
 * Les chemins à sonder pour trouver la CI, sous une racine donnée.
 *
 * `racine` existe pour une raison précise et temporaire : le dépôt de démonstration vit
 * dans un sous-dossier du dépôt produit, faute de pouvoir en créer un dédié. Sur une
 * vraie cible elle vaut '' et la CI est à la racine, comme l'exige GitLab.
 */
export const cheminsCI = (racine = '') => {
  const base = racine ? racine.replace(/\/+$/, '') + '/' : '';
  return FICHIERS_CI.map((f) => base + f);
};

export const BUMPS = ['major', 'minor', 'patch'];

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
 *   @param {{path:string, content:string}|null} entree.ci       le fichier de CI trouvé
 *   @param {Array<{path:string, content:string}>} entree.overlays  les kustomization lus
 * @returns {{ok, raison, courante, cible, fichiers, message, titreMR}}
 */
export function planifier({ branche, brancheCible = 'main', bump = 'patch', ci, overlays = [] } = {}) {
  const refus = (raison) => ({ ok: false, raison, fichiers: [], courante: '', cible: '' });

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

  for (const o of overlays) {
    const nouveau = reecrireOverlay(o.content, cible);
    // Seuls les fichiers réellement modifiés entrent au commit.
    if (nouveau !== o.content) fichiers.push({ path: o.path, content: nouveau, quoi: 'overlay' });
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
    message: `[Livraison] Bump IMAGE_TAG → ${cible}`,
    titreMR: `release ${cible}`,
    overlaysTouches: fichiers.filter((f) => f.quoi === 'overlay').length
  };
}

/** Résumé d'une ligne, pour la confirmation humaine. */
export function resumer(plan, { branche, brancheCible }) {
  if (!plan.ok) return plan.raison;
  return `${branche} → ${brancheCible} · IMAGE_TAG ${plan.courante} → ${plan.cible} · `
       + `${plan.fichiers.length} fichier(s), dont ${plan.overlaysTouches} overlay(s)`;
}

export default { bumpVersion, versionCourante, reecrireCI, reecrireOverlay, planifier, resumer,
                 BUMPS, FICHIERS_CI, IMAGE_TAG_RX, KUSTOMIZATION_RX };
