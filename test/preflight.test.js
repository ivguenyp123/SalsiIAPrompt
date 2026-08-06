/*
 * Tests du pré-vol (moment 4).
 *
 * Ce qui est vérifié n'est pas une liste de contrôles, c'est une PROPRIÉTÉ : le pré-vol
 * refuse ce que le lint ne PEUT PAS voir, parce que le lint ne connaît pas le dépôt cible.
 * Un contrôle qui passerait aussi bien au lint n'a rien à faire ici — il y coûterait moins
 * cher et préviendrait plus tôt.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR, WARN } from '../lint/index.js';
import { prevol, SENSIBILITES } from '../preflight/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const registres = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

/** `prep-delivery` : officiel, Plateforme, 2 variables requises, 2 outils d'écriture. */
const officiel = () => loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));

/** Un contexte d'exécution qui passe : c'est de lui qu'on fera varier une chose à la fois. */
const contexteOk = (extra = {}) => ({
  registres,
  depot: { path: 'plateforme/demo-spring', scope: 'Plateforme', sensibilite: 'interne' },
  valeurs: { repo: 'demo-spring', stack: 'java' },
  criticite: 'test',
  ...extra
});

const codes = (r, severity) => r.constats.filter((c) => c.severity === severity).map((c) => c.code);

describe('le contexte nominal passe', () => {
  test('un artefact officiel sur son dépôt, variables résolues', () => {
    const r = prevol(officiel(), contexteOk());
    assert.equal(r.bloque, false, `refusé pour : ${codes(r, ERROR).join(', ')}`);
  });

  test('mais il exige une confirmation humaine : il écrit', () => {
    // Ce n'est pas un refus. C'est « l'humain valide » rendu mécanique — l'appelant ne
    // peut pas lancer en autonomie, ça ne dépend plus de sa discipline.
    const r = prevol(officiel(), contexteOk());
    assert.equal(r.confirmationRequise, true);
    assert.ok(codes(r, WARN).includes('P007'));
  });

  test('un artefact de lecture seule ne demande pas de confirmation', () => {
    const lecture = loadYaml(join(ROOT, 'artifacts/commit-message.yaml'));
    const r = prevol(lecture, contexteOk({
      depot: { path: 'plateforme/demo', scope: 'Plateforme', sensibilite: 'interne' },
      valeurs: Object.fromEntries((lecture.variables || []).map((v) => [v.name, 'x']))
    }));
    assert.equal(r.confirmationRequise, false);
  });
});

describe('P002 — la sensibilité est le contrôle qui ne peut exister qu\'ici', () => {
  test('un dépôt plus sensible que le plafond est refusé', () => {
    // prep-delivery déclare `interne`. Le lint ne peut pas voir ça : il ne sait pas
    // sur quel dépôt on tourne.
    const r = prevol(officiel(), contexteOk({
      depot: { path: 'x/y', scope: 'Plateforme', sensibilite: 'confidentiel' }
    }));
    assert.ok(codes(r, ERROR).includes('P002'));
    assert.equal(r.bloque, true);

    // Et le même artefact franchit la porte du lint sans problème : la preuve que le
    // contrôle est à sa place.
    assert.equal(lint(officiel(), registres).blocked, false);
  });

  test('un dépôt moins sensible passe', () => {
    const r = prevol(officiel(), contexteOk({
      depot: { path: 'x/y', scope: 'Plateforme', sensibilite: 'public' }
    }));
    assert.ok(!codes(r, ERROR).includes('P002'));
  });

  test('sans plafond déclaré, `interne` est retenu — le silence n\'ouvre pas de droit', () => {
    const nu = officiel();
    delete nu.classification;

    const surInterne = prevol(nu, contexteOk());
    assert.ok(!codes(surInterne, ERROR).includes('P002'), 'interne reste permis');
    assert.ok(codes(surInterne, WARN).includes('P002'), 'mais le défaut est signalé');

    const surConfidentiel = prevol(nu, contexteOk({
      depot: { path: 'x/y', scope: 'Plateforme', sensibilite: 'confidentiel' }
    }));
    assert.ok(codes(surConfidentiel, ERROR).includes('P002'),
      'ne rien déclarer ne doit pas être le chemin le plus permissif');
  });

  test('un dépôt non classé est refusé, pas toléré', () => {
    const r = prevol(officiel(), contexteOk({ depot: { path: 'x/y', scope: 'Plateforme' } }));
    assert.ok(codes(r, ERROR).includes('P002'));
  });

  test('l\'échelle est ordonnée, pas alphabétique', () => {
    assert.deepEqual(SENSIBILITES, ['public', 'interne', 'confidentiel', 'secret']);
  });
});

describe('P003 — une variable manquante coûte moins cher avant qu\'après', () => {
  test('une variable requise non résolue refuse le départ', () => {
    const r = prevol(officiel(), contexteOk({ valeurs: { repo: 'demo-spring' } }));  // `stack` manque
    assert.ok(codes(r, ERROR).includes('P003'));
  });

  test('une chaîne vide ne compte pas comme une valeur', () => {
    const r = prevol(officiel(), contexteOk({ valeurs: { repo: 'demo-spring', stack: '   ' } }));
    assert.ok(codes(r, ERROR).includes('P003'));
  });

  test('une variable facultative absente ne bloque pas', () => {
    const a = officiel();
    a.variables = [{ name: 'optionnelle', source: 'user', required: false }];
    const r = prevol(a, contexteOk({ valeurs: {} }));
    assert.ok(!codes(r, ERROR).includes('P003'));
  });
});

describe('P004 — le droit suit la cible, pas le porteur', () => {
  test('un outil Plateforme est refusé sur un dépôt Data', () => {
    // prep-delivery appartient à Plateforme et utilise bump_image_tag, réservé à
    // Plateforme. Lancé sur un dépôt Data, il ne doit pas emporter cet outil avec lui.
    const r = prevol(officiel(), contexteOk({
      depot: { path: 'data/entrepot', scope: 'Data', sensibilite: 'interne' }
    }));
    assert.ok(codes(r, ERROR).includes('P004'));
  });

  test('L006 ne l\'aurait pas vu : il juge le périmètre de l\'owner, pas celui de la cible', () => {
    // L'artefact est parfaitement conforme au lint — son owner EST Plateforme.
    assert.equal(lint(officiel(), registres).blocked, false);
  });

  test('sans périmètre connu sur le dépôt, P004 s\'abstient', () => {
    // P002 a déjà refusé pour flou : inutile d'empiler un second constat sur la même cause.
    const r = prevol(officiel(), contexteOk({ depot: { path: 'x/y', sensibilite: 'interne' } }));
    assert.ok(!codes(r, ERROR).includes('P004'));
  });
});

describe('P005 — un agent se périme, le modèle bouge sous le prompt', () => {
  const avecDerive = (cert) => contexteOk({
    derive: { 'prep-delivery': { certification: cert } },
    now: new Date('2026-08-06T00:00:00Z')
  });

  test('sans état dérivé joignable, le contrôle s\'abstient au lieu de mentir', () => {
    assert.ok(!codes(prevol(officiel(), contexteOk()), ERROR).includes('P005'));
  });

  test('jamais certifié : refus', () => {
    const r = prevol(officiel(), contexteOk({ derive: { 'prep-delivery': {} } }));
    assert.ok(codes(r, ERROR).includes('P005'));
  });

  test('certification périmée : refus', () => {
    const r = prevol(officiel(), avecDerive({ expires_on: '2026-01-01', model_version: 'mid-2025-11' }));
    assert.ok(codes(r, ERROR).includes('P005'));
  });

  test('certifiée sur un autre modèle : avertissement, pas refus', () => {
    // Les cas d'or n'ont pas été rejoués sur ce modèle. C'est une information de
    // décision, pas une faute — refuser bloquerait toute montée de version.
    const r = prevol(officiel(), { ...avecDerive({ expires_on: '2027-01-01', model_version: 'mid-2025-11' }),
                                   modele: 'mid-2026-06' });
    assert.ok(codes(r, WARN).includes('P005'));
    assert.ok(!codes(r, ERROR).includes('P005'));
  });
});

describe('P006 — l\'expérimental n\'a pas sa place en production', () => {
  test('un artefact expérimental est refusé en production', () => {
    const a = officiel();
    a.target_level = 'experimental';
    a.golden_cases = [];
    const r = prevol(a, contexteOk({ criticite: 'production' }));
    assert.ok(codes(r, ERROR).includes('P006'));
  });

  test('hors production, le niveau ne bloque pas', () => {
    const a = officiel();
    a.target_level = 'experimental';
    assert.ok(!codes(prevol(a, contexteOk()), ERROR).includes('P006'));
  });

  test('faute d\'état dérivé, le niveau VISÉ est retenu — et c\'est dit', () => {
    // Sinon on prendrait une intention pour un acquis : le niveau atteint se mérite
    // sur preuve de banc d'essai, il ne se déclare pas.
    const r = prevol(officiel(), contexteOk({ criticite: 'production' }));
    assert.ok(codes(r, WARN).includes('P006'));
    assert.ok(!codes(r, ERROR).includes('P006'));
  });

  test('avec un niveau dérivé suffisant, plus d\'avertissement', () => {
    const r = prevol(officiel(), contexteOk({
      criticite: 'production',
      derive: { 'prep-delivery': { level: 'officiel' } }
    }));
    assert.ok(!codes(r, WARN).includes('P006'));
  });
});

describe('P001 — la conformité d\'hier ne vaut pas pour aujourd\'hui', () => {
  test('un artefact devenu non conforme ne part pas', () => {
    const casse = officiel();
    casse.criteria = [];                       // L008 le refuse désormais
    const r = prevol(casse, contexteOk());
    assert.ok(codes(r, ERROR).includes('P001'));
    assert.equal(r.bloque, true);
  });

  test('le message nomme les règles enfreintes, pas juste « non conforme »', () => {
    const casse = officiel();
    casse.criteria = [];
    const p = prevol(casse, contexteOk()).constats.find((c) => c.code === 'P001');
    assert.match(p.message, /L008/);
  });
});

describe('robustesse', () => {
  test('un contrôle qui casse bloque, il ne laisse pas passer', () => {
    // `registres` absent fait échouer le lint interne. Le doute doit bloquer.
    const r = prevol(officiel(), { depot: { scope: 'Plateforme', sensibilite: 'interne' }, valeurs: {} });
    assert.equal(r.bloque, true);
  });

  test('un artefact vide ne fait pas exploser le pré-vol', () => {
    const r = prevol({}, contexteOk());
    assert.equal(typeof r.bloque, 'boolean');
    assert.ok(r.constats.length > 0);
  });

  test('le rapport compte erreurs et avertissements séparément', () => {
    const r = prevol(officiel(), contexteOk());
    assert.equal(r.erreurs + r.avertissements, r.constats.length);
    assert.equal(r.bloque, r.erreurs > 0);
  });
});
