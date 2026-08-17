/*
 * Une réponse coupée le dit — partout.
 *
 * ── LE DÉFAUT QUE CES TESTS FERMENT ──────────────────────────────────────────
 *
 * Le motif d'arrêt remontait du moteur jusqu'à l'écran, et personne ne le lisait. Une
 * réponse tronquée par le plafond de jetons a l'air FINIE : un début, des sections, un ton
 * assuré. On la lit, on agit dessus, et le plan d'action s'arrête là où le modèle a été
 * coupé sans que rien ne l'indique.
 *
 * C'est le même défaut que partout ailleurs ici — une mesure partielle qui se présente
 * comme complète — et il était sous nos yeux.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { coupee, MOTIFS_COUPURE } from '../lib/arret.js';
import { rapportHtml } from '../lib/rapport.js';
import yaml from '../lib/yaml.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = yaml.load(readFileSync(join(ROOT, 'registries/models.yaml'), 'utf8')).models;

describe('reconnaître une coupure, quel que soit le fournisseur', () => {
  test('les deux vocabulaires sont couverts', () => {
    // DeepSeek dit `length`, Vertex dit `MAX_TOKENS`. Un test écrit à un seul endroit ne
    // reconnaîtrait qu'un fournisseur, et la coupure passerait sur l'autre.
    assert.equal(coupee('length'), true, 'DeepSeek');
    assert.equal(coupee('MAX_TOKENS'), true, 'Vertex');
    assert.equal(coupee('max_tokens'), true, 'la casse ne doit pas décider');
    assert.equal(coupee(' Length '), true, 'les espaces non plus');
  });

  test('un arrêt normal n\'est pas une coupure', () => {
    for (const m of ['stop', 'STOP', 'end_turn', '', null, undefined]) {
      assert.equal(coupee(m), false, `« ${m} » ne devrait pas alerter`);
    }
  });

  test('un motif inconnu ne déclenche PAS l\'alerte', () => {
    /*
     * Le prix de l'erreur n'est pas le même dans les deux sens. Annoncer une coupure qui
     * n'a pas eu lieu fait douter d'une réponse entière — et on cesse de lire
     * l'avertissement le jour où il compte vraiment.
     */
    assert.equal(coupee('recitation'), false);
    assert.equal(coupee('safety'), false);
  });

  test('le vocabulaire est déclaré, pas dispersé dans des `if`', () => {
    assert.ok(MOTIFS_COUPURE.has('length'));
    assert.ok(MOTIFS_COUPURE.size >= 2);
  });
});

describe('le plafond de sortie appartient au palier', () => {
  test('chaque palier déclare le sien', () => {
    for (const m of MODELS) {
      assert.equal(typeof m.max_sortie, 'number', `${m.tier} n'a pas de plafond`);
      assert.ok(m.max_sortie >= 256, `${m.tier} : plafond trop bas`);
    }
  });

  test('un palier qui raisonne peut écrire plus long qu\'un palier qui classe', () => {
    /*
     * Les valeurs suivent l'USAGE du palier, pas la capacité du modèle. `nano` classe et
     * reformate ; `large` rend des plans en cinq sections. Un plafond unique à 4096 —
     * celui d'avant — coupait les seconds au milieu.
     */
    const plafond = Object.fromEntries(MODELS.map((m) => [m.tier, m.max_sortie]));
    assert.ok(plafond.large > plafond.mid);
    assert.ok(plafond.mid > plafond.small);
    assert.ok(plafond.small >= plafond.nano);
    assert.ok(plafond.large >= 16384, 'une revue en cinq sections ne tient pas en moins');
  });
});

describe('le rapport exporté', () => {
  const BASE = { titre: 'T', agent: 'a', depot: 'eq/dep', sortie: '## Une section\ndu texte' };

  test('une réponse coupée est signalée DANS le fichier', () => {
    // Le rapport part en pièce jointe et se relit six mois plus tard, par quelqu'un qui
    // n'était pas là au moment du lancement.
    const html = rapportHtml({ ...BASE, motifArret: 'length' });
    assert.match(html, /Réponse coupée/);
    assert.match(html, /Ne conclus rien de leur absence/);
    assert.match(html, /verdict ko/);
  });

  test('une réponse entière ne porte aucun avertissement', () => {
    const html = rapportHtml({ ...BASE, motifArret: 'stop' });
    assert.ok(!/Réponse coupée/.test(html));
  });

  test('sans motif d\'arrêt, on ne suppose pas la coupure', () => {
    assert.ok(!/Réponse coupée/.test(rapportHtml(BASE)));
  });
});
