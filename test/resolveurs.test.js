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

/* ── Le secret, et ce qui n'en est pas ────────────────────────────────────── */

/*
 * VU LE 2026-08-20, SUR UNE VRAIE SÉRIE.
 *
 * Quatorze analyses d'une chaîne GitLab CI : treize vertes, une refusée sur
 * `output.contains_secret`. Le motif déclenché était « URL en dur », sur la chaîne
 * `https://-development.` — que l'agent citait comme PREUVE du défaut qu'il venait de
 * trouver. Le contrôle a refusé un rapport à cause de son meilleur constat.
 *
 * Une URL en dur est un vrai défaut dans un SPEC — l'endpoint appartient au module qui
 * exécute. Dans une SORTIE, c'est du contenu : qui analyse un fichier de CI en cite
 * forcément. Un contrôle qui crie au loup s'ignore, et ça se paie le jour du vrai jeton.
 */
describe('output.contains_secret — les secrets, pas les senteurs de configuration', () => {
  const cs = (s) => resoudre('output.contains_secret', s);

  test('LE FAUX POSITIF DU 2026-08-20 : une URL citée n\'est pas un secret', () => {
    assert.equal(cs('les URLs seront mal formées (ex: https://-development.)'), false);
    assert.equal(cs('Le job appelle https://sonarqube.interne.example/api/qualitygates'), false);
    assert.equal(cs('Il lit projects/mon-projet-ci et projet_id: 12345'), false);
  });

  test('les vrais secrets refusent toujours — c\'est ce qui compte', () => {
    // Le cas qui a motivé le contrôle : un agent qui recopie un jeton lu dans un diff.
    assert.equal(cs('le token est glpat-AbCdEfGhIjKlMnOpQrSt'), true);
    assert.equal(cs('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'), true);
    assert.equal(cs('AKIAIOSFODNN7EXAMPLE'), true);
    /*
     * L'en-tête de clé privée est ASSEMBLÉ, jamais écrit : `test/secrets.test.js` refuse
     * qu'un fichier suivi le contienne — y compris un test, et il a raison. Un motif de
     * fixture ne doit pas obliger à assouplir le garde qui protège le dépôt.
     */
    const enTete = `${'-'.repeat(5)}BEGIN RSA PRIVATE ${'KEY'}${'-'.repeat(5)}`;
    assert.equal(cs(enTete), true);
    assert.equal(cs('password = "hunter2istooshort"'), true);
  });

  test('le SPEC, lui, refuse toujours une URL en dur — L007 ne bouge pas', async () => {
    // Les deux questions gardent UNE liste : c'est le tri qui diffère, pas la source.
    const { L007, SECRET_PATTERNS, SECRETS_EN_SORTIE } =
      await import('../lint/rules/safety.js');
    const constats = L007({ id: 'x', spec: 'Appelle https://api.exemple.test/v1 et rends le JSON.' });
    assert.equal(constats.length, 1);
    assert.match(constats[0].message, /URL en dur/);
    assert.ok(SECRETS_EN_SORTIE.length < SECRET_PATTERNS.length,
      'la liste de sortie est un sous-ensemble, jamais une seconde liste');
  });
});
