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

  test('la technique est DISPONIBLE mais repliée — on vient pour le plan', () => {
    /*
     * Agent, version, modèle, coût et critères occupaient le haut de page. Personne ne
     * vient chercher ça : on vient chercher quoi faire de son dépôt. Les supprimer serait
     * pire — le jour où quelqu'un conteste un chiffre, il doit pouvoir remonter à
     * l'agent qui l'a produit.
     */
    assert.match(html, /<details class="tech">/);
    assert.match(html, /Provenance et contrôles/);
    assert.ok(html.indexOf('Le diagnostic et le plan') < html.indexOf('class="tech"'));
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

describe('les chiffres mesurés, montrés comme des chiffres', () => {
  const m = { score: 2, niveau: 'RISQUE MOYEN',
    contributeurs: [{ nom: 'claude', commits: 51 }, { nom: 'daniel', commits: 49 }],
    zones: [{ chemin: 'lib', facteur: 1, commits: 40, parts: [{ nom: 'claude', part: 100 }] },
            { chemin: 'app', facteur: 2, commits: 20,
              parts: [{ nom: 'daniel', part: 64 }, { nom: 'claude', part: 36 }] }],
    comptes: { ignorees: 15 } };
  const html = rapportHtml({ ...BASE, mesures: m });

  test('le score s\'affiche en grand, depuis la MESURE et non depuis le texte', () => {
    /*
     * Si le modèle recopiait mal un chiffre, c'est celui-ci qui ferait foi. Le calculer à
     * part est ce qui permet de le dire.
     */
    assert.match(html, /<div class="score moyen">/);
    assert.match(html, /<b>2<\/b>/);
    assert.match(html, /RISQUE MOYEN/);
  });

  test('qui porte le code, en tableau', () => {
    assert.match(html, /Qui porte le code/);
    assert.match(html, /claude/);
    assert.match(html, /51/);
  });

  test('les zones, avec leur urgence lisible sans lire', () => {
    assert.match(html, /Les zones, de la plus fragile/);
    assert.match(html, /<tr class="ko">/);
    assert.match(html, /<code>lib<\/code>/);
  });

  test('ce qui n\'a pas été regardé est dit, pas tu', () => {
    assert.match(html, /15 répertoire\(s\) n'ont pas été interrogés/);
  });

  test('sans mesure, aucun tableau inventé', () => {
    const nu = rapportHtml({ ...BASE, mesures: null });
    assert.ok(!/class="score"/.test(nu));
    assert.ok(!/Qui porte le code/.test(nu));
  });

  test('un score non calculable ne devient pas zéro', () => {
    const na = rapportHtml({ ...BASE, mesures: { score: null, contributeurs: [], zones: [] } });
    assert.match(na, /score non calculable/);
    assert.ok(!/<b>0<\/b>/.test(na));
  });
});

/*
 * Un rapport qui ne parle pas de bus factor.
 *
 * Les tableaux du bus factor sont écrits en dur — score, contributeurs, zones. Un rapport
 * de secrets exposés n'a rien de tout ça, et il ne doit pas pour autant sortir nu. La
 * matière décrit alors elle-même sa mise en page, et le rapport n'a pas à connaître son
 * sujet.
 */
describe('une matière qui décrit sa propre mise en page', () => {
  const secrets = { presentation: {
    entete: { valeur: '3', libelle: 'secrets à révoquer', sous: '2 fichiers lus', ton: 'ko' },
    tableaux: [{
      titre: 'Où ils se trouvent',
      colonnes: [{ libelle: 'Fichier' }, { libelle: 'Ligne', align: 'n' }],
      lignes: [{ ton: 'ko', cellules: [{ texte: '.env', code: true }, { texte: '12' }] }],
      note: '8 fichier(s) non lus.'
    }]
  } };

  test('l\'en-tête et les tableaux viennent de la matière', () => {
    const html = rapportHtml({ ...BASE, mesures: secrets });
    assert.match(html, /<div class="score ko">/);
    assert.match(html, /secrets à révoquer/);
    assert.match(html, /Où ils se trouvent/);
    assert.match(html, /<code>\.env<\/code>/);
    assert.match(html, /8 fichier\(s\) non lus\./);
  });

  test('les tableaux du bus factor ne s\'invitent pas', () => {
    const html = rapportHtml({ ...BASE, mesures: secrets });
    assert.ok(!/Qui porte le code/.test(html));
    assert.ok(!/Les zones, de la plus fragile/.test(html));
  });

  test('plusieurs matières : autant de chiffres, côte à côte et sans moyenne', () => {
    /*
     * Une revue de sécurité lit trois signaux. N'en exporter qu'un donnait un rapport qui
     * paraissait complet — pire que de n'en montrer aucun. Et les agréger en une note
     * unique inventerait une pondération que personne n'a écrite.
     */
    const conformite = { presentation: {
      entete: { valeur: '67', libelle: 'non conforme', ton: 'ko' },
      tableaux: [{ titre: 'Les contrôles', colonnes: [{ libelle: 'CIS' }],
                   lignes: [{ cellules: [{ texte: '1.1.1' }] }] }]
    } };
    const html = rapportHtml({ ...BASE, mesures: [secrets, conformite] });
    assert.match(html, /<div class="scores">/);
    assert.match(html, /secrets à révoquer/);
    assert.match(html, /non conforme/);
    assert.match(html, /Où ils se trouvent/);
    assert.match(html, /Les contrôles/);
  });

  test('une liste vide ne fabrique ni chiffre ni tableau', () => {
    const html = rapportHtml({ ...BASE, mesures: [] });
    assert.ok(!/class="score/.test(html));
    assert.ok(!/Qui porte le code/.test(html));
  });

  test('un tableau large défile dans son cadre, pas la page entière', () => {
    // Sinon le texte part de travers sur téléphone, et le rapport devient illisible là
    // où il est le plus souvent ouvert.
    assert.match(rapportHtml({ ...BASE, mesures: secrets }), /<div class="scroll">/);
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
    assert.match(html, /le diagnostic est rédigé par un modèle/);
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
