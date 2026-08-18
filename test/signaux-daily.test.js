/*
 * Le rapport quotidien, et sa fidélité au hub.
 *
 * ── CE QUE CES TESTS DÉFENDENT ───────────────────────────────────────────────
 *
 * Pas « le calcul est raisonnable » : « le calcul est CELUI DE LA PLATEFORME ». La
 * différence est tout le produit. Un Health Score plus juste que celui du hub serait un
 * défaut, parce que le rapport prétend refléter un écran que les équipes regardent tous
 * les jours — et deux chiffres différents pour la même semaine ne se départagent pas.
 *
 * Le test central compare donc mon calcul à la FORMULE DU HUB recopiée telle quelle
 * depuis `js/daily-report.js`. Tant qu'il est vert, la fidélité est vérifiée et non
 * affirmée.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chiffresDaily, resumeDaily, PENALITES, SEUIL_BRANCHE_MORTE_J,
         SEUIL_MR_AGEE_J } from '../lib/signaux-daily.js';

const MAINTENANT = '2026-08-17T18:00:00Z';
const ilYA = (j) => new Date(new Date(MAINTENANT).getTime() - j * 86400000).toISOString();

/** Le calcul du hub, recopié verbatim depuis `buildStandaloneHTML()`. */
function formuleDuHub({ pipelines, branches, mrsOpen }) {
  const total = pipelines.length;
  const success = pipelines.filter((p) => p.status === 'success').length;
  const rate = total > 0 ? Math.round((success / total) * 100) : 0;
  let health = 100;
  if (rate < 80) health -= 20;
  if (rate < 60) health -= 15;
  const stale = branches.filter((b) =>
    (new Date(MAINTENANT) - new Date(b.date)) / 86400000 > 90).length;
  if (stale > 20) health -= 15;
  const oldMrs = mrsOpen.filter((mr) =>
    (new Date(MAINTENANT) - new Date(mr.created_at)) / 86400000 > 7).length;
  if (oldMrs > 5) health -= 10;
  return { health: Math.max(0, Math.min(100, health)), rate };
}

/** Une matière d'essai, dans les deux vocabulaires à la fois. */
function matiere({ ok = 0, ko = 0, annules = 0, mortes = 0, vieilles = 0, vives = 5 } = {}) {
  const pipelines = [
    ...Array.from({ length: ok }, () => ({ statut: 'succes', status: 'success', branche: 'main', quand: ilYA(1) })),
    ...Array.from({ length: ko }, (_, i) => ({ statut: 'echec', status: 'failed', branche: i % 3 ? 'main' : 'feat/x', quand: ilYA(1) })),
    ...Array.from({ length: annules }, () => ({ statut: 'annule', status: 'canceled', branche: 'main', quand: ilYA(1) }))
  ];
  const branches = [
    ...Array.from({ length: mortes }, (_, i) => ({ name: `old-${i}`, quand: ilYA(120), date: ilYA(120) })),
    ...Array.from({ length: vives }, (_, i) => ({ name: `vif-${i}`, quand: ilYA(2), date: ilYA(2) }))
  ];
  const mrsOuvertes = [
    ...Array.from({ length: vieilles }, (_, i) => ({ numero: i, titre: `vieille ${i}`, auteur: 'a.b', ouvert: ilYA(20), created_at: ilYA(20) })),
    ...Array.from({ length: 3 }, (_, i) => ({ numero: 100 + i, titre: 'fraîche', auteur: 'c.d', ouvert: ilYA(1), created_at: ilYA(1) }))
  ];
  return { pipelines, branches, mrsOuvertes };
}

const calcule = (m, sur = {}) => chiffresDaily({
  depot: 'lcl/paiement', fenetreJours: 7,
  pipelines: m.pipelines, branches: m.branches, mrsOuvertes: m.mrsOuvertes,
  mrsFusionnees: [], commits: [], deploiements: [],
  maintenant: MAINTENANT, ...sur
});

/* ── La fidélité ──────────────────────────────────────────────────────────── */

describe('le Health Score est CELUI du hub', () => {
  const CAS = [
    ['aucun défaut',            { ok: 30 }],
    ['taux à 79 %',             { ok: 79, ko: 21 }],
    ['taux à 59 %',             { ok: 59, ko: 41 }],
    ['exactement 20 branches',  { ok: 30, mortes: 20 }],
    ['21 branches dormantes',   { ok: 30, mortes: 21 }],
    ['exactement 5 MR âgées',   { ok: 30, vieilles: 5 }],
    ['6 MR qui traînent',       { ok: 30, vieilles: 6 }],
    ['tout se cumule',          { ok: 30, ko: 70, mortes: 25, vieilles: 9 }],
    ['aucun pipeline',          {}]
  ];

  for (const [nom, forme] of CAS) {
    test(nom, () => {
      const m = matiere(forme);
      const attendu = formuleDuHub({ pipelines: m.pipelines, branches: m.branches,
                                     mrsOpen: m.mrsOuvertes });
      const r = calcule(m);
      assert.equal(r.sante.score, attendu.health, `score : ${nom}`);
      assert.equal(r.pipelines.taux, attendu.rate, `taux : ${nom}`);
    });
  }

  test('les seuils sont des SUPÉRIEURS STRICTS, pas des supérieurs ou égaux', () => {
    /*
     * `stale > 20`, `oldMrs > 5`. Écrire `>=` retirerait des points à un dépôt qui est
     * pile au seuil — et le rapport contredirait l'écran d'un point exactement, ce qui est
     * la divergence la plus difficile à voir et la plus longue à croire.
     */
    assert.equal(calcule(matiere({ ok: 30, mortes: 20 })).sante.score, 100);
    assert.equal(calcule(matiere({ ok: 30, mortes: 21 })).sante.score, 85);
    assert.equal(calcule(matiere({ ok: 30, vieilles: 5 })).sante.score, 100);
    assert.equal(calcule(matiere({ ok: 30, vieilles: 6 })).sante.score, 90);
  });

  test('une semaine SANS pipeline est notée 65, et c\'est reproduit exprès', () => {
    /*
     * Sans pipeline, la plateforme écrit un taux de 0 %. Ce 0 franchit les deux bornes et
     * coûte 35 points : une semaine sans aucun pipeline est notée comme une semaine où
     * tout a échoué.
     *
     * On aurait pu « corriger » en rendant `N/A`, comme on l'a fait pour DORA. On ne le
     * fait PAS ici : DORA est une mesure qu'on assume de calculer autrement, le rapport
     * quotidien est un document censé refléter un écran. Le corriger le rendrait faux par
     * rapport à ce que l'équipe voit.
     */
    const r = calcule(matiere({}));
    assert.equal(r.pipelines.taux, 0);
    assert.equal(r.sante.score, 65);
    assert.equal(r.sante.retraits.length, 2);
  });

  test('le score ne monte jamais au-dessus de 100', () => {
    // Il ne fait que retirer. Un dépôt parfait vaut exactement 100, pas davantage.
    const r = calcule(matiere({ ok: 100 }));
    assert.equal(r.sante.score, 100);
    assert.equal(r.sante.intacte, true);
    assert.deepEqual(r.sante.retraits, []);
  });
});

/* ── Les deux périmètres ──────────────────────────────────────────────────── */

describe('le mélange de périmètres est DIT, pas corrigé', () => {
  test('les points perdus hors fenêtre sont comptés à part', () => {
    /*
     * C'est l'information la plus utile du rapport. Une équipe qui perd 25 points pour des
     * branches mortes et des MR anciennes, sur un document intitulé « la semaine », passe
     * son lundi à chercher ce qu'elle a raté — et ne trouve rien, parce qu'il n'y a rien.
     */
    const r = calcule(matiere({ ok: 30, mortes: 25, vieilles: 9 }));
    assert.equal(r.sante.score, 75);
    assert.equal(r.sante.hors_fenetre, 25, '15 (branches) + 10 (MR), tous deux hors fenêtre');
  });

  test('un défaut de la fenêtre n\'y est PAS compté', () => {
    const r = calcule(matiere({ ok: 50, ko: 50 }));
    assert.equal(r.sante.hors_fenetre, 0, 'le taux de succès porte bien sur la semaine');
  });

  test('chaque retrait nomme son fait et ses points', () => {
    // Un score sans ses retraits est un jugement. Avec eux, c'est un constat qu'on peut
    // contester ligne à ligne.
    const r = calcule(matiere({ ok: 30, vieilles: 9 }));
    assert.equal(r.sante.retraits[0].points, PENALITES.mr_qui_trainent.points);
    assert.match(r.sante.retraits[0].quoi, /MR ouvertes/);
  });
});

/* ── Ce qu'on ne sait pas ─────────────────────────────────────────────────── */

describe('ce qui n\'a pas été mesuré ne devient pas zéro', () => {
  test('des déploiements illisibles rendent `N/A`, jamais 0', () => {
    /*
     * La permission `deployments` est rarement cochée sur un jeton. Un 403 rendu en
     * « 0 déploiement » est l'affirmation qu'on n'a rien mis en production — le genre de
     * phrase qui remonte en comité et qu'on ne rattrape pas.
     */
    const r = calcule(matiere({ ok: 30 }), { deploiements: null });
    const d = r.indicateurs.find((i) => i.cle === 'deploiements');
    assert.equal(d.valeur, 'N/A');
    assert.equal(d.par_jour, 'N/A');
    assert.notEqual(d.valeur, 0);
    assert.match(r.angles_morts.join(' '), /pas écrire zéro/);
  });

  test('des déploiements lus et vides rendent 0 — et c\'est différent', () => {
    const r = calcule(matiere({ ok: 30 }), { deploiements: [] });
    assert.equal(r.indicateurs.find((i) => i.cle === 'deploiements').valeur, 0);
    assert.ok(!r.angles_morts.join(' ').includes('pas écrire zéro'));
  });

  test('une branche SANS date n\'est présumée ni vivante ni morte', () => {
    // GitHub ne date pas ses branches ; le lot daté à la main est plafonné. Les compter
    // comme fraîches ferait disparaître une pénalité de 15 points — un score faux dans le
    // sens que personne ne conteste.
    const m = matiere({ ok: 30, mortes: 21 });
    m.branches.push({ name: 'sans-date', quand: '' }, { name: 'autre', quand: '' });
    const r = calcule(m);
    assert.equal(r.branches.sans_date, 2);
    assert.equal(r.branches.dormantes, 21, 'les non datées ne gonflent pas le compte');
    assert.match(r.angles_morts.join(' '), /sans date/);
  });

  test('un compte tronqué est signalé comme un MINIMUM', () => {
    const r = calcule(matiere({ ok: 30 }), { tronque: { pipelines: true } });
    assert.match(r.angles_morts.join(' '), /MINIMUM/);
  });

  test('sans troncature ni trou, aucun angle mort n\'est inventé', () => {
    assert.deepEqual(calcule(matiere({ ok: 30 })).angles_morts, []);
  });
});

/* ── Les indicateurs ──────────────────────────────────────────────────────── */

describe('la grille de KPI', () => {
  test('la moyenne divise par la FENÊTRE, pas par les jours actifs', () => {
    // Un dépôt actif deux jours sur sept affiche une moyenne basse, et c'est
    // l'information recherchée — pas un défaut à lisser.
    const r = calcule(matiere({ ok: 14 }));
    assert.equal(r.indicateurs.find((i) => i.cle === 'pipelines').par_jour, 2);
  });

  test('le taux de succès n\'a PAS de moyenne par jour', () => {
    // La plateforme n'en affiche pas sous ce chiffre. En inventer une donnerait un nombre
    // que personne ne peut retrouver à l'écran.
    assert.equal(calcule(matiere({ ok: 30 })).indicateurs
      .find((i) => i.cle === 'taux_succes').par_jour, null);
  });

  test('les annulés ne comptent NI en succès NI en échec, mais restent au total', () => {
    // C'est une soustraction dans le hub, pas un filtre : tout ce qui n'est ni l'un ni
    // l'autre atterrit là, y compris un pipeline encore en cours.
    const r = calcule(matiere({ ok: 8, ko: 2, annules: 10 }));
    assert.equal(r.pipelines.total, 20);
    assert.equal(r.pipelines.autres, 10);
    assert.equal(r.pipelines.taux, 40, '8/20 — les annulés sont au dénominateur');
  });

  test('les six indicateurs sont là, dans l\'ordre de l\'écran', () => {
    assert.deepEqual(calcule(matiere({ ok: 1 })).indicateurs.map((i) => i.cle),
      ['mrs_fusionnees', 'pipelines', 'echecs', 'deploiements', 'taux_succes', 'commits']);
  });
});

/* ── Ce qui mérite attention ──────────────────────────────────────────────── */

describe('ce que le rapport donne à regarder', () => {
  test('les échecs sont groupés par branche, les plus atteintes devant', () => {
    const r = calcule(matiere({ ok: 10, ko: 9 }));
    assert.ok(r.branches_en_echec.length > 0);
    for (let i = 1; i < r.branches_en_echec.length; i++) {
      assert.ok(r.branches_en_echec[i - 1].echecs >= r.branches_en_echec[i].echecs);
    }
  });

  test('la LISTE des MR part à 2 jours, la PÉNALITÉ à 7 — deux seuils', () => {
    /*
     * Le tableau du rapport et la pénalité du score ne regardent pas la même chose. Les
     * aligner « pour simplifier » ferait disparaître du tableau des MR de trois jours,
     * qui sont exactement celles qu'on peut encore rattraper.
     */
    const m = matiere({ ok: 30 });
    m.mrsOuvertes.push({ numero: 900, titre: 'de trois jours', auteur: 'e.f', ouvert: ilYA(3) });
    const r = calcule(m);
    assert.ok(r.mrs.qui_trainent.some((mr) => mr.numero === 900), 'listée à 3 jours');
    assert.equal(r.mrs.ouvertes_depuis_plus_de_7j, 0, 'mais pas pénalisée');
    assert.equal(SEUIL_MR_AGEE_J, 7);
    assert.equal(SEUIL_BRANCHE_MORTE_J, 90);
  });

  test('la liste porte de quoi agir : numéro, âge, auteur', () => {
    // « Une MR traîne » n'est pas actionnable ; « la #42, 20 jours, a.b » l'est.
    const mr = calcule(matiere({ ok: 30, vieilles: 3 })).mrs.qui_trainent[0];
    assert.equal(typeof mr.numero, 'number');
    assert.equal(typeof mr.jours, 'number');
    assert.ok(mr.auteur);
  });
});

/* ── Le résumé ────────────────────────────────────────────────────────────── */

describe('la ligne affichée sous le bouton', () => {
  test('dit qu\'il n\'y a rien à raconter, plutôt que de laisser partir un appel', () => {
    // Un dépôt sans activité n'a pas besoin d'un modèle pour qu'on le sache — et le
    // laisser partir donnerait un rapport qui commente le néant en cinq paragraphes.
    assert.match(resumeDaily(calcule(matiere({}))), /aucune activité sur 7 jours/);
  });

  test('porte le score et de quoi décider si ça vaut le coup', () => {
    const l = resumeDaily(calcule(matiere({ ok: 30 })));
    assert.match(l, /santé 100\/100/);
    assert.match(l, /30 pipeline/);
  });

  test('sans matière du tout, ne prétend pas mesurer', () => {
    assert.equal(resumeDaily(null), 'aucune mesure');
  });
});
