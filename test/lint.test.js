/*
 * Tests du linter.
 *
 * Convention : le nom d'une fixture porte le code de la règle qu'elle doit déclencher
 * (L009-cible-non-assertable.yaml). Ajouter une fixture crée donc son test — il n'y a
 * pas de liste à tenir à jour à côté, donc rien à oublier de mettre à jour.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../lib/yaml.js';

import { lint, ERROR, WARN } from '../lint/index.js';
import { makeValidator } from '../lib/schema.js';
import { prevol } from '../preflight/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  entrees: loadYaml(join(ROOT, 'entrees/index.yaml')),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

const yamlIn = (dir) => readdirSync(join(ROOT, dir)).filter((f) => /\.ya?ml$/.test(f));
const codeOf = (filename) => filename.slice(0, 4);
const codes = (report, severity) =>
  report.findings.filter((f) => f.severity === severity).map((f) => f.code);

// ── Les artefacts réels franchissent la porte ────────────────────────────────
describe('artefacts du registre', () => {
  for (const file of yamlIn('artifacts')) {
    test(`${file} est conforme`, () => {
      const report = lint(loadYaml(join(ROOT, 'artifacts', file)), ctx);
      assert.equal(
        report.blocked, false,
        `attendu conforme, refusé pour : ${report.findings.filter((f) => f.severity === ERROR).map((f) => `${f.code} ${f.message}`).join(' | ')}`
      );
    });
  }

  test('un agent de LECTURE passe grâce aux cibles de classe form', () => {
    // Le point de conception : sans la classe `form`, L008+L009 étant bloquantes,
    // tout agent sans pipeline serait refusé — soit la majorité du catalogue.
    const artifact = loadYaml(join(ROOT, 'artifacts/commit-message.yaml'));
    const formTargets = new Set(ctx.targets.filter((t) => t.class === 'form').map((t) => t.target));

    assert.ok(artifact.criteria.every((c) => formTargets.has(c.target)), 'tous ses critères sont de classe form');
    assert.equal(lint(artifact, ctx).blocked, false);
  });
});

// ── Chaque fixture invalide déclenche sa règle, en bloquant ──────────────────
describe('fixtures invalides — refus', () => {
  for (const file of yamlIn('fixtures/invalid')) {
    test(`${file} déclenche ${codeOf(file)}`, () => {
      const report = lint(loadYaml(join(ROOT, 'fixtures/invalid', file)), ctx);
      assert.ok(codes(report, ERROR).includes(codeOf(file)), `attendu ${codeOf(file)} bloquant, obtenu : ${codes(report, ERROR).join(', ') || 'aucun'}`);
      assert.equal(report.blocked, true);
    });
  }
});

// ── Chaque fixture d'avertissement signale sans bloquer ──────────────────────
describe('fixtures d\'avertissement — signalées, jamais bloquantes', () => {
  for (const file of yamlIn('fixtures/warn')) {
    test(`${file} avertit ${codeOf(file)} sans bloquer`, () => {
      const report = lint(loadYaml(join(ROOT, 'fixtures/warn', file)), ctx);
      assert.ok(codes(report, WARN).includes(codeOf(file)), `attendu ${codeOf(file)} en avertissement, obtenu : ${codes(report, WARN).join(', ') || 'aucun'}`);
      assert.equal(report.blocked, false, 'un avertissement n\'empêche jamais la soumission');
    });
  }
});

// ── L005 : l'invariant ne se contourne pas par une fausse déclaration ────────
describe('L005 — invariant d\'écriture', () => {
  test('déclarer en lecture un outil que le registre sait en écriture ne contourne rien', () => {
    const report = lint(loadYaml(join(ROOT, 'fixtures/invalid/L004-contournement-invariant.yaml')), ctx);
    const errs = codes(report, ERROR);
    assert.ok(errs.includes('L004'), 'le registre fait autorité sur le mode');
    assert.ok(errs.includes('L005'), 'l\'invariant est évalué sur le mode EFFECTIF, pas sur le mode déclaré');
  });

  test('tout outil write du registre est en executor:module', () => {
    for (const t of ctx.tools.filter((t) => t.mode === 'write')) {
      assert.equal(t.executor, 'module', `${t.id} viole l'invariant dans le registre lui-même`);
    }
  });
});

// ── L015 : similarité, sur artefacts fournis par le contexte ─────────────────
describe('L015 — doublons', () => {
  const a = loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));

  test('signale un artefact quasi identique', () => {
    const jumeau = { ...a, id: 'prep-delivery-bis' };
    const report = lint(a, { ...ctx, artifacts: [jumeau] });
    assert.ok(codes(report, WARN).includes('L015'));
    assert.equal(report.blocked, false, 'un doublon se discute, il ne se refuse pas');
  });

  test('ne signale rien face à un artefact différent', () => {
    const autre = loadYaml(join(ROOT, 'artifacts/commit-message.yaml'));
    const report = lint(a, { ...ctx, artifacts: [autre] });
    assert.ok(!codes(report, WARN).includes('L015'));
  });
});

// ── L016 : certification dérivée, donc contextuelle ──────────────────────────
describe('L016 — certification', () => {
  const a = loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));

  test('s\'abstient quand l\'état dérivé n\'est pas joignable', () => {
    // La certification est OCTROYÉE par la plateforme, pas écrite par l'auteur :
    // au lint de fichier seul, la règle n'a rien à lire et ne doit pas inventer.
    const report = lint(a, ctx);
    assert.ok(!codes(report, ERROR).includes('L016'));
  });

  test('refuse une certification périmée', () => {
    const derive = { 'prep-delivery': { certification: { model_version: 'gemini-2.5-pro-2026-04', expires_on: '2026-11-20' } } };
    const report = lint(a, { ...ctx, derive, now: new Date('2027-01-15') });
    assert.ok(codes(report, ERROR).includes('L016'));
  });

  test('accepte une certification en cours de validité', () => {
    const derive = { 'prep-delivery': { certification: { model_version: 'gemini-2.5-pro-2026-04', expires_on: '2026-11-20' } } };
    const report = lint(a, { ...ctx, derive, now: new Date('2026-08-05') });
    assert.ok(!codes(report, ERROR).includes('L016'));
  });

  test('avertit — sans refuser — sur un artefact jamais certifié', () => {
    // Même raisonnement que P005 : « périmée » est un fait mesuré, « jamais certifié »
    // est une absence de mesure. Refuser sur l'absence mettrait au rouge tout artefact
    // qui n'est pas encore passé au banc — c'est-à-dire tous, le jour du premier passage.
    const report = lint(a, { ...ctx, derive: {}, now: new Date('2026-08-05') });
    assert.ok(!codes(report, ERROR).includes('L016'));
    assert.ok(codes(report, WARN).includes('L016'));
  });

  /*
   * La régression que ce test empêche a vraiment eu lieu : L016 lisait `ctx.derived` et
   * le pré-vol `ctx.derive`. Les deux couches se croyaient branchées sur le même état et
   * l'une des deux ne voyait jamais rien. Une seule clé, vérifiée par les deux.
   */
  test('le lint et le pré-vol lisent la MÊME clé d\'état dérivé', () => {
    const derive = { 'prep-delivery': { certification: { model_version: 'x', expires_on: '2026-11-20' } } };
    const vu = lint(a, { ...ctx, derive, now: new Date('2026-08-05') });
    assert.ok(!codes(vu, WARN).includes('L016'), 'le lint doit voir la certification');

    const av = prevol(a, { registres: { tools: ctx.tools, targets: ctx.targets },
                           depot: { path: 'demo/x', scope: a.owner.scope, sensibilite: 'interne' },
                           criticite: 'test', derive, now: new Date('2026-08-05') });
    assert.ok(!av.constats.some((c) => c.code === 'P005' && /jamais passé/.test(c.message)),
              'le pré-vol doit voir la même certification');
  });
});

// ── Robustesse : une règle qui casse ne laisse jamais passer ─────────────────
describe('robustesse', () => {
  test('un artefact null est refusé, pas planté', () => {
    const report = lint(null, ctx);
    assert.equal(report.blocked, true);
  });

  test('un registre vide refuse tout outil et toute cible', () => {
    const report = lint(loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml')), { ...ctx, tools: [], targets: [] });
    const errs = codes(report, ERROR);
    assert.ok(errs.includes('L004') && errs.includes('L009'));
  });
});
