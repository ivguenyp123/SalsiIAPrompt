/*
 * Tests de la forge.
 *
 * `fetch` est injectable : on vérifie les deux implémentations — chemins appelés,
 * en-têtes d'authentification, et surtout la différence création / mise à jour, qui
 * est là où les deux API divergent le plus et où une erreur écrase silencieusement.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createForge, detectKind, toBase64, fromBase64, ForgeError } from '../app/forge.js';

const GITLAB = { gitlabUrl: 'https://gitlab.example.com', token: 'glpat-x' };
const GITHUB = { gitlabUrl: 'https://github.com', token: 'ghp-x' };

/** Enregistre les appels et répond selon une table chemin → réponse. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ url, pathname, method: options.method || 'GET', options,
                 params: Object.fromEntries(searchParams),
                 body: options.body ? JSON.parse(options.body) : undefined });
    const key = `${options.method || 'GET'} ${pathname}`;
    const hit = routes[key] ?? routes[pathname];
    if (hit === undefined) return { ok: false, status: 404 };
    if (typeof hit === 'number') return { ok: false, status: hit };
    return { ok: true, status: 200, json: async () => hit };
  };
  impl.calls = calls;
  return impl;
}

describe('detectKind', () => {
  test('reconnaît GitHub, tout le reste est GitLab', () => {
    assert.equal(detectKind('https://github.com'), 'github');
    assert.equal(detectKind('https://api.github.com'), 'github');
    assert.equal(detectKind('https://gitlab.example.com'), 'gitlab');
    assert.equal(detectKind('https://gitlab.github.com.evil.example'), 'gitlab', 'pas de correspondance partielle');
    assert.equal(detectKind('n\'importe quoi'), 'gitlab');
  });
});

describe('base64', () => {
  test('aller-retour sur de l\'UTF-8, accents et symboles compris', () => {
    const texte = 'spec: |\n  Tu analyses le dépôt — coût : 12 €\n  ✓ éàüñ\n';
    assert.equal(fromBase64(toBase64(texte)), texte);
  });
});

describe('GitLab', () => {
  test('authentifie par PRIVATE-TOKEN sur /api/v4', async () => {
    const fetchImpl = fakeFetch({ '/api/v4/user': { id: 1, username: 'm.dubois', name: 'Marie' } });
    const user = await createForge(GITLAB, fetchImpl).currentUser();

    assert.equal(user.username, 'm.dubois');
    assert.equal(fetchImpl.calls[0].pathname, '/api/v4/user');
    assert.equal(fetchImpl.calls[0].options.headers['PRIVATE-TOKEN'], 'glpat-x');
  });

  test('listRepos se limite aux dépôts dont l\'utilisateur est membre', async () => {
    const fetchImpl = fakeFetch({ '/api/v4/projects': [{ id: 42, path_with_namespace: 'data/etl', name: 'etl' }] });
    const repos = await createForge(GITLAB, fetchImpl).listRepos();

    assert.deepEqual(repos, [{ id: '42', path: 'data/etl', name: 'etl' }]);
    assert.equal(fetchImpl.calls[0].params.membership, 'true');
  });

  test('listFiles normalise l\'arbre GitLab', async () => {
    const fetchImpl = fakeFetch({ '/api/v4/projects/42/repository/tree': [
      { name: 'a.yaml', path: 'artifacts/a.yaml', type: 'blob' },
      { name: 'sous', path: 'artifacts/sous', type: 'tree' }
    ] });
    const files = await createForge(GITLAB, fetchImpl).listFiles('42', 'artifacts');
    assert.deepEqual(files, [
      { name: 'a.yaml', path: 'artifacts/a.yaml', type: 'file' },
      { name: 'sous', path: 'artifacts/sous', type: 'dir' }
    ]);
    assert.equal(fetchImpl.calls[0].params.ref, 'main');
  });

  test('un fichier absent renvoie null, ce n\'est pas une erreur', async () => {
    const forge = createForge(GITLAB, fakeFetch({}));
    assert.equal(await forge.getFile('42', 'artifacts/x.yaml'), null);
  });

  test('POST quand le fichier n\'existe pas, PUT quand il existe', async () => {
    // GitLab distingue création et mise à jour par le verbe : se tromper renvoie une
    // erreur au mieux, écrase au pire.
    const absent = fakeFetch({ 'POST /api/v4/projects/42/repository/files/a%2Fb.yaml': { file_path: 'a/b.yaml' } });
    await createForge(GITLAB, absent).putFile('42', 'a/b.yaml', { content: 'eA==', message: 'm' });
    assert.equal(absent.calls.at(-1).method, 'POST');

    const present = fakeFetch({
      '/api/v4/projects/42/repository/files/a%2Fb.yaml': { content: 'eA==', last_commit_id: 'abc' },
      'PUT /api/v4/projects/42/repository/files/a%2Fb.yaml': { file_path: 'a/b.yaml' }
    });
    await createForge(GITLAB, present).putFile('42', 'a/b.yaml', { content: 'eQ==', message: 'm' });
    assert.equal(present.calls.at(-1).method, 'PUT');
    assert.equal(present.calls.at(-1).body.commit_message, 'm');
    assert.equal(present.calls.at(-1).body.branch, 'main');
  });
});

describe('GitHub', () => {
  test('authentifie par Bearer sur api.github.com', async () => {
    const fetchImpl = fakeFetch({ '/user': { id: 1, login: 'ivguenyp123', name: null } });
    const user = await createForge(GITHUB, fetchImpl).currentUser();

    assert.equal(user.username, 'ivguenyp123');
    assert.equal(user.name, 'ivguenyp123', 'le login sert de nom quand il n\'y en a pas');
    assert.equal(new URL(fetchImpl.calls[0].url).host, 'api.github.com');
    assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'Bearer ghp-x');
  });

  test('joint le sha du fichier existant, sans quoi l\'écriture est refusée', async () => {
    const fetchImpl = fakeFetch({
      '/repos/o/r/contents/artifacts/x.yaml': { sha: 'deadbeef', content: 'eA==' },
      'PUT /repos/o/r/contents/artifacts/x.yaml': { commit: { sha: 'new' } }
    });
    await createForge(GITHUB, fetchImpl).putFile('o/r', 'artifacts/x.yaml', { content: 'eQ==', message: 'm' });

    const put = fetchImpl.calls.at(-1);
    assert.equal(put.method, 'PUT');
    assert.equal(put.body.sha, 'deadbeef');
    assert.equal(put.body.branch, 'main');
  });

  test('listFiles normalise le contenu GitHub', async () => {
    const fetchImpl = fakeFetch({ '/repos/o/r/contents/artifacts': [
      { name: 'a.yaml', path: 'artifacts/a.yaml', type: 'file' },
      { name: 'sous', path: 'artifacts/sous', type: 'dir' }
    ] });
    const files = await createForge(GITHUB, fetchImpl).listFiles('o/r', 'artifacts');
    assert.deepEqual(files.map((f) => f.type), ['file', 'dir']);
  });

  test('listFiles sur un chemin de FICHIER renvoie une liste vide, pas un plantage', async () => {
    // GitHub renvoie un objet et non un tableau dans ce cas : sans garde, le .map casse.
    const fetchImpl = fakeFetch({ '/repos/o/r/contents/artifacts/a.yaml': { name: 'a.yaml', type: 'file' } });
    assert.deepEqual(await createForge(GITHUB, fetchImpl).listFiles('o/r', 'artifacts/a.yaml'), []);
  });

  test('crée sans sha quand le fichier n\'existe pas encore', async () => {
    const fetchImpl = fakeFetch({ 'PUT /repos/o/r/contents/artifacts/x.yaml': { commit: { sha: 'new' } } });
    await createForge(GITHUB, fetchImpl).putFile('o/r', 'artifacts/x.yaml', { content: 'eQ==', message: 'm' });

    assert.ok(!('sha' in fetchImpl.calls.at(-1).body), 'un sha inventé ferait échouer la création');
  });
});

describe('valider = déplacer', () => {
  const CONTENU = 'id: x\n';

  test('GitHub : copie puis supprime, avec le sha exigé', async () => {
    const fetchImpl = fakeFetch({
      '/repos/o/r/contents/artifacts/pending/x.yaml': { sha: 'aaa', content: toBase64(CONTENU) },
      'PUT /repos/o/r/contents/artifacts/x.yaml': { commit: { sha: 'n' } },
      'DELETE /repos/o/r/contents/artifacts/pending/x.yaml': { commit: { sha: 'd' } }
    });
    await createForge(GITHUB, fetchImpl).moveFile('o/r', 'artifacts/pending/x.yaml', 'artifacts/x.yaml', { message: 'validé' });

    const verbes = fetchImpl.calls.map((c) => c.method);
    assert.ok(verbes.indexOf('PUT') < verbes.lastIndexOf('DELETE'),
              'on copie AVANT de supprimer : l\'inverse ferait disparaître l\'artefact si ça casse au milieu');
    assert.equal(fetchImpl.calls.at(-1).body.sha, 'aaa');
  });

  test('GitLab : même séquence', async () => {
    const fetchImpl = fakeFetch({
      '/api/v4/projects/42/repository/files/artifacts%2Fpending%2Fx.yaml': { content: toBase64(CONTENU), last_commit_id: 'c' },
      'POST /api/v4/projects/42/repository/files/artifacts%2Fx.yaml': { file_path: 'artifacts/x.yaml' },
      'DELETE /api/v4/projects/42/repository/files/artifacts%2Fpending%2Fx.yaml': {}
    });
    await createForge(GITLAB, fetchImpl).moveFile('42', 'artifacts/pending/x.yaml', 'artifacts/x.yaml', { message: 'validé' });
    assert.equal(fetchImpl.calls.at(-1).method, 'DELETE');
  });

  test('refuse de déplacer ce qui n\'existe pas, plutôt que de créer un vide', async () => {
    await assert.rejects(
      () => createForge(GITHUB, fakeFetch({})).moveFile('o/r', 'absent.yaml', 'x.yaml', { message: 'm' }),
      (e) => e.status === 404);
  });
});

describe('registre encore vide', () => {
  test('un dossier absent renvoie [] plutôt qu\'une erreur, des deux côtés', async () => {
    // Le cas du premier jour : personne n'a encore publié. Ce n'est pas une panne.
    assert.deepEqual(await createForge(GITLAB, fakeFetch({})).listFiles('42', 'artifacts'), []);
    assert.deepEqual(await createForge(GITHUB, fakeFetch({})).listFiles('o/r', 'artifacts'), []);
  });
});

describe('erreurs', () => {
  const cas = [[401, /révoqué/], [403, /droit/], [404, /introuvable/], [409, /Conflit/], [500, /serveur/]];

  test('chaque code HTTP devient une phrase actionnable', async () => {
    for (const [status, motif] of cas) {
      const forge = createForge(GITLAB, fakeFetch({ '/api/v4/user': status }));
      await assert.rejects(() => forge.currentUser(), (e) => e instanceof ForgeError && motif.test(e.message));
    }
  });

  test('un échec réseau dit quoi vérifier, pas « failed to fetch »', async () => {
    const forge = createForge(GITLAB, async () => { throw new TypeError('Failed to fetch'); });
    await assert.rejects(() => forge.currentUser(), (e) => e.status === 0 && /VPN|CORS/.test(e.message));
  });

  test('exige une URL et un jeton', () => {
    assert.throws(() => createForge({ gitlabUrl: '', token: '' }), /URL et un jeton/);
  });
});
