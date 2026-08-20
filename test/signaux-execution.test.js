import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executionCi, resumeExecution, parEtape } from '../lib/signaux-execution.js';
import { SIGNAUX, sait, listeDeChoix } from '../lib/signaux-matiere.js';

const RUN = { id: 42, branche: 'main', statut: 'echec',
              quand: '2026-08-20T10:00:00Z', sha: 'abcdef1234' };

const j = (nom, etape, statut, secondes) => ({ nom, etape, statut, secondes });

const sur = (jobs, extra = {}) => executionCi({
  depot: 'lcl/paiement', run: RUN, jobs, ...extra });

/* ══ LES DEUX TOTAUX — LE CONTRESENS CENTRAL ══════════════════════════════════ */

describe('la somme des durées n\'est PAS la durée du pipeline', () => {
  /*
   * Trois jobs de cinq minutes dans la MÊME étape : cinq minutes d'attente, quinze de
   * machine. Confondre les deux fait « optimiser » un pipeline sans faire gagner une
   * seconde à qui attend — et c'est l'erreur que ce signal existe pour empêcher.
   */
  const PARALLELE = [j('a', 'test', 'success', 300),
                     j('b', 'test', 'success', 300),
                     j('c', 'test', 'success', 300)];

  test('trois jobs parallèles : 5 min subies, 15 min machine', () => {
    const r = sur(PARALLELE);
    assert.equal(r.tempsSubi, 300);
    assert.equal(r.tempsMachine, 900);
  });

  test('trois jobs en série : les deux totaux se rejoignent', () => {
    const r = sur([j('a', 'un', 'success', 300),
                   j('b', 'deux', 'success', 300),
                   j('c', 'trois', 'success', 300)]);
    assert.equal(r.tempsSubi, 900);
    assert.equal(r.tempsMachine, 900);
  });

  test('les deux totaux sont EN TÊTE, et leur différence est expliquée', () => {
    const r = sur(PARALLELE);
    const tete = r.texte.slice(0, r.texte.indexOf('ÉTAPE PAR ÉTAPE'));
    assert.match(tete, /TEMPS SUBI/);
    assert.match(tete, /TEMPS MACHINE/);
    assert.match(tete, /ne fait gagner AUCUNE seconde/);
  });

  test('le temps subi est un PLANCHER : l\'attente d\'un agent n\'est pas comptée', () => {
    // Le signal ne peut pas voir le temps passé en file d'attente. Le taire ferait lire
    // « 8 minutes » comme le temps écoulé, alors qu'il a pu être le double.
    assert.match(sur(PARALLELE).texte, /le temps réellement écoulé est donc SUPÉRIEUR/);
  });

  test('un job sans durée compte pour zéro, et le texte dit que le total est un plancher', () => {
    const r = sur([j('a', 'test', 'success', 300), j('b', 'test', 'success', 0)]);
    assert.equal(r.sansDuree, 1);
    assert.match(r.texte, /SANS DURÉE rapportée/);
    assert.match(r.texte, /planchers/);
  });
});

/* ══ LE REGROUPEMENT PAR ÉTAPE ════════════════════════════════════════════════ */

describe('l\'étape est l\'unité qui décide de l\'attente', () => {
  test('chaque étape garde son job le plus long', () => {
    const e = parEtape([j('court', 'test', 'success', 10),
                        j('long', 'test', 'success', 400),
                        j('seul', 'build', 'success', 100)]);
    assert.equal(e.length, 2);
    assert.equal(e[0].plusLong.nom, 'long');
    assert.equal(e[0].secondes, 410, 'la somme machine de l\'étape');
    assert.equal(e[1].plusLong.nom, 'seul');
  });

  test('un job sans étape est rangé sous un nom, jamais perdu', () => {
    const e = parEtape([j('orphelin', '', 'success', 60)]);
    assert.equal(e[0].etape, '(sans étape)');
  });

  test('le texte désigne le job à raccourcir, pas la somme', () => {
    assert.match(sur([j('long', 'test', 'success', 400), j('court', 'test', 'success', 10)]).texte,
                 /c'est LUI qu'il\n  faut raccourcir, pas la somme/);
  });
});

/* ══ LE LOG — LU SEULEMENT POUR L'ÉCHEC ═══════════════════════════════════════ */

describe('le log de l\'échec, et rien d\'autre', () => {
  test('sans job en échec, aucun log n\'est lu et le texte dit pourquoi', () => {
    const r = sur([j('a', 'test', 'success', 60)]);
    assert.equal(r.extrait, null);
    assert.match(r.texte, /Aucun job en échec : aucun log n'a été lu/);
    assert.match(r.texte, /coûterait plusieurs mégaoctets/);
  });

  test('UN LOG ABSENT N\'EST PAS UN LOG VIDE', () => {
    /*
     * La distinction décide de ce qu'on fait ensuite : un log vide se lit et n'apprend
     * rien ; un log absent veut dire qu'on n'a pas regardé, et la cause reste entière.
     */
    const r = sur([j('unit', 'test', 'echec', 60)],
                  { jobEchoue: { nom: 'unit', etape: 'test' }, log: null });
    assert.equal(r.logLisible, false);
    assert.match(r.texte, /son log n'a PAS pu être lu/);
    assert.match(r.texte, /Ce n'est pas un log vide/);
    assert.match(r.texte, /ne la devine pas/);
  });

  test('le log est CAVIARDÉ avant d\'être découpé, et le compte est dit', () => {
    const r = sur([j('unit', 'test', 'echec', 60)], {
      jobEchoue: { nom: 'unit', etape: 'test' },
      log: 'npm ERR! echec\nJETON=glpat-AbCdEfGhIjKlMnOpQrSt\n' });
    assert.ok(!r.texte.includes('glpat-AbCdEfGhIjKlMnOpQrSt'), 'la valeur ne part jamais');
    assert.ok(r.extrait.secrets >= 1);
    assert.match(r.texte, /valeur\(s\) de secret ont été retirées/);
    assert.match(r.texte, /Ne\n  recopie jamais un emplacement caviardé/);
  });

  test('un log entier le dit, un log coupé dit combien de lignes ont été écartées', () => {
    const court = sur([j('u', 't', 'echec', 1)],
                      { jobEchoue: { nom: 'u' }, log: 'a\nb\nc\n' });
    assert.match(court.texte, /Log entier : \d+ ligne\(s\), rien n'a été coupé/);

    const long = sur([j('u', 't', 'echec', 1)], { jobEchoue: { nom: 'u' },
      log: `${'bruit\n'.repeat(300)}npm ERR! cassé\n${'suite\n'.repeat(300)}` });
    assert.equal(long.extrait.coupe, true);
    assert.match(long.texte, /EXTRAIT : \d+ ligne\(s\) montrées sur \d+/);
    assert.match(long.texte, /ne conclus pas sur ce que tu n'as\n  pas lu/);
  });
});

/* ══ CE QUE LE SIGNAL REFUSE DE LAISSER CROIRE ════════════════════════════════ */

describe('une exécution est un échantillon, et le texte le martèle', () => {
  test('le texte interdit de conclure qu\'un job « est lent »', () => {
    const r = sur([j('a', 'test', 'success', 900)]);
    assert.match(r.texte, /UNE SEULE EXÉCUTION EST UN ÉCHANTILLON/);
    assert.match(r.texte, /dis « a duré »/);
  });

  test('les durées ne disent pas POURQUOI, et c\'est écrit', () => {
    assert.match(sur([j('a', 'test', 'success', 900)]).texte,
                 /ne disent pas non plus POURQUOI un job est long/);
  });

  test('zéro job n\'est pas « le pipeline est vide »', () => {
    const r = sur([]);
    assert.match(r.texte, /AUCUN JOB LU/);
    assert.match(r.texte, /Ce n'est pas « le pipeline\n  est vide »/);
    assert.match(r.texte, /un droit manquant/);
  });

  test('un échec est nommé, une exécution saine le dit aussi', () => {
    assert.match(sur([j('u', 't', 'echec', 60)]).texte, /CE QUI A ÉCHOUÉ \(1\)/);
    assert.match(sur([j('u', 't', 'success', 60)]).texte, /Aucun job en échec dans cette exécution/);
  });
});

/* ══ LE RÉSUMÉ ET LA DÉCLARATION ══════════════════════════════════════════════ */

describe('le résumé et le registre', () => {
  test('le résumé porte LES DEUX totaux, jamais un seul', () => {
    const r = sur([j('a', 'test', 'success', 300), j('b', 'test', 'echec', 300)]);
    assert.match(resumeExecution(r), /subi 5 min 00 s/);
    assert.match(resumeExecution(r), /machine 10 min 00 s/);
    assert.match(resumeExecution(r), /1 en échec/);
  });

  test('`pipeline_log` déroule les exécutions, pas seulement les échecs', () => {
    /*
     * `run` ne liste que les pipelines en ÉCHEC. Ici, l'exécution qu'on veut ouvrir est
     * le plus souvent une exécution RÉUSSIE mais trop longue : deux listes, deux questions.
     */
    assert.ok(sait('pipeline_log'));
    assert.equal(listeDeChoix('pipeline_log'), 'execution');
    assert.equal(listeDeChoix('job_en_echec'), 'run');
    assert.ok(SIGNAUX.pipeline_log.source);
  });
});
