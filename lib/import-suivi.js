/*
 * Suivre l'amont d'une capacité importée — constater, jamais mettre à jour.
 *
 * ── CE QUE CE MODULE N'EST PAS ───────────────────────────────────────────────
 *
 * Ce n'est pas un mécanisme de mise à jour. Il n'existe AUCUN chemin qui prenne le
 * nouveau texte de l'amont et le pose dans un artefact : la « mise à jour » d'une
 * capacité importée est un NOUVEL import, qui relit le pack, repasse par le proposeur,
 * par le crible, et repart en `artifacts/pending/` attendre une validation (I001, I002).
 * Ce module répond à une seule question : « le document que j'ai cité a-t-il bougé
 * depuis ? » — et la réponse est un constat daté, pas un geste.
 *
 * ── LA PROVENANCE SE RELIT, ELLE NE SE DEVINE PAS ────────────────────────────
 *
 * `enteteDe` (import-artefact.js) écrit en tête de chaque artefact importé d'où vient
 * le texte cité : dépôt, référence, commit épinglé, chemin du fichier, empreinte. Ces
 * lignes sont des commentaires YAML — le parseur les jette, mais le FICHIER les garde.
 * `provenanceDe` les relit depuis le texte brut, et un test d'aller-retour verrouille
 * le format : si `enteteDe` change une ligne, la relecture casse ici, pas en silence
 * chez l'utilisateur six mois plus tard.
 *
 * ── LE VERDICT COMPARE DES CONTENUS, PAS DES NUMÉROS DE COMMIT ───────────────
 *
 * L'HEAD d'un dépôt actif bouge tous les jours pour des fichiers qui ne nous regardent
 * pas. Dire « modifié » parce que le sha de tête a changé serait crier au loup à chaque
 * scan. On compare LE fichier cité : son empreinte d'aujourd'hui contre celle notée à
 * l'import — et quand l'import n'avait pas pu la calculer, le texte épinglé relu contre
 * le texte de tête. Quand ni l'une ni l'autre n'est possible, le verdict est
 * `non_verifiable` et il se montre : « on n'a pas su comparer » n'est pas « à jour »
 * (« N/A n'est pas zéro »).
 */

/** Le fichier cité n'a pas changé : même contenu à la tête de l'amont. */
export const IDENTIQUE = 'identique';
/** Le fichier cité a changé en amont : l'artefact cite un texte qui n'est plus le leur. */
export const MODIFIE = 'modifie';
/** Le fichier cité n'existe plus à la tête de l'amont. */
export const DISPARU = 'disparu';
/** On n'a pas de quoi comparer : ni empreinte notée, ni texte épinglé relisible. */
export const NON_VERIFIABLE = 'non_verifiable';

/*
 * Les lignes que `provenanceDe` sait relire. La liste est FERMÉE et minuscule à
 * dessein : l'en-tête contient aussi de la prose pour le relecteur humain, et la
 * confondre avec des champs machine ferait dépendre le suivi d'un texte qui a le
 * droit de changer.
 */
const LIGNE = /^#\s*(pack|commit|fichier|sha256):\s*(.+?)\s*$/;

/**
 * La provenance d'import d'un artefact, relue depuis son texte brut.
 *
 * Rend `null` pour tout fichier qui ne commence pas par le marqueur
 * `# salsi-provenance: import` : un artefact écrit à la main n'a pas d'amont, et
 * l'absence de provenance n'est pas une erreur — c'est l'état normal de tout ce qui
 * n'a pas été importé.
 *
 * @param {string} texte  le fichier YAML BRUT, commentaires compris
 * @returns {{depot: string, ref: string, commit: string, fichier: string,
 *            sha256: string|null}|null}
 */
export function provenanceDe(texte = '') {
  const lignes = String(texte).split('\n');
  if (!/^#\s*salsi-provenance:\s*import\s*$/.test(lignes[0] || '')) return null;

  const champs = {};
  for (const ligne of lignes) {
    if (!ligne.startsWith('#')) break;      // l'en-tête s'arrête au premier vrai contenu
    const m = LIGNE.exec(ligne);
    if (m && champs[m[1]] === undefined) champs[m[1]] = m[2];
  }

  /*
   * `pack` vaut `depot@ref` — et le dépôt peut contenir des `@` s'il vient d'une URL
   * ssh mal nettoyée. On coupe au DERNIER `@` : la référence, elle, n'en porte pas.
   * Un champ à `?` (l'inconnu assumé d'`enteteDe`) vaut absent : on ne suit pas un
   * amont dont on ne sait pas écrire l'adresse.
   */
  const pack = champs.pack && champs.pack !== '?' ? champs.pack : null;
  const commit = champs.commit && champs.commit !== '?' ? champs.commit : null;
  if (!pack || !commit || !champs.fichier) return null;

  const arobase = pack.lastIndexOf('@');
  const depot = arobase > 0 ? pack.slice(0, arobase) : pack;
  const ref = arobase > 0 ? pack.slice(arobase + 1) : 'main';

  return { depot, ref, commit, fichier: champs.fichier, sha256: champs.sha256 || null };
}

/**
 * Le verdict : le document cité a-t-il bougé en amont ?
 *
 * Tout est passé en valeurs — ce module ne parle à aucune forge. C'est l'appelant qui
 * a lu l'amont, et c'est ce qui rend chaque issue jouable dans un test sans réseau.
 *
 * @param {object} p
 * @param {object} p.provenance     ce que `provenanceDe` a relu
 * @param {string} p.commitAmont    le sha de tête de la référence suivie
 * @param {string|null} p.contenuAmont    le fichier cité, lu À LA TÊTE — `null` s'il
 *                                        n'y est plus
 * @param {string|null} [p.contenuEpingle]  le même fichier relu AU COMMIT ÉPINGLÉ —
 *                                        utile seulement quand l'import n'avait pas
 *                                        d'empreinte ; `null` si illisible
 * @param {(texte: string) => string|null} [p.hacher]  sha-256 hex, injecté comme dans
 *                                        `lireCapacite` : un module pur ne calcule pas
 * @returns {{issue: string, detail: string}}
 */
export function verdictAmont({ provenance, commitAmont, contenuAmont,
                               contenuEpingle = null, hacher = null }) {
  const court = (sha) => String(sha || '').slice(0, 8);

  // La tête n'a pas bougé du tout : rien n'a pu changer, fichier cité compris.
  if (commitAmont && commitAmont === provenance.commit) {
    return { issue: IDENTIQUE,
             detail: `L'amont est resté au commit épinglé (${court(commitAmont)}).` };
  }

  if (contenuAmont === null || contenuAmont === undefined) {
    return { issue: DISPARU,
             detail: `\`${provenance.fichier}\` n'existe plus à la tête de `
               + `${provenance.depot}@${provenance.ref} (${court(commitAmont)}). Le texte `
               + 'cité dans l\'artefact est le seul qui reste.' };
  }

  /*
   * L'empreinte d'abord : c'est la comparaison la moins chère et la plus sûre — elle
   * a été calculée sur le contenu EXACT qui a été cité, au moment où il l'a été.
   */
  if (provenance.sha256 && hacher) {
    const empreinte = hacher(contenuAmont);
    if (empreinte === null) {
      return { issue: NON_VERIFIABLE,
               detail: 'L\'empreinte du fichier de tête n\'a pas pu être calculée : '
                 + 'on ne compare pas, on le dit.' };
    }
    return empreinte === provenance.sha256
      ? { issue: IDENTIQUE,
          detail: `Le fichier cité est identique à la tête (${court(commitAmont)}) : `
            + 'même empreinte.' }
      : { issue: MODIFIE,
          detail: `\`${provenance.fichier}\` a changé en amont depuis `
            + `${court(provenance.commit)} : l'artefact cite un texte qui n'est plus `
            + 'celui qu\'ils publient.' };
  }

  // Pas d'empreinte notée à l'import : on compare les textes, épinglé contre tête.
  if (contenuEpingle !== null && contenuEpingle !== undefined) {
    return contenuEpingle === contenuAmont
      ? { issue: IDENTIQUE,
          detail: `Le fichier cité est identique à la tête (${court(commitAmont)}) : `
            + 'même texte que le commit épinglé.' }
      : { issue: MODIFIE,
          detail: `\`${provenance.fichier}\` a changé en amont depuis `
            + `${court(provenance.commit)} : l'artefact cite un texte qui n'est plus `
            + 'celui qu\'ils publient.' };
  }

  return { issue: NON_VERIFIABLE,
           detail: 'Pas d\'empreinte notée à l\'import, et le commit épinglé '
             + `${court(provenance.commit)} n'a pas pu être relu. On ne sait pas si le `
             + 'texte a bougé — et « on ne sait pas » ne se maquille pas en « à jour ».' };
}

export default { provenanceDe, verdictAmont, IDENTIQUE, MODIFIE, DISPARU, NON_VERIFIABLE };
