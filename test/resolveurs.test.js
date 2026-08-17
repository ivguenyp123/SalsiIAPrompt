/*
 * Les résolveurs — ce qui donne une valeur à une cible, à partir de la sortie du modèle.
 *
 * C'est le socle du post-vol : un critère ne vaut que ce que vaut son résolveur. Une
 * cible qui rend systématiquement la même chose produit un contrat décoratif, et rien à
 * l'écran ne peut le dire.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resoudre, satisfait } from '../runtime/resolveurs.js';


/* ── La cible qui manquait, trouvée à l'usage ─────────────────────────────── */

describe('output.json_keys', () => {
  test('rend les clés de premier niveau', () => {
    const s = JSON.stringify({ deployment_frequency: {}, lead_time: {} });
    assert.deepEqual(resoudre('output.json_keys', s), ['deployment_frequency', 'lead_time']);
  });

  test('survit aux ```json que les modèles ajoutent', () => {
    assert.deepEqual(resoudre('output.json_keys', '```json\n{"a":1}\n```'), ['a']);
  });

  test('ne descend PAS dans les objets imbriqués', () => {
    // Mêler `metriques` et `valeur` ferait un contrat qui ne sait plus de quoi il parle.
    const s = JSON.stringify({ metriques: { valeur: 1 } });
    assert.deepEqual(resoudre('output.json_keys', s), ['metriques']);
  });

  test('rend une liste vide sur ce qui n\'est pas un objet JSON', () => {
    for (const x of ['pas du json', '[1,2]', '"texte"', '42', '']) {
      assert.deepEqual(resoudre('output.json_keys', x), [], JSON.stringify(x));
    }
  });

  test('là où `output.sections` échouait', () => {
    /*
     * Le cas réel : un agent d'export DORA exigeait `is_valid_json` ET quatre `sections`.
     * `sections` cherche des titres Markdown — sur du JSON elle rend toujours [].
     */
    const s = JSON.stringify({ deployment_frequency: {}, lead_time: {},
                               change_failure_rate: {}, time_to_restore: {} });
    assert.deepEqual(resoudre('output.sections', s), []);
    assert.equal(resoudre('output.json_keys', s).length, 4);
  });
});

describe('`contains` avec une liste attendue', () => {
  test('exige TOUS les éléments, pas la chaîne « a,b,c »', () => {
    /*
     * Le défaut : `String(['df','lt'])` vaut « df,lt », et on cherchait cette chaîne dans
     * les clés. Un critère à un seul élément passait par accident, un critère à cinq
     * échouait toujours. Les contrats extraits en produisent cinq — leurs agents étaient
     * refusés en rendant exactement les bonnes clés.
     */
    const cles = ['score_global', 'df', 'lt', 'cfr', 'mttr'];
    assert.equal(satisfait(cles, 'contains', ['score_global', 'df', 'lt', 'cfr', 'mttr']), true);
    assert.equal(satisfait(cles, 'contains', ['df']), true);
  });

  test('une seule clé manquante suffit à refuser', () => {
    assert.equal(satisfait(['df', 'lt'], 'contains', ['df', 'lt', 'mttr']), false);
  });

  test('une chaîne attendue continue de se comporter comme avant', () => {
    assert.equal(satisfait(['alpha', 'beta'], 'contains', 'alph'), true);
    assert.equal(satisfait('un texte entier', 'contains', 'texte'), true);
    assert.equal(satisfait(['a'], 'contains', 'zz'), false);
  });

  test('une liste attendue vide ne prouve rien, donc ne refuse rien', () => {
    assert.equal(satisfait(['a'], 'contains', []), true);
  });
});
