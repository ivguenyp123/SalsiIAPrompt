/*
 * Tests de la connexion : session et client GitLab.
 *
 * Les deux modules sont écrits pour être testables hors navigateur — le stockage est
 * isolé derrière quelques fonctions, et `fetch` est injectable. On vérifie donc la
 * logique de connexion sans navigateur, sans réseau et sans instance GitLab.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Stockage web minimal, conforme à ce que les modules utilisent. */
class FakeStorage {
  #data = new Map();
  getItem(k) { return this.#data.has(k) ? this.#data.get(k) : null; }
  setItem(k, v) { this.#data.set(k, String(v)); }
  removeItem(k) { this.#data.delete(k); }
  get size() { return this.#data.size; }
}

globalThis.sessionStorage = new FakeStorage();
globalThis.localStorage = new FakeStorage();

const { normalizeGitlabUrl, checkToken, toSession, save, load, clear, hubHint } =
  await import('../app/session.js');
const { createClient, GitlabError } = await import('../app/gitlab.js');

const USER = { id: 7, username: 'm.dubois', name: 'Marie Dubois', avatar_url: 'https://x/a.png' };

beforeEach(() => {
  globalThis.sessionStorage = new FakeStorage();
  globalThis.localStorage = new FakeStorage();
});

describe('normalizeGitlabUrl', () => {
  test('complète le schéma et retire la barre finale', () => {
    assert.equal(normalizeGitlabUrl('gitlab.example.com'), 'https://gitlab.example.com');
    assert.equal(normalizeGitlabUrl('https://gitlab.example.com/'), 'https://gitlab.example.com');
    assert.equal(normalizeGitlabUrl('  https://gitlab.example.com//  '), 'https://gitlab.example.com');
  });

  test('conserve un chemin d\'instance sous-répertoire', () => {
    assert.equal(normalizeGitlabUrl('https://intra.example.com/gitlab/'), 'https://intra.example.com/gitlab');
  });

  test('refuse le http distant — le jeton circulerait en clair', () => {
    assert.throws(() => normalizeGitlabUrl('http://gitlab.example.com'), /https/);
  });

  test('tolère le http en local, où il n\'y a rien à intercepter', () => {
    assert.equal(normalizeGitlabUrl('http://localhost:8929'), 'http://localhost:8929');
  });

  test('refuse le vide et l\'illisible, avec un message utile', () => {
    assert.throws(() => normalizeGitlabUrl(''), /URL de ton instance/);
    assert.throws(() => normalizeGitlabUrl('ftp://x.example.com'), /http/);
  });
});

describe('checkToken', () => {
  test('accepte un jeton plausible', () => {
    assert.equal(checkToken('  glpat-AbCdEfGhIjKlMnOpQrSt '), 'glpat-AbCdEfGhIjKlMnOpQrSt');
  });
  test('refuse vide, trop court, ou contenant un espace', () => {
    assert.throws(() => checkToken(''), /jeton/);
    assert.throws(() => checkToken('court'), /trop court/);
    assert.throws(() => checkToken('glpat-AbCd EfGhIjKlMnOpQrSt'), /espace/);
  });
});

describe('stockage de session', () => {
  const base = () => toSession('https://gitlab.example.com', 'glpat-AbCdEfGhIjKlMnOpQrSt', USER);

  test('par défaut la session vit dans l\'onglet, pas sur le navigateur', () => {
    save(base());
    assert.equal(globalThis.sessionStorage.size, 1);
    assert.equal(globalThis.localStorage.size, 0, 'le jeton ne doit pas survivre à la fermeture');
    assert.equal(load().username, 'm.dubois');
  });

  test('« rester connecté » bascule sur le navigateur, et un seul emplacement fait foi', () => {
    save(base());                                   // d'abord dans l'onglet
    save({ ...base(), remember: true });             // puis persistant
    assert.equal(globalThis.localStorage.size, 1);
    assert.equal(globalThis.sessionStorage.size, 0, 'pas deux sessions divergentes');
  });

  test('clear efface les deux emplacements', () => {
    save({ ...base(), remember: true });
    clear();
    assert.equal(load(), null);
  });

  test('une session tronquée ou illisible est ignorée', () => {
    globalThis.sessionStorage.setItem('salsi_ia_session', '{pas du json');
    assert.equal(load(), null);
    globalThis.sessionStorage.setItem('salsi_ia_session', JSON.stringify({ gitlabUrl: 'x' }));
    assert.equal(load(), null, 'sans jeton ni identité, ce n\'est pas une session');
  });

  test('toSession ne retient que l\'utile', () => {
    const s = toSession('https://g.example.com', 'tok', { ...USER, email: 'secret@example.com' });
    assert.equal(s.username, 'm.dubois');
    assert.ok(!('email' in s), 'aucune donnée personnelle superflue');
  });
});

describe('hubHint — reprise depuis Salsifi', () => {
  test('propose l\'instance du hub mais jamais son jeton', () => {
    globalThis.localStorage.setItem('devops_hub_workspaces', JSON.stringify({
      gitlabUrl: 'https://gitlab.example.com', token: 'glpat-DU-HUB', username: 'm.dubois'
    }));
    const hint = hubHint();
    assert.equal(hint.gitlabUrl, 'https://gitlab.example.com');
    assert.ok(!('token' in hint), 'le jeton du hub ne doit jamais être repris en silence');
    assert.equal(load(), null, 'et aucune session ne s\'ouvre toute seule');
  });

  test('ne dit rien sans session hub', () => assert.equal(hubHint(), null));
});

describe('client GitLab', () => {
  const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

  test('appelle /api/v4/user avec le jeton en en-tête', async () => {
    let seen;
    const client = createClient({ gitlabUrl: 'https://g.example.com', token: 'tok' },
      async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => USER }; });

    assert.equal((await client.currentUser()).username, 'm.dubois');
    assert.equal(seen.url, 'https://g.example.com/api/v4/user');
    assert.equal(seen.opts.headers['PRIVATE-TOKEN'], 'tok');
  });

  test('traduit les codes HTTP en phrases actionnables', async () => {
    for (const [status, motif] of [[401, /invalide/], [403, /portée/], [404, /Aucune API/], [500, /serveur/]]) {
      const client = createClient({ gitlabUrl: 'https://g.example.com', token: 'tok' },
        async () => ({ ok: false, status }));
      await assert.rejects(() => client.currentUser(), (e) => e instanceof GitlabError && motif.test(e.message));
    }
  });

  test('un échec réseau dit quoi vérifier, pas « failed to fetch »', async () => {
    const client = createClient({ gitlabUrl: 'https://g.example.com', token: 'tok' },
      async () => { throw new TypeError('Failed to fetch'); });
    await assert.rejects(() => client.currentUser(), (e) => e.status === 0 && /VPN|CORS/.test(e.message));
  });

  test('listProjects se limite aux dépôts dont l\'utilisateur est membre', async () => {
    let seen;
    const client = createClient({ gitlabUrl: 'https://g.example.com', token: 'tok' },
      async (url) => { seen = url; return { ok: true, status: 200, json: async () => [] }; });

    await client.listProjects({ search: 'demo' });
    const params = new URL(seen).searchParams;
    assert.equal(params.get('membership'), 'true');
    assert.equal(params.get('search'), 'demo');
  });

  test('exige une instance et un jeton', () => {
    assert.throws(() => createClient({ gitlabUrl: '', token: '' }), /gitlabUrl et token/);
  });
});
