/*
 * Conformité croisée — `lib/yaml.js` et `lib/schema.js` face aux implémentations
 * de référence (js-yaml, ajv).
 *
 * Ces tests SE SAUTENT quand les devDependencies ne sont pas installées : le socle
 * doit rester utilisable hors réseau. Ils tournent en CI, où le réseau est disponible,
 * et c'est là qu'ils gardent le code maison honnête.
 *
 *   npm install && npm test     → conformité vérifiée
 *   npm test (sans install)     → sautée, le reste tourne
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import mine from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Charge une référence, ou null si elle n'est pas installée. */
async function optional(specifier) {
  try { return (await import(specifier)).default ?? (await import(specifier)); }
  catch { return null; }
}

const jsYaml = await optional('js-yaml');
const Ajv2020 = await optional('ajv/dist/2020.js');
const available = Boolean(jsYaml && Ajv2020);

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (/\.ya?ml$/.test(p) ? [p] : []);
});
const yamlFiles = ['artifacts', 'registries', 'fixtures'].flatMap((d) => walk(join(ROOT, d)));
const schemas = readdirSync(join(ROOT, 'schema')).map((f) => join(ROOT, 'schema', f));

describe('conformité croisée', { skip: available ? false : 'devDependencies absentes (hors réseau) — sautée' }, () => {

  test('lib/yaml.js lit comme js-yaml, sur tous les fichiers du registre', () => {
    for (const file of yamlFiles) {
      const src = readFileSync(file, 'utf8');
      const label = file.replace(`${ROOT}/`, '');
      assert.deepEqual(mine.parse(src), jsYaml.load(src), `divergence de lecture sur ${label}`);
    }
  });

  test('lib/yaml.js lit comme js-yaml, sur les cas limites', () => {
    const cases = [
      'a: |\n  x\n  y\n', 'a: |-\n  x\n  y\n', 'a: >\n  x\n  y\n', 'a: >-\n  x\n  y\n',
      'a: |\n  x\n\n  y\n', 'a: |\n  x\n    z\n  y\n',
      'a:\n  - k: 1\n    j: 2\n  - k: 3\n', 'a:\n  - k:\n      z: 1\n',
      'a: [[1,2],[3,4]]\n', 'a: { b: { c: 1 }, d: [1, 2] }\n', 'a: {}\nb: []\n',
      "a: 'c''est'\n", 'a: "x\\ny\\\\z\\"w"\n', 'a: "x # y"\nb: 3   # commentaire\n',
      'a: http://x/y\nb: "k: v"\n',
      'a: true\nb: false\nc: null\nd: ~\ne: 12\nf: -3.5\ng: 1e3\nh: 0012\n',
      'a:\nb: 1\n', '- a: 1\n- a: 2\n', '---\na: 1\n', 'a: ""\nb: \'\'\n',
      'a:\n  b:\n    c:\n      - d: 1\n        e: [1,2]\n'
    ];
    for (const src of cases) {
      assert.deepEqual(mine.parse(src), jsYaml.load(src), `divergence sur ${JSON.stringify(src)}`);
    }
  });

  test('lib/schema.js rend le même verdict qu\'ajv, sur tous les artefacts et fixtures', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const artifactSchema = JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8'));
    const byAjv = ajv.compile(artifactSchema);
    const byMine = makeValidator(artifactSchema);

    for (const file of yamlFiles.filter((f) => !f.includes('/registries/'))) {
      const doc = mine.parse(readFileSync(file, 'utf8'));
      assert.equal(
        byMine(doc).valid, Boolean(byAjv(doc)),
        `verdict divergent sur ${file.replace(`${ROOT}/`, '')} — ajv: ${byAjv(doc)}, maison: ${byMine(doc).valid}`
      );
    }
  });

  test('les registres eux-mêmes valident contre leur schéma, des deux côtés', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const pairs = [
      ['schema/tool-registry.schema.json', 'registries/tools.yaml'],
      ['schema/target-registry.schema.json', 'registries/targets.yaml']
    ];
    for (const [schemaPath, dataPath] of pairs) {
      const schema = JSON.parse(readFileSync(join(ROOT, schemaPath), 'utf8'));
      const doc = mine.parse(readFileSync(join(ROOT, dataPath), 'utf8'));
      const ajvVerdict = Boolean(ajv.compile(schema)(doc));
      assert.equal(makeValidator(schema)(doc).valid, ajvVerdict, `verdict divergent sur ${dataPath}`);
      assert.equal(ajvVerdict, true, `${dataPath} ne respecte pas ${schemaPath}`);
    }
  });

  test('tous nos schémas n\'emploient que des mots-clés gérés', () => {
    // makeValidator lève sur un mot-clé inconnu : on refuse d'évaluer plutôt que
    // d'ignorer silencieusement une contrainte.
    for (const path of schemas) {
      const schema = JSON.parse(readFileSync(path, 'utf8'));
      assert.doesNotThrow(() => makeValidator(schema)({}), `mot-clé non géré dans ${path.replace(`${ROOT}/`, '')}`);
    }
  });
});
