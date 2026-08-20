/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  L'HISTORIQUE DES EXÉCUTIONS DE CI — LES ÉVÉNEMENTS, PAS LEUR MOYENNE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── POURQUOI IL N'EST PAS `chiffres_dora` ────────────────────────────────────
 *
 * `chiffres_dora` répond à « où en est cette équipe » : quatre métriques agrégées sur une
 * fenêtre. C'est exactement ce qu'il faut pour un comité, et exactement ce qui empêche de
 * répondre à « pourquoi ».
 *
 * Un taux d'échec de 30 % peut être trente pipelines qui échouent un peu partout, ou une
 * seule journée noire suivie de trois semaines calmes. Une fréquence de déploiement basse
 * peut venir d'un rythme régulier lent, ou d'un gros lot par mois. La moyenne efface
 * précisément ce qui permet d'agir — la FORME dans le temps, et le fait qu'un même job
 * revienne dans les échecs.
 *
 * Ce signal rend donc la SUITE des exécutions : datées, avec leur branche, leur statut et
 * leur durée, plus les regroupements qu'aucun agrégat ne conserve — par jour, par branche,
 * par succession. Cinq agents de l'inventaire le réclament, et aucun ne peut travailler
 * sur une moyenne.
 *
 * ── CE QU'IL NE PORTE PAS ────────────────────────────────────────────────────
 *
 * AUCUN LOG, AUCUN JOB. Savoir qu'un pipeline a échoué et savoir pourquoi sont deux
 * lectures, et la seconde coûte un appel par job. `job_en_echec` porte déjà l'extraction
 * d'un log ; `pipeline_log` porte les durées par job d'une exécution. Trois signaux parce
 * que ce sont trois questions, et parce que leur coût d'obtention n'a rien de comparable.
 *
 * ── LA LIMITE, ET ELLE EST DITE EN TÊTE ──────────────────────────────────────
 *
 * La forge rend les N dernières exécutions, pas toutes. Sur un dépôt actif, la fenêtre
 * lue est plus courte que la fenêtre demandée — et un agent qui l'ignore écrit « l'activité
 * a chuté » alors que c'est le plafond de lecture qui a coupé. Le texte annonce donc la
 * période RÉELLEMENT couverte, et dit quand le plafond a mordu.
 */

import { branchesDeProduction } from './signaux-dora.js';

/** Le plafond de lecture : au-delà, la forge pagine et le coût grimpe. */
export const MAX_EXECUTIONS = 100;

/** La fenêtre par défaut, en jours — celle de `chiffres_dora`, pour qu'ils se croisent. */
export const FENETRE_JOURS = 30;

/** Combien d'exécutions le texte détaille une par une. Le reste est compté, jamais tu. */
const MAX_DETAIL = 40;

/** Combien de jours la courbe montre au plus. */
const MAX_JOURS = 30;

const jourDe = (iso) => String(iso || '').slice(0, 10);

/**
 * Les statuts, ramenés à TROIS familles — et « en cours » n'est pas « échoué ».
 *
 * La forge distingue annulé, ignoré, manuel, en attente. Pour lire une tendance, seule
 * compte la question « est-ce que ça a abouti ». Mais un pipeline ANNULÉ n'est pas un
 * échec : le compter comme tel gonfle un taux d'échec sans qu'aucun test n'ait rien
 * trouvé, et c'est l'erreur qui fait chercher un problème qui n'existe pas.
 */
export const FAMILLES_STATUT = {
  reussi: ['success', 'reussi', 'passed', 'completed'],
  echoue: ['failed', 'echoue', 'failure', 'error'],
  autre: ['canceled', 'cancelled', 'annule', 'skipped', 'ignore', 'manual',
          'pending', 'running', 'en_cours', 'created', 'waiting']
};

export function familleDe(statut) {
  const s = String(statut || '').toLowerCase();
  for (const [famille, mots] of Object.entries(FAMILLES_STATUT)) {
    if (mots.includes(s)) return famille;
  }
  return 'autre';
}

/**
 * Les séries d'échecs consécutifs sur une même branche.
 *
 * C'EST LE MOTIF QUE LA MOYENNE DÉTRUIT. Dix échecs isolés sur trente jours et deux séries
 * de cinq échecs de suite donnent le même taux et racontent deux histoires opposées : la
 * première dit « instable », la seconde dit « cassé pendant deux jours, puis réparé ».
 *
 * Une série est comptée à partir de DEUX échecs consécutifs sur la même branche : un échec
 * isolé est un incident, deux d'affilée sont un blocage.
 */
export function seriesDEchecs(executions = []) {
  const parBranche = new Map();
  for (const e of executions) {
    if (!parBranche.has(e.branche)) parBranche.set(e.branche, []);
    parBranche.get(e.branche).push(e);
  }

  const series = [];
  for (const [branche, liste] of parBranche) {
    // Du plus ancien au plus récent : une série se lit dans le sens du temps.
    const ordre = [...liste].sort((a, b) => String(a.quand).localeCompare(String(b.quand)));
    let courante = null;
    for (const e of ordre) {
      if (familleDe(e.statut) === 'echoue') {
        courante = courante || { branche, debut: e.quand, fin: e.quand, echecs: 0 };
        courante.echecs += 1;
        courante.fin = e.quand;
      } else {
        if (courante && courante.echecs >= 2) series.push(courante);
        courante = null;
      }
    }
    if (courante && courante.echecs >= 2) series.push({ ...courante, encours: true });
  }
  return series.sort((a, b) => b.echecs - a.echecs);
}

const compter = (liste, cle) => {
  const par = new Map();
  for (const e of liste) {
    const k = cle(e);
    const c = par.get(k) || { cle: k, total: 0, reussis: 0, echoues: 0, autres: 0 };
    c.total += 1;
    c[{ reussi: 'reussis', echoue: 'echoues', autre: 'autres' }[familleDe(e.statut)]] += 1;
    par.set(k, c);
  }
  return [...par.values()];
};

/**
 * L'historique des exécutions de CI d'un dépôt.
 *
 * @param {object} e
 *   @param {string} e.depot
 *   @param {Array<{id, statut, branche, quand, debut, sha, secondes}>} e.executions
 *   @param {string} e.brancheDefaut
 *   @param {number} e.fenetre        la fenêtre DEMANDÉE, en jours
 *   @param {Date} e.maintenant
 */
export function historiquePipelines({ depot = '', executions = [], brancheDefaut = 'main',
                                      fenetre = FENETRE_JOURS,
                                      maintenant = new Date() } = {}) {
  // Du plus récent au plus ancien : c'est l'ordre dans lequel on regarde un historique.
  const ordre = [...executions]
    .sort((a, b) => String(b.quand).localeCompare(String(a.quand)));

  // `branchesDeProduction` rend un Set — la même autorité que `chiffres_dora`, pour que
  // les deux signaux ne divergent jamais sur ce qu'est une branche de production.
  const prod = branchesDeProduction(brancheDefaut);
  const estProd = (b) => prod.has(String(b || ''));

  const total = ordre.length;
  const reussis = ordre.filter((e) => familleDe(e.statut) === 'reussi').length;
  const echoues = ordre.filter((e) => familleDe(e.statut) === 'echoue').length;
  const autres = total - reussis - echoues;

  /*
   * LE TAUX SE CALCULE SUR CE QUI A ABOUTI, PAS SUR TOUT.
   *
   * Un pipeline annulé ou encore en cours n'a rien prouvé. L'inclure au dénominateur fait
   * baisser le taux d'échec quand quelqu'un annule beaucoup — ce qui récompense
   * exactement le mauvais comportement.
   */
  const aboutis = reussis + echoues;
  const tauxEchec = aboutis ? Math.round((echoues / aboutis) * 100) : null;

  const jours = compter(ordre, (e) => jourDe(e.quand))
    .sort((a, b) => b.cle.localeCompare(a.cle));
  const branches = compter(ordre, (e) => e.branche || '(sans branche)')
    .sort((a, b) => b.total - a.total);

  const series = seriesDEchecs(ordre);

  // La période RÉELLEMENT couverte, qui n'est pas la fenêtre demandée dès que le plafond
  // a mordu. C'est la seule information qui rende les comptes interprétables.
  const dates = ordre.map((e) => e.quand).filter(Boolean);
  const couvre = dates.length
    ? { du: jourDe(dates[dates.length - 1]), au: jourDe(dates[0]) } : null;
  const plafondAtteint = total >= MAX_EXECUTIONS;

  const durees = ordre.map((e) => Number(e.secondes) || 0).filter((s) => s > 0);
  const dureeMediane = durees.length
    ? [...durees].sort((a, b) => a - b)[Math.floor(durees.length / 2)] : null;

  const r = {
    depot,
    brancheDefaut,
    fenetre,
    total,
    reussis,
    echoues,
    autres,
    aboutis,
    tauxEchec,
    jours: jours.slice(0, MAX_JOURS),
    joursTotal: jours.length,
    branches,
    series,
    executions: ordre,
    surProd: ordre.filter((e) => estProd(e.branche)).length,
    dureeMediane,
    couvre,
    plafondAtteint,
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteHistorique(r) };
}

const mmss = (s) => (s == null ? 'inconnue'
  : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

function texteHistorique(r) {
  const L = [];
  L.push(`Historique des exécutions de CI — ${r.depot}`);
  L.push(`${r.total} exécution(s) lue(s), fenêtre demandée : ${r.fenetre} jour(s).`);
  L.push('');

  /*
   * LA PÉRIODE RÉELLE AVANT LES CHIFFRES.
   *
   * L'erreur que ce signal rend facile : lire « 100 exécutions » comme la production de la
   * fenêtre entière, alors que le plafond a coupé au bout de six jours sur un dépôt actif.
   * Un agent conclut alors « l'activité a chuté avant le 12 » — et c'est la lecture qui
   * s'est arrêtée là, pas l'activité.
   */
  L.push('CE QUE CETTE LECTURE COUVRE VRAIMENT');
  if (!r.total) {
    L.push('  AUCUNE exécution lue. Ce n\'est PAS « la CI ne tourne pas » : ce peut être un');
    L.push('  dépôt sans chaîne, une fenêtre trop courte, ou un droit manquant.');
  } else {
    L.push(`  Du ${r.couvre.du} au ${r.couvre.au} — ${r.joursTotal} jour(s) portant au moins`
         + ' une exécution.');
    if (r.plafondAtteint) {
      L.push(`  PLAFOND DE ${MAX_EXECUTIONS} ATTEINT. La période couverte est donc plus`);
      L.push('  COURTE que la fenêtre demandée, et tout ce qui précède le premier jour listé');
      L.push('  est invisible ici. Ne conclus RIEN sur une baisse d\'activité avant cette date.');
    }
    L.push('  Les jours sans aucune exécution n\'apparaissent pas : un trou dans la liste des');
    L.push('  jours est un jour sans pipeline, pas une donnée manquante.');
  }
  L.push('');

  L.push('LE COMPTE');
  L.push(`  ${r.reussis} réussie(s) · ${r.echoues} échouée(s) · ${r.autres} autre(s)`
       + ' (annulée, ignorée, en cours)');
  L.push(`  Taux d'échec : ${r.tauxEchec === null ? 'non calculable — aucune exécution aboutie'
    : `${r.tauxEchec} % sur ${r.aboutis} exécution(s) ABOUTIE(S)`}`);
  L.push('  Les annulées et les en-cours sont HORS du dénominateur : elles n\'ont rien');
  L.push('  prouvé. Les compter comme des échecs ferait chercher un problème qui n\'existe pas.');
  L.push(`  Durée médiane : ${mmss(r.dureeMediane)}`
       + `${r.dureeMediane === null ? ' — la forge n\'a pas rendu de durée' : ''}`);
  L.push(`  Sur une branche de production (${r.brancheDefaut}) : ${r.surProd}`);
  L.push('');

  if (r.series.length) {
    L.push(`LES SÉRIES D'ÉCHECS CONSÉCUTIFS (${r.series.length})`);
    L.push('  Deux échecs d\'affilée sur une même branche. C\'est le motif qu\'un taux moyen');
    L.push('  détruit : dix échecs isolés et deux séries de cinq donnent le même taux et');
    L.push('  racontent deux histoires opposées.');
    for (const s of r.series.slice(0, 10)) {
      L.push(`  ${String(s.echecs).padStart(3)} échec(s) d'affilée · ${s.branche} · `
           + `du ${jourDe(s.debut)} au ${jourDe(s.fin)}${s.encours ? ' · TOUJOURS EN COURS' : ''}`);
    }
    if (r.series.length > 10) L.push(`  … ${r.series.length - 10} autre(s) série(s).`);
  } else {
    L.push('LES SÉRIES D\'ÉCHECS CONSÉCUTIFS (0)');
    L.push('  Aucune série de deux échecs d\'affilée sur une même branche dans ce qui a été');
    L.push('  lu. Les échecs, s\'il y en a, sont isolés — ce qui oriente vers l\'instabilité');
    L.push('  plutôt que vers une rupture.');
  }
  L.push('');

  L.push(`PAR BRANCHE (${r.branches.length})`);
  for (const b of r.branches.slice(0, 12)) {
    L.push(`  ${String(b.cle).slice(0, 34).padEnd(34)} ${String(b.total).padStart(4)} exéc. · `
         + `${b.reussis} ✔ · ${b.echoues} ✘ · ${b.autres} ~`);
  }
  if (r.branches.length > 12) L.push(`  … ${r.branches.length - 12} autre(s) branche(s).`);
  L.push('');

  if (r.jours.length) {
    L.push(`JOUR PAR JOUR — ${r.jours.length} jour(s) montré(s)`
         + `${r.joursTotal > r.jours.length ? ` sur ${r.joursTotal}` : ''}`);
    for (const j of r.jours) {
      L.push(`  ${j.cle}  ${String(j.total).padStart(3)} exéc. · ${j.reussis} ✔ · `
           + `${j.echoues} ✘ · ${j.autres} ~`);
    }
    L.push('');
  }

  if (r.executions.length) {
    const montrees = r.executions.slice(0, MAX_DETAIL);
    L.push(`LES EXÉCUTIONS, DE LA PLUS RÉCENTE (${montrees.length}`
         + `${r.total > montrees.length ? ` sur ${r.total}` : ''})`);
    for (const e of montrees) {
      L.push(`  ${String(e.quand).slice(0, 16).padEnd(16)} ${familleDe(e.statut).padEnd(7)}`
           + ` ${String(e.branche || '(sans branche)').slice(0, 28).padEnd(28)}`
           + ` ${e.secondes ? mmss(Number(e.secondes)) : ''}`);
    }
    if (r.total > montrees.length) {
      L.push(`  … ${r.total - montrees.length} exécution(s) non détaillée(s), mais COMPTÉE(S)`);
      L.push('    dans tout ce qui précède.');
    }
    L.push('');
  }

  L.push('CE QUE CE SIGNAL NE PORTE PAS');
  L.push('  Ni les JOBS d\'une exécution, ni aucun LOG : savoir qu\'un pipeline a échoué et');
  L.push('  savoir pourquoi sont deux lectures. Ne devine donc jamais la cause d\'un échec —');
  L.push('  dis ce que la forme montre, et ce qu\'il faudrait ouvrir pour trancher.');
  L.push('  Ni ce qui a été DÉPLOYÉ : un pipeline réussi n\'est pas une mise en production.');
  return L.join('\n');
}

/** Le résumé d'une ligne, pour l'écran de lancement. */
export function resumeHistorique(r) {
  if (!r.total) return `${r.depot} — aucune exécution lue`;
  return `${r.depot} — ${r.total} exécution(s) du ${r.couvre.du} au ${r.couvre.au}`
       + ` · ${r.tauxEchec === null ? 'taux N/A' : `${r.tauxEchec} % d'échec`}`
       + `${r.series.length ? ` · ${r.series.length} série(s) d'échecs` : ''}`
       + `${r.plafondAtteint ? ' · plafond atteint' : ''}`;
}

export const SIGNAUX_PIPELINES = {
  /*
   * `historique_pipelines` — le nom que l'inventaire du hub donne déjà à cette entrée.
   *
   * Cinq de ses capacités s'en réclament ; en inventer un autre aurait laissé le catalogue
   * dire une chose et la plateforme une autre, et l'écart se serait payé au premier
   * rapprochement.
   */
  historique_pipelines: {
    libelle: 'les exécutions de CI dans le temps',
    besoin: 'les pipelines du dépôt sur une fenêtre, avec leur date, leur branche et leur statut',
    source: 'js/insights.js',
    /*
     * `choix` et non un genre neuf : les options ne se lisent pas dans un dépôt, elles
     * sont déclarées ici. C'est exactement le cas que ce genre existe pour couvrir, et
     * inventer un `genre: 'fenetre'` aurait ajouté un chemin de rendu pour trois valeurs.
     *
     * Trois fenêtres, et pas un champ libre : 7 jours pour lire une semaine de travail,
     * 30 pour croiser avec DORA qui calcule sur cette fenêtre, 90 pour une tendance. Un
     * champ libre inviterait à demander 365 jours, que le plafond de lecture ne servira
     * jamais — et le rapport annoncerait une fenêtre qu'il n'a pas couverte.
     */
    reglages: [
      { nom: 'fenetre', libelle: 'Sur combien de jours', genre: 'choix', requis: false,
        options: ['7', '30', '90'] }
    ]
  }
};
