/*
 * Tests du signal `plan_de_livraison` — le plan qu'un agent explique.
 *
 * ── CE QUI EST VÉRIFIÉ ICI, ET DANS QUEL ORDRE D'IMPORTANCE ─────────────────
 *
 * 1. Le texte ne MENT pas par omission. Un overlay écarté par le filtre
 *    d'environnement garde l'ancienne version : si le texte ne le dit pas, l'agent
 *    écrira « la livraison met le dépôt à jour » et il aura tort pour deux
 *    environnements sur trois. C'est le seul défaut de ce module qui coûte un
 *    déploiement.
 * 2. Un refus est un RÉSULTAT, pas une panne. Le texte doit porter la raison, pas
 *    disparaître — un champ vide ferait répondre l'agent quand même.
 * 3. Ce que la plateforme ne mesure pas est DIT. Sans la section « ce qui n'a pas été
 *    regardé », un modèle à qui l'on montre un plan propre écrit volontiers « aucune
 *    vulnérabilité critique », et cette phrase n'a aucune source.
 * 4. Les réglages sont dans le texte. Deux plans du même dépôt, l'un en `major` sur
 *    `production` et l'autre en `patch` sur `uat`, doivent être discernables.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planDeLivraison, resumeLivraison, SIGNAUX_LIVRAISON } from '../lib/signaux-livraison.js';
import { environnementDe, environnements, planifier } from '../runtime/livraison.js';
import { reglagesDe, reglagesComplets, seRegle, sait } from '../lib/signaux-matiere.js';

const M = new Date('2026-08-18T09:00:00Z');
const DEPOT = 'plateforme/demo-spring';
const CI = { path: '.gitlab-ci.yml', content: 'variables:\n  IMAGE_TAG: "1.4.2"\n' };
const overlay = (env) => ({
  path: `Manifests/overlays/${env}/kustomization.yaml`,
  content: 'images:\n  - name: app\n    newTag: "1.4.2"\n'
});

const plan = (extra = {}) => planDeLivraison({
  depot: DEPOT, branche: 'feat/refunds', brancheCible: 'main', bump: 'patch',
  ci: CI, overlays: [overlay('development'), overlay('uat'), overlay('production')],
  mrs: [], runs: [], deploiements: [], stack: [], maintenant: M, ...extra
});

/* ── L'environnement, lu dans le chemin ───────────────────────────────────── */

describe('l\'environnement d\'un overlay se lit, il ne se devine pas', () => {
  test('la convention `overlays/<env>/` est reconnue à n\'importe quelle profondeur', () => {
    assert.equal(environnementDe('Manifests/overlays/uat/kustomization.yaml'), 'uat');
    assert.equal(environnementDe('k8s/overlays/prod/kustomization.yml'), 'prod');
    assert.equal(environnementDe('overlays/dev/kustomization.yaml'), 'dev');
  });

  test('une base n\'est pas un environnement, et on ne lui en invente pas', () => {
    // Un répertoire quelconque pourrait ressembler à un environnement. Deviner ferait
    // filtrer sur un pressentiment — et écarter des overlays sans que ce soit visible.
    assert.equal(environnementDe('Manifests/base/kustomization.yaml'), '');
    assert.equal(environnementDe('kustomization.yaml'), '');
    assert.equal(environnementDe('k8s/prod/kustomization.yaml'), '');
  });

  test('la liste est dédoublonnée et triée : c\'est celle d\'une liste déroulante', () => {
    assert.deepEqual(environnements([
      'Manifests/overlays/uat/kustomization.yaml',
      'Manifests/overlays/development/kustomization.yaml',
      'Manifests/overlays/uat/patch.yaml',
      'Manifests/base/kustomization.yaml'
    ]), ['development', 'uat']);
  });
});

/* ── Le filtre, et ce qu'il laisse en arrière ─────────────────────────────── */

describe('livrer un seul environnement laisse les autres en arrière', () => {
  test('sans réglage, tous les overlays sont bumpés — le comportement du module d\'origine', () => {
    const r = plan();
    assert.equal(r.plan.ok, true);
    assert.equal(r.plan.fichiers.length, 4);           // la CI + trois overlays
    assert.deepEqual(r.plan.ecartes, []);
  });

  test('avec un environnement, seul le sien est touché', () => {
    const r = plan({ environnement: 'uat' });
    assert.deepEqual(r.plan.fichiers.map((f) => f.path), [
      '.gitlab-ci.yml', 'Manifests/overlays/uat/kustomization.yaml'
    ]);
  });

  test('CE QUI EST ÉCARTÉ EST NOMMÉ, dans le plan et dans le texte', () => {
    // Le test le plus important du fichier. Un plan qui annonce « 2 fichiers » sans dire
    // que deux overlays gardent l'ancienne version fait confirmer une livraison partielle
    // à quelqu'un qui la croit complète.
    const r = plan({ environnement: 'uat' });
    assert.deepEqual(r.plan.ecartes, [
      'Manifests/overlays/development/kustomization.yaml',
      'Manifests/overlays/production/kustomization.yaml'
    ]);
    assert.match(r.texte, /Laissés en arrière par le réglage « uat » \(2\)/);
    assert.match(r.texte, /ne seront PAS à jour/);
    assert.match(r.texte, /reste à 1\.4\.2/);
  });

  test('un fichier que la livraison n\'aurait pas touché n\'est PAS « laissé en arrière »', () => {
    /*
     * Vu à l'écran. Un `kustomization` de base ne porte ni `newTag` ni `APP_VERSION` : il
     * ne serait pas modifié même sans filtre. Le compter parmi les écartés faisait dire
     * « 3 overlays gardent l'ancienne version » là où deux étaient concernés — une alarme
     * sur un fichier hors sujet, dans la section même qui doit rester crédible.
     */
    const base = { path: 'Manifests/base/kustomization.yaml', content: 'resources:\n  - d.yaml\n' };
    const r = plan({ environnement: 'uat',
                     overlays: [base, overlay('development'), overlay('uat')] });
    assert.deepEqual(r.plan.ecartes, ['Manifests/overlays/development/kustomization.yaml']);
    assert.equal(r.overlaysLus, 3, 'il est bien LU, il n\'est simplement pas écarté');
    assert.match(r.texte, /Sans environnement \(1\)/);
  });

  test('un environnement inconnu du dépôt écarte tout, et le texte le dit', () => {
    // Le cas silencieux : viser `preprod` sur un dépôt qui n'en a pas produirait un plan
    // à un seul fichier — techniquement exact, et parfaitement trompeur.
    const r = plan({ environnement: 'preprod' });
    assert.equal(r.plan.fichiers.length, 1);
    assert.equal(r.plan.ecartes.length, 3);
    assert.match(r.texte, /Laissés en arrière par le réglage « preprod » \(3\)/);
  });

  test('le message de commit et le titre de MR portent l\'environnement', () => {
    // Sinon deux livraisons partielles successives sont indiscernables dans l'historique.
    const r = plan({ environnement: 'uat' });
    assert.match(r.plan.message, /\(uat\)/);
    assert.match(r.plan.titreMR, /— uat$/);
    assert.match(planifier({ branche: 'f', ci: CI, overlays: [] }).titreMR, /^release 1\.4\.3$/);
  });
});

/* ── Les réglages sont dans le texte ──────────────────────────────────────── */

describe('deux plans du même dépôt restent discernables', () => {
  test('branche, incrément et environnement sont écrits en tête', () => {
    const r = plan({ bump: 'major', environnement: 'production' });
    assert.match(r.texte, /Branche à livrer : feat\/refunds → main/);
    assert.match(r.texte, /Incrément +: major \(majeur\)/);
    assert.match(r.texte, /Environnement +: production/);
    assert.match(r.texte, /IMAGE_TAG 1\.4\.2 → 2\.0\.0/);
  });

  test('sans environnement, le texte dit « tous » plutôt que de rester muet', () => {
    assert.match(plan().texte, /Environnement +: tous les environnements trouvés/);
  });
});

/* ── Un refus est un résultat ─────────────────────────────────────────────── */

describe('une livraison impossible produit un texte, pas un vide', () => {
  test('sans fichier de CI, la raison part au modèle', () => {
    const r = plan({ ci: null, overlays: [] });
    assert.equal(r.plan.ok, false);
    assert.match(r.texte, /LA LIVRAISON NE PEUT PAS ÊTRE PRÉPARÉE/);
    assert.match(r.texte, /Aucun fichier de CI trouvé/);
    assert.ok(r.texte.length > 200, 'un refus reste une matière, pas une ligne');
  });

  test('un tag non SemVer est refusé, et c\'est la contradiction qu\'on avait déclarée', () => {
    /*
     * Le contrat de `prep-delivery` exigeait `^v[0-9]+\.[0-9]+\.[0-9]+$` — un tag préfixé
     * d'un `v` — quand le module refuse précisément ceux-là. Un dépôt conforme au critère
     * n'aurait jamais pu être livré par le module censé le servir. Le critère a été
     * aligné sur le module ; ce test garde la preuve du comportement réel.
     */
    const r = plan({ ci: { path: '.gitlab-ci.yml', content: '  IMAGE_TAG: "v1.4.2"\n' } });
    assert.equal(r.plan.ok, false);
    assert.match(r.texte, /non SemVer/);
  });

  test('même refusé, le texte dit ce qui n\'a pas été regardé', () => {
    // Sans cette section, un modèle comble : il conclut sur les tests ou les
    // vulnérabilités que personne n'a mesurés.
    assert.match(plan({ ci: null }).texte, /CE QUI N'A PAS ÉTÉ REGARDÉ/);
  });
});

/* ── Ce que la plateforme ne mesure pas ───────────────────────────────────── */

describe('ce qui n\'a pas été mesuré est dit, jamais laissé au modèle', () => {
  test('les vulnérabilités sont N/A, et le mot « zéro » est explicitement écarté', () => {
    assert.match(plan().texte, /`vulnerabilities\.critical` est donc N\/A — pas zéro/);
  });

  test('aucun pipeline lu ne veut pas dire CI verte', () => {
    assert.match(plan().texte, /son état de CI est INCONNU, pas vert/);
  });

  test('aucun conflit signalé ne veut pas dire fusion garantie', () => {
    /*
     * `conflits` ne peut être qu'un vrai positif : GitLab rend `null` tant qu'il n'a pas
     * calculé la fusion, et GitHub ne peuple le champ que sur la fiche d'une PR, jamais
     * dans une liste. Écrire « aucun conflit » donnerait à un silence la valeur d'une
     * vérification.
     */
    const r = plan({ mrs: [{ numero: 41, titre: 'x', branche: 'feat/refunds', cible: 'main',
                             auteur: 'a.b', conflits: false, relecteurs: [] }] });
    assert.match(r.texte, /pas de conflit signalé/);
    // « fusion garantie » n'apparaît QUE dans la phrase qui la nie.
    assert.match(r.texte, /pas comme « fusion garantie »/);
  });

  test('un conflit déclaré, lui, est affirmé sans réserve', () => {
    const r = plan({ mrs: [{ numero: 41, titre: 'x', branche: 'feat/refunds', cible: 'main',
                             auteur: 'a.b', conflits: true, relecteurs: [] }] });
    assert.match(r.texte, /Conflits : OUI/);
  });

  test('l\'absence de merge request n\'est pas présentée comme une anomalie', () => {
    // C'est le cas NORMAL : la livraison en ouvrira une. Le taire ferait conclure l'agent
    // à un problème là où il n'y a qu'un ordre des choses.
    assert.match(plan().texte, /c'est la livraison qui en ouvrira une/);
  });
});

/* ── Le contexte lu autour du plan ────────────────────────────────────────── */

describe('le contexte porte sur la branche livrée, pas sur le dépôt entier', () => {
  test('seuls les pipelines de cette branche sont comptés', () => {
    const r = plan({ runs: [
      { branche: 'main', statut: 'echec', debut: '2026-08-18T08:00:00Z', sha: 'aaaa1111' },
      { branche: 'feat/refunds', statut: 'succes', debut: '2026-08-18T08:40:00Z', sha: 'bbbb2222' }
    ] });
    assert.equal(r.runsBranche, 1);
    assert.match(r.texte, /Dernier pipeline : succès/);
  });

  test('les déploiements sont filtrés par l\'environnement visé', () => {
    const r = plan({ environnement: 'uat', deploiements: [
      { environnement: 'production', quand: '2026-08-17T10:00:00Z', branche: 'main' },
      { environnement: 'uat', quand: '2026-08-17T16:00:00Z', branche: 'main' }
    ] });
    assert.equal(r.deploiements.length, 1);
    assert.equal(r.deploiements[0].environnement, 'uat');
  });

  test('un environnement sans déploiement le dit autrement qu\'un dépôt sans déploiement', () => {
    // « Aucun déploiement sur ce dépôt » et « aucun sur uat, mais d'autres ailleurs » ne
    // se lisent pas pareil : le second dit que l'environnement visé n'a jamais servi.
    const r = plan({ environnement: 'uat', deploiements: [
      { environnement: 'production', quand: '2026-08-17T10:00:00Z', branche: 'main' }
    ] });
    assert.match(r.texte, /Aucun déploiement lu sur `uat`/);
  });
});

/* ── Le contrat du signal ─────────────────────────────────────────────────── */

describe('le signal se déclare comme réglable', () => {
  test('la plateforme sait le calculer', () => assert.ok(sait('plan_de_livraison')));

  test('il déclare trois réglages, dont deux remplis par le dépôt', () => {
    const r = reglagesDe('plan_de_livraison');
    assert.deepEqual(r.map((x) => x.nom), ['branche', 'environnement', 'bump']);
    assert.deepEqual(r.map((x) => x.genre), ['branche', 'environnement', 'choix']);
    assert.ok(seRegle('plan_de_livraison'));
  });

  test('l\'environnement est FACULTATIF : « tous » est une valeur, pas un trou', () => {
    // Le tester comme un manque bloquerait le calcul sur le cas le plus courant.
    assert.equal(reglagesComplets('plan_de_livraison', { branche: 'f', bump: 'patch' }), true);
    assert.equal(reglagesComplets('plan_de_livraison', { bump: 'patch' }), false);
  });

  test('un signal sans réglage reste complet sans rien fournir', () => {
    assert.equal(seRegle('rapport_depot'), false);
    assert.equal(reglagesComplets('rapport_depot', {}), true);
  });

  test('les incréments proposés sont ceux du module, pas une liste recopiée', () => {
    const bump = SIGNAUX_LIVRAISON.plan_de_livraison.reglages.find((r) => r.nom === 'bump');
    assert.deepEqual(bump.options, ['major', 'minor', 'patch']);
    assert.equal(bump.defaut, 'patch');
  });
});

describe('le résumé tient sur une ligne', () => {
  test('il annonce le bump et le compte de fichiers', () => {
    assert.match(resumeLivraison(plan()), /^1\.4\.2 → 1\.4\.3 · 4 fichier\(s\)$/);
  });

  test('il annonce aussi ce qui reste en arrière', () => {
    assert.match(resumeLivraison(plan({ environnement: 'uat' })),
      /· uat · 2 overlay\(s\) en arrière$/);
  });

  test('un refus se résume par sa raison', () => {
    assert.match(resumeLivraison(plan({ ci: null })), /^livraison impossible — /);
  });
});
