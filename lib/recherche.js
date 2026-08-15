/*
 * Le moteur de recherche du catalogue — trouver une capacité qu'on ne sait pas nommer.
 *
 * ── POURQUOI L'ANCIEN NE SUFFISAIT PLUS ──────────────────────────────────────
 *
 * Il faisait `haystack.includes(mot)` sur tous les champs collés bout à bout, et rendait
 * les résultats dans l'ordre du dossier. À seize artefacts ça passe. À cent — et le
 * catalogue en vise cent trente — ça se casse de trois façons :
 *
 *   — chercher « revue » remonte autant un agent DONT C'EST LE TITRE qu'un agent dont le
 *     `not_for` dit « pas pour une revue ». L'ordre du dossier tranche, c'est-à-dire
 *     l'alphabet.
 *   — chercher « secret » ne trouve pas `output.contains_secret`, alors que c'est
 *     exactement ce que la personne veut : un agent qui vérifie les secrets.
 *   — chercher « revu » ne trouve rien, parce qu'on n'a pas fini de taper.
 *
 * ── CE QUE CELUI-CI FAIT ─────────────────────────────────────────────────────
 *
 * Il PONDÈRE et il CLASSE. Un mot dans le titre pèse plus qu'un mot dans une description,
 * qui pèse plus qu'un nom de variable. Il accepte les préfixes, donc il répond pendant
 * qu'on tape. Et il dit POURQUOI il a trouvé — sans ça, un résultat inattendu ressemble à
 * un bug, et on cesse de faire confiance au champ.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/** Sans accents, sans casse — « requête » et « requete » sont le même mot. */
export const plier = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Les mots d'un texte, dédoublonnés. `output.contains_secret` en donne trois. */
const mots = (s) => [...new Set(plier(s).split(/[^a-z0-9]+/).filter((m) => m.length > 1))];

/*
 * Les champs fouillés, et ce que chacun pèse.
 *
 * L'ordre n'est pas arbitraire : il suit ce qu'on cherche quand on cherche une capacité.
 * On cherche d'abord ce qu'elle FAIT (titre, intention), ensuite comment elle est rangée
 * (étiquettes, périmètre), et en dernier ce qu'elle manipule (entrées, cibles). Un nom de
 * variable qui pèserait autant qu'un titre ferait remonter « relire un changement » sur
 * une recherche « repo », parce que TOUS les artefacts déclarent `repo`.
 */
const CHAMPS = [
  { cle: 'titre', poids: 10, quoi: 'le titre' },
  { cle: 'tags', poids: 7, quoi: 'une étiquette' },
  { cle: 'purpose', poids: 5, quoi: 'ce à quoi ça sert' },
  { cle: 'scope', poids: 4, quoi: 'le périmètre' },
  { cle: 'id', poids: 3, quoi: 'l\'identifiant' },
  { cle: 'entrees', poids: 2, quoi: 'ce qu\'il lit' },
  { cle: 'cibles', poids: 2, quoi: 'ce qu\'il vérifie' },
  { cle: 'notFor', poids: 1, quoi: 'ses limites' }
];

/**
 * L'index d'un artefact : ses mots, rangés par champ.
 *
 * Calculé une fois au chargement, pas à chaque frappe. Sur cent trente artefacts, replier
 * les accents à chaque touche du clavier se sent.
 */
export function indexer(artefact = {}) {
  return {
    titre: mots(artefact.title),
    tags: mots((artefact.tags || []).join(' ')),
    purpose: mots(artefact.intent?.purpose),
    notFor: mots(artefact.intent?.not_for),
    scope: mots(artefact.owner?.scope),
    id: mots(artefact.id),
    entrees: mots((artefact.variables || []).map((v) => v.name).join(' ')),
    cibles: mots((artefact.criteria || []).map((c) => c.target).join(' '))
  };
}

/**
 * Le score d'un artefact pour une requête, et la raison.
 *
 * TOUS les fragments doivent correspondre — « revue sql » ne rend pas tout ce qui parle de
 * revue. Un fragment est satisfait par un PRÉFIXE : « revu » trouve « revue », ce qui est
 * ce qu'on veut quand on n'a pas fini de taper.
 *
 * @returns {{score, pourquoi}} — `score: 0` quand un fragment ne trouve rien
 */
export function noter(index, fragments = []) {
  if (fragments.length === 0) return { score: 1, pourquoi: [] };

  let total = 0;
  const raisons = new Set();

  for (const f of fragments) {
    let meilleur = 0;
    let quoi = '';

    for (const champ of CHAMPS) {
      for (const m of index[champ.cle] || []) {
        // Le mot exact vaut plus que le préfixe : « test » doit préférer « tests » à
        // « tester une migration », sans quoi taper plus long dégraderait le classement.
        const gain = m === f ? champ.poids * 2 : m.startsWith(f) ? champ.poids : 0;
        if (gain > meilleur) { meilleur = gain; quoi = champ.quoi; }
      }
    }

    if (meilleur === 0) return { score: 0, pourquoi: [] };   // ce fragment ne trouve rien
    total += meilleur;
    raisons.add(quoi);
  }

  return { score: total, pourquoi: [...raisons] };
}

/** Les fragments d'une requête. */
export const fragments = (q) => plier(q).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * La recherche, classée.
 *
 * `garder` filtre AVANT le classement — les filtres de type et d'étiquette réduisent
 * l'ensemble, ils ne le réordonnent pas. Mélanger les deux ferait remonter un artefact
 * écarté par un filtre juste parce qu'il a un bon score.
 *
 * @param {Array} entrees  [{ index, ... }] — l'index est calculé une fois au chargement
 */
export function chercher(entrees = [], q = '', garder = () => true) {
  const f = fragments(q);

  return entrees
    .filter(garder)
    .map((e) => ({ entree: e, ...noter(e.index, f) }))
    .filter((r) => r.score > 0)
    // À score égal, l'ordre reste STABLE : deux recherches identiques rendent la même
    // liste, et rien ne bouge sous le curseur entre deux frappes.
    .sort((a, b) => b.score - a.score);
}

/* ── Les étiquettes ───────────────────────────────────────────────────────── */

/**
 * Le nuage d'étiquettes, avec les comptes.
 *
 * Dérivé du registre, jamais saisi : une liste d'étiquettes tenue à côté divergerait au
 * premier artefact publié. Trié par fréquence puis par ordre alphabétique — les
 * étiquettes qui rangent vraiment quelque chose passent devant celles qui n'ont servi
 * qu'une fois.
 */
export function etiquettes(artefacts = []) {
  const par = new Map();
  for (const a of artefacts) {
    for (const t of a?.tags || []) {
      const cle = String(t).trim();
      if (!cle) continue;
      par.set(cle, (par.get(cle) || 0) + 1);
    }
  }
  return [...par.entries()]
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'fr'));
}

/** Un artefact porte-t-il TOUTES les étiquettes retenues ? */
export function porteEtiquettes(artefact, retenues = []) {
  if (retenues.length === 0) return true;
  const siennes = new Set((artefact?.tags || []).map((t) => plier(t)));
  return retenues.every((t) => siennes.has(plier(t)));
}

export default { plier, indexer, noter, chercher, fragments, etiquettes, porteEtiquettes };
