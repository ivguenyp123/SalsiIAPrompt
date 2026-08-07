/*
 * Tests de l'aide aux cas d'or.
 *
 * La propriété qui compte : les cas produits sont COHÉRENTS avec l'artefact — pas
 * seulement bien formés. Un générateur qui produirait cinq cas valides mais contredisant
 * les critères déclarés ferait apparaître cinq avertissements `L022`, et l'auteur
 * conclurait que l'aide est cassée.
 *
 * C'est possible parce que Salsi ne devine rien : le contexte vient des variables
 * déclarées, l'attente des critères déclarés. Le seul apport de l'utilisateur est le
 * GENRE de situation, en français.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR, WARN } from '../lint/index.js';
import { SITUATIONS, PROPOSITIONS, composerCas } from '../studio/assistant-cas.js';
import { artifactToForm } from '../studio/artifact-to-form.js';
import { formToArtifact } from '../studio/form-to-artifact.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

/** Un artefact réel, dont on remplace les cas d'or par ceux que Salsi propose. */
const avecCasDe = (situations, fichier = 'prep-delivery.yaml', niveau) => {
  const form = artifactToForm(loadYaml(join(ROOT, 'artifacts', fichier)));
  const cas = composerCas({ situations, variables: form.variables,
                            criteria: form.criteria, targets: ctx.targets });
  return formToArtifact({ ...form, goldenCases: cas, targetLevel: niveau || form.targetLevel }, ctx);
};

const codes = (a, severity) =>
  lint(a, ctx).findings.filter((f) => f.severity === severity).map((f) => f.code);

/* ── LA propriété ─────────────────────────────────────────────────────────── */

describe('les cas proposés sont cohérents avec l\'artefact', () => {
  test('aucune combinaison ne produit d\'avertissement L022', () => {
    // Cinq cas qui contrediraient les critères déclarés feraient conclure que l'aide
    // est cassée. Salsi ne peut pas se contredire : il LIT ces critères.
    for (const s of SITUATIONS) {
      const a = avecCasDe([s.id, s.id, s.id, s.id, s.id]);
      assert.ok(!codes(a, WARN).includes('L022'), `${s.id} → L022`);
    }
  });

  test('aucune combinaison ne produit d\'erreur L017', () => {
    for (const s of SITUATIONS) {
      const a = avecCasDe([s.id, s.id, s.id]);
      assert.ok(!codes(a, ERROR).includes('L017'), `${s.id} → L017`);
    }
  });

  test('la proposition d\'un niveau suffit à franchir L010', () => {
    // C'est le vrai mur : pas la difficulté d'un cas, mais d'en écrire cinq.
    for (const [niveau, situations] of Object.entries(PROPOSITIONS)) {
      const a = avecCasDe(situations, 'prep-delivery.yaml', niveau);
      assert.equal(lint(a, ctx).blocked, false,
        `${niveau} refusé pour : ${codes(a, ERROR).join(', ')}`);
    }
  });

  test('ça tient aussi sur un artefact de lecture, aux critères de forme', () => {
    const a = avecCasDe(PROPOSITIONS.team, 'commit-message.yaml', 'team');
    assert.equal(lint(a, ctx).blocked, false, codes(a, ERROR).join(', '));
    assert.ok(!codes(a, WARN).includes('L022'));
  });
});

/* ── Pourquoi elle tient ──────────────────────────────────────────────────── */

describe('un cas de refus viole VRAIMENT le critère', () => {
  const casRefus = (critere) => composerCas({
    situations: ['refus'], variables: [{ name: 'repo', source: 'repo' }],
    criteria: [critere], targets: ctx.targets })[0];

  test('sur un booléen, la valeur est inversée', () => {
    const c = casRefus({ target: 'branch.mergeable', op: 'eq', value: 'true' });
    assert.equal(c.expect[0].value, 'false');
    assert.equal(c.expectsViolation, true);
  });

  test('sur un seuil, la valeur le dépasse', () => {
    const c = casRefus({ target: 'output.files_touched', op: 'lte', value: '20' });
    assert.ok(Number(c.expect[0].value) > 20, c.expect[0].value);
  });

  test('sur une chaîne, la valeur diffère', () => {
    const c = casRefus({ target: 'pipeline.status', op: 'eq', value: 'success' });
    assert.notEqual(c.expect[0].value, 'success');
  });

  test('le drapeau n\'est posé que s\'il y a vraiment une attente qui viole', () => {
    // Marquer `expects_violation` sur un cas qui ne viole rien serait un mensonge :
    // la règle se tairait sans raison.
    const c = composerCas({ situations: ['refus'], variables: [], criteria: [], targets: ctx.targets })[0];
    assert.equal(c.expectsViolation, false);
  });
});

describe('un cas qui doit passer satisfait le critère', () => {
  test('sous un seuil, la valeur reste dessous', () => {
    const [c] = composerCas({ situations: ['nominal'], variables: [],
      criteria: [{ target: 'output.length', op: 'lte', value: '2000' }], targets: ctx.targets });
    assert.ok(Number(c.expect[0].value) <= 2000, c.expect[0].value);
    assert.equal(c.expectsViolation, false);
  });

  test('sur une égalité, la valeur est celle attendue', () => {
    const [c] = composerCas({ situations: ['nominal'], variables: [],
      criteria: [{ target: 'vulnerabilities.critical', op: 'eq', value: '0' }], targets: ctx.targets });
    assert.equal(c.expect[0].value, '0');
  });
});

describe('le vocabulaire disparaît, les concepts restent', () => {
  test('le k/n vient du genre de situation, et il est expliqué', () => {
    const cas = composerCas({ situations: ['nominal', 'limite', 'refus'],
      variables: [{ name: 'repo' }], criteria: [{ target: 'output.length', op: 'lte', value: '500' }],
      targets: ctx.targets });

    assert.deepEqual(cas.map((c) => `${c.passAtLeast}/${c.runs}`), ['5/5', '4/5', '3/3']);
    for (const c of cas) assert.ok(c.pourquoi.length > 20, 'chaque cas dit pourquoi ce seuil');
  });

  test('les identifiants se lisent et ne se répètent pas', () => {
    const cas = composerCas({ situations: ['nominal', 'nominal', 'limite'],
      variables: [{ name: 'repo' }], criteria: [{ target: 'output.length', op: 'lte', value: '500' }],
      targets: ctx.targets });
    assert.deepEqual(cas.map((c) => c.id), ['gc-01-nominal', 'gc-02-nominal', 'gc-03-limite']);
    assert.equal(new Set(cas.map((c) => c.id)).size, 3);
  });

  test('le contexte reprend les variables, avec des valeurs qui se lisent', () => {
    // `repo: "valeur"` n'aiderait personne à comprendre ce que le cas décrit.
    const [c] = composerCas({ situations: ['nominal'],
      variables: [{ name: 'repo' }, { name: 'stack' }], criteria: [], targets: ctx.targets });
    assert.deepEqual(c.context.map((x) => x.key), ['repo', 'stack']);
    assert.ok(c.context.every((x) => x.value.includes(x.key)), JSON.stringify(c.context));
  });
});

describe('robustesse', () => {
  test('sans critère, les cas restent formés — L017 dira ce qui manque', () => {
    const cas = composerCas({ situations: ['nominal'], variables: [{ name: 'repo' }],
                              criteria: [], targets: ctx.targets });
    assert.equal(cas.length, 1);
    assert.deepEqual(cas[0].expect, []);
  });

  test('une situation inconnue retombe sur le cas courant', () => {
    const [c] = composerCas({ situations: ['n-importe-quoi'], variables: [], criteria: [], targets: [] });
    assert.match(c.id, /nominal/);
  });

  test('aucune situation ne produit aucun cas', () => {
    assert.deepEqual(composerCas({}), []);
  });
});

describe('ce que Salsi refuse de deviner', () => {
  test('un critère `matches` est écarté de l\'attente d\'un cas qui doit passer', () => {
    // Produire une chaîne satisfaisant une expression régulière quelconque ne se dérive
    // pas. Proposer le motif comme valeur serait faux — un motif ne se correspond pas à
    // lui-même — et L022 le signalerait aussitôt. Mieux vaut ne rien proposer.
    const [c] = composerCas({ situations: ['nominal'], variables: [],
      criteria: [{ target: 'kustomize.image_tag', op: 'matches', value: '^v[0-9]+$' },
                 { target: 'pipeline.status', op: 'eq', value: 'success' }],
      targets: ctx.targets });
    assert.deepEqual(c.expect.map((e) => e.target), ['pipeline.status']);
  });

  test('mais un cas de REFUS sait quoi opposer à un `matches`', () => {
    const [c] = composerCas({ situations: ['refus'], variables: [],
      criteria: [{ target: 'kustomize.image_tag', op: 'matches', value: '^v[0-9]+$' }],
      targets: ctx.targets });
    assert.equal(c.expect.length, 1);
    assert.ok(!/^v[0-9]+$/.test(c.expect[0].value), 'la valeur ne correspond vraiment pas');
  });
});
