/*
 * Tests du pont Studio → artefact.
 *
 * Deux garanties à tenir :
 *   1. le formulaire produit un artefact que le linter comprend
 *   2. le YAML affiché à l'auteur est exactement l'artefact évalué (aller-retour)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR, WARN } from '../lint/index.js';
import { formToArtifact, slugify } from '../studio/form-to-artifact.js';
import { toYaml } from '../studio/to-yaml.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

const codes = (r, sev) => r.findings.filter((f) => f.severity === sev).map((f) => f.code);

/** Une saisie complète et correcte, telle que la remplirait un ai-maintainer. */
const FORM_OK = {
  title: 'Vérifier les migrations Flyway',
  ownerPerson: 'm.dubois',
  ownerScope: 'Plateforme',
  purpose: 'Analyser les scripts de migration et signaler les ruptures de compatibilité.',
  notFor: 'Ne pas utiliser sur un dépôt sans migrations versionnées.',
  spec: 'Tu analyses les migrations du dépôt {{repo}}.\nTu signales toute rupture de compatibilité ascendante.',
  variables: [{ name: 'repo', source: 'repo' }],
  tools: [{ id: 'read_repo_metadata' }],
  criteria: [{ target: 'output.length', op: 'lte', value: '2000' }],
  targetLevel: 'experimental'
};

describe('formToArtifact', () => {
  test('une saisie correcte produit un artefact qui franchit la porte', () => {
    const report = lint(formToArtifact(FORM_OK, ctx), ctx);
    assert.equal(report.blocked, false, `refusé pour : ${codes(report, ERROR).join(', ')}`);
  });

  test('l\'identifiant est dérivé du titre, accents compris', () => {
    assert.equal(slugify('Vérifier les migrations Flyway — v2'), 'verifier-les-migrations-flyway-v2');
    assert.equal(formToArtifact(FORM_OK, ctx).id, 'verifier-les-migrations-flyway');
  });

  test('mode et executor viennent du REGISTRE, jamais de la saisie', () => {
    // Le point : même en tentant de déclarer une écriture confiée au LLM, la saisie
    // est écrasée par le registre. L005 devient une impossibilité, pas un reproche.
    const piege = { ...FORM_OK, tools: [{ id: 'bump_image_tag', mode: 'read', executor: 'llm' }] };
    const artifact = formToArtifact(piege, ctx);

    assert.deepEqual(artifact.tools[0], { id: 'bump_image_tag', mode: 'write', executor: 'module' });
    assert.ok(!codes(lint(artifact, ctx), ERROR).includes('L005'), 'l\'invariant ne peut plus être violé depuis le Studio');
  });

  test('un outil inconnu reste refusé, lui', () => {
    const artifact = formToArtifact({ ...FORM_OK, tools: [{ id: 'outil_fantome' }] }, ctx);
    assert.ok(codes(lint(artifact, ctx), ERROR).includes('L004'));
  });

  test('les valeurs de critère sont typées d\'après le registre des cibles', () => {
    const a = formToArtifact({ ...FORM_OK, criteria: [
      { target: 'output.length', op: 'lte', value: '2000' },        // number attendu
      { target: 'output.contains_secret', op: 'eq', value: 'false' } // boolean attendu
    ] }, ctx);
    assert.equal(a.criteria[0].value, 2000);
    assert.equal(a.criteria[1].value, false);
    assert.ok(!codes(lint(a, ctx), ERROR).includes('L009'));
  });

  test('les champs vides déclenchent les règles parlantes, pas « champ manquant »', () => {
    const vide = formToArtifact({ ...FORM_OK, criteria: [], spec: '' }, ctx);
    const errs = codes(lint(vide, ctx), ERROR);
    assert.ok(errs.includes('L008'), 'criteria vide → L008 et son explication sur les cibles form');
    assert.ok('spec' in vide && 'criteria' in vide, 'les deux clés restent présentes');
  });

  test('une variable non déclarée est signalée à la saisie', () => {
    const a = formToArtifact({ ...FORM_OK, spec: 'Analyse {{repo}} sur la branche {{branche}}.' }, ctx);
    assert.ok(codes(lint(a, ctx), ERROR).includes('L002'));
  });

  test('un reste de rédaction est signalé à la saisie', () => {
    const a = formToArtifact({ ...FORM_OK, spec: 'Analyse {{repo}}. TODO : gérer les conflits.' }, ctx);
    assert.ok(codes(lint(a, ctx), ERROR).includes('L018'));
  });

  test('de la logique dans le spec avertit sans bloquer', () => {
    const a = formToArtifact({ ...FORM_OK, spec: 'Analyse {{repo}}. Si le pipeline est rouge alors relance les tests.' }, ctx);
    const r = lint(a, ctx);
    assert.ok(codes(r, WARN).includes('L019'));
    assert.equal(r.blocked, false);
  });

  test('un formulaire vide ne plante pas et explique quoi remplir', () => {
    const r = lint(formToArtifact({}, ctx), ctx);
    assert.equal(r.blocked, true);
    assert.ok(r.findings.length > 0);
  });
});

describe('toYaml — aller-retour', () => {
  test('l\'artefact affiché est exactement l\'artefact évalué', () => {
    const artifact = formToArtifact(FORM_OK, ctx);
    assert.deepEqual(yaml.parse(toYaml(artifact)), artifact);
  });

  test('l\'aller-retour tient sur les artefacts réels du registre', () => {
    for (const f of ['artifacts/prep-delivery.yaml', 'artifacts/commit-message.yaml']) {
      const original = loadYaml(join(ROOT, f));
      assert.deepEqual(yaml.parse(toYaml(original)), original, `aller-retour cassé sur ${f}`);
    }
  });

  test('les prompts multilignes sortent en scalaire bloc, pas en chaîne échappée', () => {
    const out = toYaml(formToArtifact(FORM_OK, ctx));
    assert.match(out, /^spec: \|-?$/m);   // `|` ou `|-` selon le \n final
    assert.ok(!out.includes('\\n'), 'aucun retour à la ligne échappé');
  });
});
