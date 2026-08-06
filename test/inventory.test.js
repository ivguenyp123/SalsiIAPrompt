/*
 * Tests de l'inventaire du Studio.
 *
 * Ce qui est vérifié : un artefact soumis reste RETROUVABLE. Avant, le Studio ouvrait sur
 * un formulaire vide et le Catalogue ne montrait que le validé — une soumission en attente
 * disparaissait de l'interface dès l'onglet fermé.
 *
 * Et surtout : publié et « correction en attente » ne se confondent pas. Les confondre
 * ferait croire à l'auteur que sa correction est en ligne alors que c'est l'ancienne
 * version qui sert encore.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { inventaire, aCorriger, ETATS } from '../studio/inventory.js';

const art = (id, extra = {}) => ({
  id, kind: 'agent', title: `Titre de ${id}`,
  owner: { person: 'm.dubois', scope: 'Plateforme' },
  intent: { purpose: 'Faire une chose utile.' },
  target_level: 'experimental',
  ...extra
});

const enAttente = (id, extra) => ({ path: `artifacts/pending/${id}.yaml`, artifact: art(id, extra) });
const publie = (id, extra) => ({ path: `artifacts/${id}.yaml`, artifact: art(id, extra) });

describe('le dossier porte l\'état', () => {
  test('un fichier dans pending est en revue', () => {
    const [e] = inventaire({ pending: [enAttente('a')] });
    assert.equal(e.etat, 'revue');
  });

  test('un fichier dans artifacts est publié', () => {
    const [e] = inventaire({ published: [publie('a')] });
    assert.equal(e.etat, 'publie');
  });

  test('aux deux endroits : une correction en attente sur une capacité publiée', () => {
    const liste = inventaire({ pending: [enAttente('a')], published: [publie('a')] });
    assert.equal(liste.length, 1, 'un seul identifiant, pas deux lignes');
    assert.equal(liste[0].etat, 'correction');
    assert.ok(liste[0].pending && liste[0].published, 'les deux fichiers restent joignables');
  });
});

describe('ce qui attend une décision passe devant', () => {
  test('revue, puis correction, puis publié', () => {
    const liste = inventaire({
      pending: [enAttente('zulu'), enAttente('bravo')],
      published: [publie('alpha'), publie('bravo')]
    });
    assert.deepEqual(liste.map((e) => [e.id, e.etat]), [
      ['zulu', 'revue'],         // rien de publié derrière : c'est ce qui bloque
      ['bravo', 'correction'],
      ['alpha', 'publie']
    ]);
  });

  test('à état égal, l\'ordre alphabétique — et il tient sur les accents', () => {
    const liste = inventaire({ published: [publie('z'), publie('e'), publie('a')].map((f, i) => ({
      ...f, artifact: { ...f.artifact, title: ['Zèbre', 'Élan', 'Abeille'][i] }
    })) });
    assert.deepEqual(liste.map((e) => e.titre), ['Abeille', 'Élan', 'Zèbre']);
  });
});

describe('ce qui est affiché vient de la dernière intention de l\'auteur', () => {
  test('la soumission en attente prime sur la version publiée', () => {
    const [e] = inventaire({
      pending: [enAttente('a', { title: 'Le nouveau titre' })],
      published: [publie('a', { title: 'L\'ancien titre' })]
    });
    assert.equal(e.titre, 'Le nouveau titre');
  });

  test('corriger rouvre la soumission en attente, pas le publié', () => {
    // Rouvrir le publié écraserait la correction en attente par une version antérieure,
    // sans que rien ne le signale.
    const [e] = inventaire({ pending: [enAttente('a')], published: [publie('a')] });
    assert.equal(aCorriger(e).path, 'artifacts/pending/a.yaml');
  });

  test('sans soumission en attente, on rouvre le publié', () => {
    const [e] = inventaire({ published: [publie('a')] });
    assert.equal(aCorriger(e).path, 'artifacts/a.yaml');
  });
});

describe('« à moi » se juge sur l\'owner déclaré', () => {
  test('l\'owner engage sa responsabilité, pas l\'auteur du commit', () => {
    const liste = inventaire({
      published: [publie('a'), publie('b', { owner: { person: 'j.martin', scope: 'Plateforme' } })],
      me: 'm.dubois'
    });
    assert.deepEqual(liste.map((e) => [e.id, e.mien]), [['a', true], ['b', false]]);
  });

  test('sans compte connu, rien n\'est marqué comme sien', () => {
    assert.equal(inventaire({ published: [publie('a')] })[0].mien, false);
  });
});

describe('robustesse de lecture', () => {
  test('un fichier illisible garde sa place, identifié par son nom', () => {
    // Sinon un artefact au YAML cassé devient invisible depuis le Studio : impossible
    // à retrouver, donc impossible à corriger.
    const [e] = inventaire({ pending: [{ path: 'artifacts/pending/casse.yaml', artifact: null }] });
    assert.equal(e.id, 'casse');
    assert.equal(e.titre, 'casse');
    assert.equal(e.etat, 'revue');
    assert.equal(e.lisible, false);
  });

  test('un illisible n\'appartient à personne — il ne doit donc pas être filtré comme tel', () => {
    // Le piège : « seulement les miens » se juge sur l'owner, qu'un fichier cassé n'a
    // pas. Sans le drapeau `lisible`, le filtre cacherait précisément le fichier qu'il
    // faut retrouver pour le réparer. L'interface s'en sert pour le laisser passer.
    const [e] = inventaire({ pending: [{ path: 'artifacts/pending/casse.yaml', artifact: null }], me: 'm.dubois' });
    assert.equal(e.mien, false);
    assert.equal(e.lisible, false, 'le drapeau qui permet à l\'interface de l\'exempter du filtre');
  });

  test('un artefact lisible est marqué comme tel', () => {
    assert.equal(inventaire({ published: [publie('a')] })[0].lisible, true);
  });

  test('chaque état a un libellé et une aide', () => {
    for (const [nom, def] of Object.entries(ETATS)) {
      assert.ok(def.label && def.aide, `${nom} est décrit`);
    }
  });

  test('une liste vide ne casse rien', () => {
    assert.deepEqual(inventaire(), []);
    assert.equal(aCorriger(undefined), null);
  });
});
