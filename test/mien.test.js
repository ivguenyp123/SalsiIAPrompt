/*
 * « Le mien » — sauver, partager, forker.
 *
 * Ce qui se vérifie ici est une règle de GOUVERNANCE, pas une mécanique de fichiers :
 * sauver ne passe pas par la validation, partager si. Elle ne tient que si un fork
 * engage vraiment celui qui forke, et si rien de ce qui est sauvé ne peut atteindre le
 * catalogue sans être passé par la file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RACINE, proprietaire, chemin, dossier, depuisChemin, forker, estFork,
         etat, ETATS } from '../lib/mien.js';
import { entete, lire, ORIGINES } from '../lib/provenance.js';

const CHAINE = {
  id: 'expliquer-puis-resumer', kind: 'chain', title: 'Expliquer puis résumer',
  owner: { person: 'alice', scope: 'Plateforme' },
  intent: { purpose: 'p', not_for: 'n' },
  target_level: 'team',
  steps: [{ id: 'e1', artefact: 'expliquer-un-code', entrees: { code: '{{code}}' } }]
};

/* ── Où vit une chaîne personnelle ────────────────────────────────────────── */

describe('le chemin', () => {
  test('le dossier porte le propriétaire', () => {
    // Le dossier porte l'état, comme `artifacts/pending/` porte « en revue ».
    assert.equal(chemin('ivguenyp123', 'ma-chaine'), `${RACINE}/ivguenyp123/ma-chaine.yaml`);
    assert.equal(dossier('ivguenyp123'), `${RACINE}/ivguenyp123`);
  });

  test('un pseudo devient un nom de dossier sûr', () => {
    // Un identifiant vient d'une forge : il peut porter des accents, des points, pire.
    // Rien de tout ça ne doit atterrir tel quel dans un chemin.
    assert.equal(proprietaire('Élodie.Martin'), 'elodie-martin');
    assert.equal(proprietaire('../../etc/passwd'), 'etc-passwd');
    assert.equal(proprietaire(''), 'anonyme');
    assert.equal(proprietaire(null), 'anonyme');
  });

  test('le chemin se relit — une seule découpe, partout', () => {
    assert.deepEqual(depuisChemin(chemin('moi', 'x-y')), { qui: 'moi', id: 'x-y' });
    assert.equal(depuisChemin('artifacts/pending/x.yaml'), null);
    assert.equal(depuisChemin(''), null);
  });
});

/* ── Le fork ──────────────────────────────────────────────────────────────── */

describe('forker', () => {
  const f = forker(CHAINE, { qui: 'bob', suffixe: 'bob' });

  test('le fork ENGAGE celui qui forke', () => {
    /*
     * Garder l'auteur d'origine ferait porter à quelqu'un d'autre une chaîne qu'il n'a
     * pas écrite — et qu'il découvrirait le jour où elle casse.
     */
    assert.equal(f.owner.person, 'bob');
    assert.equal(CHAINE.owner.person, 'alice', 'l\'original n\'est pas touché');
  });

  test('l\'identifiant change, sinon la copie écrase l\'original', () => {
    assert.equal(f.id, 'expliquer-puis-resumer-de-bob');
    assert.notEqual(f.id, CHAINE.id);
  });

  test('forker un fork ne cumule pas les suffixes', () => {
    // Sinon `x-de-bob-de-carole-de-bob` au troisième tour, et l'identifiant déborde.
    const g = forker(f, { qui: 'carole', suffixe: 'carole' });
    assert.equal(g.id, 'expliquer-puis-resumer-de-carole');
  });

  test('le niveau retombe à `expérimental`', () => {
    // Un fork n'a jamais été mesuré, même si son original l'avait été : c'est un autre
    // fichier, il refait ses preuves.
    assert.equal(CHAINE.target_level, 'team');
    assert.equal(f.target_level, 'experimental');
  });

  test('les étapes et le câblage sont copiés tels quels', () => {
    // C'est précisément ce qu'on vient chercher.
    assert.deepEqual(f.steps, CHAINE.steps);
    f.steps[0].id = 'modifie';
    assert.equal(CHAINE.steps[0].id, 'e1', 'copie profonde : l\'original ne bouge pas');
  });

  test('on ne forke que des chaînes', () => {
    // Forker un agent recopierait son PROMPT sous un autre nom : deux textes à corriger
    // au lieu d'un. C'est exactement ce que la composition évite.
    assert.equal(forker({ ...CHAINE, kind: 'agent' }, { qui: 'bob' }), null);
    assert.equal(forker(null, { qui: 'bob' }), null);
  });
});

describe('la trace d\'un fork', () => {
  test('vit en provenance, pas dans le YAML', () => {
    /*
     * Deux chaînes identiques, l'une écrite et l'autre forkée, sont la même capacité.
     * L'origine décrit d'où le FICHIER vient — même règle que pour la dictée.
     */
    const p = lire(entete({ origine: 'fork', phrase: 'expliquer-puis-resumer',
                            auteur: 'alice', date: '2026-08-13' }));
    assert.deepEqual(estFork(CHAINE, p), { de: 'alice', quoi: 'expliquer-puis-resumer' });
    assert.equal(estFork(CHAINE, { origine: 'demande' }), null);
    assert.equal(estFork(CHAINE, null), null);
  });

  test('l\'écran d\'Admin sait la nommer', () => {
    assert.ok(ORIGINES.fork);
    assert.match(lire(entete({ origine: 'fork', phrase: 'x' })).libelle, /[Ff]ork/);
  });
});

/* ── Les trois états ──────────────────────────────────────────────────────── */

describe('l\'état d\'une chaîne', () => {
  test('à moi, et pas encore partagée', () => {
    assert.equal(etat({ proprietaire: 'moi', publiee: false }, 'moi'), 'privee');
  });

  test('à moi ET déjà partagée', () => {
    /*
     * L'état qui manquait. Confondre « la mienne » et « privée » ferait disparaître de mon
     * établi ce que je viens de faire valider — c'est-à-dire mon meilleur travail.
     */
    assert.equal(etat({ proprietaire: 'moi', publiee: true }, 'moi'), 'partagee');
  });

  test('celle d\'un autre, selon qu\'elle est validée ou non', () => {
    assert.equal(etat({ proprietaire: 'bob', publiee: true }, 'moi'), 'du-registre');
    assert.equal(etat({ proprietaire: 'bob', publiee: false }, 'moi'), 'a-quelquun-dautre');
  });

  test('chaque état porte un libellé et une explication', () => {
    for (const cle of ['privee', 'partagee', 'du-registre', 'a-quelquun-dautre']) {
      assert.ok(ETATS[cle]?.label && ETATS[cle]?.aide, cle);
    }
  });

  test('la casse du pseudo ne fait pas perdre ce qui est à soi', () => {
    assert.equal(etat({ proprietaire: 'Ivguenyp123', publiee: false }, 'ivguenyp123'), 'privee');
  });
});
