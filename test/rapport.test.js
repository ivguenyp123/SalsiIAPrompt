/*
 * Le rapport exporté — ce qu'il porte, et ce qu'il refuse de laisser croire.
 *
 * Un fichier téléchargé survit à l'onglet qui l'a produit. Il part en pièce jointe, il se
 * relit six mois plus tard, il sert d'argument en comité. Ce qui n'y figure pas est perdu
 * pour de bon — et ce qui y figure sans nuance sera lu sans nuance.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rapportHtml, nomFichier } from '../lib/rapport.js';

const BASE = {
  titre: 'bus factor', agent: 'bus-factor', version: '1.0.0', depot: 'moi/mon-depot',
  quand: '17 août 2026 à 14:32', modele: 'deepseek-chat', auteur: 'daniel',
  perimetre: 'Data',
  sortie: '## Ton bus factor\n\nUn score de **2 personnes**.\n\n- `lib` — facteur 1',
  matiere: 'BUS FACTOR — moi/mon-depot\nScore global : 2 personnes',
  jetons: { entree: 1062, sortie: 894 },
  postvol: { conforme: true, violes: [],
             constats: [{ cible: 'output.sections', op: 'contains',
                          attendu: ['Ton bus factor'], verdict: 'satisfait' }] }
};

describe('ce que le rapport porte', () => {
  const html = rapportHtml(BASE);

  test('c\'est un document complet, pas un fragment', () => {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>$/);
  });

  test('il dit SUR QUOI il porte et QUAND', () => {
    // Sans ça, une capture d'écran ferait la même chose — et personne ne saurait de quel
    // dépôt ni de quelle semaine on parle.
    assert.match(html, /moi\/mon-depot/);
    assert.match(html, /17 août 2026/);
  });

  test('il dit QUI l\'a produit — agent, version, modèle, responsable', () => {
    assert.match(html, /bus-factor/);
    assert.match(html, /v1\.0\.0/);
    assert.match(html, /deepseek-chat/);
    assert.match(html, /daniel/);
  });

  test('il rend le Markdown, il ne le recopie pas', () => {
    assert.match(html, /<h2[^>]*>Ton bus factor<\/h2>/);
    assert.match(html, /<b>2 personnes<\/b>/);
    assert.match(html, /<code>lib<\/code>/);
  });

  test('il porte les contrôles ET leur verdict', () => {
    assert.match(html, /Tous les contrôles automatiques passent/);
    assert.match(html, /output\.sections/);
  });

  test('un critère violé ne se cache pas', () => {
    // Un rapport qui masquerait un refus mentirait exactement là où il sert de preuve.
    const ko = rapportHtml({ ...BASE, postvol: { conforme: false,
      violes: [{ cible: 'output.sections' }],
      constats: [{ cible: 'output.sections', op: 'contains', attendu: ['x'], verdict: 'violé' }] } });
    assert.match(ko, /1 critère\(s\) violé\(s\)/);
    assert.match(ko, /verdict ko/);
  });
});

describe('ce que le rapport refuse de laisser croire', () => {
  const html = rapportHtml(BASE);

  test('les chiffres et le commentaire restent SÉPARÉS', () => {
    /*
     * Les chiffres sont calculés par du code, le commentaire est écrit par un modèle. Un
     * document qui les fondrait en une seule voix ferait passer une rédaction pour une
     * mesure — l'erreur exacte que tout ce produit cherche à empêcher.
     */
    assert.match(html, /Les chiffres fournis à l'agent/);
    assert.match(html, /n'ont pas été produits par le modèle/);
    assert.match(html, /le commentaire est rédigé par un modèle/);
  });

  test('la matière figure telle quelle, pour être confrontée', () => {
    assert.match(html, /Score global : 2 personnes/);
  });

  test('sans matière, la section disparaît au lieu de rester vide', () => {
    const nu = rapportHtml({ ...BASE, matiere: '' });
    assert.ok(!/Les chiffres fournis à l'agent/.test(nu));
  });

  test('sans réponse, il le dit plutôt que de rendre une page blanche', () => {
    assert.match(rapportHtml({ ...BASE, sortie: '' }), /Aucune réponse/);
  });
});

describe('un fichier qui vivra sans nous', () => {
  const html = rapportHtml(BASE);

  test('aucune ressource distante — il s\'ouvre hors ligne', () => {
    /*
     * L'export du hub appelle Google Fonts : hors ligne, sa mise en page tombe. Un rapport
     * qu'on garde doit rendre la même chose dans dix ans, sur un poste sans réseau.
     */
    assert.ok(!/<link[^>]+href=/i.test(html));
    assert.ok(!/https?:\/\/fonts\./i.test(html));
    assert.ok(!/<script/i.test(html));
  });

  test('il s\'imprime', () => {
    // Un comité, ça se prépare en PDF. Sans règle d'impression, le fond sombre sort noir.
    assert.match(html, /@media print/);
  });
});

describe('ce que le modèle écrit n\'a aucun pouvoir sur la page', () => {
  test('une balise reste du texte', () => {
    const html = rapportHtml({ ...BASE, sortie: '<script>alert(1)</script>' });
    assert.ok(!/<script>alert/.test(html));
    assert.match(html, /&lt;script&gt;/);
  });

  test('un lien `javascript:` devient inerte', () => {
    const html = rapportHtml({ ...BASE, sortie: '[clic](javascript:alert(1))' });
    assert.ok(!/href="javascript:/i.test(html));
    assert.match(html, /href="#"/);
  });

  test('la matière brute est échappée elle aussi', () => {
    const html = rapportHtml({ ...BASE, matiere: '<img onerror=x>' });
    assert.ok(!/<img onerror/.test(html));
  });
});

describe('le nom du fichier', () => {
  test('lisible, triable, sans caractère qui fâche', () => {
    assert.equal(nomFichier({ agent: 'bus-factor', depot: 'moi/mon-depot', date: '2026-08-17' }),
      'bus-factor_moi-mon-depot_2026-08-17.html');
  });

  test('ce qui manque ne laisse pas de trou', () => {
    assert.equal(nomFichier({ agent: 'x', date: '2026-08-17' }), 'x_2026-08-17.html');
  });
});
