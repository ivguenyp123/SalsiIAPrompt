/*
 * L'état DÉRIVÉ — la mémoire de la plateforme, et rien d'autre.
 *
 * ── LA LIGNE QUI SÉPARE CE FICHIER DE TOUS LES AUTRES ────────────────────────
 *
 * Un artefact est DÉCLARÉ : son auteur l'écrit, il l'engage, il est relu. `derive/etat.json`
 * est DÉRIVÉ : personne ne l'écrit à la main, il est le résidu d'une mesure. L015 refuse
 * déjà qu'un bloc `derived` apparaisse dans un artefact, pour que la frontière ne se
 * brouille pas dans l'autre sens.
 *
 * Il est versionné au dépôt malgré tout, et c'est délibéré. Le niveau atteint doit être
 * lisible par le Catalogue et l'Admin, qui n'ont ni base de données ni serveur — ils lisent
 * des fichiers, comme les registres. Le versionner rend aussi la mesure AUDITABLE : on voit
 * dans l'historique quand un agent a été certifié, sur quel modèle, et quand il est retombé.
 *
 * ── CE QU'IL NE CONTIENT PAS ─────────────────────────────────────────────────
 *
 * Ni sortie de modèle, ni prompt rendu. Une sortie peut contenir ce qu'on lui a donné à
 * lire — un extrait de dépôt, un journal de pipeline — et le dépôt du registre n'est pas
 * l'endroit où ça se stocke. On garde le VERDICT, pas la matière.
 */

/** Le chemin, unique et connu des deux côtés — écriture ici, lecture dans les écrans. */
export const CHEMIN = 'derive/etat.json';

/** Un état vide, de la bonne forme. */
export const VIDE = { schema: 1, genere_le: null, artefacts: {} };

/**
 * La carte `{ <id>: { level, certification } }` attendue par `lib/niveau.js`, P005 et P006.
 *
 * Rend `null` quand le fichier n'existe pas, et c'est important : `null` fait taire L016,
 * P005 et P006 au lieu de leur faire dire « jamais certifié » pour tout le catalogue. Une
 * plateforme sans banc d'essai ne doit pas ressembler à une plateforme dont tout échoue.
 */
export function carte(brut) {
  if (!brut || typeof brut !== 'object') return null;
  const a = brut.artefacts;
  if (!a || typeof a !== 'object' || Object.keys(a).length === 0) return null;
  return a;
}

/**
 * Le résultat d'un passage, réduit à ce qui se conserve.
 *
 * Volontairement plat : ce que les écrans lisent (`level`, `certification`) est au premier
 * niveau, le détail du passage est rangé sous `banc` et n'est lu par personne d'autre que
 * l'écran de détail. Un consommateur qui n'aurait besoin que du niveau n'a pas à connaître
 * la forme du reste.
 */
export function entree(passage, { certification, raison, modele, fournisseur, date, depense }) {
  return {
    level: passage.niveau.level,
    certification: certification || null,
    banc: {
      joue_le: date,
      modele,
      fournisseur,
      vise: passage.niveau.vise,
      pourquoi: passage.niveau.pourquoi,
      sans_certification: certification ? '' : raison,
      cas: passage.cas.map((c) => ({
        id: c.id,
        passe: c.passe,
        reussites: c.reussites,
        runs: c.runs,
        seuil: c.seuil,
        indecis: c.indecis,
        erreurs: c.erreurs
      })),
      appels: depense?.appels ?? 0,
      jetons: depense?.jetons || null,
      euros: depense?.euros ?? null
    }
  };
}

/**
 * Le nouvel état, l'ancien inchangé pour tout le reste.
 *
 * Un passage porte sur UN artefact : écraser le fichier entier effacerait la mesure des
 * autres, et le catalogue repasserait en « visé » partout après un banc ciblé.
 */
export function fusionner(etat, id, valeur, date) {
  const base = etat && typeof etat === 'object' ? etat : VIDE;
  return {
    schema: 1,
    genere_le: date,
    artefacts: { ...(base.artefacts || {}), [id]: valeur }
  };
}

/** Retire un artefact de l'état — quand il disparaît du parc, sa mesure n'a plus d'objet. */
export function oublier(etat, id, date) {
  const reste = { ...((etat && etat.artefacts) || {}) };
  delete reste[id];
  return { schema: 1, genere_le: date, artefacts: reste };
}

export const serialiser = (etat) => `${JSON.stringify(etat, null, 2)}\n`;

export default { CHEMIN, VIDE, carte, entree, fusionner, oublier, serialiser };
