/*
 * Le parc — croiser les trois dossiers en une seule liste, et la filtrer.
 *
 * ── POURQUOI UNE SEULE LISTE ─────────────────────────────────────────────────
 *
 * L'état vient du dossier, faute d'état dérivé :
 *
 *   artifacts/          actif — visible au catalogue, lançable
 *   artifacts/pending/  en revue — soumis, attend une décision
 *   artifacts/retires/  retiré — a servi, ne sert plus
 *
 * Trois écrans séparés obligeraient à savoir OÙ chercher avant de chercher. Or la
 * question qu'on se pose devant un parc n'est jamais « montre-moi le dossier pending »,
 * c'est « où en est cet agent-là ». Une liste, une colonne Statut, une recherche.
 *
 * ── CE QU'ON REFUSE D'AFFICHER ───────────────────────────────────────────────
 *
 * La maquette montre une colonne « Santé » (taux de réussite) et une colonne « Usages ».
 * Ce sont des états DÉRIVÉS, et rien ne les mesure encore. Les remplir de chiffres
 * plausibles serait exactement ce que ce produit reproche aux autres — et le pire
 * mensonge possible ici, puisque toute sa thèse tient à la séparation entre ce qui est
 * déclaré et ce qui est mesuré.
 *
 * Alors on garde les colonnes et on dit la vérité :
 *   `porte`  ce qu'on SAIT — l'artefact franchit-il encore le lint. Déterministe.
 *   `usages` `null`, rendu « jamais mesuré ». Une colonne vide qui s'explique vaut
 *            mieux qu'une colonne pleine qui ment.
 *
 * Module PUR : aucune forge, aucun DOM.
 */
import { niveau } from '../lib/niveau.js';

/** Les statuts, du plus demandeur d'attention au plus stable. */
export const STATUTS = {
  revue: { label: 'en revue', ordre: 0, aide: 'soumis, attend une décision humaine' },
  actif: { label: 'actif', ordre: 1, aide: 'visible au catalogue, lançable' },
  retire: { label: 'retiré', ordre: 2, aide: 'hors catalogue, réactivable d\'un clic' }
};

/** Les dossiers, et le statut que chacun porte. */
export const DOSSIERS = [
  ['revue', 'artifacts/pending'],
  ['actif', 'artifacts'],
  ['retire', 'artifacts/retires']
];

const idDe = (f) =>
  f?.artifact?.id || f?.path?.split('/').pop()?.replace(/\.ya?ml$/, '') || '';

/** Sans accent ni casse : chercher « migration » doit trouver « Migrations ». */
export const plier = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Une entrée de parc par fichier.
 *
 * Un identifiant peut exister à DEUX endroits — une correction en revue sur une capacité
 * publiée. Ce n'est pas un doublon à fusionner : les deux lignes décrivent deux choses
 * réelles et différentes, et la publiée continue de servir. Les confondre ferait croire
 * à l'auteur que sa correction est en ligne.
 *
 * @param {object} entree  { revue: [...], actif: [...], retire: [...] }
 *                         chaque élément : { path, artifact, report, error }
 * @returns {Array} entrées triées : ce qui attend une décision d'abord
 */
export function inventaireParc(entree = {}, derive = null) {
  const out = [];

  for (const [statut] of DOSSIERS) {
    for (const f of entree[statut] || []) {
      const a = f?.artifact || {};
      out.push({
        id: idDe(f),
        path: f?.path || '',
        statut,
        kind: a.kind || '',
        titre: a.title || f?.path?.split('/').pop() || '(sans titre)',
        owner: a.owner?.person || '',
        scope: a.owner?.scope || '',
        niveau: a.target_level || 'experimental',
        // Avec sa PROVENANCE : « officiel — visé » tant que rien ne l'a mesuré. Une
        // ligne de parc qui dirait « officiel » tout court referait le bug du catalogue.
        niveauTexte: niveau(a, derive).texte,
        // Ce qu'on SAIT de sa santé : franchit-il encore la porte.
        porte: f?.report ? (f.report.blocked ? 'refuse' : 'conforme') : null,
        erreurs: f?.report?.errors ?? 0,
        // Ce qu'on ne sait pas. `null` n'est pas 0 : zéro usage serait une mesure.
        usages: null,
        lisible: Boolean(f?.artifact),
        erreur: f?.error || '',
        artifact: f?.artifact || null
      });
    }
  }

  return out.sort((a, b) =>
    STATUTS[a.statut].ordre - STATUTS[b.statut].ordre || a.titre.localeCompare(b.titre, 'fr'));
}

/** Le décompte par statut. Toujours toutes les clés, y compris à zéro. */
export function compter(entrees = []) {
  const out = Object.fromEntries(Object.keys(STATUTS).map((k) => [k, 0]));
  for (const e of entrees) if (out[e.statut] !== undefined) out[e.statut] += 1;
  return out;
}

/**
 * Filtre la liste.
 *
 * La recherche porte sur le titre, l'identifiant, l'owner et le périmètre — ce qu'on a
 * en tête en cherchant. Pas sur le chemin du fichier : personne ne retient un chemin.
 */
export function filtrer(entrees = [], { q = '', kind = '', statut = '' } = {}) {
  const mot = plier(q).trim();
  return entrees.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (statut && e.statut !== statut) return false;
    if (!mot) return true;
    return plier(`${e.titre} ${e.id} ${e.owner} ${e.scope}`).includes(mot);
  });
}

export default { STATUTS, DOSSIERS, inventaireParc, compter, filtrer, plier };
