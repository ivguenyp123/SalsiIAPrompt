/*
 * Tests de l'exécution — moment 5.
 *
 * La propriété centrale, et c'est la seule qui protège vraiment : `preparer` N'ÉCRIT
 * RIEN. Tant que `executer` n'a pas été appelé, le dépôt est intact. C'est ce qui rend
 * la confirmation humaine réelle plutôt que décorative — l'humain voit les fichiers, les
 * versions et le message AVANT que quoi que ce soit parte.
 *
 * La forge est simulée : on vérifie donc aussi ce qui est demandé au dépôt, pas
 * seulement ce qui en revient.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { preparer, executer, descriptionMR } from '../runtime/executer.js';

const CI = 'stages: [build]\n\nvariables:\n  IMAGE_TAG: "1.4.2"\n';
const OVERLAY = 'images:\n  - name: app\n    newTag: "1.4.2"\nconfigMapGenerator:\n  - literals:\n      - APP_VERSION=1.4.2\n';
const BASE = 'resources:\n  - deployment.yaml\n';

/** Une forge en mémoire qui enregistre TOUT ce qu'on lui demande. */
function forgeSimulee({ fichiers = {}, arbre = [], mrEchoue = false } = {}) {
  const journal = { lectures: [], commits: [], mrs: [] };
  return {
    journal,
    projectInfo: async () => ({ defaultBranch: 'main', path: 'plateforme/demo', visibility: 'private' }),
    getFile: async (_repo, path) => {
      journal.lectures.push(path);
      return fichiers[path] !== undefined ? { content: fichiers[path], sha: 'x' } : null;
    },
    listTree: async () => arbre,
    commitFiles: async (_repo, args) => { journal.commits.push(args); return { sha: 'abc1234def', url: 'https://gl/c/abc1234' }; },
    createMergeRequest: async (_repo, args) => {
      journal.mrs.push(args);
      if (mrEchoue) throw new Error('Another open merge request already exists for this source branch');
      return { number: 313, url: 'https://gl/mr/313', title: args.title };
    }
  };
}

const depotComplet = () => forgeSimulee({
  fichiers: {
    '.gitlab-ci.yml': CI,
    'k8s/overlays/preprod/kustomization.yaml': OVERLAY,
    'k8s/base/kustomization.yaml': BASE
  },
  arbre: ['README.md', 'src/App.java', 'k8s/base/kustomization.yaml',
          'k8s/overlays/preprod/kustomization.yaml', 'k8s/base/deployment.yaml']
});

describe('préparer : on lit, on calcule, on n\'écrit pas', () => {
  test('le plan annonce la version et les fichiers', async () => {
    const f = depotComplet();
    const { plan, brancheCible } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds', bump: 'minor' });

    assert.equal(plan.ok, true);
    assert.equal(plan.courante, '1.4.2');
    assert.equal(plan.cible, '1.5.0');
    assert.equal(brancheCible, 'main', 'la branche cible vient du dépôt, elle ne se suppose pas');
  });

  test('AUCUNE écriture n\'a eu lieu', async () => {
    // La garantie qui compte : la confirmation humaine n'a de sens que si rien n'a bougé.
    const f = depotComplet();
    await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    assert.equal(f.journal.commits.length, 0);
    assert.equal(f.journal.mrs.length, 0);
  });

  test('les overlays sont DÉCOUVERTS dans l\'arbre, pas supposés', async () => {
    // Une liste en dur vieillirait au premier overlay ajouté par une équipe, et l'agent
    // bumperait la CI en en laissant un derrière — incohérence visible au déploiement
    // seulement.
    const f = depotComplet();
    const { overlaysLus } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    assert.equal(overlaysLus, 2, 'les deux kustomization sont lus');
    assert.ok(f.journal.lectures.includes('k8s/overlays/preprod/kustomization.yaml'));
    assert.ok(!f.journal.lectures.includes('src/App.java'), 'et rien d\'autre');
  });

  test('seul l\'overlay qui porte la version entre au plan', async () => {
    const f = depotComplet();
    const { plan } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    assert.deepEqual(plan.fichiers.map((x) => x.path),
      ['.gitlab-ci.yml', 'k8s/overlays/preprod/kustomization.yaml']);
  });

  test('sans fichier de CI, le plan refuse et rien n\'est lu en trop', async () => {
    const f = forgeSimulee({ fichiers: {}, arbre: ['k8s/base/kustomization.yaml'] });
    const { plan } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    assert.equal(plan.ok, false);
    assert.match(plan.raison, /Aucun fichier de CI/);
    // On n'a pas parcouru l'arbre pour rien : sans CI, il n'y a pas de version à propager.
    assert.ok(!f.journal.lectures.includes('k8s/base/kustomization.yaml'));
  });
});

describe('exécuter : un seul commit, puis la merge request', () => {
  test('le commit est ATOMIQUE — tous les fichiers, une seule fois', async () => {
    // Bumper la CI sans les overlays laisserait le dépôt incohérent, et il n'y aurait
    // rien à annuler d'un bloc.
    const f = depotComplet();
    const { plan, brancheCible } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    await executer(f, 'plateforme/demo', plan, { branche: 'feat/refunds', brancheCible });

    assert.equal(f.journal.commits.length, 1);
    assert.equal(f.journal.commits[0].files.length, 2);
    assert.equal(f.journal.commits[0].branch, 'feat/refunds');
    assert.equal(f.journal.commits[0].message, '[Livraison] Bump IMAGE_TAG → 1.4.3');
  });

  test('le contenu commité porte bien la nouvelle version, partout', async () => {
    const f = depotComplet();
    const { plan, brancheCible } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    await executer(f, 'plateforme/demo', plan, { branche: 'feat/refunds', brancheCible });

    const parChemin = Object.fromEntries(f.journal.commits[0].files.map((x) => [x.path, x.content]));
    assert.match(parChemin['.gitlab-ci.yml'], /IMAGE_TAG: "1\.4\.3"/);
    assert.match(parChemin['k8s/overlays/preprod/kustomization.yaml'], /newTag: "1\.4\.3"/);
    assert.match(parChemin['k8s/overlays/preprod/kustomization.yaml'], /APP_VERSION=1\.4\.3/);
  });

  test('la merge request va de la branche vers la cible', async () => {
    const f = depotComplet();
    const { plan, brancheCible } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    const r = await executer(f, 'plateforme/demo', plan, { branche: 'feat/refunds', brancheCible });

    assert.equal(f.journal.mrs[0].source, 'feat/refunds');
    assert.equal(f.journal.mrs[0].target, 'main');
    assert.equal(f.journal.mrs[0].title, 'release 1.4.3');
    assert.equal(r.mr.number, 313);
  });

  test('une MR refusée ne fait pas passer le commit pour un échec', async () => {
    // Cas fréquent : une MR existe déjà pour ce couple de branches. Le travail utile a
    // eu lieu ; le cacher enverrait l'auteur relancer une livraison déjà faite.
    const f = forgeSimulee({
      fichiers: { '.gitlab-ci.yml': CI }, arbre: [], mrEchoue: true
    });
    const { plan, brancheCible } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    const r = await executer(f, 'plateforme/demo', plan, { branche: 'feat/refunds', brancheCible });

    assert.equal(f.journal.commits.length, 1, 'le commit est bien passé');
    assert.equal(r.mr, null);
    assert.match(r.avertissement, /commit est passé/);
    assert.match(r.avertissement, /abc1234/, 'et il donne la référence, pour vérifier');
  });

  test('un plan refusé ne s\'exécute pas', async () => {
    const f = depotComplet();
    await assert.rejects(
      () => executer(f, 'plateforme/demo', { ok: false, raison: 'IMAGE_TAG introuvable.' }, {}),
      /IMAGE_TAG introuvable/);
    assert.equal(f.journal.commits.length, 0);
  });
});

describe('la description de la merge request', () => {
  test('elle dit tout ce qu\'un relecteur veut savoir sans ouvrir le diff', async () => {
    const f = depotComplet();
    const { plan } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds', bump: 'major' });
    const texte = descriptionMR(plan, { branche: 'feat/refunds', brancheCible: 'main', auteur: 'ivguenyp123' });

    for (const attendu of ['1.4.2', '2.0.0', 'feat/refunds', 'main',
                           'k8s/overlays/preprod/kustomization.yaml', 'ivguenyp123']) {
      assert.ok(texte.includes(attendu), `la description mentionne ${attendu}`);
    }
  });

  test('elle dit explicitement que l\'écriture n\'est pas venue d\'un modèle', async () => {
    // C'est l'information qui change la nature de la revue : le relecteur sait qu'il
    // relit un calcul, pas une proposition.
    const f = depotComplet();
    const { plan } = await preparer(f, 'plateforme/demo', { branche: 'feat/refunds' });
    const texte = descriptionMR(plan, { branche: 'feat/refunds', brancheCible: 'main' });
    assert.match(texte, /module déterministe, pas par un modèle/);
    assert.match(texte, /confirmation humaine/);
  });
});
