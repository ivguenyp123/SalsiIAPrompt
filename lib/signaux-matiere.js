/*
 * La matière d'un signal — calculée, jamais demandée.
 *
 * ── LE DÉFAUT QUE CE MODULE CORRIGE ──────────────────────────────────────────
 *
 * Pour connaître son bus factor, l'écran demandait de remplir `{{repartition_contributions}}`
 * — une variable dont personne ne sait ce qu'elle attend — et proposait d'aller chercher
 * « un fichier du dépôt » qui n'existe nulle part. Le retour de l'usage a été net :
 * « si je dois mettre des variables que je ne connais pas partout, personne ne l'utilisera. »
 *
 * C'est juste. `repartition_contributions` est un détail d'implémentation du prompt.
 * L'utilisateur choisit un DÉPÔT ; le reste se calcule.
 *
 * ── CE QUI SE CALCULE, ET CE QUI S'EXPLIQUE ──────────────────────────────────
 *
 * Un modèle sans données invente des données. On lui a vu écrire `"élevée"` là où la
 * plateforme calcule `4.2 /sem` — et la porte avait dit oui. La séparation est donc
 * stricte, et c'est tout l'intérêt :
 *
 *   le CHIFFRE      se calcule ici, en code déterministe, rejouable et contestable
 *   l'EXPLICATION   revient à l'agent, qui est bon à ça et mauvais à l'arithmétique
 *
 * Le contrat extrait de `js/bus-factor.js` (`inventaire/contrats/bus-factor.yaml`) sert
 * ici de cahier des charges : médiane pondérée et non moyenne, plafond à 5, seuil des
 * 80 %, zones d'au moins 5 commits. Ce sont ses règles, écrites en JavaScript.
 *
 * ── UNE DIVERGENCE ASSUMÉE, ET DITE ──────────────────────────────────────────
 *
 * Le hub découpe ses zones en lisant le DIFF de chacun des 200 derniers commits — deux
 * cents appels. Ici, on liste les commits PAR RÉPERTOIRE, ce que les deux forges savent
 * faire en un appel chacune. La définition d'un facteur de zone est la même ;
 * l'échantillon, lui, peut différer. Le texte produit le dit, plutôt que de laisser croire
 * à une reproduction au commit près.
 *
 * Module PUR : ni forge, ni DOM, ni réseau. Il reçoit des données déjà lues.
 */

/** Ce qu'on sait calculer, et ce qu'il faut aller chercher pour y arriver. */
export const SIGNAUX = {
  repartition_contributions: {
    libelle: 'la répartition des contributions',
    besoin: 'les commits du dépôt, globalement et par répertoire',
    source: 'js/bus-factor.js'
  }
};

/** Sait-on calculer cette matière ? Sinon, l'écran demande — et il a raison de demander. */
export const sait = (nom) => Object.hasOwn(SIGNAUX, String(nom || ''));

/*
 * Combien de commits on demande.
 *
 * Le hub en prend 200. Les deux forges plafonnent une page à 100, et notre couche n'expose
 * pas la pagination — on demande donc 100. Le texte produit annonce toujours le nombre
 * RÉELLEMENT lu, jamais celui qu'on visait : un rapport qui dirait « sur 200 commits »
 * après en avoir lu 60 mentirait sur son assise.
 */
export const FENETRE = 100;

/*
 * Combien de répertoires on interroge.
 *
 * Un appel par zone : sans plafond, un gros dépôt en déclencherait des centaines. Ce qui
 * est laissé de côté est COMPTÉ et dit dans le texte — une zone fragile peut s'y cacher,
 * et le taire donnerait à un score partiel l'allure d'un score complet.
 */
export const MAX_ZONES_INTERROGEES = 12;

/** En dessous, une zone n'est pas une alerte : c'est un fichier touché une fois. */
export const MINI_COMMITS_ZONE = 5;

/** Ce que la plateforme montre : les plus fragiles, et pas les cinquante suivantes. */
export const MAX_ZONES = 10;
export const MAX_CONTRIBUTEURS = 3;

/**
 * Les zones d'un dépôt, à partir de la liste de ses fichiers.
 *
 * ── UNE DIVERGENCE VOLONTAIRE AVEC LE HUB, ET IL FAUT LA DIRE ────────────────
 *
 * Le commentaire de `js/bus-factor.js` annonce « groupement par répertoire : 2 niveaux ».
 * Son code, lui, fait `parts.slice(0, 2)` sur le chemin COMPLET, ce qui range un fichier
 * à deux segments dans une zone qui est… le fichier lui-même :
 *
 *   src/main/java/Foo.java  →  src/main       ← le répertoire, comme annoncé
 *   lib/yaml.js             →  lib/yaml.js    ← le fichier
 *
 * Sur un dépôt profond ça ne se voit pas. Sur un dépôt plat — le nôtre, et beaucoup
 * d'autres — chaque fichier devient sa propre zone : le bus factor cesse de parler de
 * zones de connaissance et se met à parler de fichiers, un par un.
 *
 * On applique donc l'INTENTION écrite plutôt que le code : le répertoire, à deux niveaux
 * au plus. Un fichier de racine n'est pas une zone — il n'y a pas de connaissance
 * partagée à propos d'un fichier isolé — et il est compté à part plutôt qu'écarté en
 * silence.
 *
 * Rangées par nombre de fichiers : à défaut de connaître leur activité avant de les
 * interroger, c'est le seul indice qu'on ait pour décider lesquelles valent un appel.
 */
export function zonesDepuisArbre(chemins = []) {
  const par = new Map();
  let racine = 0;
  for (const chemin of chemins) {
    const parts = String(chemin).split('/');
    if (parts.length < 2) { racine += 1; continue; }
    const zone = parts.slice(0, Math.min(2, parts.length - 1)).join('/');
    par.set(zone, (par.get(zone) || 0) + 1);
  }
  const zones = [...par]
    .map(([chemin, fichiers]) => ({ chemin, fichiers }))
    .sort((a, b) => b.fichiers - a.fichiers || a.chemin.localeCompare(b.chemin));
  zones.racine = racine;
  return zones;
}

/* ── Les calculs, tels que le contrat les décrit ───────────────────────────── */

/**
 * Le facteur d'une zone : combien de personnes couvrent 80 % de ses commits.
 *
 * Ni 100 % — une longue traîne de contributeurs occasionnels gonflerait tous les
 * facteurs — ni 50 %. Les parts sont arrondies avant d'être cumulées, comme dans le
 * module d'origine : sur de petits volumes, arrondir après changerait le compte.
 */
export function facteurDeZone(contributeurs = []) {
  const total = contributeurs.reduce((s, c) => s + c.commits, 0);
  if (!total) return { facteur: 0, parts: [] };

  const parts = contributeurs
    .map((c) => ({ ...c, part: Math.round((c.commits / total) * 100) }))
    .sort((a, b) => b.commits - a.commits);

  let cumul = 0;
  let facteur = 0;
  for (const c of parts) {
    cumul += c.part;
    facteur += 1;
    if (cumul >= 80) break;
  }
  return { facteur, parts };
}

/**
 * La médiane pondérée — et surtout PAS la moyenne.
 *
 * Le code du hub donne lui-même le contre-exemple : une zone critique (facteur 1) et neuf
 * zones saines (facteur 5) donnaient 4,6/5 en moyenne, soit « RISQUE FAIBLE », alors que
 * la zone critique pouvait être le cœur du projet. Pondérée par les commits, la médiane
 * dit 1 dès que la moitié de l'activité tombe sur des zones fragiles.
 */
export function medianePonderee(items = []) {
  if (!items.length) return 0;
  const tries = [...items].sort((a, b) => a.valeur - b.valeur);
  const poidsTotal = tries.reduce((s, x) => s + x.poids, 0);
  if (poidsTotal === 0) return tries[0].valeur;

  const moitie = poidsTotal / 2;
  let cumul = 0;
  for (const x of tries) {
    cumul += x.poids;
    if (cumul >= moitie) return x.valeur;
  }
  return tries[tries.length - 1].valeur;
}

/** Les trois paliers de la plateforme. `< 2` critique, `< 3` moyen, au-delà faible. */
export function niveauDeRisque(score) {
  if (score < 2) return 'RISQUE CRITIQUE';
  if (score < 3) return 'RISQUE MOYEN';
  return 'RISQUE FAIBLE';
}

/* ── De données brutes à une matière lisible ───────────────────────────────── */

const compter = (commits = []) => {
  const par = new Map();
  for (const c of commits) {
    const qui = String(c?.author || '').trim() || '(inconnu)';
    par.set(qui, (par.get(qui) || 0) + 1);
  }
  return [...par].map(([nom, n]) => ({ nom, commits: n })).sort((a, b) => b.commits - a.commits);
};

/**
 * La matière de `repartition_contributions`, prête à être lue par un agent.
 *
 * @param {object} donnees
 *   depot     le chemin du dépôt, pour que le texte dise sur QUOI il porte
 *   commits   les commits récents, `{ author }` suffit
 *   zones     `[{ chemin, commits: [...] }]` — les répertoires examinés
 *   ignorees  les répertoires qu'on n'a pas interrogés, et pourquoi
 */
export function repartitionContributions({ depot = '', commits = [], zones = [],
                                            ignorees = 0 } = {}) {
  const contributeurs = compter(commits);
  const total = commits.length;

  const calculees = zones
    .map((z) => {
      const { facteur, parts } = facteurDeZone(compter(z.commits || []));
      return { chemin: z.chemin, commits: (z.commits || []).length, facteur, parts };
    })
    .filter((z) => z.commits > 0);

  // Les compteurs portent sur TOUTES les zones, la liste seulement sur celles qui pèsent.
  const critiques = calculees.filter((z) => z.facteur === 1).length;
  const surveiller = calculees.filter((z) => z.facteur === 2).length;
  const saines = calculees.filter((z) => z.facteur >= 3).length;

  const retenues = calculees.filter((z) => z.commits >= MINI_COMMITS_ZONE);
  const score = retenues.length
    ? Number(Math.min(5, medianePonderee(
        retenues.map((z) => ({ valeur: z.facteur, poids: z.commits })))).toFixed(1))
    : null;

  const listees = [...retenues].sort((a, b) => a.facteur - b.facteur).slice(0, MAX_ZONES);

  return {
    score,
    niveau: score === null ? null : niveauDeRisque(score),
    contributeurs,
    zones: listees,
    comptes: { critiques, surveiller, saines, examinees: calculees.length, ignorees },
    texte: texte({ depot, total, contributeurs, listees, retenues, score, ignorees,
                   comptes: { critiques, surveiller, saines } })
  };
}

/** Le pourcentage d'un contributeur sur le total, arrondi comme la plateforme l'affiche. */
const part = (n, total) => (total ? `${Math.round((n / total) * 100)} %` : '—');

function texte({ depot, total, contributeurs, listees, retenues, score, ignorees, comptes }) {
  if (!total) {
    // Pas de commit, pas de score. Écrire 0 se lirait comme un bus factor catastrophique
    // alors qu'il n'y a rien à mesurer — c'est ce que le contrat exige de ne pas faire.
    return `Dépôt : ${depot}\n\nAucun commit lu : il n'y a pas de quoi calculer un bus `
         + 'factor. Ce n\'est pas un score de 0, c\'est une absence de mesure.';
  }

  const lignes = [
    `BUS FACTOR — ${depot}`,
    `Calculé sur les ${total} commits les plus récents.`,
    ''
  ];

  if (score === null) {
    lignes.push('Score global : non calculable — aucune zone n\'atteint '
      + `${MINI_COMMITS_ZONE} commits. En dessous, un répertoire touché une fois par une `
      + 'seule personne donnerait un facteur de 1 sans qu\'aucune connaissance soit en jeu.',
    '');
  } else {
    lignes.push(`Score global : ${score} personne${score >= 2 ? 's' : ''} — ${niveauDeRisque(score)}`,
      '  Médiane pondérée des facteurs de zone (poids = commits de la zone), plafonnée à 5.',
      `  Zones : ${comptes.critiques} critique(s) · ${comptes.surveiller} à surveiller · `
      + `${comptes.saines} saine(s).`,
      '');
  }

  lignes.push(`Contributeurs (${total} commits) :`);
  for (const c of contributeurs.slice(0, 10)) {
    lignes.push(`  ${c.nom.padEnd(28)} ${String(c.commits).padStart(4)}   ${part(c.commits, total)}`);
  }
  if (contributeurs.length > 10) {
    lignes.push(`  … et ${contributeurs.length - 10} autre(s).`);
  }
  lignes.push('');

  if (listees.length) {
    lignes.push(`Zones d'au moins ${MINI_COMMITS_ZONE} commits, de la plus fragile à la plus solide :`);
    for (const z of listees) {
      const qui = z.parts.slice(0, MAX_CONTRIBUTEURS)
        .map((c) => `${c.nom} ${c.part} %`).join(' · ');
      lignes.push(`  ${z.chemin.padEnd(28)} facteur ${z.facteur}   ${String(z.commits).padStart(4)} commits   ${qui}`);
    }
    if (retenues.length > listees.length) {
      lignes.push(`  … et ${retenues.length - listees.length} zone(s) de plus, moins fragiles.`);
    }
  } else {
    lignes.push(`Aucune zone n'atteint ${MINI_COMMITS_ZONE} commits.`);
  }

  if (ignorees > 0) {
    lignes.push('', `${ignorees} répertoire(s) n'ont pas été interrogés — on s'arrête aux plus `
      + 'fournis pour ne pas multiplier les appels. Ils peuvent cacher une zone fragile.');
  }

  lignes.push('',
    'Méthode : le facteur d\'une zone est le nombre de personnes couvrant 80 % de ses '
    + 'commits. Les zones sont les répertoires du dépôt pris à deux niveaux, et leurs '
    + 'commits sont lus par chemin — le hub, lui, les déduit du diff de chaque commit. '
    + 'La définition est la même, l\'échantillon peut différer.');

  return lignes.join('\n');
}

/** Le résumé d'une ligne affiché à l'écran, à la place du champ qu'on ne demande plus. */
export function resumeCourt(r) {
  if (!r || !r.contributeurs?.length) return 'aucun commit lu';
  const n = r.contributeurs.length;
  const zones = r.comptes?.examinees || 0;
  return r.score === null
    ? `${n} contributeur(s) · aucune zone assez active pour un score`
    : `bus factor ${r.score} — ${r.niveau} · ${n} contributeur(s) · ${zones} zone(s)`;
}

export default { SIGNAUX, sait, FENETRE, MINI_COMMITS_ZONE, MAX_ZONES, MAX_CONTRIBUTEURS,
                 MAX_ZONES_INTERROGEES, zonesDepuisArbre, facteurDeZone, medianePonderee, niveauDeRisque, repartitionContributions,
                 resumeCourt };
