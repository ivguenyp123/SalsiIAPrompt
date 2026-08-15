/*
 * Le sommaire du guide — la seule liste écrite à la main, et elle est vérifiée.
 *
 * ── POURQUOI UNE LISTE, ALORS QUE LE RESTE EST DÉRIVÉ ────────────────────────
 *
 * Tout ce produit dérive plutôt que de déclarer. Ici on ne peut pas : l'écran est servi
 * en statique, et un navigateur ne sait pas lister un dossier. Il faut donc dire les
 * pages.
 *
 * Une liste écrite à la main dans un dépôt vivant se désynchronise — c'est une loi. On
 * la traite donc comme une déclaration à confronter, exactement comme un artefact :
 * `test/doc.test.js` échoue si une page existe sans être listée, ou si une page listée
 * n'existe pas. La désynchronisation devient un test rouge au lieu d'un lien mort.
 *
 * ── L'ORDRE EST CELUI DE LA PREMIÈRE VISITE ──────────────────────────────────
 *
 * Ni l'alphabet ni la chronologie : ce qu'on ouvre en premier quand on ne connaît pas.
 * D'abord ce qu'on veut FAIRE (demander, trouver, composer), puis ce qu'on veut
 * COMPRENDRE (valider, niveaux), puis ce qu'on cherche quand ça coince (refus, mots).
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers.
 */

/** Où vivent les pages. Jamais recomposé ailleurs. */
export const RACINE = 'docs';

/**
 * Les pages du guide, dans l'ordre du sommaire.
 *
 * `pour` est la phrase qui dit à qui la page s'adresse — c'est ce qui évite qu'on lise
 * les sept dans l'ordre en cherchant celle qui nous concerne.
 */
export const PAGES = [
  { cle: 'index', fichier: 'index.md', titre: 'Guide d\'utilisation',
    pour: 'Commencer ici — les deux principes, et où aller ensuite.' },
  { cle: 'demander', fichier: 'demander.md', titre: 'Demander un agent',
    pour: 'Vous avez un besoin, pas un agent.' },
  { cle: 'catalogue', fichier: 'catalogue.md', titre: 'Trouver et lancer',
    pour: 'Chercher ce qui existe, lire une fiche, lancer sur votre dépôt.' },
  { cle: 'composer', fichier: 'composer.md', titre: 'Composer',
    pour: 'Un agent à partir de prompts, ou une chaîne d\'agents. Deux choses différentes.' },
  { cle: 'valider', fichier: 'valider.md', titre: 'Valider',
    pour: 'Vous relisez ce que les équipes soumettent.' },
  { cle: 'niveaux', fichier: 'niveaux.md', titre: 'Niveaux et certification',
    pour: 'Visé contre atteint, le banc d\'essai, les 90 jours.' },
  { cle: 'refus', fichier: 'refus.md', titre: 'Quand ça refuse',
    pour: 'Les 32 codes, un par un, avec la manœuvre.' },
  { cle: 'mots', fichier: 'mots.md', titre: 'Les mots du produit',
    pour: 'Palier, périmètre, cas d\'or, post-vol. Cinq minutes.' }
];

/** La page demandée, ou la première. Une clé inconnue ne doit pas rendre un écran vide. */
export function page(cle) {
  return PAGES.find((p) => p.cle === cle) || PAGES[0];
}

/** Le chemin d'une page, depuis la racine du dépôt. */
export const chemin = (p) => `${RACINE}/${p.fichier}`;

/**
 * Un lien de la doc, réécrit pour l'écran.
 *
 * Les pages se lient entre elles en `[…](refus.md)` : ça marche sur GitHub, où la doc se
 * lit aussi. Dans l'application, ces mêmes liens doivent devenir de la navigation
 * interne — sinon un clic quitte le produit pour afficher du Markdown brut.
 *
 * Le reste (`http…`, une ancre seule) passe intact.
 */
export function lien(href, { prefixe = '?p=' } = {}) {
  const h = String(href || '');
  const m = /^([a-z0-9-]+)\.md(#.*)?$/i.exec(h);
  if (!m) return h;
  const p = PAGES.find((x) => x.fichier.toLowerCase() === `${m[1].toLowerCase()}.md`);
  return p ? `${prefixe}${p.cle}${m[2] || ''}` : h;
}

/** Les liens internes d'une page — ce que le test confronte aux fichiers présents. */
export function liensInternes(source) {
  const out = [];
  const re = /\[[^\]]+\]\(([a-z0-9-]+\.md)(?:#[^)]*)?\)/gi;
  let m;
  while ((m = re.exec(String(source || '')))) out.push(m[1]);
  return [...new Set(out)];
}

export default { RACINE, PAGES, page, chemin, lien, liensInternes };
