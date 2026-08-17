/*
 * La matière calculée — le chiffre au code, l'explication à l'agent.
 *
 * Ce qui se vérifie ici : que le calcul suit le contrat extrait de `js/bus-factor.js`, et
 * qu'il refuse d'inventer là où il ne sait pas. C'est la moitié qui doit être
 * déterministe — un modèle sans données écrit « élevée » et la porte dit oui.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { facteurDeZone, medianePonderee, niveauDeRisque, repartitionContributions,
         resumeCourt, sait, zonesDepuisArbre, inventaireBranches, resumeBranches,
         MINI_COMMITS_ZONE } from '../lib/signaux-matiere.js';

const commits = (paires) => paires.flatMap(([qui, n]) =>
  Array.from({ length: n }, () => ({ author: qui })));

describe('le facteur d\'une zone', () => {
  test('compte les personnes qui couvrent 80 % des commits', () => {
    // 70 % + 20 % = 90 % ≥ 80 : deux personnes suffisent, la troisième ne compte pas.
    const { facteur } = facteurDeZone([{ nom: 'a', commits: 70 }, { nom: 'b', commits: 20 },
                                       { nom: 'c', commits: 10 }]);
    assert.equal(facteur, 2);
  });

  test('une seule personne sur tout : facteur 1', () => {
    assert.equal(facteurDeZone([{ nom: 'a', commits: 40 }]).facteur, 1);
  });

  test('une zone sans commit ne vaut pas 1, elle ne vaut rien', () => {
    // Zéro personne pour zéro commit. Écrire 1 inventerait un porteur.
    assert.equal(facteurDeZone([]).facteur, 0);
  });

  test('les parts sortent triées, de la plus grosse à la plus petite', () => {
    const { parts } = facteurDeZone([{ nom: 'a', commits: 10 }, { nom: 'b', commits: 90 }]);
    assert.deepEqual(parts.map((p) => p.nom), ['b', 'a']);
    assert.deepEqual(parts.map((p) => p.part), [90, 10]);
  });
});

describe('la médiane pondérée', () => {
  test('le contre-exemple du hub : la moyenne rassure, la médiane alerte', () => {
    /*
     * Une zone critique qui porte la moitié de l'activité, neuf zones saines qui se
     * partagent l'autre. La moyenne arithmétique dirait 4,6 — « RISQUE FAIBLE ». C'est
     * exactement le chiffre que la plateforme a cessé de rendre.
     */
    const zones = [{ valeur: 1, poids: 500 },
      ...Array.from({ length: 9 }, () => ({ valeur: 5, poids: 55 }))];
    assert.equal(medianePonderee(zones), 1);
  });

  test('quand les zones fragiles sont minoritaires en activité, le score reste haut', () => {
    const zones = [{ valeur: 1, poids: 10 }, { valeur: 5, poids: 400 }];
    assert.equal(medianePonderee(zones), 5);
  });

  test('sans zone, zéro — et l\'appelant en fait « non calculable »', () => {
    assert.equal(medianePonderee([]), 0);
  });
});

describe('les paliers de risque', () => {
  test('ceux de la plateforme, aux bornes exactes', () => {
    assert.equal(niveauDeRisque(1.9), 'RISQUE CRITIQUE');
    assert.equal(niveauDeRisque(2), 'RISQUE MOYEN');
    assert.equal(niveauDeRisque(2.9), 'RISQUE MOYEN');
    assert.equal(niveauDeRisque(3), 'RISQUE FAIBLE');
  });
});

describe('la matière de « répartition des contributions »', () => {
  const donnees = {
    depot: 'moi/mon-depot',
    commits: commits([['daniel', 170], ['marie', 30]]),
    zones: [
      { chemin: 'lib', commits: commits([['daniel', 88]]) },
      { chemin: 'app', commits: commits([['daniel', 28], ['marie', 12]]) },
      { chemin: 'docs', commits: commits([['marie', 3]]) }
    ]
  };
  const r = repartitionContributions(donnees);

  test('rend un score CALCULÉ, pas un score à deviner', () => {
    // `lib` est tenue par une seule personne (facteur 1) et pèse le plus : la médiane
    // pondérée la suit.
    assert.equal(r.score, 1);
    assert.equal(r.niveau, 'RISQUE CRITIQUE');
  });

  test('écarte les zones trop maigres du SCORE, mais les compte', () => {
    // `docs` a 3 commits : sous le seuil, elle ne pèse pas dans la médiane. Elle reste
    // comptée parmi les zones examinées — les compteurs et la liste ne portent pas sur
    // le même ensemble, et c'est voulu.
    assert.ok(!r.zones.some((z) => z.chemin === 'docs'));
    assert.equal(r.comptes.examinees, 3);
    assert.ok(MINI_COMMITS_ZONE > 3);
  });

  test('les zones sortent de la plus fragile à la plus solide', () => {
    assert.deepEqual(r.zones.map((z) => z.chemin), ['lib', 'app']);
  });

  test('le texte porte le chiffre, sa méthode, et de quel dépôt il parle', () => {
    assert.match(r.texte, /moi\/mon-depot/);
    assert.match(r.texte, /Score global : 1 personne —/);
    assert.match(r.texte, /RISQUE CRITIQUE/);
    assert.match(r.texte, /Médiane pondérée/);
    assert.match(r.texte, /80 % de ses commits/);
  });

  test('le texte DIT sa divergence avec le hub au lieu de la taire', () => {
    /*
     * Le hub déduit ses zones du diff de chacun des 200 derniers commits ; ici on liste
     * les commits par chemin. La définition est la même, l'échantillon peut différer —
     * le cacher ferait passer une approximation pour une reproduction au commit près.
     */
    assert.match(r.texte, /l'échantillon peut différer/);
  });

  test('nomme les contributeurs et leur part', () => {
    assert.match(r.texte, /daniel\s+170\s+85 %/);
    assert.match(r.texte, /marie\s+30\s+15 %/);
  });
});

describe('ce qu\'on refuse d\'inventer', () => {
  test('aucun commit : pas de score de 0, une absence de mesure', () => {
    const r = repartitionContributions({ depot: 'moi/vide', commits: [], zones: [] });
    assert.equal(r.score, null);
    assert.match(r.texte, /Aucun commit lu/);
    assert.match(r.texte, /pas un score de 0/);
    assert.ok(!/Score global : 0/.test(r.texte));
  });

  test('des commits mais aucune zone assez active : le score se tait', () => {
    // On sait qui commite, on ne sait pas où ça concentre. Rendre un chiffre quand même
    // serait le pire des deux — un score sans zone derrière.
    const r = repartitionContributions({
      depot: 'moi/petit', commits: commits([['daniel', 4]]),
      zones: [{ chemin: 'src', commits: commits([['daniel', 4]]) }]
    });
    assert.equal(r.score, null);
    assert.match(r.texte, /non calculable/);
  });

  test('les répertoires non interrogés se disent, ils ne se cachent pas', () => {
    const r = repartitionContributions({
      depot: 'moi/gros', commits: commits([['daniel', 10]]),
      zones: [{ chemin: 'src', commits: commits([['daniel', 10]]) }], ignorees: 7
    });
    assert.match(r.texte, /7 répertoire\(s\) n'ont pas été interrogés/);
    assert.match(r.texte, /peuvent cacher une zone fragile/);
  });

  test('un auteur sans nom devient « (inconnu) », pas une ligne perdue', () => {
    const r = repartitionContributions({
      depot: 'd', commits: [{ author: '' }, { author: 'a' }], zones: [] });
    assert.ok(r.contributeurs.some((c) => c.nom === '(inconnu)'));
  });
});

describe('ce que l\'écran affiche à la place du champ', () => {
  test('une ligne qui dit le résultat, pas « rempli »', () => {
    const r = repartitionContributions({
      depot: 'd', commits: commits([['a', 20]]),
      zones: [{ chemin: 'src', commits: commits([['a', 20]]) }] });
    assert.match(resumeCourt(r), /bus factor 1 — RISQUE CRITIQUE/);
    assert.match(resumeCourt(r), /1 contributeur/);
  });

  test('sans commit, il le dit', () => {
    assert.equal(resumeCourt(repartitionContributions({ depot: 'd' })), 'aucun commit lu');
  });
});

describe('ce qu\'on sait calculer', () => {
  test('se déclare, et le reste continue de se demander', () => {
    // Un signal qu'on ne sait pas calculer doit rester un champ de saisie : prétendre le
    // calculer rendrait un champ vide sans dire pourquoi.
    assert.equal(sait('repartition_contributions'), true);
    assert.equal(sait('chiffres_dora'), false);
    assert.equal(sait(''), false);
  });
});

describe('les zones d\'un dépôt', () => {
  test('le RÉPERTOIRE, à deux niveaux au plus', () => {
    const z = zonesDepuisArbre(['src/main/Foo.java', 'src/main/Bar.java', 'src/test/T.java']);
    assert.deepEqual(z.map((x) => x.chemin), ['src/main', 'src/test']);
    assert.deepEqual(z.map((x) => x.fichiers), [2, 1]);
  });

  test('un dépôt PLAT donne des répertoires, pas un fichier par zone', () => {
    /*
     * La divergence assumée avec le hub. Son code fait `slice(0, 2)` sur le chemin
     * complet : `lib/yaml.js` devient la zone « lib/yaml.js », c'est-à-dire le fichier.
     * Sur un dépôt profond ça ne se voit pas ; sur un dépôt plat, le bus factor cesse de
     * parler de zones de connaissance et se met à parler de fichiers un par un.
     *
     * On applique l'intention écrite dans son commentaire — « 2 niveaux » — plutôt que le
     * code.
     */
    const z = zonesDepuisArbre(['lib/yaml.js', 'lib/md.js', 'app/forge.js']);
    assert.deepEqual(z.map((x) => x.chemin), ['lib', 'app']);
  });

  test('un fichier de racine n\'est pas une zone, et il est compté à part', () => {
    // Aucune connaissance partagée à propos d'un fichier isolé — mais l'écarter en
    // silence ferait disparaître du dépôt sans que rien ne le dise.
    const z = zonesDepuisArbre(['README.md', 'lib/a.js']);
    assert.deepEqual(z.map((x) => x.chemin), ['lib']);
    assert.equal(z.racine, 1);
  });

  test('rangées par nombre de fichiers — le seul indice avant de les interroger', () => {
    const z = zonesDepuisArbre(['a/x.js', 'b/1.js', 'b/2.js', 'b/3.js']);
    assert.deepEqual(z.map((x) => x.chemin), ['b', 'a']);
  });

  test('à volume égal, l\'ordre est stable et alphabétique', () => {
    // Sinon deux exécutions sur le même dépôt interrogeraient des zones différentes, et
    // deux rapports cesseraient d'être comparables sans que rien ne l'explique.
    const z = zonesDepuisArbre(['z/1.js', 'a/1.js']);
    assert.deepEqual(z.map((x) => x.chemin), ['a', 'z']);
  });

  test('un arbre vide ne donne aucune zone', () => {
    assert.deepEqual([...zonesDepuisArbre([])], []);
  });
});

describe('l\'état des branches', () => {
  const quand = (jours) => new Date(Date.UTC(2026, 7, 17) - jours * 86400000).toISOString();
  const r = inventaireBranches({
    depot: 'moi/demo', maintenant: '2026-08-17T00:00:00Z',
    branches: [
      { name: 'main', protectee: true, default: true, quand: quand(120) },
      { name: 'feature/ancienne', quand: quand(228) },
      { name: 'chore/tiede', quand: quand(45) },
      { name: 'fix/recent', quand: quand(7) },
      { name: 'wip/sans-date' }
    ]
  });

  test('classe aux paliers du hub — 90 jours, 30 jours', () => {
    assert.equal(r.comptes.critiques, 1);
    assert.equal(r.comptes.aSurveiller, 1);
    assert.equal(r.comptes.recentes, 1);
  });

  test('une branche PROTÉGÉE n\'est jamais morte, quel que soit son âge', () => {
    /*
     * `main` sans commit depuis quatre mois n'est pas une branche abandonnée : c'est une
     * branche stable. La compter parmi les mortes ferait proposer de supprimer la branche
     * principale — le genre de conseil qui discrédite tout le reste.
     */
    assert.equal(r.comptes.protegees, 1);
    assert.ok(!r.texte.split('De la plus ancienne')[1].split('Protégées')[0].includes('main'));
    assert.match(r.texte, /jamais à supprimer/);
  });

  test('une branche SANS DATE est comptée à part, jamais classée', () => {
    // GitHub ne donne pas la date avec la branche. La ranger d'office en « récente »
    // laisserait croire le dépôt plus propre qu'il ne l'est ; en « morte », l'inverse.
    assert.equal(r.comptes.sansDate, 1);
    assert.match(r.texte, /n'a pas pu être établi/);
  });

  test('les branches sortent de la plus ancienne à la plus récente', () => {
    const ordre = r.branches.filter((b) => !b.protegee && b.jours !== null)
      .sort((a, b) => b.jours - a.jours).map((b) => b.nom);
    assert.deepEqual(ordre, ['feature/ancienne', 'chore/tiede', 'fix/recent']);
  });

  test('le texte dit sa méthode et ses seuils', () => {
    assert.match(r.texte, /90 jours/);
    assert.match(r.texte, /30 jours/);
    assert.match(r.texte, /branches protégées sont exclues/);
  });

  test('aucune branche : on le dit, on ne rend pas un rapport vide', () => {
    const vide = inventaireBranches({ depot: 'd', branches: [] });
    assert.match(vide.texte, /Aucune branche lue/);
  });

  test('le résumé tient sur une ligne', () => {
    assert.match(resumeBranches(r), /5 branche\(s\) · 1 morte\(s\) · 1 à surveiller · 1 sans date/);
  });
});
