/*
 * Les contrats de sortie de la plateforme — reproduire, pas imiter.
 *
 * ── L'ÉTAPE QU'ON AVAIT SAUTÉE ───────────────────────────────────────────────
 *
 * L'inventaire porte un BESOIN par capacité : « un agent qui explique les 4 métriques
 * DORA ». C'est assez pour proposer la capacité au catalogue. C'est très insuffisant pour
 * que l'agent produise LE MÊME RAPPORT que le module dont il vient.
 *
 * Constaté à l'usage, et c'est le genre de défaut qui ne se voit qu'en s'en servant :
 * l'agent DORA rendait `deployment_frequency: "élevée"` là où la plateforme calcule
 * `df: 4.2 /sem → High`. Deux vocabulaires, deux unités, aucun seuil commun. Impossible
 * de comparer, de rejouer, ou de contester un chiffre.
 *
 * ── CE QUE CE MODULE APPORTE ─────────────────────────────────────────────────
 *
 * Le contrat RÉEL du module d'origine : les clés exactes, les unités, les niveaux et
 * leurs seuils, tels qu'ils sont écrits dans le code de la plateforme. À partir de là :
 *
 *   · la consigne dit au modèle la forme EXACTE à produire, avec ses seuils
 *   · les critères vérifient les VRAIES clés — plus besoin de les deviner
 *
 * ── EXTRAIT, JAMAIS INVENTÉ ──────────────────────────────────────────────────
 *
 * Un contrat approximatif est pire que pas de contrat : il ferait diverger deux rapports
 * censés être le même, et personne ne saurait lequel croire. Une capacité sans contrat
 * extrait n'en a donc pas, et l'agent qu'on en tire reste ce qu'il était — une aide, pas
 * une reproduction. `sansContrat()` permet de le dire à l'écran.
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers.
 */

/** Ce qu'un contrat doit porter pour valoir quelque chose. */
export const CHAMPS_REQUIS = ['cle', 'libelle'];

/** Les contrats sont indexés par MODULE : c'est le module qui produit le rapport. */
export function indexer(contrats = []) {
  const par = new Map();
  for (const c of contrats) {
    if (c?.module && Array.isArray(c.champs) && c.champs.length) par.set(c.module, c);
  }
  return par;
}

/** Le contrat d'une capacité, via son module. `null` s'il n'a pas été extrait. */
export function contratDe(entree, index) {
  if (!entree?.module || !index) return null;
  return index.get(entree.module) || null;
}

/** Une capacité dont on ne sait pas reproduire la sortie. À dire, pas à masquer. */
export const sansContrat = (entree, index) => contratDe(entree, index) === null;

/**
 * La partie de la consigne qui décrit la sortie ATTENDUE.
 *
 * Elle est longue et précise, et c'est voulu : c'est la seule façon qu'un modèle rende
 * `df` et non `deployment_frequency`. Une formulation vague redonnerait au modèle la
 * liberté qu'on cherche justement à lui retirer.
 */
export function consigneDeSortie(contrat) {
  if (!contrat?.champs?.length) return '';

  const lignes = contrat.champs.map((c) => {
    const unite = c.unite ? ` (${c.unite})` : '';
    const seuils = c.seuils ? `\n    niveaux : ${c.seuils}` : '';
    return `  - "${c.cle}" — ${c.libelle}${unite}${seuils}`;
  });

  const niveaux = (contrat.niveaux || []).length
    ? `\n\nLe niveau de chaque champ est l'une de ces valeurs EXACTEMENT : `
      + `${contrat.niveaux.map((n) => `"${n}"`).join(', ')}.`
    : '';

  return 'Rends du JSON, et RIEN d\'autre — pas de texte avant ni après.\n\n'
    + 'Les clés sont exactement celles-ci, sans en ajouter ni en retirer :\n'
    + `${lignes.join('\n')}${niveaux}\n\n`
    + 'Chaque champ vaut un objet `{ "valeur": <nombre>, "niveau": "<niveau>" }`. '
    + 'Quand la donnée manque, écris `{ "valeur": null, "niveau": "N/A" }` — jamais zéro, '
    + 'qui se lirait comme une mesure.';
}

/**
 * Les critères qui vérifient qu'on a bien reproduit la sortie.
 *
 * Ils ne sont pas proposés : ils sont DÉDUITS du contrat. C'est la différence entre
 * « le modèle a l'air d'avoir compris » et « la sortie a la forme du rapport ».
 */
export function criteresDuContrat(contrat) {
  if (!contrat?.champs?.length) return [];
  return [
    { target: 'output.is_valid_json', op: 'eq', value: true },
    { target: 'output.json_keys', op: 'contains',
      value: contrat.champs.map((c) => c.cle) }
  ];
}

/** Ce qu'on affiche pour dire d'où vient le contrat. Un chiffre sans source ne vaut rien. */
export const provenance = (contrat) =>
  (contrat?.source ? `Forme extraite de \`${contrat.source}\` (${contrat.module}).` : '');

export default { CHAMPS_REQUIS, indexer, contratDe, sansContrat, consigneDeSortie,
                 criteresDuContrat, provenance };
