/*
 * Les quatre métriques DORA — le chiffre au code, l'explication à l'agent.
 *
 * Ce qui se vérifie ici, c'est ce qu'un modèle sans données ne saurait jamais faire :
 * une MÉDIANE et non une moyenne, une série d'échecs qui compte pour UN incident, un
 * plafond qui interdit « Elite » sans temps de rétablissement, et surtout `N/A` là où on
 * n'a pas mesuré — jamais zéro.
 *
 * C'est cette dernière ligne qui vaut le plus. « Élevée » écrit par un modèle a franchi
 * la porte une fois ; un `0` écrit à la place d'une absence la franchirait aussi.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chiffresDora, niveauDe, mediane, branchesDeProduction, resumeDora,
         valeurLisible, SEUILS, POINTS, FENETRE_JOURS, CAP_MTTR_H,
         MINI_PIPELINES_PROD } from '../lib/signaux-dora.js';
import { sait, SIGNAUX } from '../lib/signaux-matiere.js';

const MAINTENANT = '2026-08-17T12:00:00Z';
/** Il y a `n` jours, à l'heure de référence. Les tests ne dépendent d'aucune horloge. */
const ilYA = (n) => new Date(Date.parse(MAINTENANT) - n * 86400000).toISOString();

const pipeline = (jours, statut, { branche = 'main', sha = '' } = {}) =>
  ({ statut, branche, sha, debut: ilYA(jours) });

/** Assez de pipelines de production pour que le hub accepte de calculer. */
const socle = (statut = 'succes') => Array.from({ length: MINI_PIPELINES_PROD },
  (_, i) => pipeline(20 + i, statut, { sha: `s${i}` }));

const dora = (o) => chiffresDora({ depot: 'eq/dep', maintenant: MAINTENANT, ...o });

describe('le signal est au registre', () => {
  test('la plateforme sait le calculer, donc l\'écran ne le demandera pas', () => {
    assert.equal(sait('chiffres_dora'), true);
    assert.ok(SIGNAUX.chiffres_dora.libelle);
  });
});

describe('les seuils, tels que la plateforme les décerne', () => {
  test('la fréquence se juge vers le haut, le reste vers le bas', () => {
    assert.equal(niveauDe('df', 7), 'Elite');
    assert.equal(niveauDe('df', 6.9), 'High');
    assert.equal(niveauDe('df', 0.2), 'Low');
    assert.equal(niveauDe('lt', 24), 'Elite');
    assert.equal(niveauDe('lt', 25), 'High');
    assert.equal(niveauDe('cfr', 5), 'Elite');
    assert.equal(niveauDe('mttr', 1), 'Elite');
    assert.equal(niveauDe('mttr', 169), 'Low');
  });

  test('une métrique absente vaut N/A, jamais Low', () => {
    // Le cœur du sujet. `Low` est un jugement, `N/A` est un aveu — et un modèle à qui on
    // donne `Low` écrira un plan d'action pour un problème qui n'a pas été mesuré.
    for (const m of Object.keys(SEUILS)) assert.equal(niveauDe(m, null), 'N/A');
  });
});

describe('la médiane, et pourquoi ce n\'est pas la moyenne', () => {
  test('une livraison qui traîne trois mois n\'écrase pas les autres', () => {
    // Moyenne : 552 h — « Medium ». Médiane : 3 h — « Elite ». Le même dépôt.
    const v = [2, 3, 4, 2200];
    assert.equal(mediane(v), 3.5);
    assert.notEqual(mediane(v), v.reduce((s, x) => s + x, 0) / v.length);
  });

  test('rien à médianer ne vaut pas zéro', () => {
    assert.equal(mediane([]), null);
  });
});

describe('le périmètre de production', () => {
  test('main et master toujours, plus la branche par défaut si elle diffère', () => {
    assert.deepEqual([...branchesDeProduction('release')].sort(), ['main', 'master', 'release']);
    assert.deepEqual([...branchesDeProduction('main')].sort(), ['main', 'master']);
  });

  test('le taux d\'échec ignore les branches de travail', () => {
    // Sinon une branche de feature qui casse vingt fois ferait chuter le taux de prod, et
    // l'équipe corrigerait au mauvais endroit.
    const r = dora({ pipelines: [...socle('succes'),
      ...Array.from({ length: 10 }, (_, i) => pipeline(3, 'echec', { branche: 'feat/x', sha: `f${i}` }))] });
    assert.equal(r.cfr, 0);
    assert.equal(r.comptes.pipelinesProd, MINI_PIPELINES_PROD);
  });
});

describe('la fréquence de déploiement', () => {
  test('un commit qui déclenche trois pipelines est UNE livraison', () => {
    const r = dora({ pipelines: [
      pipeline(1, 'succes', { sha: 'aaa' }), pipeline(1, 'succes', { sha: 'aaa' }),
      pipeline(1, 'succes', { sha: 'aaa' }), pipeline(2, 'succes', { sha: 'bbb' })] });
    assert.equal(r.comptes.livraisons, 2);
    assert.equal(r.df, Number(((2 / FENETRE_JOURS) * 7).toFixed(2)));
  });

  test('un pipeline sans commit est gardé plutôt que perdu', () => {
    const r = dora({ pipelines: [pipeline(1, 'succes', { sha: '' }),
                                 pipeline(1, 'succes', { sha: '' })] });
    assert.equal(r.comptes.livraisons, 2);
  });

  /*
   * La divergence assumée avec le hub, et celle qui compte le plus à l'usage.
   *
   * Le hub écrit `df = 0` quand il ne lit aucun pipeline : une équipe dont le jeton n'a
   * pas le droit de lire la CI est notée comme une équipe qui ne livre jamais.
   */
  test('aucun pipeline LU vaut N/A ; aucun SUCCÈS parmi des pipelines lus vaut 0', () => {
    const aveugle = dora({ pipelines: [], mrs: [{ ouvert: ilYA(3), fusionne: ilYA(1) }] });
    assert.equal(aveugle.df, null);
    assert.equal(aveugle.niveaux.df, 'N/A');

    const mesure = dora({ pipelines: socle('echec') });
    assert.equal(mesure.df, 0);
    assert.equal(mesure.niveaux.df, 'Low');
  });

  test('hors fenêtre, hors calcul', () => {
    const r = dora({ pipelines: [pipeline(FENETRE_JOURS + 1, 'succes', { sha: 'vieux' })] });
    assert.equal(r.comptes.pipelines, 0);
    assert.equal(r.df, null);
  });
});

describe('le lead time', () => {
  test('médiane des durées ouverture → fusion, en heures', () => {
    const r = dora({ mrs: [
      { ouvert: ilYA(3), fusionne: ilYA(2) },        // 24 h
      { ouvert: ilYA(6), fusionne: ilYA(3) },        // 72 h
      { ouvert: ilYA(2), fusionne: ilYA(1) }         // 24 h
    ] });
    assert.equal(r.lt, 24);
    assert.equal(r.niveaux.lt, 'Elite');
    assert.equal(r.comptes.dureesRetenues, 3);
  });

  test('une durée négative ou de plus d\'un an est une erreur de données, pas une lenteur', () => {
    const r = dora({ mrs: [
      { ouvert: ilYA(1), fusionne: ilYA(3) },        // négative
      { ouvert: '2000-01-01T00:00:00Z', fusionne: ilYA(1) },
      { ouvert: ilYA(4), fusionne: ilYA(2) }         // 48 h — la seule bonne
    ] });
    assert.equal(r.comptes.dureesRetenues, 1);
    assert.equal(r.lt, 48);
  });

  test('une MR fusionnée hors fenêtre ne compte pas', () => {
    const r = dora({ mrs: [{ ouvert: ilYA(40), fusionne: ilYA(35) }] });
    assert.equal(r.lt, null);
    assert.equal(r.niveaux.lt, 'N/A');
  });
});

describe('le taux d\'échec', () => {
  test('en dessous de cinq pipelines de production, on ne calcule pas', () => {
    // Une estimation sur trois pipelines se lirait comme une mesure. Le hub refuse, nous
    // aussi — et le texte dit pourquoi plutôt que d'afficher un tiret muet.
    const r = dora({ pipelines: [pipeline(1, 'echec', { sha: 'a' }),
                                 pipeline(2, 'succes', { sha: 'b' })] });
    assert.equal(r.cfr, null);
    assert.equal(r.niveaux.cfr, 'N/A');
  });

  test('les jours récents pèsent double : une correction se voit tout de suite', () => {
    /*
     * Vingt échecs il y a trois semaines, cinq succès hier. À plat le taux serait de 80 %.
     * Pondéré, il descend nettement — c'est le but : une équipe qui vient de corriger doit
     * le voir bouger, sinon elle cesse de regarder le chiffre.
     */
    const r = dora({ pipelines: [
      ...Array.from({ length: 20 }, (_, i) => pipeline(22, 'echec', { sha: `v${i}` })),
      ...Array.from({ length: 5 }, (_, i) => pipeline(1, 'succes', { sha: `n${i}` }))] });
    const aPlat = (20 / 25) * 100;
    assert.ok(r.cfr < aPlat, `${r.cfr} devrait être sous ${aPlat}`);
    assert.equal(r.tendance, 'en baisse');
  });

  test('une fenêtre trop maigre est omise, pas remplacée par zéro', () => {
    // Aucun pipeline sur les 10 derniers jours : les fenêtres 5 j et 10 j sont absentes.
    // Les compter à zéro ferait passer le silence pour une réussite.
    const r = dora({ pipelines: socle('echec') });   // tous entre 20 et 24 jours
    assert.equal(r.cfr5, null);
    assert.equal(r.cfr10, null);
    assert.equal(r.cfr30, 100);
    assert.equal(r.cfr, 100);
  });
});

describe('le temps de rétablissement', () => {
  test('une série d\'échecs est UN incident, pas trois', () => {
    /*
     * Sans cette règle, `F F F S` fournit trois échantillons dont deux très courts, et la
     * médiane tombe : un dépôt cassé trois jours se présenterait comme réactif.
     */
    const r = dora({ pipelines: [
      ...socle('succes').map((p, i) => ({ ...p, debut: ilYA(28 - i) })),
      pipeline(5, 'echec', { sha: 'f1' }), pipeline(4, 'echec', { sha: 'f2' }),
      pipeline(3, 'echec', { sha: 'f3' }), pipeline(2, 'succes', { sha: 'ok' })] });
    assert.equal(r.comptes.incidents, 1);
    assert.equal(r.mttr, 72);   // du PREMIER échec au succès : 3 jours
  });

  test('un incident non résolu au bout de sept jours sort du calcul', () => {
    const r = dora({ pipelines: [
      ...socle('succes').map((p, i) => ({ ...p, debut: ilYA(29 - i) })),
      pipeline(20, 'echec', { sha: 'vieux' }), pipeline(1, 'succes', { sha: 'enfin' })] });
    assert.ok(CAP_MTTR_H / 24 === 7);
    assert.equal(r.comptes.incidents, 0);
    assert.equal(r.mttr, null);
  });

  test('un échec jamais suivi d\'un succès ne compte pas comme résolu', () => {
    const r = dora({ pipelines: [...socle('succes'), pipeline(1, 'echec', { sha: 'casse' })] });
    assert.equal(r.mttr, null);
    assert.equal(r.niveaux.mttr, 'N/A');
  });
});

describe('le score global, et ses deux plafonds', () => {
  test('moyenne des seules métriques disponibles', () => {
    const r = dora({
      pipelines: Array.from({ length: 40 }, (_, i) => pipeline(i % 30, 'succes', { sha: `s${i}` })),
      mrs: [{ ouvert: ilYA(3), fusionne: ilYA(2) }]
    });
    // df Elite, lt Elite, cfr Elite (aucun échec), mttr N/A → plafond.
    assert.equal(r.niveaux.mttr, 'N/A');
    assert.ok(r.score <= 75, `${r.score} devrait être plafonné à 75`);
  });

  test('sans temps de rétablissement, « Elite » est refusé', () => {
    /*
     * La règle la plus intéressante du hub, et elle dit la même chose que tout le reste du
     * registre : on ne décerne pas l'excellence sur une résilience qu'on n'a pas mesurée.
     *
     * Trois métriques parfaites — 100 points de moyenne — et le verdict reste « High ».
     * C'est le plafond à 75 qui l'impose, et rien d'autre : il n'y a pas de seconde règle
     * qui rétrograderait un Elite, elle serait inatteignable.
     */
    const r = dora({
      pipelines: Array.from({ length: 40 }, (_, i) => pipeline(i % 30, 'succes', { sha: `s${i}` })),
      mrs: [{ ouvert: ilYA(3), fusionne: ilYA(2) }]
    });
    assert.deepEqual([r.niveaux.df, r.niveaux.lt, r.niveaux.cfr], ['Elite', 'Elite', 'Elite']);
    assert.equal(r.niveaux.mttr, 'N/A');
    assert.equal(r.score, 75);
    assert.equal(r.verdict, 'High');
    assert.ok(r.avertissements.some((a) => /Elite/.test(a)));
  });

  test('deux métriques manquantes ou plus : score plafonné à 50', () => {
    const r = dora({ mrs: [{ ouvert: ilYA(3), fusionne: ilYA(2) }] });
    assert.equal(r.comptes.manquantes, 3);
    assert.ok(r.score <= 50, `${r.score} devrait être plafonné à 50`);
    assert.ok(r.avertissements.some((a) => /métriques manquantes/.test(a)));
  });

  test('aucune métrique : le score est indisponible et NON zéro', () => {
    const r = dora({ pipelines: [], mrs: [] });
    assert.equal(r.score, null);
    assert.equal(r.verdict, 'N/A');
    assert.match(r.texte, /absence de mesure/);
    assert.equal(r.presentation.entete.ton, 'na');
    assert.equal(r.presentation.entete.valeur, '—');
  });

  test('les points par niveau sont ceux de la plateforme', () => {
    assert.deepEqual(POINTS, { Elite: 100, High: 70, Medium: 40, Low: 15 });
  });
});

describe('ce que le texte refuse de taire', () => {
  test('la période réellement couverte, pas celle qu\'on visait', () => {
    const r = dora({ pipelines: [pipeline(6, 'succes', { sha: 'a' })] });
    assert.equal(r.comptes.couverture, 6);
    assert.match(r.texte, /Période réellement couverte : 6 jour/);
  });

  test('une page pleine se dit, sinon un score partiel passe pour un score du mois', () => {
    const r = dora({ pipelines: socle(), tronque: true });
    assert.match(r.texte, /page pleine/);
    assert.ok(r.presentation.tableaux.some((t) => /assise/i.test(t.titre)));
  });

  test('les trois écarts avec la plateforme sont écrits, pas cachés', () => {
    const r = dora({ pipelines: socle() });
    assert.match(r.texte, /TROIS ÉCARTS/);
    assert.match(r.texte, /OUVERTURE de la merge request/);
    assert.match(r.texte, /ANNULÉE/);
  });

  test('une métrique N/A dit POURQUOI elle manque', () => {
    // « — » tout seul fait croire à un défaut du produit. La raison rend la mesure
    // réparable : configure la CI, protège main, ouvre des MR.
    const r = dora({ pipelines: socle() });      // des pipelines, aucune MR
    assert.equal(r.niveaux.lt, 'N/A');
    assert.match(r.texte, /aucune merge request fusionnée/);
    assert.match(r.texte, /aucune séquence échec → succès/);
  });

  test('le résumé d\'écran dit le score et sur quoi il porte', () => {
    const r = dora({ pipelines: socle(), mrs: [{ ouvert: ilYA(3), fusionne: ilYA(2) }] });
    assert.match(resumeDora(r), /DORA \d+\/100/);
    assert.match(resumeDora(r), /métriques/);
  });

  test('une valeur absente s\'écrit N/A, avec son unité sinon', () => {
    assert.equal(valeurLisible('lt', null), 'N/A');
    assert.equal(valeurLisible('lt', 24), '24 h');
    assert.equal(valeurLisible('df', 3.5), '3.5 /sem');
  });
});
