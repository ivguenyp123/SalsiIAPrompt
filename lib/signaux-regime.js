/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CE QU'UN DÉPÔT VERSIONNE ET NE DEVRAIT PAS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Extrait de `js/repo-diet.js` du hub, qui classe l'arborescence d'un dépôt en onze
 * familles de superflu — binaires livrés, archives, médias, journaux, dumps, dossiers de
 * dépendances, sorties de build, réglages d'IDE, et le pire de tous : des clés privées.
 *
 * ── POURQUOI UN SIGNAL, ET PAS UN AGENT QUI REGARDE ──────────────────────────
 *
 * « Le chiffre au code, l'explication à l'agent. » Qu'un fichier s'appelle `.jar` ou vive
 * sous `node_modules/` n'est pas une opinion : ça se compte, ça se recompte, et deux
 * personnes obtiennent le même chiffre. Ce qu'un modèle apporte, c'est ce qui vient
 * après : par quoi commencer, ce que ça coûte à celui qui clone, et ce qui se casse si on
 * l'enlève sans prévenir.
 *
 * ── LA LIMITE, ET ELLE EST DITE EN TÊTE DE LA MATIÈRE ────────────────────────
 *
 * CE SIGNAL NE PÈSE RIEN. `listTree` rend des CHEMINS, sur les deux forges — GitLab
 * n'expose pas la taille dans son arbre, et bâtir un régime sur des tailles disponibles
 * d'un côté seulement produirait un rapport qui change de verdict selon la forge.
 *
 * On aurait pu appeler l'API fichier par fichier pour obtenir les tailles. Sur un dépôt
 * qui porte `node_modules`, ce sont des dizaines de milliers d'appels pour apprendre ce
 * que le chemin disait déjà : `node_modules/` n'a rien à faire dans git, à n'importe
 * quelle taille. « N/A n'est pas zéro » — donc on ne dit pas « ce dépôt pèse X Mo », on
 * dit ce qui est là et combien de fichiers, et la matière interdit au modèle d'inventer
 * le reste.
 *
 * ── ET CE QU'IL N'EST PAS ────────────────────────────────────────────────────
 *
 * Ce n'est pas `rapport_secrets`, qui cherche des VALEURS de secret dans le CONTENU des
 * fichiers. Ici on ne lit aucun contenu : un `.pem` versionné est un constat de chemin.
 * Les deux se complètent et aucun ne remplace l'autre — un `.pem` peut ne contenir qu'un
 * certificat public, et une clé privée peut vivre dans un `.yaml` que ce signal ne
 * regarde même pas.
 */

/**
 * LES FAMILLES DE SUPERFLU, ET L'ORDRE COMPTE.
 *
 * Une famille par ligne, testée dans l'ordre : le premier qui matche gagne. `cles` passe
 * donc avant tout le reste — un `.pem` sous `build/` est une clé avant d'être une sortie
 * de build, et c'est bien la clé qu'on veut voir remonter.
 *
 * `geste` n'est pas un conseil du modèle : c'est ce que l'écosystème fait de cette famille
 * depuis toujours, et l'écrire ici plutôt que dans un prompt le rend contestable.
 */
export const FAMILLES = [
  { id: 'cles', libelle: 'Clés et certificats', gravite: 'bloquant',
    extensions: ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk'],
    geste: 'à retirer ET à révoquer — présent dans l\'historique, donc compromis' },
  { id: 'donnees', libelle: 'Données et sauvegardes', gravite: 'lourd',
    extensions: ['.sql', '.dump', '.bak', '.mdb', '.sqlite', '.sqlite3'],
    geste: 'hors de git — et vérifier qu\'aucune donnée personnelle n\'y est' },
  { id: 'dependances', libelle: 'Dossiers de dépendances', gravite: 'lourd',
    dossiers: ['node_modules', 'vendor', 'bower_components', 'venv', '.venv',
               'virtualenv', '__pycache__', '.gradle', '.m2'],
    geste: '.gitignore + installation reproductible depuis le manifeste' },
  { id: 'build', libelle: 'Sorties de build', gravite: 'lourd',
    dossiers: ['target', 'build', 'dist', 'out', 'bin', 'obj', '.next', '.nuxt',
               'coverage', '.pytest_cache', '.mypy_cache'],
    geste: '.gitignore — c\'est la chaîne CI qui les produit' },
  { id: 'binaires', libelle: 'Binaires livrés', gravite: 'lourd',
    extensions: ['.jar', '.war', '.ear', '.class', '.dll', '.exe', '.pdb', '.so',
                 '.dylib', '.o', '.a', '.pyc', '.pyo'],
    geste: 'un dépôt d\'artefacts (Nexus, Artifactory), pas git' },
  { id: 'archives', libelle: 'Archives', gravite: 'lourd',
    extensions: ['.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.rar', '.7z'],
    geste: 'stockage externe — git ne sait pas les compresser à nouveau' },
  { id: 'medias', libelle: 'Médias lourds', gravite: 'lourd',
    extensions: ['.mp4', '.avi', '.mov', '.mkv', '.mp3', '.wav', '.flac',
                 '.psd', '.ai', '.sketch', '.iso', '.dmg'],
    geste: 'Git LFS, ou un stockage d\'objets' },
  { id: 'journaux', libelle: 'Journaux et traces', gravite: 'friction',
    extensions: ['.log', '.out', '.trace'], dossiers: ['logs'],
    geste: '.gitignore — une trace d\'exécution ne se relit jamais depuis git' },
  { id: 'poste', libelle: 'Réglages de poste', gravite: 'friction',
    dossiers: ['.idea', '.vscode', '.vs', '.settings'],
    fichiers: ['.DS_Store', 'Thumbs.db', 'desktop.ini', '.project', '.classpath'],
    geste: '.gitignore — ce sont les réglages d\'une personne, pas ceux du projet' },
  { id: 'temporaires', libelle: 'Restes de travail', gravite: 'friction',
    extensions: ['.swp', '.swo', '.orig', '.rej', '.tmp', '.bak~'],
    motifs: [/(?:^|\/)[^/]*\.(?:orig|rej)$/i, /~$/],
    geste: 'à supprimer — ce sont des restes de fusion ou d\'éditeur' }
];

/** La gravité est un vocabulaire FERMÉ : trois mots, et le rapport s'y tient. */
export const GRAVITES = ['bloquant', 'lourd', 'friction'];

const extensionDe = (chemin) => {
  const nom = chemin.slice(chemin.lastIndexOf('/') + 1);
  const point = nom.lastIndexOf('.');
  return point > 0 ? nom.slice(point).toLowerCase() : '';
};

const segments = (chemin) => chemin.split('/').slice(0, -1);

/**
 * À quelle famille ce chemin appartient — ou aucune.
 *
 * PUR ET DÉTERMINISTE : même arbre, même verdict, par qui que ce soit. C'est ce qui rend
 * le constat contestable, et donc utile.
 */
export function familleDe(chemin) {
  const ext = extensionDe(chemin);
  const dossiers = segments(chemin);
  const nom = chemin.slice(chemin.lastIndexOf('/') + 1);
  for (const f of FAMILLES) {
    if (f.extensions?.includes(ext)) return f;
    if (f.dossiers?.some((d) => dossiers.includes(d))) return f;
    if (f.fichiers?.includes(nom)) return f;
    if (f.motifs?.some((m) => m.test(chemin))) return f;
  }
  return null;
}

/** Le premier segment d'un chemin — la zone où le superflu se concentre. */
const zoneDe = (chemin) => (chemin.includes('/') ? chemin.slice(0, chemin.indexOf('/')) : '.');

const MAX_EXEMPLES = 6;
const MAX_ZONES = 8;

/**
 * Le régime d'un dépôt : ce qu'il porte de superflu, par famille et par zone.
 *
 * @param {object} e
 *   @param {string} e.depot
 *   @param {string} e.ref            la branche lue
 *   @param {Array<string>} e.arbre   l'arborescence ENTIÈRE, en chemins
 *   @param {string} e.gitignore      son contenu, ou '' s'il n'y en a pas
 *   @param {Date} e.maintenant
 */
export function analyseRegime({ depot = '', ref = '', arbre = [], gitignore = '',
                                maintenant = new Date() } = {}) {
  const parFamille = new Map();
  const parZone = new Map();
  let superflus = 0;

  for (const chemin of arbre) {
    const f = familleDe(chemin);
    if (!f) continue;
    superflus += 1;
    const e = parFamille.get(f.id) || { famille: f, fichiers: 0, exemples: [] };
    e.fichiers += 1;
    if (e.exemples.length < MAX_EXEMPLES) e.exemples.push(chemin);
    parFamille.set(f.id, e);
    parZone.set(zoneDe(chemin), (parZone.get(zoneDe(chemin)) || 0) + 1);
  }

  /*
   * L'ordre est celui de la GRAVITÉ, puis du nombre. Une clé seule passe devant dix mille
   * fichiers de `node_modules` : ce qui est irréversible prime sur ce qui est encombrant.
   */
  const familles = [...parFamille.values()].sort((a, b) => {
    const g = GRAVITES.indexOf(a.famille.gravite) - GRAVITES.indexOf(b.famille.gravite);
    return g !== 0 ? g : b.fichiers - a.fichiers;
  });

  const zones = [...parZone.entries()].map(([zone, fichiers]) => ({ zone, fichiers }))
    .sort((a, b) => b.fichiers - a.fichiers);

  /*
   * Le `.gitignore` n'est PAS relu pour vérifier chaque règle — un `.gitignore` correct
   * n'empêche pas un fichier DÉJÀ suivi de le rester, et c'est justement le cas le plus
   * fréquent. On dit donc seulement s'il existe et combien de règles il porte : le modèle
   * a besoin de savoir si le problème est « personne n'y a pensé » ou « c'est resté
   * malgré la règle », et ces deux histoires n'appellent pas le même geste.
   */
  const regles = gitignore
    ? gitignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).length
    : 0;

  const r = {
    depot,
    ref,
    arbre: arbre.length,
    superflus,
    propres: arbre.length - superflus,
    familles,
    zones,
    gitignore: { present: Boolean(gitignore), regles },
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteRegime(r) };
}

function texteRegime(r) {
  const L = [];
  L.push(`Régime du dépôt — ${r.depot}${r.ref ? ` · ${r.ref}` : ''}`);
  L.push(`${r.arbre} fichier(s) suivis par git, dont ${r.superflus} d'une famille `
       + 'qui n\'a normalement rien à faire dans un dépôt.');
  L.push('');

  /*
   * LA LIMITE AVANT LES CHIFFRES, PARCE QU'ELLE LES QUALIFIE.
   *
   * Un rapport de régime SANS cette phrase se lit comme un bilan de poids, et le premier
   * réflexe d'un modèle est alors d'écrire « ce dépôt pèse plusieurs centaines de Mo ».
   * Aucun octet n'a été lu. La phrase est donc en tête, pas en note de bas de page.
   */
  L.push('CE QUI N\'A PAS ÉTÉ MESURÉ');
  L.push('  AUCUNE TAILLE. Ce relevé porte sur des CHEMINS, jamais sur des octets : la');
  L.push('  liste d\'arbre des deux forges ne donne pas de taille, et l\'inventer serait');
  L.push('  un faux avec de l\'autorité. Ne parle donc ni de Mo, ni de Go, ni de « poids »,');
  L.push('  ni de « −40 % ». Un nombre de FICHIERS, oui — c\'est ce qui est compté ici.');
  L.push('  Ni le contenu, ni l\'historique : un fichier retiré aujourd\'hui reste dans');
  L.push('  l\'historique de git, et ce relevé ne sait pas ce que l\'historique porte.');
  L.push('');

  L.push(`LE .gitignore : ${r.gitignore.present
    ? `présent, ${r.gitignore.regles} règle(s).`
    : 'ABSENT. Rien n\'empêche le prochain ajout.'}`);
  if (r.gitignore.present && r.superflus) {
    L.push('  Un `.gitignore` correct n\'enlève PAS ce que git suit déjà. Ce qui suit peut');
    L.push('  donc être couvert par une règle et rester suivi malgré elle.');
  }
  L.push('');

  if (!r.familles.length) {
    L.push('CE QUI N\'A RIEN À FAIRE LÀ (0)');
    L.push('  Aucun chemin d\'une famille connue. Ce qui veut dire : aucune des dix');
    L.push('  familles listées plus bas n\'apparaît. Ce n\'est PAS « ce dépôt est propre » —');
    L.push('  un fichier lourd sous un nom banal échappe entièrement à ce relevé.');
  } else {
    L.push(`CE QUI N'A RIEN À FAIRE LÀ (${r.familles.length} famille(s), ${r.superflus} fichier(s))`);
    for (const e of r.familles) {
      L.push(`  ${e.famille.gravite.toUpperCase().padEnd(10)} ${e.famille.libelle} — `
           + `${e.fichiers} fichier(s)`);
      L.push(`             geste : ${e.famille.geste}`);
      L.push(`             ex. : ${e.exemples.join(', ')}`
           + `${e.fichiers > e.exemples.length ? `, … (+${e.fichiers - e.exemples.length})` : ''}`);
    }
  }
  L.push('');

  if (r.zones.length) {
    L.push(`OÙ ÇA SE CONCENTRE — ${r.zones.length} zone(s) touchée(s)`);
    for (const z of r.zones.slice(0, MAX_ZONES)) {
      L.push(`  ${z.zone.padEnd(30)} ${String(z.fichiers).padStart(6)} fichier(s)`);
    }
    if (r.zones.length > MAX_ZONES) {
      L.push(`  … ${r.zones.length - MAX_ZONES} autre(s) zone(s).`);
    }
    L.push('');
  }

  L.push('LES FAMILLES CHERCHÉES, ET RIEN D\'AUTRE');
  L.push(`  ${FAMILLES.map((f) => f.libelle).join(' · ')}.`);
  L.push('  Un fichier hors de ces familles n\'est pas signalé, même s\'il est énorme.');
  L.push('  Le relevé est un plancher, pas un verdict.');
  return L.join('\n');
}

/** Ce que l'écran affiche avant de lancer : la part, jamais un total rassurant. */
export function resumeRegime(r) {
  const dur = r.familles.filter((f) => f.famille.gravite === 'bloquant')
    .reduce((s, f) => s + f.fichiers, 0);
  return `${r.depot} — ${r.superflus}/${r.arbre} fichier(s) de trop`
       + `${dur ? `, dont ${dur} clé(s) ou certificat(s)` : ''}`
       + ` · ${r.gitignore.present ? `.gitignore : ${r.gitignore.regles} règle(s)` : 'pas de .gitignore'}`;
}

export const SIGNAUX_REGIME = {
  /*
   * `regime_du_depot` et pas `poids_du_depot` : le nom promet ce que la matière tient.
   *
   * « Poids » aurait annoncé des octets qu'on ne lit pas, et un nom qui ment se paie deux
   * fois — une fois chez celui qui choisit le signal, une fois chez le modèle qui écrit
   * son rapport. C'est la même règle que `code_de_la_branche` contre `etat_branche`.
   */
  regime_du_depot: {
    libelle: 'ce que ce dépôt versionne et ne devrait pas',
    besoin: 'l\'arborescence entière du dépôt et son .gitignore, sur la branche choisie',
    source: 'js/repo-diet.js',
    reglages: [
      { nom: 'branche', libelle: 'Lire une autre branche', genre: 'branche', requis: false }
    ]
  }
};
