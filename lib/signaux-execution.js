/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  UNE EXÉCUTION DE CI, JOB PAR JOB — AVEC DES DURÉES VRAIMENT MESURÉES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── LES TROIS SIGNAUX DE CI, ET POURQUOI ILS SONT TROIS ──────────────────────
 *
 *   historique_pipelines  N exécutions, leurs statuts, leur forme dans le temps.
 *                         Répond à « comment ça se passe en ce moment ».
 *   pipeline_log          UNE exécution, ses jobs, leurs DURÉES, et l'extrait du log
 *                         de ce qui a échoué. Répond à « où passe le temps », et
 *                         « qu'est-ce qui a cassé, précisément ».
 *   job_en_echec          UN job en échec et son log, pour en expliquer la cause.
 *
 * Trois lectures, trois coûts d'obtention très différents : lister cent exécutions est un
 * appel, lire les jobs d'une exécution en est un de plus, lire un log peut peser des
 * mégaoctets. Un seul signal les aurait tous payés à chaque lancement.
 *
 * ── CE QUI REND CELUI-CI PARTICULIER : LES DURÉES SONT MESURÉES ──────────────
 *
 * `ce-que-cette-chaine-coute-en-temps` lit du YAML et n'a donc AUCUNE durée — son spec
 * interdit d'en écrire une. Ici, la forge rend le nombre de secondes de chaque job : ce
 * sont de vraies mesures, et c'est toute la valeur de ce signal.
 *
 * Mais une mesure sur UNE exécution reste UN échantillon. Un job lent ce jour-là peut
 * avoir attendu un agent d'exécution libre, ou un miroir de paquets. Le texte rappelle
 * donc de ne rien conclure d'une seule exécution — c'est la faute que ce signal rend
 * facile, parce que les chiffres ont l'air solides.
 *
 * ── ET LA SOMME DES DURÉES N'EST PAS LA DURÉE DU PIPELINE ────────────────────
 *
 * C'est le contresens central du genre. Des jobs qui tournent en parallèle s'additionnent
 * dans le total du temps machine, jamais dans le temps d'attente humaine. Une chaîne dont
 * les jobs totalisent quarante minutes peut rendre son verdict en huit. Le signal calcule
 * donc les deux, séparément et nommément.
 */

import { nettoyer, caviarder, extraire } from './signaux-ci.js';

/** Combien de jobs le texte détaille. Au-delà, on compte sans détailler. */
const MAX_JOBS = 60;

/** Ce qu'on garde du log de l'échec — le même budget que `job_en_echec`. */
export const MAX_EXTRAIT = 12000;

const mmss = (s) => (s == null || Number.isNaN(s) ? 'inconnue'
  : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);

/**
 * Les jobs groupés par ÉTAPE, dans l'ordre où la chaîne les traverse.
 *
 * L'étape est l'unité qui décide de l'attente : à l'intérieur d'une étape les jobs sont
 * parallèles, entre deux étapes ils sont en série. Sans ce regroupement, on ne peut rien
 * dire du temps réellement subi — seulement du temps machine consommé.
 */
export function parEtape(jobs = []) {
  const par = new Map();
  for (const j of jobs) {
    const cle = j.etape || '(sans étape)';
    if (!par.has(cle)) par.set(cle, { etape: cle, jobs: [], secondes: 0, plusLong: null });
    const e = par.get(cle);
    e.jobs.push(j);
    e.secondes += Number(j.secondes) || 0;
    if (!e.plusLong || (Number(j.secondes) || 0) > (Number(e.plusLong.secondes) || 0)) {
      e.plusLong = j;
    }
  }
  return [...par.values()];
}

/**
 * Une exécution de CI, job par job.
 *
 * @param {object} e
 *   @param {string} e.depot
 *   @param {object} e.run              l'exécution choisie
 *   @param {Array<{id, nom, etape, statut, secondes}>} e.jobs
 *   @param {object|null} e.jobEchoue   le premier job en échec, s'il y en a un
 *   @param {string|null} e.log         son log brut, ou null s'il n'a pas pu être lu
 */
export function executionCi({ depot = '', run = {}, jobs = [], jobEchoue = null,
                              log = null } = {}) {
  const propres = jobs.map((j) => ({
    nom: j.nom || '(sans nom)',
    etape: j.etape || '',
    statut: String(j.statut || '').toLowerCase(),
    secondes: Number(j.secondes) || 0
  }));

  const etapes = parEtape(propres);

  /*
   * DEUX TOTAUX, ET ILS NE MESURENT PAS LA MÊME CHOSE.
   *
   * `tempsMachine` est la somme de tout : ce que ça coûte en agents d'exécution.
   * `tempsSubi` est la somme, par étape, du job le plus long : c'est ce que quelqu'un
   * attend vraiment, puisque les jobs d'une même étape tournent ensemble.
   *
   * Les confondre est le contresens du genre. Une chaîne à quarante minutes machine peut
   * rendre son verdict en huit, et « réduire de moitié le temps machine » sans toucher au
   * chemin critique ne fait gagner zéro seconde à qui attend.
   */
  const tempsMachine = propres.reduce((s, j) => s + j.secondes, 0);
  const tempsSubi = etapes.reduce((s, e) => s + (Number(e.plusLong?.secondes) || 0), 0);

  const echoues = propres.filter((j) => j.statut === 'echec' || j.statut === 'failed');
  const lesPlusLongs = [...propres].sort((a, b) => b.secondes - a.secondes).slice(0, 8);
  const sansDuree = propres.filter((j) => !j.secondes).length;

  // Le log n'est extrait que pour l'échec, et il est caviardé AVANT d'être découpé.
  let extrait = null;
  if (log != null) {
    const { texte: sur, trouves } = caviarder(nettoyer(String(log)));
    const m = extraire(sur);
    extrait = {
      texte: String(m.texte).slice(0, MAX_EXTRAIT),
      secrets: trouves?.length || 0,
      // Ce que la découpe a écarté est COMPTÉ : « la vraie cause est peut-être plus haut »
      // n'a de poids que si l'on dit combien de lignes ont été laissées de côté.
      total: m.total, gardees: m.gardees, coupe: m.coupe
    };
  }

  const r = {
    depot,
    run: { id: run.id, branche: run.branche || '', quand: run.quand || run.debut || '',
           statut: String(run.statut || '').toLowerCase(), sha: run.sha || '' },
    jobs: propres,
    etapes,
    tempsMachine,
    tempsSubi,
    echoues,
    lesPlusLongs,
    sansDuree,
    jobEchoue: jobEchoue ? { nom: jobEchoue.nom || '', etape: jobEchoue.etape || '' } : null,
    extrait,
    logLisible: log != null
  };
  return { ...r, texte: texteExecution(r) };
}

function texteExecution(r) {
  const L = [];
  L.push(`Une exécution de CI — ${r.depot} · ${r.run.branche || '(sans branche)'}`
       + `${r.run.sha ? ` · ${r.run.sha.slice(0, 7)}` : ''}`);
  L.push(`${r.run.quand ? `Lancée le ${String(r.run.quand).slice(0, 16)}. ` : ''}`
       + `Statut : ${r.run.statut || 'inconnu'}. ${r.jobs.length} job(s).`);
  L.push('');

  if (!r.jobs.length) {
    L.push('AUCUN JOB LU');
    L.push('  La forge n\'a rendu aucun job pour cette exécution. Ce n\'est pas « le pipeline');
    L.push('  est vide » : ce peut être un droit manquant, une exécution trop ancienne, ou');
    L.push('  une chaîne déclenchée ailleurs. Ne conclus rien.');
    return L.join('\n');
  }

  /*
   * LES DEUX TOTAUX EN TÊTE, ET LEUR DIFFÉRENCE EXPLIQUÉE.
   *
   * Placés plus bas, ils seraient additionnés par mégarde. C'est la seule chose que ce
   * signal doit absolument faire comprendre avant tout le reste.
   */
  L.push('LES DEUX TOTAUX, ET ILS NE MESURENT PAS LA MÊME CHOSE');
  L.push(`  TEMPS SUBI      ${mmss(r.tempsSubi).padEnd(18)} ce que quelqu'un attend vraiment`);
  L.push(`  TEMPS MACHINE   ${mmss(r.tempsMachine).padEnd(18)} la somme de tous les jobs`);
  L.push('  Les jobs d\'une MÊME étape tournent ensemble : ils s\'additionnent dans le temps');
  L.push('  machine, jamais dans l\'attente. Réduire le temps machine sans toucher au job le');
  L.push('  plus long de chaque étape ne fait gagner AUCUNE seconde à celui qui attend.');
  L.push('  Le temps subi est calculé étape par étape, en gardant le job le plus long de');
  L.push('  chacune. Il ignore l\'attente d\'un agent d\'exécution libre, que la forge ne');
  L.push('  rapporte pas — le temps réellement écoulé est donc SUPÉRIEUR à celui-ci.');
  if (r.sansDuree) {
    L.push(`  ${r.sansDuree} job(s) SANS DURÉE rapportée : ils comptent pour zéro dans les deux`);
    L.push('  totaux, qui sont donc des planchers.');
  }
  L.push('');

  L.push(`ÉTAPE PAR ÉTAPE (${r.etapes.length}) — l'ordre est celui de la chaîne`);
  for (const e of r.etapes) {
    L.push(`  ${String(e.etape).slice(0, 24).padEnd(24)} ${String(e.jobs.length).padStart(3)} job(s)`
         + ` · le plus long : ${mmss(Number(e.plusLong?.secondes) || 0)}`
         + ` (${e.plusLong?.nom || '?'})`
         + ` · machine : ${mmss(e.secondes)}`);
  }
  L.push('  Le « plus long » de chaque étape est ce qui décide de l\'attente : c\'est LUI qu\'il');
  L.push('  faut raccourcir, pas la somme.');
  L.push('');

  L.push(`LES JOBS LES PLUS LONGS (${r.lesPlusLongs.length})`);
  for (const j of r.lesPlusLongs) {
    L.push(`  ${mmss(j.secondes).padStart(14)}  ${String(j.etape).slice(0, 16).padEnd(16)}`
         + ` ${j.nom}  [${j.statut || 'inconnu'}]`);
  }
  L.push('');

  if (r.echoues.length) {
    L.push(`CE QUI A ÉCHOUÉ (${r.echoues.length})`);
    for (const j of r.echoues) {
      L.push(`  ${String(j.etape).slice(0, 16).padEnd(16)} ${j.nom} · ${mmss(j.secondes)}`);
    }
  } else {
    L.push('CE QUI A ÉCHOUÉ (0)');
    L.push('  Aucun job en échec dans cette exécution.');
  }
  L.push('');

  if (r.jobs.length > MAX_JOBS) {
    L.push(`  ${r.jobs.length - MAX_JOBS} job(s) non détaillé(s), mais COMPTÉ(S) dans les totaux.`);
    L.push('');
  }

  L.push('L\'EXTRAIT DU LOG');
  if (!r.jobEchoue) {
    L.push('  Aucun job en échec : aucun log n\'a été lu. Lire le log d\'un job qui a réussi');
    L.push('  coûterait plusieurs mégaoctets pour une information que personne n\'a demandée.');
  } else if (!r.logLisible) {
    L.push(`  Le job « ${r.jobEchoue.nom} » a échoué, mais son log n'a PAS pu être lu.`);
    L.push('  Ce n\'est pas un log vide : c\'est un log absent. La cause de l\'échec reste');
    L.push('  entièrement inconnue — ne la devine pas.');
  } else {
    L.push(`  Job « ${r.jobEchoue.nom} »${r.jobEchoue.etape ? ` (étape ${r.jobEchoue.etape})` : ''},`
         + ' nettoyé des codes de couleur, CAVIARDÉ, puis découpé autour de l\'erreur.');
    if (r.extrait.secrets) {
      L.push(`  ${r.extrait.secrets} valeur(s) de secret ont été retirées avant lecture. Ne`);
      L.push('  recopie jamais un emplacement caviardé comme s\'il portait une valeur.');
    }
    if (r.extrait.coupe) {
      L.push(`  EXTRAIT : ${r.extrait.gardees} ligne(s) montrées sur ${r.extrait.total}. Ce qui`);
      L.push('  a été écarté peut porter la vraie cause — ne conclus pas sur ce que tu n\'as');
      L.push('  pas lu.');
    } else {
      L.push(`  Log entier : ${r.extrait.total} ligne(s), rien n'a été coupé.`);
    }
    L.push('');
    L.push(r.extrait.texte);
  }
  L.push('');

  L.push('CE QUE CETTE LECTURE NE PERMET PAS');
  L.push('  UNE SEULE EXÉCUTION EST UN ÉCHANTILLON. Un job lent ce jour-là a peut-être');
  L.push('  attendu un agent libre, un miroir de paquets, ou un réseau chargé. Ne conclus');
  L.push('  pas qu\'un job « est lent » depuis une mesure — dis « a duré », et propose de');
  L.push('  regarder plusieurs exécutions.');
  L.push('  Les durées ne disent pas non plus POURQUOI un job est long : téléchargement,');
  L.push('  compilation, attente. Seul le log le dirait, et il n\'est lu que pour l\'échec.');
  return L.join('\n');
}

/** Le résumé d'une ligne, pour l'écran de lancement. */
export function resumeExecution(r) {
  if (!r.jobs.length) return `${r.depot} — aucun job lu sur cette exécution`;
  return `${r.depot} · ${r.run.branche || '(sans branche)'} — ${r.jobs.length} job(s)`
       + ` · subi ${mmss(r.tempsSubi)} · machine ${mmss(r.tempsMachine)}`
       + `${r.echoues.length ? ` · ${r.echoues.length} en échec` : ''}`;
}

export const SIGNAUX_EXECUTION = {
  /*
   * `pipeline_log` — le nom de l'inventaire du hub, et il est un peu étroit.
   *
   * Chez le hub, c'est un log de pipeline qu'on COLLE. Ici, la plateforme lit les jobs,
   * leurs durées, et ne va chercher le log QUE de ce qui a échoué — nettoyé et caviardé.
   * On garde le nom parce que deux capacités s'en réclament et qu'un nom différent aurait
   * fait diverger le catalogue de la plateforme ; le texte, lui, dit exactement ce qu'il
   * porte.
   *
   * `parExecution` et non `parRun` : la liste des pipelines en ÉCHEC ne convient pas ici.
   * On veut pouvoir ouvrir une exécution RÉUSSIE mais lente — c'est même le cas d'usage
   * principal de « réduire la durée d'un pipeline ».
   */
  pipeline_log: {
    libelle: 'une exécution de CI, job par job',
    besoin: 'un pipeline du dépôt, choisi dans la liste — réussi ou non',
    source: 'js/insights.js · js/daily-report.js',
    parExecution: true
  }
};
