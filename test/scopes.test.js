/*
 * Tests des périmètres.
 *
 * Le périmètre décide des outils autorisés (L006). Deux garanties à tenir :
 * la liste vient du registre et non d'une saisie, et la déduction depuis GitLab
 * ne devine jamais au hasard.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { knownScopes, guessScope } from '../app/scopes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = yaml.load(readFileSync(join(ROOT, 'registries/tools.yaml'), 'utf8')).tools;

describe('knownScopes', () => {
  test('dérive les périmètres du registre des outils', () => {
    assert.deepEqual(knownScopes(tools), ['Data', 'Livraison', 'Plateforme']);
  });

  test('n\'expose jamais le joker `*` comme un périmètre', () => {
    assert.ok(!knownScopes(tools).includes('*'));
  });

  test('supporte un registre vide sans casser', () => {
    assert.deepEqual(knownScopes([]), []);
    assert.deepEqual(knownScopes(undefined), []);
  });
});

describe('guessScope', () => {
  const scopes = knownScopes(tools);

  test('reconnaît le groupe GitLab, casse et accents mis à part', () => {
    assert.equal(guessScope('plateforme/demo-spring', scopes), 'Plateforme');
    assert.equal(guessScope('PLATEFORME/demo', scopes), 'Plateforme');
    assert.equal(guessScope('livraison/overlays', scopes), 'Livraison');
  });

  test('va du sous-groupe le plus précis au plus général', () => {
    // `data` est le groupe immédiat : il l'emporte sur `plateforme`, plus haut.
    assert.equal(guessScope('plateforme/data/etl', scopes), 'Data');
  });

  test('ignore le nom du projet lui-même', () => {
    // Sinon un dépôt nommé « plateforme » à la racine s'auto-attribuerait le périmètre.
    assert.equal(guessScope('data/plateforme', scopes), 'Data');
    assert.equal(guessScope('plateforme', scopes), '', 'un projet sans groupe ne donne aucun périmètre');
  });

  test('ne devine jamais au hasard', () => {
    assert.equal(guessScope('tribu-inconnue/projet', scopes), '');
    assert.equal(guessScope('', scopes), '');
    assert.equal(guessScope('plateforme/demo', []), '');
  });
});
