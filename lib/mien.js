/*
 * « Le mien » — sauver une chaîne, la partager, la forker.
 *
 * ── LA QUESTION DE GOUVERNANCE, ET SA RÉPONSE ────────────────────────────────
 *
 * Tout ce qui existe dans ce produit passe par la file de validation. Pourquoi une chaîne
 * personnelle y échapperait-elle ?
 *
 * Parce qu'elle n'apporte AUCUN texte neuf. Une chaîne ne contient pas de prompt : elle
 * ordonne des artefacts qui ont chacun franchi la porte, avec leur intention, leurs outils
 * autorisés et leur contrat. Ce qu'un relecteur aurait à juger tient dans l'ordre et le
 * câblage — et `L024`/`L025` le vérifient déjà, mécaniquement, à chaque frappe.
 *
 * D'où la règle, en trois temps :
 *
 *   SAUVER    `mes-chaines/<qui>/<id>.yaml` — immédiat, personnel. Rien de neuf n'a été
 *             écrit, donc rien de neuf n'est à valider. Invisible au catalogue.
 *   PARTAGER  dépose dans `artifacts/pending/` — là, ça devient une promesse faite aux
 *             autres, et une promesse se valide.
 *   FORKER    recopie chez soi — immédiat à nouveau, pour la même raison qu'à la sauvegarde.
 *
 * Le mot « partager » porte donc toute la charge : il ne veut pas dire « rendre visible »,
 * il veut dire « engager le registre ». C'est pour ça qu'il passe par l'Admin et que
 * sauver n'y passe pas.
 *
 * ── POURQUOI DANS LE DÉPÔT, ET PAS DANS LE NAVIGATEUR ────────────────────────
 *
 * `localStorage` serait plus simple et faux : une chaîne qu'on ne retrouve pas en changeant
 * de poste n'est pas « la sienne », c'est un brouillon d'onglet. Et surtout, on ne peut
 * partager que ce qui existe quelque part — un fork suppose un original joignable.
 *
 * Le dépôt reste donc la seule source de vérité, comme partout ici. Le dossier porte
 * l'état, comme `artifacts/pending/` porte « en revue ».
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers.
 */

/** Où vivent les chaînes personnelles. Le dossier porte le propriétaire. */
export const RACINE = 'mes-chaines';

/** Un identifiant de personne réduit à ce qui peut être un nom de dossier. */
export function proprietaire(qui) {
  const propre = String(qui || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 39);
  return propre || 'anonyme';
}

/** Le chemin d'une chaîne personnelle. Jamais composé ailleurs. */
export const chemin = (qui, id) => `${RACINE}/${proprietaire(qui)}/${id}.yaml`;

/** Le dossier d'une personne — ce qu'on liste pour afficher « les miennes ». */
export const dossier = (qui) => `${RACINE}/${proprietaire(qui)}`;

/**
 * À qui appartient ce chemin ? `null` si ce n'en est pas un.
 *
 * Sert à l'écran pour distinguer « la mienne » de « celle d'un autre » sans avoir à
 * refaire la découpe à chaque endroit — et donc sans risquer de la refaire différemment.
 */
export function depuisChemin(p) {
  const m = new RegExp(`^${RACINE}/([a-z0-9_-]+)/([a-z][a-z0-9-]*)\\.ya?ml$`).exec(String(p || ''));
  return m ? { qui: m[1], id: m[2] } : null;
}

/* ── Le fork ──────────────────────────────────────────────────────────────── */

/**
 * Une copie personnelle d'une chaîne existante.
 *
 * Trois choses changent, et aucune n'est cosmétique :
 *
 *   owner.person   le fork ENGAGE celui qui forke. Garder l'auteur d'origine ferait
 *                  porter à quelqu'un d'autre une chaîne qu'il n'a pas écrite — et qu'il
 *                  découvrirait le jour où elle casse.
 *   id             suffixé, sinon la copie écraserait l'original au dépôt et deux
 *                  personnes qui forkent la même chaîne se marcheraient dessus.
 *   target_level   remis à `experimental` : un fork n'a jamais été mesuré, même si son
 *                  original l'avait été. C'est un autre fichier, il refait ses preuves.
 *
 * Le reste — les étapes, le câblage — est copié tel quel : c'est précisément ce qu'on
 * vient chercher. Et `derive` n'est pas copié parce qu'il n'est pas dans le fichier.
 */
export function forker(artefact, { qui, suffixe = 'moi' } = {}) {
  if (!artefact || artefact.kind !== 'chain') return null;

  const base = String(artefact.id || 'chaine').replace(/-(de|par)-[a-z0-9-]+$/, '');
  const copie = structuredClone(artefact);

  copie.id = `${base}-de-${proprietaire(suffixe || qui)}`.slice(0, 64).replace(/-+$/, '');
  copie.owner = { ...(copie.owner || {}), person: qui || copie.owner?.person || '' };
  copie.target_level = 'experimental';

  return copie;
}

/**
 * De qui vient ce fork ? `null` si l'artefact n'en porte pas la trace.
 *
 * L'origine vit en provenance (commentaires de tête), pas dans le fichier YAML : elle
 * décrit d'où le fichier vient, pas ce que la capacité fait. Même règle que pour la
 * dictée — deux chaînes identiques, l'une écrite et l'autre forkée, sont la même capacité.
 */
export function estFork(artefact, provenance) {
  return provenance?.origine === 'fork' ? { de: provenance.auteur || '', quoi: provenance.phrase || '' } : null;
}

/* ── Ce qui est à moi ─────────────────────────────────────────────────────── */

/**
 * Le classement d'une chaîne du point de vue de quelqu'un.
 *
 * Trois états, et le troisième est celui qui manquait au produit : une chaîne peut être
 * à moi ET déjà partagée. Confondre « la mienne » et « privée » ferait disparaître de mon
 * établi ce que je viens de faire valider — c'est-à-dire mon meilleur travail.
 */
export function etat(chaine, qui) {
  const moi = proprietaire(qui);
  const mienne = proprietaire(chaine?.proprietaire) === moi;
  if (chaine?.publiee) return mienne ? 'partagee' : 'du-registre';
  return mienne ? 'privee' : 'a-quelquun-dautre';
}

export const ETATS = {
  privee: { label: 'à moi', aide: 'Sauvée chez toi. Personne d\'autre ne la voit.' },
  partagee: { label: 'partagée', aide: 'Tu l\'as envoyée en validation : elle engage le registre.' },
  'du-registre': { label: 'au registre', aide: 'Validée, visible de tous. Forke-la pour l\'adapter.' },
  'a-quelquun-dautre': { label: 'à quelqu\'un d\'autre', aide: 'Forke-la pour en avoir ta version.' }
};

export default { RACINE, proprietaire, chemin, dossier, depuisChemin, forker, estFork,
                 etat, ETATS };
