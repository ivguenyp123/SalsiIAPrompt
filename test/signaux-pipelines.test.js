import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { historiquePipelines, resumeHistorique, seriesDEchecs, familleDe,
         MAX_EXECUTIONS } from '../lib/signaux-pipelines.js';
import { SIGNAUX, sait, reglagesDe } from '../lib/signaux-matiere.js';

const M = new Date('2026-08-20T12:00:00Z');
const DEPOT = 'lcl/paiement';

const p = (quand, statut, branche = 'main', secondes = 300) =>
  ({ id: quand, quand, statut, branche, secondes, sha: quand });

const sur = (executions, extra = {}) => historiquePipelines({
  depot: DEPOT, executions, brancheDefaut: 'main', maintenant: M, ...extra });

/* ══ LES STATUTS ══════════════════════════════════════════════════════════════ */

describe('trois familles de statut, et « annulé » n\'est pas « échoué »', () => {
  test('les statuts des deux forges tombent dans la bonne famille', () => {
    assert.equal(familleDe('success'), 'reussi');
    assert.equal(familleDe('failed'), 'echoue');
    assert.equal(familleDe('failure'), 'echoue');
    assert.equal(familleDe('canceled'), 'autre');
    assert.equal(familleDe('running'), 'autre');
    assert.equal(familleDe('quelque-chose-de-neuf'), 'autre');
  });

  test('LE TAUX SE CALCULE SUR CE QUI A ABOUTI, pas sur tout', () => {
    /*
     * Compter les annulés au dénominateur fait BAISSER le taux d'échec quand quelqu'un
     * annule beaucoup — ce qui récompense exactement le mauvais comportement. Et les
     * compter comme des échecs ferait chercher un problème qui n'existe pas.
     */
    const r = sur([p('2026-08-19T10:00:00Z', 'success'),
                   p('2026-08-19T11:00:00Z', 'failed'),
                   p('2026-08-19T12:00:00Z', 'canceled'),
                   p('2026-08-19T13:00:00Z', 'running')]);
    assert.equal(r.total, 4);
    assert.equal(r.aboutis, 2, 'seuls le réussi et l\'échoué ont prouvé quelque chose');
    assert.equal(r.tauxEchec, 50);
    assert.match(r.texte, /HORS du dénominateur/);
  });

  test('sans aucune exécution aboutie, le taux est N/A et jamais zéro', () => {
    const r = sur([p('2026-08-19T10:00:00Z', 'canceled'),
                   p('2026-08-19T11:00:00Z', 'running')]);
    assert.equal(r.tauxEchec, null);
    assert.match(r.texte, /non calculable/);
    assert.ok(!/Taux d'échec : 0 %/.test(r.texte));
  });
});

/* ══ LES SÉRIES — LE MOTIF QUE LA MOYENNE DÉTRUIT ═════════════════════════════ */

describe('les séries d\'échecs consécutifs', () => {
  test('deux échecs d\'affilée sur une branche font une série, un seul non', () => {
    const s = seriesDEchecs([
      p('2026-08-01T10:00:00Z', 'failed'),
      p('2026-08-02T10:00:00Z', 'success'),
      p('2026-08-03T10:00:00Z', 'failed'),
      p('2026-08-04T10:00:00Z', 'failed'),
      p('2026-08-05T10:00:00Z', 'success')]);
    assert.equal(s.length, 1, 'l\'échec isolé du 01 n\'est pas une série');
    assert.equal(s[0].echecs, 2);
    assert.equal(s[0].debut.slice(0, 10), '2026-08-03');
  });

  test('une série se compte PAR BRANCHE, jamais en mélangeant', () => {
    /*
     * Sans ce découpage, un échec sur `feat/a` intercalé entre deux échecs de `main`
     * produirait une série de trois qui n'a jamais existé — et l'inverse : deux échecs de
     * `main` séparés par un succès de `feat/b` seraient vus comme continus.
     */
    const s = seriesDEchecs([
      p('2026-08-01T10:00:00Z', 'failed', 'main'),
      p('2026-08-01T11:00:00Z', 'failed', 'feat/a'),
      p('2026-08-01T12:00:00Z', 'failed', 'main')]);
    assert.equal(s.length, 1, 'seule `main` a deux échecs consécutifs');
    assert.equal(s[0].branche, 'main');
    assert.equal(s[0].echecs, 2);
  });

  test('une série qui n\'est pas terminée est marquée EN COURS', () => {
    const r = sur([p('2026-08-19T10:00:00Z', 'failed'),
                   p('2026-08-19T11:00:00Z', 'failed')]);
    assert.equal(r.series[0].encours, true);
    assert.match(r.texte, /TOUJOURS EN COURS/);
  });

  test('aucune série est un CONSTAT, et le texte l\'oriente', () => {
    /*
     * « Zéro série » n'est pas une absence d'information : dix échecs isolés orientent
     * vers l'instabilité, deux séries de cinq vers une rupture. Le texte le dit.
     */
    const r = sur([p('2026-08-19T10:00:00Z', 'failed'),
                   p('2026-08-19T11:00:00Z', 'success'),
                   p('2026-08-19T12:00:00Z', 'failed')]);
    assert.equal(r.series.length, 0);
    assert.match(r.texte, /oriente vers l'instabilité/);
  });
});

/* ══ LA PÉRIODE RÉELLEMENT COUVERTE ═══════════════════════════════════════════ */

describe('la lecture dit ce qu\'elle couvre, avant de dire ce qu\'elle a compté', () => {
  const TROIS = [p('2026-08-18T10:00:00Z', 'success'),
                 p('2026-08-19T10:00:00Z', 'failed'),
                 p('2026-08-20T10:00:00Z', 'success')];

  test('la période réelle est annoncée AVANT les chiffres', () => {
    const r = sur(TROIS);
    const tete = r.texte.slice(0, r.texte.indexOf('LE COMPTE'));
    assert.match(tete, /CE QUE CETTE LECTURE COUVRE VRAIMENT/);
    assert.match(tete, /Du 2026-08-18 au 2026-08-20/);
  });

  test('LE PLAFOND ATTEINT est dit, et l\'erreur qu\'il produit est nommée', () => {
    /*
     * Vu de loin, « 100 exécutions » se lit comme la production de la fenêtre entière.
     * Sur un dépôt actif, la lecture s'est arrêtée au bout de six jours — et un agent
     * conclut « l'activité a chuté avant le 12 » alors que c'est la lecture qui a coupé.
     */
    const beaucoup = Array.from({ length: MAX_EXECUTIONS }, (_, i) =>
      p(`2026-08-${String(10 + (i % 10)).padStart(2, '0')}T10:${String(i % 60).padStart(2, '0')}:00Z`,
        'success'));
    const r = sur(beaucoup);
    assert.equal(r.plafondAtteint, true);
    assert.match(r.texte, /PLAFOND DE 100 ATTEINT/);
    assert.match(r.texte, /Ne conclus RIEN sur une baisse d'activité/);
  });

  test('sous le plafond, aucune alerte de plafond', () => {
    assert.ok(!/PLAFOND/.test(sur(TROIS).texte));
  });

  test('zéro exécution n\'est pas « la CI ne tourne pas »', () => {
    const r = sur([]);
    assert.equal(r.total, 0);
    assert.match(r.texte, /Ce n'est PAS « la CI ne tourne pas »/);
    assert.match(r.texte, /un droit manquant/);
  });

  test('un jour sans exécution est un jour sans pipeline, et le texte le dit', () => {
    const r = sur(TROIS);
    assert.match(r.texte, /un trou dans la liste des\n  jours est un jour sans pipeline/);
  });
});

/* ══ LES REGROUPEMENTS ════════════════════════════════════════════════════════ */

describe('ce que la moyenne effacerait', () => {
  const MELANGE = [
    p('2026-08-18T10:00:00Z', 'success', 'main'),
    p('2026-08-18T11:00:00Z', 'failed', 'feat/x'),
    p('2026-08-19T10:00:00Z', 'failed', 'feat/x'),
    p('2026-08-20T10:00:00Z', 'success', 'main')];

  test('le jour par jour sort du plus récent au plus ancien', () => {
    const r = sur(MELANGE);
    assert.deepEqual(r.jours.map((j) => j.cle),
                     ['2026-08-20', '2026-08-19', '2026-08-18']);
    assert.equal(r.jours[2].total, 2);
  });

  test('les branches sortent par volume, avec le détail des statuts', () => {
    const r = sur(MELANGE);
    assert.equal(r.branches[0].cle, 'main');
    assert.equal(r.branches[0].reussis, 2);
    const x = r.branches.find((b) => b.cle === 'feat/x');
    assert.equal(x.echoues, 2);
  });

  test('les exécutions sur une branche de production sont comptées à part', () => {
    assert.equal(sur(MELANGE).surProd, 2);
  });

  test('une branche vide est nommée, jamais tue', () => {
    const r = sur([p('2026-08-19T10:00:00Z', 'success', '')]);
    assert.equal(r.branches[0].cle, '(sans branche)');
  });

  test('la durée médiane est N/A quand la forge n\'en rend pas', () => {
    const r = sur([{ id: 1, quand: '2026-08-19T10:00:00Z', statut: 'success', branche: 'main' }]);
    assert.equal(r.dureeMediane, null);
    assert.match(r.texte, /la forge n'a pas rendu de durée/);
  });
});

/* ══ CE QUE LE SIGNAL REFUSE DE PORTER ════════════════════════════════════════ */

describe('le signal dit ce qu\'il ne contient pas', () => {
  test('ni jobs ni logs, et le texte interdit de deviner la cause', () => {
    const r = sur([p('2026-08-19T10:00:00Z', 'failed')]);
    assert.match(r.texte, /Ni les JOBS d'une exécution, ni aucun LOG/);
    assert.match(r.texte, /ne devine donc jamais la cause d'un échec/i);
  });

  test('un pipeline réussi n\'est pas une mise en production, et c\'est écrit', () => {
    assert.match(sur([p('2026-08-19T10:00:00Z', 'success')]).texte,
                 /un pipeline réussi n'est pas une mise en production/i);
  });

  test('ce qui n\'est pas détaillé reste COMPTÉ, et le texte le dit', () => {
    const beaucoup = Array.from({ length: 60 }, (_, i) =>
      p(`2026-08-19T${String(i % 24).padStart(2, '0')}:00:00Z`, 'success'));
    const r = sur(beaucoup);
    assert.equal(r.total, 60);
    assert.match(r.texte, /non détaillée\(s\), mais COMPTÉE\(S\)/);
  });
});

/* ══ LE RÉSUMÉ ET LA DÉCLARATION ══════════════════════════════════════════════ */

describe('le résumé et le registre', () => {
  test('le résumé dit la période, jamais un total nu', () => {
    const r = sur([p('2026-08-18T10:00:00Z', 'success'), p('2026-08-20T10:00:00Z', 'failed')]);
    assert.match(resumeHistorique(r), /2 exécution\(s\) du 2026-08-18 au 2026-08-20/);
    assert.match(resumeHistorique(r), /50 % d'échec/);
  });

  test('un dépôt sans exécution le dit dans le résumé', () => {
    assert.match(resumeHistorique(sur([])), /aucune exécution lue/);
  });

  test('`historique_pipelines` est au registre, sa fenêtre est facultative', () => {
    assert.ok(sait('historique_pipelines'));
    const g = reglagesDe('historique_pipelines');
    assert.equal(g.length, 1);
    assert.equal(g[0].nom, 'fenetre');
    assert.equal(g[0].requis, false);
    assert.ok(SIGNAUX.historique_pipelines.source, 'un signal sans provenance ne se conteste pas');
  });
});
