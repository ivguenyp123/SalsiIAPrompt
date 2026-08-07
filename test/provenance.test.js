/*
 * La provenance — le contrat entre ce qui ÉCRIT le fichier et ce qui le RELIT.
 *
 * Trois endroits écrivent l'en-tête : l'écran « Demander », la dictée du Studio et la
 * ligne de commande. Un seul le lit : l'écran d'Admin. Ces tests tiennent le format à un
 * seul endroit — sans eux, une des trois écritures dériverait, et le bandeau de
 * provenance disparaîtrait en silence sur les fichiers concernés. Personne ne s'en
 * apercevrait : un bandeau absent ne ressemble pas à un bug, il ressemble à un artefact
 * écrit à la main.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { entete, lire, MARQUEUR, ORIGINES } from '../lib/provenance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PLEIN = {
  origine: 'demande',
  phrase: 'je voudrais un agent pour vérifier mes branches mortes',
  auteur: 'ivguenyp123', date: '2026-08-07',
  tours: 2, modele: 'deepseek-chat', fournisseur: 'deepseek'
};

describe('l\'aller-retour', () => {
  test('ce qui est écrit se relit', () => {
    const p = lire(entete(PLEIN));
    assert.equal(p.origine, 'demande');
    assert.equal(p.phrase, PLEIN.phrase);
    assert.equal(p.auteur, 'ivguenyp123');
    assert.equal(p.date, '2026-08-07');
    assert.equal(p.tours, 2);
    assert.equal(p.modele, 'deepseek-chat via deepseek');
    assert.equal(p.libelle, ORIGINES.demande);
  });

  test('l\'origine change le libellé affiché', () => {
    assert.equal(lire(entete({ ...PLEIN, origine: 'dictee' })).libelle, ORIGINES.dictee);
  });

  test('un en-tête minimal se relit aussi', () => {
    const p = lire(entete({ phrase: 'un agent' }));
    assert.equal(p.phrase, 'un agent');
    assert.equal(p.tours, 0);
    assert.equal(p.auteur, '');
  });
});

describe('ce qui n\'est PAS une provenance', () => {
  test('un fichier sans en-tête rend `null`', () => {
    assert.equal(lire('id: x\nkind: agent\n'), null);
  });

  test('un commentaire d\'auteur n\'en est pas une', () => {
    // Tous les artefacts du registre commencent par un commentaire explicatif. Les faire
    // passer pour des fichiers dictés mettrait un bandeau « rédigé par un modèle » sur du
    // travail humain — l'accusation exactement inverse de celle qu'on veut porter.
    assert.equal(lire('# Agent de LECTURE — la démonstration que la porte reste franchissable.\n'
                    + '# Cet artefact n\'a aucun état du monde à assertir.\n\nid: x\n'), null);
  });

  test('un marqueur enfoui au milieu du fichier ne compte pas', () => {
    // Sinon n'importe qui — ou n'importe quel modèle — pourrait faire passer un fichier
    // pour autre chose en glissant une ligne dans un spec.
    assert.equal(lire(`id: x\nspec: |\n  # ${MARQUEUR}: demande\n`), null);
  });

  test('rien du tout rend `null`, sans exploser', () => {
    for (const rien of [null, undefined, '', 0, {}]) assert.equal(lire(rien), null);
  });
});

describe('l\'en-tête est un commentaire, et rien d\'autre', () => {
  const artefact = readFileSync(join(ROOT, 'artifacts/commit-message.yaml'), 'utf8');

  test('le YAML lu est IDENTIQUE avec ou sans en-tête', () => {
    // La propriété qui rend tout ça acceptable : la provenance n'atteint ni le linter, ni
    // l'exécution, ni le catalogue. Elle ne décrit pas la capacité — elle décrit comment
    // le fichier est arrivé là.
    assert.deepEqual(yaml.parse(entete(PLEIN) + artefact), yaml.parse(artefact));
  });

  test('toutes ses lignes sont commentées', () => {
    for (const l of entete(PLEIN).split('\n')) {
      if (l.trim() === '') continue;
      assert.ok(l.startsWith('#'), `« ${l} » n'est pas un commentaire`);
    }
  });

  test('une phrase multiligne ne casse pas le bloc', () => {
    // Un champ de saisie rend des retours à la ligne. Non échappés, ils feraient sortir
    // la suite de la phrase du commentaire — et le YAML deviendrait illisible.
    const p = lire(entete({ ...PLEIN, phrase: 'je voudrais\nun agent\npour mes branches' }));
    assert.equal(p.phrase, 'je voudrais un agent pour mes branches');
    assert.deepEqual(yaml.parse(entete({ ...PLEIN, phrase: 'a\nb' }) + artefact), yaml.parse(artefact));
  });

  test('une phrase à deux-points se relit entière', () => {
    // « un agent pour ça : les branches mortes » — le séparateur est le PREMIER `:`,
    // le reste appartient à la valeur.
    assert.equal(lire(entete({ phrase: 'un agent pour ça : les branches mortes' })).phrase,
                 'un agent pour ça : les branches mortes');
  });
});

describe('les trois écritures utilisent le même générateur', () => {
  /*
   * Vérifié sur le TEXTE des trois fichiers plutôt que sur leur comportement : ils
   * touchent au DOM ou au disque et ne s'importent pas en test. Ce que ce test empêche,
   * c'est qu'on réécrive un en-tête à la main « juste pour ajouter un champ ».
   */
  const ecrivains = ['demande/demande.js', 'studio/studio.js', 'runtime/rediger-cli.js'];

  for (const f of ecrivains) {
    test(`${f} importe lib/provenance.js`, () => {
      const src = readFileSync(join(ROOT, f), 'utf8');
      assert.match(src, /from '(\.\.\/)+lib\/provenance\.js'/,
                   `${f} doit composer son en-tête avec entete(), pas à la main`);
      assert.ok(!/# Rédigé par la dictée/.test(src),
                `${f} écrit un en-tête en dur : l'Admin ne saura pas le relire`);
    });
  }

  test('l\'Admin, lui, le lit', () => {
    const src = readFileSync(join(ROOT, 'admin/admin.js'), 'utf8');
    assert.match(src, /from '\.\.\/lib\/provenance\.js'/);
  });
});
