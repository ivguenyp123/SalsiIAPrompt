/*
 * Tests des cas d'or saisis au Studio.
 *
 * Ce qui est vraiment vérifié ici n'est pas un champ de formulaire, c'est une propriété
 * du produit : l'ÉCHELLE DE MATURITÉ EST ATTEIGNABLE. Tant que le Studio ne savait pas
 * saisir de cas d'or, tout artefact écrit dans l'interface butait sur L010 — 3 requis
 * pour `équipe`, 5 pour `officiel` — et restait `expérimental` à vie. Le niveau
 * `officiel` n'existait que dans les fichiers écrits à la main.
 *
 * Et l'inverse compte tout autant : le seuil doit rester incontournable AUTREMENT qu'en
 * ajoutant des cas creux.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR, WARN } from '../lint/index.js';
import { formToArtifact } from '../studio/form-to-artifact.js';
import { artifactToForm, CARRIED } from '../studio/artifact-to-form.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

const codes = (artifact, severity) =>
  lint(artifact, ctx).findings.filter((f) => f.severity === severity).map((f) => f.code);

/** Un cas d'or de formulaire, tel que le Studio le produit. */
const cas = (n, extra = {}) => ({
  id: `gc-0${n}-nominal`,
  context: [{ key: 'repo', value: 'demo-spring' }, { key: 'stack', value: 'java' }],
  expect: [{ target: 'output.contains_secret', value: 'false' }],
  runs: '5',
  passAtLeast: '4',
  ...extra
});

/** Le formulaire d'un artefact conforme, dont on ne fera varier que les cas d'or. */
const formeDeBase = () => {
  const form = artifactToForm(loadYaml(join(ROOT, 'artifacts/commit-message.yaml')));
  return { ...form, goldenCases: [] };
};

/* ── Traduction ───────────────────────────────────────────────────────────── */

describe('les lignes de saisie deviennent un cas d\'or', () => {
  test('les attentes sont typées par le registre des cibles, pas par la saisie', () => {
    const artifact = formToArtifact({
      title: 'Test', spec: '{{repo}}', variables: [{ name: 'repo', source: 'repo' }],
      goldenCases: [{
        id: 'gc-01',
        context: [{ key: 'repo', value: 'demo' }],
        expect: [
          { target: 'branch.mergeable', value: 'true' },          // boolean au registre
          { target: 'output.files_touched', value: '20' },        // number
          { target: 'pipeline.status', value: 'success' }         // string
        ],
        runs: '5', passAtLeast: '4'
      }]
    }, ctx);

    // Une chaîne « true » comparée à un booléen `true` échouerait au banc d'essai sans
    // qu'on comprenne pourquoi : le type vient du registre, jamais du champ de saisie.
    assert.deepEqual(artifact.golden_cases[0].expect, {
      'branch.mergeable': true,
      'output.files_touched': 20,
      'pipeline.status': 'success'
    });
  });

  test('le contexte est deviné, faute de type déclaré sur les variables', () => {
    const artifact = formToArtifact({
      title: 'Test', spec: '{{repo}}', variables: [{ name: 'repo', source: 'repo' }],
      goldenCases: [{
        id: 'gc-01',
        context: [{ key: 'repo', value: 'demo-spring' }, { key: 'strict', value: 'true' },
                  { key: 'seuil', value: '12' }, { key: 'branche', value: 'feat/refunds' }],
        expect: [{ target: 'output.length', value: '400' }],
        runs: '3', passAtLeast: '3'
      }]
    }, ctx);

    assert.deepEqual(artifact.golden_cases[0].context,
      { repo: 'demo-spring', strict: true, seuil: 12, branche: 'feat/refunds' });
  });

  test('k et n laissés vides sont omis, pas mis à zéro', () => {
    const artifact = formToArtifact({
      title: 'Test', spec: '{{repo}}', variables: [{ name: 'repo', source: 'repo' }],
      goldenCases: [cas(1, { runs: '', passAtLeast: '' })]
    }, ctx);

    const g = artifact.golden_cases[0];
    assert.ok(!('runs' in g) && !('pass_at_least' in g), 'les champs vides ne créent pas de clé');
    // Le défaut de `runs` est 3, mais l'absence de seuil reste signalée : sans k/n
    // explicite, le banc d'essai rend un verdict différent à chaque passage.
    assert.ok(codes(artifact, WARN).includes('L017'));
  });

  test('un cas sans identifiant est ignoré, pas publié à moitié', () => {
    const artifact = formToArtifact({
      title: 'Test', spec: '{{repo}}', variables: [{ name: 'repo', source: 'repo' }],
      goldenCases: [cas(1), { id: '  ', context: [], expect: [] }]
    }, ctx);
    assert.equal(artifact.golden_cases.length, 1);
  });
});

/* ── La propriété qui compte ──────────────────────────────────────────────── */

describe('l\'échelle de maturité est atteignable depuis le formulaire', () => {
  for (const [niveau, requis] of [['team', 3], ['officiel', 5]]) {
    test(`« ${niveau} » : ${requis} cas d'or saisis suffisent`, () => {
      const assez = formToArtifact({
        ...formeDeBase(), targetLevel: niveau,
        goldenCases: Array.from({ length: requis }, (_, i) => cas(i + 1))
      }, ctx);
      assert.equal(lint(assez, ctx).blocked, false,
        `refusé pour : ${codes(assez, ERROR).join(', ')}`);
      assert.equal(assez.target_level, niveau);
    });

    test(`« ${niveau} » : ${requis - 1} ne suffisent pas`, () => {
      const trop_peu = formToArtifact({
        ...formeDeBase(), targetLevel: niveau,
        goldenCases: Array.from({ length: requis - 1 }, (_, i) => cas(i + 1))
      }, ctx);
      assert.ok(codes(trop_peu, ERROR).includes('L010'));
    });
  }
});

describe('le seuil ne se contourne pas par du remplissage', () => {
  test('cinq cas sans attente sont refusés, seuil de L010 atteint ou pas', () => {
    const creux = formToArtifact({
      ...formeDeBase(), targetLevel: 'officiel',
      goldenCases: Array.from({ length: 5 }, (_, i) => cas(i + 1, { expect: [] }))
    }, ctx);

    // L010 est satisfaite — il y a bien cinq cas. C'est L017 qui refuse, et c'est elle
    // qui empêche L010 de n'être qu'un compteur.
    assert.ok(!codes(creux, ERROR).includes('L010'), 'le compte est atteint');
    assert.ok(codes(creux, ERROR).includes('L017'), 'mais les cas ne vérifient rien');
    assert.equal(lint(creux, ctx).blocked, true);
  });

  test('une attente vide survit à la traduction — sinon rien ne pourrait la refuser', () => {
    const artifact = formToArtifact({
      title: 'Test', spec: '{{repo}}', variables: [{ name: 'repo', source: 'repo' }],
      goldenCases: [cas(1, { expect: [] })]
    }, ctx);
    // `compact` efface les objets vides partout ailleurs : ici l'effacer ferait
    // disparaître le cas fautif au lieu de le signaler.
    assert.deepEqual(artifact.golden_cases[0].expect, {});
  });

  test('un cas sans contexte alors que des variables sont déclarées avertit', () => {
    const artifact = formToArtifact({
      ...formeDeBase(), targetLevel: 'experimental',
      goldenCases: [cas(1, { context: [] })]
    }, ctx);
    assert.ok(codes(artifact, WARN).includes('L017'));
    assert.equal(lint(artifact, ctx).blocked, false, 'un avertissement, pas un refus');
  });
});

/* ── Reprise ──────────────────────────────────────────────────────────────── */

describe('les cas d\'or se modifient au lieu d\'être transportés', () => {
  test('ils ne figurent plus dans les champs transportés', () => {
    // Les laisser dans `carried` une fois les champs écrits produirait le pire des deux
    // mondes : visibles et éditables à l'écran, remplacés par la version transportée à
    // la republication.
    assert.ok(!CARRIED.includes('golden_cases'));
  });

  test('un cas d\'or repris remonte en lignes de saisie', () => {
    const doc = loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));
    const form = artifactToForm(doc);

    assert.equal(form.goldenCases.length, 5);
    assert.deepEqual(form.goldenCases[0], {
      id: 'gc-01-nominal',
      context: [{ key: 'repo', value: 'demo-spring' }, { key: 'branch', value: 'feat/refunds' }],
      expect: [{ target: 'branch.mergeable', value: 'true' },
               { target: 'pipeline.status', value: 'success' }],
      runs: '5', passAtLeast: '5',
      expectsViolation: false
    });
  });

  test('retirer un cas d\'or fait vraiment retomber le niveau', () => {
    const doc = loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));
    const form = artifactToForm(doc);
    const ampute = formToArtifact({ ...form, goldenCases: form.goldenCases.slice(0, 4) }, ctx);

    assert.equal(ampute.golden_cases.length, 4);
    assert.ok(codes(ampute, ERROR).includes('L010'),
      'le Studio ne peut plus dégrader un artefact officiel sans que la porte le dise');
  });
});

/* ── L022 : le cas d'or confronté aux critères ────────────────────────────── */

describe('L022 — un cas d\'or qui contredit les critères de l\'artefact', () => {
  /** Un artefact minimal, contrat et cas d'or maîtrisés. */
  const avec = (critere, attente, extra = {}) => formToArtifact({
    title: 'Test', spec: 'Analyse les migrations du dépôt {{repo}} et rends un résumé.',
    ownerPerson: 'm.dubois', ownerScope: 'Plateforme',
    purpose: 'Faire une chose utile et suffisamment décrite pour le schéma.',
    notFor: 'Ne pas utiliser hors du périmètre décrit ci-dessus.',
    variables: [{ name: 'repo', source: 'repo' }],
    tools: [{ id: 'read_repo_metadata' }],
    criteria: [critere],
    goldenCases: [{ id: 'gc-01', context: [{ key: 'repo', value: 'demo' }],
                    expect: [attente], runs: '3', passAtLeast: '3', ...extra }]
  }, ctx);

  test('la contradiction est signalée', () => {
    // C'est le cas trouvé à l'écran : le contrat plafonne à 20, le cas en attend 47.
    const a = avec({ target: 'output.files_touched', op: 'lte', value: '20' },
                   { target: 'output.files_touched', value: '47' });
    assert.ok(codes(a, WARN).includes('L022'));
  });

  test('mais jamais en refus — tester le chemin d\'échec est légitime', () => {
    const a = avec({ target: 'output.files_touched', op: 'lte', value: '20' },
                   { target: 'output.files_touched', value: '47' });
    assert.ok(!codes(a, ERROR).includes('L022'));
    assert.equal(lint(a, ctx).blocked, false);
  });

  test('une attente cohérente ne dit rien', () => {
    const a = avec({ target: 'output.files_touched', op: 'lte', value: '20' },
                   { target: 'output.files_touched', value: '12' });
    assert.ok(!codes(a, WARN).includes('L022'));
  });

  test('une cible sans critère correspondant ne dit rien', () => {
    // On ne compare que ce qui est comparable : un cas d'or peut assertir sur une cible
    // que le contrat de runtime ne surveille pas.
    const a = avec({ target: 'output.length', op: 'lte', value: '500' },
                   { target: 'output.files_touched', value: '47' });
    assert.ok(!codes(a, WARN).includes('L022'));
  });

  test('`expects_violation` fait taire la règle — c\'est la déclaration qui compte', () => {
    // La règle ne tranche pas à la place de l'auteur : elle l'oblige à dire s'il l'a
    // fait exprès. Une fois dit, il n'y a plus rien à signaler.
    const a = avec({ target: 'output.files_touched', op: 'lte', value: '20' },
                   { target: 'output.files_touched', value: '47' },
                   { expectsViolation: true });
    assert.equal(a.golden_cases[0].expects_violation, true);
    assert.ok(!codes(a, WARN).includes('L022'));
  });

  test('le drapeau survit à l\'aller-retour du formulaire', () => {
    // Sans ça, rouvrir un artefact au Studio ferait réapparaître l'avertissement à
    // chaque republication — et l'auteur redéclarerait indéfiniment la même intention.
    const doc = loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));
    const form = artifactToForm(doc);
    const gc05 = form.goldenCases.find((g) => g.id === 'gc-05-volume');
    assert.equal(gc05.expectsViolation, true);

    const apres = formToArtifact(form, ctx);
    assert.equal(apres.golden_cases.find((g) => g.id === 'gc-05-volume').expects_violation, true);
    assert.ok(!codes(apres, WARN).includes('L022'));
  });

  test('les opérateurs sont évalués, pas seulement l\'égalité', () => {
    const cas = [
      [{ target: 'vulnerabilities.critical', op: 'eq', value: '0' }, { target: 'vulnerabilities.critical', value: '3' }, true],
      [{ target: 'branch.mergeable', op: 'eq', value: 'true' }, { target: 'branch.mergeable', value: 'false' }, true],
      [{ target: 'pipeline.status', op: 'neq', value: 'failed' }, { target: 'pipeline.status', value: 'failed' }, true],
      [{ target: 'output.length', op: 'gte', value: '100' }, { target: 'output.length', value: '50' }, true],
      [{ target: 'output.length', op: 'gte', value: '100' }, { target: 'output.length', value: '150' }, false]
    ];
    for (const [critere, attente, attendu] of cas) {
      const a = avec(critere, attente);
      assert.equal(codes(a, WARN).includes('L022'), attendu,
        `${critere.target} ${critere.op} ${critere.value} contre ${attente.value}`);
    }
  });
});
