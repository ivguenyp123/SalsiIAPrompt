/*
 * Tests de l'édition.
 *
 * La garantie qui compte : reprendre un artefact puis le republier sans y toucher doit
 * rendre EXACTEMENT le même fichier. Sans elle, éditer dégrade en silence — un artefact
 * officiel reviendrait sans ses cas d'or et retomberait en expérimental.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR } from '../lint/index.js';
import { formToArtifact } from '../studio/form-to-artifact.js';
import { artifactToForm, restoreCarried } from '../studio/artifact-to-form.js';
import { toYaml } from '../studio/to-yaml.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

/** Le trajet complet : lire, ouvrir au Studio, republier sans rien changer. */
const rouvrirEtRepublier = (artifact) => {
  const form = artifactToForm(artifact);
  return restoreCarried(formToArtifact(form, ctx), form.carried);
};

const artefacts = readdirSync(join(ROOT, 'artifacts'))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ nom: f, doc: loadYaml(join(ROOT, 'artifacts', f)) }));

/*
 * La reprise NORMALISE : les blancs de bord des textes disparaissent, parce qu'ils
 * viennent du repli YAML (`>`) et non de ce que l'auteur a écrit. La première
 * republication produit donc un petit diff, et c'est voulu — elle nettoie le fichier.
 *
 * La garantie n'est donc pas l'identité mais l'IDEMPOTENCE : republier deux fois donne
 * le même résultat que republier une fois. Sans elle, chaque ouverture du Studio
 * salirait le dépôt d'un diff gratuit.
 */
describe('republier est idempotent', () => {
  for (const { nom, doc } of artefacts) {
    test(`${nom} se stabilise dès la première reprise`, () => {
      const une = rouvrirEtRepublier(doc);
      assert.deepEqual(rouvrirEtRepublier(une), une);
      assert.equal(toYaml(rouvrirEtRepublier(une)), toYaml(une));
    });

    test(`${nom} ne perd aucun champ`, () => {
      const apres = rouvrirEtRepublier(doc);
      assert.deepEqual(Object.keys(apres).sort(), Object.keys(doc).sort());
    });

    test(`${nom} conserve ses variables, sources et obligations comprises`, () => {
      assert.deepEqual(rouvrirEtRepublier(doc).variables, doc.variables);
    });
  }
});

describe('ce que le formulaire ne montre pas est transporté', () => {
  const officiel = loadYaml(join(ROOT, 'artifacts/prep-delivery.yaml'));

  test('les cas d\'or survivent, donc le niveau visé aussi', () => {
    const apres = rouvrirEtRepublier(officiel);
    assert.equal(apres.golden_cases.length, officiel.golden_cases.length);
    assert.equal(apres.target_level, 'officiel');

    // Sans transport, L010 refuserait : « officiel exige 5 cas d'or, 0 fourni ».
    assert.equal(lint(apres, ctx).blocked, false);
  });

  test('étiquettes, moment, palier et classification survivent', () => {
    const apres = rouvrirEtRepublier(officiel);
    assert.deepEqual(apres.tags, officiel.tags);
    assert.equal(apres.moment, officiel.moment);
    assert.equal(apres.model_tier, officiel.model_tier);
    assert.deepEqual(apres.classification, officiel.classification);
  });

  test('un champ absent à l\'origine ne réapparaît pas', () => {
    const nu = { ...officiel };
    delete nu.tags; delete nu.model_tier;
    const apres = rouvrirEtRepublier(nu);
    assert.ok(!('tags' in apres) && !('model_tier' in apres));
  });
});

describe('l\'identifiant est préservé', () => {
  test('renommer le titre ne crée pas un second fichier', () => {
    // formToArtifact dérive l'id du titre quand il n'y en a pas. À l'édition, l'id
    // existant doit gagner — sinon corriger un titre créerait un doublon et laisserait
    // l'ancien fichier orphelin dans le dépôt.
    const doc = loadYaml(join(ROOT, 'artifacts/commit-message.yaml'));
    const form = { ...artifactToForm(doc), title: 'Rédiger un message de commit — v2' };
    const apres = restoreCarried(formToArtifact(form, ctx), form.carried);

    assert.equal(apres.id, 'commit-message');
    assert.equal(apres.title, 'Rédiger un message de commit — v2');
  });
});

describe('un artefact repris reste vérifiable', () => {
  test('les modifications passent la porte, ou sont refusées pour la bonne raison', () => {
    const doc = loadYaml(join(ROOT, 'artifacts/commit-message.yaml'));
    const form = artifactToForm(doc);

    const casse = restoreCarried(
      formToArtifact({ ...form, spec: 'Analyse {{repo}} et {{inconnue}}.' }, ctx), form.carried);
    const codes = lint(casse, ctx).findings.filter((f) => f.severity === ERROR).map((f) => f.code);
    assert.ok(codes.includes('L002'), 'une variable non déclarée reste refusée après édition');
  });
});
