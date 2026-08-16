/*
 * L026 — le contrat impossible.
 *
 * Cette règle vient d'un agent RÉEL : écrit par le modèle sur demande, validé par un
 * humain, et incapable de passer. Il exigeait `output.is_valid_json eq true` ET quatre
 * `output.sections contains …` — or `sections` extrait des titres Markdown, qui n'existent
 * pas dans du JSON.
 *
 * Chaque critère était valide isolément. C'est leur RENCONTRE qui était impossible, et
 * c'est pour ça que ni la porte ni la relecture ne pouvaient l'attraper.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { L026 } from '../lint/rules/criteria.js';

const jsonEt = (...criteres) => ({
  criteria: [{ target: 'output.is_valid_json', op: 'eq', value: true }, ...criteres]
});

describe('L026', () => {
  test('refuse « du JSON » ET « des titres Markdown »', () => {
    const c = L026(jsonEt({ target: 'output.sections', op: 'contains', value: ['a'] }));
    assert.equal(c.length, 1);
    assert.match(c[0].message, /output\.json_keys/, 'la manœuvre doit être nommée');
    assert.equal(c[0].path, 'criteria[1].target');
  });

  test('signale CHAQUE critère fautif, pas seulement le premier', () => {
    // L'agent réel en portait quatre : n'en nommer qu'un ferait corriger en quatre fois.
    const c = L026(jsonEt(
      { target: 'output.sections', op: 'contains', value: ['a'] },
      { target: 'output.sections', op: 'contains', value: ['b'] }));
    assert.equal(c.length, 2);
  });

  test('refuse « du JSON » ET « un message de commit conventionnel »', () => {
    assert.equal(L026(jsonEt({ target: 'output.matches_convention', op: 'eq', value: true })).length, 1);
  });

  test('laisse passer ce qui est compatible', () => {
    assert.deepEqual(L026(jsonEt({ target: 'output.json_keys', op: 'contains', value: ['a'] })), []);
    assert.deepEqual(L026(jsonEt({ target: 'output.length', op: 'lte', value: 2000 })), []);
  });

  test('sans exigence de JSON, `output.sections` est parfaitement légitime', () => {
    // La règle ne juge pas un contrat : elle refuse deux exigences qu'aucune sortie ne
    // peut satisfaire ENSEMBLE.
    assert.deepEqual(
      L026({ criteria: [{ target: 'output.sections', op: 'contains', value: ['Résumé'] }] }), []);
  });

  test('un artefact sans critère ne jette pas', () => {
    for (const a of [{}, { criteria: null }, { criteria: [] }, null]) {
      assert.deepEqual(L026(a), []);
    }
  });
});
