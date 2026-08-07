/*
 * La banque d'entrées — résolution.
 *
 * ── LE PROBLÈME QU'ELLE RÈGLE ────────────────────────────────────────────────
 *
 * Un cas d'or se joue sur quelque chose. Pour un agent qui écrit, ce quelque chose est
 * un dépôt jetable. Pour tous les autres — la majorité du catalogue : expliquer,
 * commenter, résumer, rédiger — c'est un simple texte capturé : un diff, un journal de
 * pipeline, un script de migration.
 *
 * La première idée était de demander ce texte à l'auteur. Elle est mauvaise : personne
 * ne va « capturer un diff représentatif », et celui qui s'exécute colle le premier truc
 * qui traîne. Le test ne vaut alors rien, mais il compte pour L010.
 *
 * ── CE QUI LA REND POSSIBLE ──────────────────────────────────────────────────
 *
 * Un diff est un diff. Rien dans `diff/petit-fix.txt` n'appartient à l'agent qui le
 * consomme. La banque est donc rangée par NATURE de signal, pas par agent — et un
 * nouvel artefact hérite de ce qui existe déjà au lieu de repartir de zéro.
 *
 * Le lien entre l'artefact et la banque ne demande aucun champ nouveau :
 *
 *     variables: [{ name: diff, source: signal }]     ← la nature, c'est le nom
 *     golden_cases: [{ context: { diff_fixture: petit-fix } }]
 *
 * `<nature>_fixture` était déjà la convention écrite à la main dans commit-message.yaml
 * avant que la banque existe. On la rend exécutable plutôt que de la remplacer.
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers. Le manifeste est INJECTÉ,
 * exactement comme le registre des cibles — c'est ce qui permet à la règle L023 de
 * rendre le même verdict en CI et dans le navigateur.
 */

/** Une clé de contexte qui désigne une entrée de la banque. Le préfixe est la nature. */
export const CLE_FIXTURE = /^([a-z][a-z0-9_]*)_fixture$/;

/** La nature désignée par une clé de contexte, ou `null` si ce n'en est pas une. */
export function natureDeCle(cle) {
  const m = CLE_FIXTURE.exec(String(cle || ''));
  return m ? m[1] : null;
}

/**
 * Les natures qu'un artefact consomme : ses variables de `source: signal`.
 *
 * Une variable de `source: repo` (le nom du dépôt, la stack) ou `source: user` n'a
 * rien à capturer — c'est une chaîne. Seul le signal est de la matière.
 */
export function naturesRequises(variables = []) {
  return (variables || [])
    .filter((v) => v?.name && v.source === 'signal')
    .map((v) => v.name);
}

/** Le bloc d'une nature au manifeste, ou `undefined`. */
export function nature(banque, nom) {
  return (banque?.natures || []).find((n) => n.nature === nom);
}

/** Une entrée précise, ou `undefined`. */
export function entree(banque, nom, id) {
  return (nature(banque, nom)?.entrees || []).find((e) => e.id === id);
}

/**
 * L'entrée à proposer pour un genre de situation.
 *
 * On ne rend jamais un fichier au hasard : `exclure` permet de ne pas resservir la
 * même entrée à deux cas du même genre — sinon « 2 cas nominaux » testerait deux fois
 * la même chose et le compte de L010 serait un trompe-l'œil.
 *
 * Faute d'entrée du genre demandé on retombe sur `nominal`, puis sur la première : un
 * cas joué sur une entrée du mauvais genre reste plus utile qu'un cas joué sur du vide.
 */
export function pourGenre(banque, nom, genre, exclure = []) {
  const toutes = nature(banque, nom)?.entrees || [];
  const libres = toutes.filter((e) => !exclure.includes(e.id));
  const dans = (liste, g) => liste.find((e) => e.genre === g);
  return dans(libres, genre) || dans(toutes, genre)
      || dans(libres, 'nominal') || libres[0] || toutes[0];
}

/**
 * Ce qu'un cas d'or désigne dans la banque, et ce qui n'y est pas.
 *
 * @returns {Array} un constat par clé `*_fixture` :
 *   { cle, nature, id, entree }  — `entree` absent = la cible n'existe pas
 *   `natureConnue` distingue « aucune entrée de cette nature » de « cet identifiant-là
 *   n'existe pas », deux erreurs qui ne se corrigent pas de la même façon.
 */
export function references(contexte = {}, banque) {
  const out = [];
  for (const [cle, valeur] of Object.entries(contexte || {})) {
    const nom = natureDeCle(cle);
    if (!nom) continue;
    const bloc = nature(banque, nom);
    out.push({
      cle, nature: nom, id: String(valeur ?? ''),
      natureConnue: Boolean(bloc),
      entree: bloc ? entree(banque, nom, String(valeur ?? '')) : undefined
    });
  }
  return out;
}

/** Le chemin d'un fichier d'entrée, relatif à la racine du registre. */
export const chemin = (e) => (e ? `entrees/${e.fichier}` : '');

/** Toutes les entrées, à plat — pour un décompte ou une liste déroulante. */
export function toutes(banque) {
  return (banque?.natures || []).flatMap((n) =>
    (n.entrees || []).map((e) => ({ ...e, nature: n.nature })));
}

export default { CLE_FIXTURE, natureDeCle, naturesRequises, nature, entree, pourGenre,
                 references, chemin, toutes };
