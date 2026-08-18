/*
 * Le job de CI qui casse — l'erreur extraite d'un log, pas le log.
 *
 * ── POURQUOI CE MODULE EST LE PLUS IMPORTANT DE LA SÉRIE ─────────────────────
 *
 * Jusqu'ici la plateforme savait qu'un pipeline avait échoué. Jamais pourquoi. L'agent
 * `expliquer-un-pipeline-en-echec` avait d'ailleurs été SUPPRIMÉ du catalogue plutôt que
 * laissé en place : sans le log, un modèle à qui on demande la cause d'un échec la
 * devine, et une cause devinée est indiscernable d'une cause trouvée.
 *
 * ── ET POURQUOI IL NE SE CONTENTE PAS DE TRANSMETTRE ─────────────────────────
 *
 * Un log de CI fait couramment plusieurs mégaoctets — des milliers de lignes de
 * téléchargement de dépendances, de compilation, de tests qui passent. L'envoyer entier
 * serait à la fois ruineux et CONTRE-PRODUCTIF : noyée dans quinze mille lignes de bruit,
 * l'erreur réelle a moins de chances d'être trouvée que dans un extrait de soixante.
 *
 * Trois traitements, dans cet ordre, et l'ordre compte :
 *
 *   1. NETTOYER   les codes ANSI, les marqueurs de section, les horodatages de ligne
 *   2. CAVIARDER  les secrets — un log de CI en contient, c'est même leur endroit favori
 *   3. DÉCOUPER   une fenêtre autour de l'échec, en disant combien on a écarté
 *
 * Caviarder AVANT de découper, jamais l'inverse : un secret qui tombe hors de la fenêtre
 * n'est pas caviardé, et le jour où la fenêtre bouge il repart au modèle.
 *
 * Module PUR : ni forge, ni DOM, ni horloge.
 */
import { MOTIFS_SECRET } from './signaux-securite.js';

/** Ce qu'on sait calculer pour la CI. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_CI = {
  job_en_echec: {
    libelle: 'le job de CI qui a échoué',
    besoin: 'un pipeline en échec du dépôt, choisi dans la liste',
    source: 'js/repo-analyzer.js · js/daily-report.js',
    /*
     * Comme `revue_mr`, ce signal demande un SECOND choix après le dépôt : lequel des
     * pipelines en échec. Calculer le premier venu coûterait la lecture d'un log de
     * plusieurs mégaoctets pour quelque chose que personne n'a demandé.
     */
    parRun: true
  }
};

/* ── Le nettoyage ─────────────────────────────────────────────────────────── */

/*
 * Les codes ANSI. Un runner colore sa sortie, et ces séquences représentent facilement un
 * cinquième des octets d'un log — des octets qui coûtent des jetons et n'apprennent rien.
 */
const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

/*
 * Les marqueurs de section GitLab : `section_start:1755440000:build\r[0Kbuild`.
 * Ils structurent l'affichage dans l'interface et n'ont aucun sens hors d'elle.
 */
const SECTION_GITLAB = /^section_(?:start|end):\d+:[^\r\n]*/gm;

/*
 * L'horodatage que GitHub préfixe à CHAQUE ligne : `2026-08-17T14:03:11.4123456Z `.
 * Vingt-huit caractères par ligne, identiques d'un bout à l'autre du fichier. Sur dix
 * mille lignes, c'est un quart de mégaoctet qui ne dit rien de plus que « ça s'est passé
 * pendant le job ».
 */
const HORODATAGE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s/gm;

/** Le retour chariot seul, dont les runners se servent pour réécrire une barre de progression. */
const PROGRESSION = /\r(?!\n)/g;

export function nettoyer(log = '') {
  return String(log)
    .replace(SECTION_GITLAB, '')
    .replace(ANSI, '')
    .replace(HORODATAGE, '')
    .replace(PROGRESSION, '\n')
    // Une barre de progression laisse des dizaines de lignes quasi identiques. On garde la
    // structure du log en écrasant les rafales de lignes vides, sans toucher au reste.
    .replace(/\n{4,}/g, '\n\n\n');
}

/* ── Le caviardage ────────────────────────────────────────────────────────── */

export const CAVIARDE = '[secret caviardé]';

/**
 * Retire les secrets du log AVANT qu'il ne parte où que ce soit.
 *
 * ── LA RAISON D'ÊTRE DE CETTE FONCTION ──────────────────────────────────────
 *
 * Un log de pipeline est l'endroit où les secrets fuient le plus facilement : un `echo`
 * de débogage, un `curl -v` qui affiche ses en-têtes, un outil qui recopie sa
 * configuration au démarrage. Envoyer ce log à un modèle — donc à un fournisseur, donc
 * hors de la banque — sans le relire serait exactement l'incident que cette plateforme
 * existe pour éviter.
 *
 * On réutilise les motifs de `signaux-securite.js` plutôt que d'en écrire une seconde
 * liste. Deux listes qui doivent rester égales divergent, et celle-ci divergerait en
 * silence : personne ne relit un log caviardé pour vérifier qu'il l'a bien été.
 *
 * @returns {{ texte, trouves }} — `trouves` nomme les types rencontrés, jamais les valeurs
 */
export function caviarder(log = '') {
  let texte = String(log);
  const trouves = [];
  for (const { nom, re } of MOTIFS_SECRET) {
    // `lastIndex` est remis à zéro : ces expressions sont globales et PARTAGÉES avec le
    // scanner de secrets. Une expression globale garde sa position entre deux appels —
    // sans cette remise à zéro, un même motif sauterait une occurrence sur deux, de
    // manière parfaitement aléatoire selon l'ordre des appels.
    re.lastIndex = 0;
    if (!re.test(texte)) continue;
    re.lastIndex = 0;
    texte = texte.replace(re, CAVIARDE);
    trouves.push(nom);
  }
  return { texte, trouves };
}

/* ── Le découpage ─────────────────────────────────────────────────────────── */

/*
 * Ce qui trahit l'endroit où ça a cassé.
 *
 * Extraits de ce que les runners écrivent réellement — pas d'un vocabulaire inventé.
 * `##[error]` est GitHub, `ERROR: Job failed` est GitLab, le reste vient des outils.
 */
export const MARQUEURS = [
  /^##\[error\]/im,
  /\bnpm ERR!/i,
  /^Traceback \(most recent call last\)/im,
  /^\s*Caused by:/im,
  /\b(?:BUILD|Build) FAILED\b/,
  /\bFAILURE:/,
  /^\s*Error:/im,
  /^\s*error(?::| TS\d+)/im,
  /\bAssertionError\b/,
  /\bsegmentation fault\b/i
];

/*
 * ── LA DISTINCTION QUE CE MODULE A DÛ APPRENDRE ─────────────────────────────
 *
 * Ces lignes-ci ne sont pas des causes : ce sont les CONCLUSIONS du runner. « ERROR: Job
 * failed: exit code 1 » est toujours la dernière ligne d'un job raté, et elle n'explique
 * jamais rien.
 *
 * Elles étaient dans la liste des marqueurs, et le défaut était sérieux : la fenêtre se
 * centrait sur la conclusion, donc sur la toute fin du log — et le vrai message d'erreur,
 * trois cents lignes plus haut, était JETÉ. L'agent recevait « le job a échoué avec le
 * code 1 » et devait deviner le reste. Exactement ce qu'on voulait éviter en allant
 * chercher le log.
 *
 * Elles restent utiles pour confirmer qu'on est bien sur un échec, et la QUEUE les joint
 * de toute façon. Mais elles ne décident plus où couper.
 */
export const TERMINAISONS = [
  /^ERROR: Job failed/im,
  /^##\[error\]Process completed with exit code/im,
  /\bexit(?:ed with)? (?:code|status) [1-9]/i
];

/** Combien de lignes on garde autour de l'échec, et à la toute fin. */
export const AVANT = 45;
export const APRES = 20;
export const QUEUE = 40;

/** Le plafond de lecture. Au-delà, on ne lit même pas : on coupe et on le dit. */
export const MAX_LOG = 400000;

/**
 * L'extrait qui compte.
 *
 * ── POURQUOI LE DERNIER MARQUEUR ET PAS LE PREMIER ──────────────────────────
 *
 * Un build qui échoue affiche souvent des erreurs bénignes en cours de route — un paquet
 * introuvable dans un miroir, un test réessayé. Le premier `Error:` d'un log n'est
 * presque jamais celui qui a fait tomber le job ; le dernier l'est presque toujours,
 * parce que c'est celui après lequel le runner s'arrête.
 *
 * La QUEUE est jointe systématiquement : la ligne de sortie — `ERROR: Job failed: exit
 * code 1` — vit tout à la fin et ne tombe pas forcément dans la fenêtre de l'erreur.
 */
export function extraire(log = '') {
  const lignes = String(log).split('\n');
  const total = lignes.length;

  if (total <= AVANT + APRES + QUEUE) {
    return { texte: lignes.join('\n'), total, gardees: total, coupe: false, repere: null };
  }

  /*
   * Le dernier VRAI marqueur, à défaut la dernière conclusion.
   *
   * On cherche d'abord une cause — `npm ERR!`, un `Traceback`, un test qui casse. Les
   * conclusions du runner ne sont consultées qu'ensuite : elles disent toujours la même
   * chose et vivent toujours au même endroit, donc s'y ancrer revient à ne garder que la
   * fin du log et à jeter l'erreur qui l'explique.
   */
  const estConclusion = (ligne) => TERMINAISONS.some((m) => m.test(ligne));

  const dernier = (motifs, sautant = () => false) => {
    for (let i = total - 1; i >= 0; i--) {
      if (sautant(lignes[i])) continue;
      for (const m of motifs) if (m.test(lignes[i])) return i;
    }
    return -1;
  };

  /*
   * On SAUTE les lignes de conclusion pendant la recherche d'une cause.
   *
   * Les exclure de `MARQUEURS` ne suffisait pas : « ERROR: Job failed: exit code 1 » est
   * attrapée par le motif générique `^\s*Error:`, qui est là pour les vraies erreurs. Le
   * dernier marqueur restait donc la conclusion, et la fenêtre continuait de jeter le
   * `npm ERR!` trois cents lignes plus haut — le défaut corrigé une première fois
   * revenait par une autre porte.
   */
  let ligneErreur = dernier(MARQUEURS, estConclusion);
  if (ligneErreur < 0) ligneErreur = dernier(TERMINAISONS);
  const repere = ligneErreur >= 0 ? lignes[ligneErreur].trim().slice(0, 120) : null;

  const morceaux = [];
  let gardees = 0;

  if (ligneErreur >= 0) {
    const debut = Math.max(0, ligneErreur - AVANT);
    const fin = Math.min(total, ligneErreur + APRES + 1);
    if (debut > 0) morceaux.push(`[… ${debut} ligne(s) écartée(s) …]`);
    morceaux.push(lignes.slice(debut, fin).join('\n'));
    gardees += fin - debut;

    const queue = Math.max(fin, total - QUEUE);
    if (queue > fin) {
      morceaux.push(`[… ${queue - fin} ligne(s) écartée(s) …]`);
      morceaux.push(lignes.slice(queue).join('\n'));
      gardees += total - queue;
    }
  } else {
    /*
     * Aucun marqueur : on garde la FIN.
     *
     * C'est le pari le plus sûr — un job s'arrête là où il casse — mais c'en est un, et il
     * doit se voir. `repere: null` le dit à l'agent, qui doit alors se garder d'annoncer
     * une cause avec certitude.
     */
    const queue = total - (AVANT + APRES + QUEUE);
    morceaux.push(`[… ${queue} ligne(s) écartée(s) …]`);
    morceaux.push(lignes.slice(queue).join('\n'));
    gardees = total - queue;
  }

  return { texte: morceaux.join('\n'), total, gardees, coupe: true, repere };
}

/* ── Le signal ────────────────────────────────────────────────────────────── */

/** La configuration CI, tronquée : elle sert à proposer un correctif, pas à être relue. */
export const MAX_CONFIG = 12000;

/**
 * Tout ce qu'il faut pour expliquer un échec de pipeline et proposer un correctif.
 *
 * @param {string} depot
 * @param {object} run        { id, branche, quand, url, sha }
 * @param {Array}  jobs       tous les jobs du run
 * @param {object} job        celui qu'on analyse
 * @param {string} log        son log, BRUT — le nettoyage se fait ici
 * @param {string|null} configCi     le contenu du fichier de CI, si on a su le lire
 * @param {string} cheminConfig      son chemin
 */
export function jobEnEchec({ depot = '', run = {}, jobs = [], job = null,
                             log = null, configCi = null, cheminConfig = '' } = {}) {
  const angles = [];

  const echoues = jobs.filter((j) => j.statut === 'echec');
  const cible = job || echoues[0] || null;

  let extrait = null;
  let secrets = [];
  if (log === null || log === undefined) {
    angles.push('Le log du job n\'a pas pu être lu — le jeton n\'a pas la permission sur les '
      + 'jobs, ou la forge l\'a expiré. SANS LOG, la cause de l\'échec n\'est pas connue : '
      + 'ne pas en proposer une.');
  } else if (!String(log).trim()) {
    angles.push('Le log du job est vide. Le job a probablement échoué avant de démarrer — '
      + 'image introuvable, runner indisponible, ou étape précédente en échec.');
  } else {
    const brut = String(log);
    const tropLong = brut.length > MAX_LOG;
    const propre = nettoyer(tropLong ? brut.slice(-MAX_LOG) : brut);
    // Caviarder AVANT de découper : un secret hors fenêtre resterait en clair, et
    // repartirait au modèle le jour où la fenêtre change de taille.
    const { texte, trouves } = caviarder(propre);
    secrets = trouves;
    extrait = extraire(texte);
    if (tropLong) {
      angles.push(`Le log dépassait ${MAX_LOG} caractères : seule sa fin a été analysée.`);
    }
    if (extrait.coupe) {
      angles.push(`Le log fait ${extrait.total} lignes ; ${extrait.gardees} ont été retenues `
        + 'autour de l\'échec. Ce qui est écarté est signalé dans l\'extrait.');
    }
    if (!extrait.repere) {
      angles.push('Aucun marqueur d\'erreur reconnu dans le log : c\'est la FIN du job qui a '
        + 'été retenue, faute de mieux. La cause peut être ailleurs — le dire plutôt que '
        + 'd\'affirmer.');
    }
    if (trouves.length) {
      angles.push(`${trouves.length} type(s) de secret ont été trouvés dans le log et `
        + `CAVIARDÉS avant analyse : ${trouves.join(', ')}. C'est un incident en soi : un `
        + 'secret visible dans un log de pipeline est lisible par tous ceux qui ont accès '
        + 'au projet.');
    }
  }

  if (configCi === null || configCi === undefined) {
    angles.push('Le fichier de configuration CI n\'a pas été trouvé à la racine. Un correctif '
      + 'ne peut donc porter que sur le code ou l\'environnement, pas sur la configuration '
      + 'du pipeline — ne pas proposer de modifier un fichier qu\'on n\'a pas lu.');
  }

  const config = configCi ? String(configCi) : null;
  const configCoupee = Boolean(config && config.length > MAX_CONFIG);

  const r = {
    depot,
    run: { id: run.id ?? null, branche: run.branche || '', quand: run.quand || '',
           url: run.url || '', sha: (run.sha || '').slice(0, 8) },

    // Le job analysé, et le TABLEAU des autres : un job qui casse après trois jobs verts
    // ne se cherche pas au même endroit qu'un job qui casse en premier.
    job: cible ? { nom: cible.nom, etape: cible.etape, statut: cible.statut,
                   secondes: cible.secondes, url: cible.url } : null,
    jobs: jobs.map((j) => ({ nom: j.nom, etape: j.etape, statut: j.statut,
                             secondes: j.secondes })),
    echoues: echoues.length,

    extrait: extrait ? {
      repere: extrait.repere,
      lignes_totales: extrait.total,
      lignes_retenues: extrait.gardees,
      tronque: extrait.coupe,
      texte: extrait.texte
    } : null,

    secrets_caviardes: secrets,

    config: config ? { chemin: cheminConfig, tronquee: configCoupee,
                       texte: configCoupee ? config.slice(0, MAX_CONFIG) : config } : null,

    angles_morts: angles,

    methode: [
      'Le log est nettoyé (codes ANSI, marqueurs de section, horodatages), puis les secrets '
        + 'y sont caviardés, puis il est découpé autour de l\'échec.',
      'La fenêtre est centrée sur le DERNIER marqueur d\'erreur : le premier `Error:` d\'un '
        + 'log est rarement celui qui a fait tomber le job.',
      'La fin du log est toujours jointe : la ligne de sortie y vit.'
    ]
  };

  return { ...r, texte: texteCi(r) };
}

/** Ce que l'agent reçoit réellement. C'est ce champ, et lui seul, qui part au modèle. */
function texteCi(r) {
  const l = [
    `Pipeline en échec — ${r.depot}`,
    `Branche : ${r.run.branche || 'inconnue'}${r.run.sha ? ` · commit ${r.run.sha}` : ''}`
      + `${r.run.quand ? ` · ${r.run.quand.slice(0, 16).replace('T', ' ')}` : ''}`,
    ''
  ];

  if (!r.job) {
    l.push('Aucun job en échec sur ce pipeline. Il n\'y a rien à expliquer.');
    return l.join('\n');
  }

  l.push(`Job en échec : ${r.job.nom}`
    + (r.job.etape ? `   (étape : ${r.job.etape})` : '')
    + (r.job.secondes ? `   après ${r.job.secondes} s` : ''));
  if (r.echoues > 1) {
    l.push(`  ${r.echoues} jobs ont échoué. Celui-ci est le PREMIER dans l'ordre du `
      + 'pipeline : les suivants échouent en général à cause de lui.');
  }
  l.push('');

  if (r.jobs.length > 1) {
    l.push('Tous les jobs du pipeline :');
    for (const j of r.jobs) {
      l.push(`  ${(j.statut || '?').padEnd(8)} ${j.nom}`
        + (j.etape ? `  [${j.etape}]` : '')
        + (j.secondes ? `  ${j.secondes} s` : ''));
    }
    l.push('');
  }

  if (r.extrait) {
    l.push(r.extrait.repere
      ? `Repère d'erreur trouvé : ${r.extrait.repere}`
      : 'AUCUN marqueur d\'erreur reconnu : c\'est la fin du log qui suit, faute de mieux.');
    l.push(`Extrait du log — ${r.extrait.lignes_retenues} ligne(s) retenue(s) `
      + `sur ${r.extrait.lignes_totales} :`, '', r.extrait.texte, '');
  }

  if (r.config) {
    l.push(`Configuration CI (${r.config.chemin})`
      + (r.config.tronquee ? ' — TRONQUÉE :' : ' :'), '', r.config.texte, '');
  }

  l.push('Méthode :');
  for (const m of r.methode) l.push(`  · ${m}`);

  if (r.angles_morts.length) {
    l.push('', 'CE QU\'ON NE SAIT PAS :');
    for (const a of r.angles_morts) l.push(`  · ${a}`);
  }

  return l.join('\n');
}

/** La ligne affichée sous le bouton, avant de lancer quoi que ce soit. */
export function resumeCi(r) {
  if (!r || !r.job) return 'aucun job en échec sur ce pipeline';
  const l = r.extrait
    ? `${r.extrait.lignes_retenues}/${r.extrait.lignes_totales} lignes retenues`
    : 'log illisible';
  return `${r.job.nom}${r.job.etape ? ` (${r.job.etape})` : ''} · ${l}`
       + (r.secrets_caviardes.length ? ` · ${r.secrets_caviardes.length} secret(s) caviardé(s)` : '');
}

export default { SIGNAUX_CI, jobEnEchec, resumeCi, nettoyer, caviarder, extraire, MARQUEURS,
                 AVANT, APRES, QUEUE, MAX_LOG, MAX_CONFIG, CAVIARDE };
