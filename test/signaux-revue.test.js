/*
 * La matière d'une revue de merge request.
 *
 * Ce qui se vérifie ici : que la matière porte le CONTEXTE et pas seulement le diff, et
 * qu'elle avoue tout ce qui n'a pas été lu. Un relecteur à qui on cache une troncature
 * conclut sur une moitié de changement en croyant l'avoir vu en entier — et il approuve.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { revueMr, resumeRevue, MAX_DIFF, TROP_DE_FICHIERS } from '../lib/signaux-revue.js';
import { sait, SIGNAUX, surUneMr, surPlusieursDepots } from '../lib/signaux-matiere.js';

const PR = { numero: 42, titre: 'fix(paiement): corriger un typo', branche: 'fix/typo',
             cible: 'main', auteur: 'marie', url: 'https://x/42' };

const DIFF = 'diff --git a/src/Calcul.java b/src/Calcul.java\n'
  + '--- a/src/Calcul.java\n+++ b/src/Calcul.java\n'
  + '@@ -12,3 +12,5 @@\n-  return montant;\n+  return montant * taux;';

describe('le signal de revue', () => {
  test('la plateforme sait le calculer, et il porte sur UNE merge request', () => {
    assert.equal(sait('revue_mr'), true);
    assert.equal(surUneMr('revue_mr'), true);
    // Ni le parc ni les autres : chaque signal dit lui-même quel sélecteur il lui faut,
    // sinon l'écran devine et les deux finissent par diverger.
    assert.equal(surPlusieursDepots('revue_mr'), false);
    assert.equal(surUneMr('parc_securite'), false);
    assert.ok(SIGNAUX.revue_mr.libelle);
  });
});

describe('ce que la matière porte, en plus du diff', () => {
  const r = revueMr({ depot: 'lcl/paiement', pr: PR, diff: DIFF, fichiers: 1 });

  /*
   * Le point de tout l'agent. L'écart entre ce qu'une MR ANNONCE et ce qu'elle fait est le
   * constat le plus utile d'une revue, et le seul qu'aucun outil ne voit. Sans le titre
   * dans la matière, le modèle ne peut pas le chercher.
   */
  test('le titre annoncé part avec le diff', () => {
    assert.match(r.texte, /Titre annoncé : fix\(paiement\): corriger un typo/);
  });

  test('les branches disent où ça part, l\'auteur à qui parler', () => {
    assert.match(r.texte, /fix\/typo → main/);
    assert.match(r.texte, /par marie/);
  });

  test('le diff est là, entier', () => {
    assert.ok(r.texte.includes(DIFF));
    assert.equal(r.coupe, false);
  });

  test('sans merge request, on ne fabrique rien', () => {
    const vide = revueMr({ depot: 'lcl/paiement' });
    assert.match(vide.texte, /Aucune merge request choisie/);
    assert.equal(vide.presentation.entete.ton, 'na');
    assert.match(resumeRevue(vide), /aucune merge request/);
  });
});

describe('ce que la matière AVOUE', () => {
  test('un diff trop gros est tronqué, et la troncature est criée', () => {
    /*
     * Le cas qui compte le plus. Un relecteur à qui on cache une coupure conclut sur une
     * moitié de changement en croyant l'avoir vu en entier — et il approuve.
     */
    const enorme = 'x'.repeat(MAX_DIFF + 5000);
    const r = revueMr({ depot: 'd', pr: PR, diff: enorme, fichiers: 3 });
    assert.equal(r.coupe, true);
    assert.equal(r.diff.length, MAX_DIFF);
    assert.match(r.texte, /DIFF TRONQUÉ/);
    assert.match(r.texte, /n'a PAS été lu/);
    assert.equal(r.presentation.tableaux[0].lignes[2].ton, 'ko');
  });

  test('une merge request trop grosse est un constat de revue, pas un détail', () => {
    // Au-delà d'une vingtaine de fichiers, personne ne relit vraiment — et la seule
    // remarque honnête est « découpe-la ».
    const r = revueMr({ depot: 'd', pr: PR, diff: DIFF, fichiers: TROP_DE_FICHIERS + 1 });
    assert.equal(r.grosse, true);
    assert.match(r.texte, /ne se relit plus vraiment/);
    assert.match(r.texte, /défaut de découpage/);
    assert.equal(r.presentation.entete.ton, 'moyen');
  });

  test('les binaires sont nommés plutôt que passés sous silence', () => {
    const r = revueMr({ depot: 'd', pr: PR, diff: DIFF, fichiers: 2,
                        binaires: ['logo.png'] });
    assert.match(r.texte, /binaire\(s\)/);
    assert.match(r.texte, /logo\.png/);
  });

  test('le résumé d\'écran dit la MR, sa taille, et si le diff est coupé', () => {
    const r = revueMr({ depot: 'd', pr: PR, diff: 'x'.repeat(MAX_DIFF + 1), fichiers: 4 });
    assert.match(resumeRevue(r), /#42/);
    assert.match(resumeRevue(r), /4 fichier/);
    assert.match(resumeRevue(r), /tronqué/);
  });
});
