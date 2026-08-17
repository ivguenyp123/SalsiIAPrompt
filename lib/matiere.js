/*
 * La matière — ce qu'on donne à lire à un agent, et d'où ça vient.
 *
 * ── CE QUE ÇA DÉBLOQUE ───────────────────────────────────────────────────────
 *
 * Jusqu'ici, exécuter un agent supposait de COLLER sa matière : le diff, le journal, le
 * fichier. Ça marche une fois, pour la démonstration. Personne ne le fait deux fois — et
 * un registre d'agents que personne ne relance est un catalogue de bonnes intentions.
 *
 * La banque d'entrées (`entrees/`) n'a jamais eu vocation à régler ça : c'est de la
 * matière de TEST, choisie pour couvrir des genres de signal, figée exprès pour que les
 * cas d'or soient reproductibles. On ne travaille pas sur du fixture.
 *
 * Ici, la plateforme va chercher la matière RÉELLE dans la forge, avec le jeton de
 * l'utilisateur, dans son navigateur. Un fichier de son dépôt, ou le diff d'une pull
 * request ouverte.
 *
 * ── « C'EST TOI QUI CHOISIS » ────────────────────────────────────────────────
 *
 * La règle qui gouverne tout ce module, et la seule qui compte : **elle propose, elle
 * n'injecte jamais**. Rien n'est récupéré sans un clic, tout ce qui est récupéré reste
 * MODIFIABLE, et ce qui part au modèle est exactement ce qui est affiché — pas une
 * relecture faite au moment du départ, qui pourrait avoir changé entre-temps.
 *
 * C'est le principe du pré-vol, appliqué à l'entrée au lieu de la sortie : un contrôle
 * qui refuse ce qu'il SAIT et demande ce qu'il IGNORE. La plateforme sait aller chercher
 * un diff ; elle ignore si c'est CE diff-là que tu voulais.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/** Les sources de matière. L'ordre est celui du sélecteur. */
export const SOURCES = [
  { id: 'fichier', icone: '📄', libelle: 'Un fichier du dépôt',
    aide: 'Cherche par chemin, choisis, le contenu remplit le champ.' },
  { id: 'pull', icone: '🔀', libelle: 'Une pull request ouverte',
    aide: 'Le diff complet de la PR, tel qu\'un relecteur le verrait.' },
  { id: 'colle', icone: '⌨️', libelle: 'Je colle moi-même',
    aide: 'Rien n\'est récupéré : le champ reste à toi.' }
];

/*
 * Les entrées qui tiennent sur UNE LIGNE, et elles seules.
 *
 * ── LE DÉFAUT QUE CETTE LISTE FERME ──────────────────────────────────────────
 *
 * L'écran choisissait le champ d'après la SOURCE déclarée : `source: repo` donnait une
 * ligne de saisie, tout le reste donnait la zone de matière avec ses sélecteurs. Deux
 * agents qui font la même chose se comportaient donc différemment, selon un mot que leur
 * auteur n'a pas choisi consciemment :
 *
 *   `expliquer-un-code.yaml`   `code: signal`  → zone + « un fichier du dépôt »  ✔
 *   `analyseur-de-code.yaml`   `code: repo`    → une ligne de saisie, rien d'autre ✘
 *
 * Sur le second, impossible de choisir un fichier — et impossible même d'en coller un,
 * puisqu'une ligne de saisie ne contient pas un fichier.
 *
 * ── POURQUOI UNE LISTE, ET DANS CE SENS-LÀ ───────────────────────────────────
 *
 * La zone de matière est un SURENSEMBLE de la ligne de saisie : elle offre les sélecteurs
 * ET « je colle moi-même ». Se tromper en donnant une zone à une entrée courte coûte un
 * champ un peu grand ; se tromper dans l'autre sens rend l'agent inutilisable.
 *
 * On nomme donc ce qui est COURT, et tout le reste — y compris ce qu'on ne connaît pas
 * encore, comme une entrée sortie de Fabriquer — reçoit la zone. Le défaut penche du côté
 * où l'erreur se rattrape.
 */
export const IDENTIFIANTS = new Set([
  'stack',            // « java 17 », « node »
  'environnements',   // « dev, uat, prod »
  'version_source',   // « 11 »
  'version_cible',
  'branche_cible',    // « main »
  'branche'
]);

/** Cette entrée tient-elle sur une ligne, ou porte-t-elle de la matière ? */
export const estUnIdentifiant = (variable) =>
  IDENTIFIANTS.has(String(variable?.name || '').trim().toLowerCase());

/**
 * La source la plus PROBABLE pour une variable, d'après ce qu'elle déclare.
 *
 * Une proposition, jamais un choix : le sélecteur s'ouvre dessus et se change d'un clic.
 * Deviner sans le montrer serait exactement ce que ce module refuse — mais ne rien
 * proposer ferait recommencer le même réglage à chaque exécution.
 *
 * Le nom de la variable est un indice plus sûr que sa `source` : `source: signal` dit
 * seulement « ça vient du poste », pas ce que c'est. `diff`, lui, ne veut dire qu'une
 * chose — et c'est la même convention que la banque d'entrées, où la nature d'un signal
 * EST son nom.
 */
export function sourceProbable(variable = {}) {
  const nom = String(variable.name || '').toLowerCase();
  if (/diff|patch|changement|change/.test(nom)) return 'pull';
  if (/code|fichier|file|source|module|classe|requete|query|sql|config/.test(nom)) return 'fichier';
  // Un journal de pipeline ne se récupère pas encore : il vit dans la CI, pas au dépôt.
  // Proposer « fichier » ferait chercher un fichier qui n'existe pas.
  if (/log|journal|trace|sortie/.test(nom)) return 'colle';
  return variable.source === 'repo' ? 'colle' : 'fichier';
}

/* ── La recherche de fichier ──────────────────────────────────────────────── */

const plier = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Les chemins qui correspondent à une recherche, les plus pertinents d'abord.
 *
 * Un dépôt réel a des milliers de fichiers ; une liste brute est inutilisable et un
 * navigateur d'arborescence demande un clic par dossier. La recherche par fragments —
 * `foo serv` trouve `src/main/java/FooService.java` — est ce qui rend un gros dépôt
 * praticable sans rien charger de plus.
 *
 * @param {string[]} chemins  l'arbre plat du dépôt
 * @param {string} q          les fragments, séparés par des espaces
 * @param {number} max        au-delà, on tronque et l'appelant le DIT
 */
export function chercher(chemins = [], q = '', max = 50) {
  const mots = plier(q).split(/\s+/).filter(Boolean);
  const gardes = [];

  for (const chemin of chemins) {
    const plie = plier(chemin);
    if (!mots.every((m) => plie.includes(m))) continue;

    // Le nom de fichier compte plus que le dossier : chercher « service » doit remonter
    // `FooService.java` avant `services/config/x.yaml`.
    const nom = plie.slice(plie.lastIndexOf('/') + 1);
    const score = mots.filter((m) => nom.includes(m)).length * 100 - chemin.length;
    gardes.push({ chemin, score });
  }

  gardes.sort((a, b) => b.score - a.score);
  return { chemins: gardes.slice(0, max).map((g) => g.chemin), total: gardes.length,
           tronque: gardes.length > max };
}

/* ── Le diff d'une pull request ───────────────────────────────────────────── */

/**
 * Un diff unifié, assemblé depuis les changements par fichier rendus par la forge.
 *
 * GitHub et GitLab rendent tous deux un patch PAR FICHIER, sans les en-têtes `diff --git`
 * qui font d'une liste de morceaux un diff. Or c'est cette forme-là que les agents
 * attendent — c'est celle de la banque d'entrées, celle qu'un `git diff` produit, et
 * celle que `output.files_touched` sait compter. Reconstruire l'en-tête ici évite que
 * chaque agent ait à deviner le format de sa forge.
 *
 * @param {Array} changements  [{ fichier, ancien, patch, binaire }]
 * @returns {{texte, fichiers, ignores}}
 */
export function diffUnifie(changements = []) {
  const morceaux = [];
  const ignores = [];

  for (const c of changements || []) {
    const apres = c.fichier || c.ancien;
    const avant = c.ancien || c.fichier;
    if (!apres) continue;

    /*
     * Un binaire n'a pas de patch. L'omettre en silence ferait croire à un diff complet ;
     * on le NOMME dans le corps du diff, comme git le fait, et on le compte à part pour
     * que l'écran puisse le dire.
     */
    if (c.binaire || !c.patch) {
      morceaux.push(`diff --git a/${avant} b/${apres}\nBinary files a/${avant} and b/${apres} differ`);
      ignores.push(apres);
      continue;
    }

    morceaux.push(`diff --git a/${avant} b/${apres}\n--- a/${avant}\n+++ b/${apres}\n${c.patch.replace(/\n$/, '')}`);
  }

  return { texte: morceaux.join('\n'), fichiers: morceaux.length, ignores };
}

/* ── Ce qu'on affiche de la matière récupérée ─────────────────────────────── */

/** Deux chiffres et une origine — de quoi juger d'un coup d'œil ce qu'on s'apprête à envoyer. */
export function resume(texte, origine = '') {
  const t = String(texte || '');
  const lignes = t === '' ? 0 : t.split('\n').length;
  return {
    lignes,
    caracteres: t.length,
    origine,
    // Un ordre de grandeur du coût, avant de payer. Quatre caractères par jeton est
    // grossier et c'est dit — mais « 48 000 caractères » ne parle à personne, et
    // « ≈ 12 000 jetons » fait reculer devant un fichier-fleuve.
    jetons: Math.ceil(t.length / 4)
  };
}

/**
 * Faut-il prévenir avant d'envoyer ça ?
 *
 * Pas un refus : c'est légitime de donner un gros fichier à un agent, et le palier de
 * modèle est là pour ça. Mais l'envoyer sans le savoir coûte, et surtout dilue — un
 * agent noyé dans 2 000 lignes répond moins bien que sur les 80 qui comptent. C'est
 * exactement ce que la banque a montré avec `fichier-fleuve`.
 */
export const GROS = 40_000;
export const grosse = (texte) => String(texte || '').length > GROS;

export default { SOURCES, sourceProbable, chercher, diffUnifie, resume, grosse, GROS };
