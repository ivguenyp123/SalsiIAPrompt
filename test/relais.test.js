/*
 * Le repli par le relais — la sortie de secours quand le navigateur refuse la réponse.
 *
 * ── LE JOUR OÙ RIEN NE MARCHAIT PLUS ─────────────────────────────────────────
 *
 * `api.github.com` a renvoyé `Access-Control-Allow-Origin: *;` — un en-tête invalide. Le
 * navigateur a jeté toutes les réponses, plus personne n'a pu se connecter, et AUCUNE
 * ligne de notre code n'y pouvait quoi que ce soit : le refus venait du navigateur, pas de
 * nous. Une journée de test perdue sur un point-virgule chez un tiers.
 *
 * Le relais rend ce cas survivable. Ce qui se vérifie ici est ce qui rend le remède plus
 * sûr que le mal :
 *
 *   LE DIRECT RESTE LA VOIE NORMALE. Le relais ne s'essaie qu'après un échec.
 *   ON NE REPLIE PAS SUR UNE ERREUR HTTP. Un 401 est une réponse, pas une panne.
 *   SANS SERVEUR, RIEN NE CHANGE. L'appli en fichiers statiques se comporte comme avant.
 *   LE STATUT AMONT SURVIT AU VOYAGE. Un 404 relayé reste un 404.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createForge } from '../app/forge.js';

const session = { gitlabUrl: 'https://github.com', token: 'jeton-de-test', username: 'moi' };

/**
 * Un `fetch` qui refuse le direct comme le fait un CORS cassé — en JETANT.
 *
 * C'est le point le plus important de ce faux : le navigateur ne distingue PAS un refus
 * CORS d'une panne réseau. Les deux jettent un `TypeError` sans détail, par conception de
 * la plateforme web. Notre code ne peut donc pas choisir : il réessaie.
 */
const faux = ({ relais }) => {
  const vus = [];
  return { vus, impl: async (url, options = {}) => {
    vus.push(url);
    if (!String(url).startsWith('/api/forge')) throw new TypeError('Failed to fetch');
    if (!relais) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => relais(JSON.parse(options.body)) };
  } };
};

describe('quand le direct passe, le relais n\'existe pas', () => {
  test('aucun appel au relais sur un appel qui aboutit', async () => {
    const vus = [];
    const direct = async (url) => {
      vus.push(url);
      return { ok: true, status: 200, json: async () => ({ login: 'moi', id: 1 }) };
    };
    const u = await createForge(session, direct).currentUser();
    assert.equal(u.username, 'moi');
    assert.equal(vus.length, 1, 'un seul appel : le direct');
    assert.ok(!vus.some((v) => String(v).includes('/api/forge')));
  });

  /*
   * Le garde qui compte le plus. Un 401 est une RÉPONSE : la forge a parlé, le jeton est
   * refusé. Repasser par le relais le rejouerait pour rien, doublerait chaque appel raté
   * et enverrait le jeton une seconde fois pour s'entendre refuser à l'identique.
   */
  test('une erreur HTTP ne déclenche AUCUN repli', async () => {
    const vus = [];
    const refuse = async (url) => {
      vus.push(url);
      return { ok: false, status: 401, json: async () => ({}) };
    };
    await assert.rejects(() => createForge(session, refuse).currentUser(),
      (e) => e.status === 401);
    assert.equal(vus.length, 1, 'on ne réessaie pas ce qui a déjà répondu');
  });
});

describe('quand le navigateur refuse la réponse', () => {
  test('on repasse par le relais, et l\'appel aboutit', async () => {
    const f = faux({ relais: (envoye) => ({
      statut: 200, corps: JSON.stringify({ login: 'daniel', id: 7, name: 'daniel' }),
      _vu: envoye
    }) });
    const u = await createForge(session, f.impl).currentUser();
    assert.equal(u.username, 'daniel');
    assert.deepEqual(f.vus.map((v) => String(v).startsWith('/api/forge')), [false, true],
      'le direct d\'abord, le relais ensuite');
  });

  test('le relais reçoit l\'URL complète et les en-têtes d\'authentification', async () => {
    let envoye = null;
    const f = faux({ relais: (e) => { envoye = e; return { statut: 200, corps: '{"id":1}' }; } });
    await createForge(session, f.impl).projectInfo('moi/demo');
    assert.match(envoye.url, /^https:\/\/api\.github\.com\/repos\/moi\/demo$/);
    assert.equal(envoye.methode, 'GET');
    // Sans l'en-tête, la forge répondrait 401 et le repli ne servirait à rien.
    assert.ok(envoye.entetes.Authorization.includes('jeton-de-test'));
  });

  test('le statut de la forge survit au voyage', async () => {
    // Traduire les erreurs dans le relais ferait deux vocabulaires à maintenir, et le
    // message « jeton refusé » finirait par diverger selon le chemin emprunté.
    const f = faux({ relais: () => ({ statut: 404, corps: '{}' }) });
    await assert.rejects(() => createForge(session, f.impl).projectInfo('moi/absent'),
      (e) => e.status === 404);
  });

  test('un écrit passe aussi, avec son corps', async () => {
    let envoye = null;
    const f = faux({ relais: (e) => { envoye = e; return { statut: 200, corps: '{"id":9}' }; } });
    await createForge(session, f.impl).commenterPullRequest('moi/demo', 3, 'mon avis');
    assert.equal(envoye.methode, 'POST');
    assert.equal(envoye.corps.body, 'mon avis');
    assert.equal(envoye.entetes['Content-Type'], 'application/json');
  });
});

describe('sans serveur, rien ne change', () => {
  /*
   * Le cas de la cible : l'appli servie en fichiers statiques sur un poste, sans `serve.js`.
   * Le relais n'existe pas, le repli échoue, et on doit retomber sur le message d'avant —
   * jamais sur un plantage ni sur un message qui parle d'un relais que personne n'a.
   */
  test('le repli échoue en silence et rend le message de réseau', async () => {
    const f = faux({ relais: null });
    await assert.rejects(() => createForge(session, f.impl).currentUser(), (e) => {
      assert.equal(e.status, 0);
      assert.match(e.message, /Impossible de joindre github\.com/);
      assert.match(e.message, /CORS/);
      return true;
    });
  });

  test('le couple direct+relais est retenté pour une LECTURE, puis on s\'arrête', async () => {
    /*
     * Ce test disait « 2 appels et stop ». Depuis le premier import réel, un jet se
     * réessaie comme un 5xx — lire un pack fait ~18 requêtes en série, et un seul hoquet
     * réseau tuait tout. Ce qui ne change pas : le relais est tenté UNE fois par
     * tentative, jamais en boucle dans une même tentative, et le nombre de tentatives
     * est borné par REESSAIS.
     */
    const f = faux({ relais: null });
    await assert.rejects(() => createForge(session, f.impl).currentUser());
    assert.equal(f.vus.length, 6, '3 tentatives × (direct + relais), et on s\'arrête');
  });

  test('UN HOQUET RÉSEAU SUR UNE LECTURE NE LA TUE PLUS', async () => {
    /*
     * Le défaut du premier import réel : 18 requêtes en série, un fetch qui jette une
     * fois, et « Impossible de joindre » sur une lecture dont 17 dix-huitièmes
     * passaient. Ici : premier direct jette, relais absent, DEUXIÈME tentative réussit.
     */
    let appels = 0;
    const impl = async (u) => {
      if (String(u).startsWith('/api/forge')) throw new Error('pas de serveur');
      appels += 1;
      if (appels === 1) throw new TypeError('failed to fetch');
      return { ok: true, status: 200, json: async () => ({ id: 1, login: 'x' }) };
    };
    const u = await createForge(session, impl).currentUser();
    assert.equal(u.username, 'x');
    assert.equal(appels, 2, 'la deuxième tentative a suffi');
  });

  test('un ÉCRIT qui jette n\'est JAMAIS retenté — deux MR valent pire qu\'une erreur', async () => {
    let posts = 0;
    const impl = async (u, options = {}) => {
      if (String(u).startsWith('/api/forge')) throw new Error('pas de serveur');
      if (options.method === 'POST') { posts += 1; throw new TypeError('failed to fetch'); }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await assert.rejects(
      () => createForge(session, impl).commenterPullRequest('moi/demo', 3, 'avis'),
      (e) => e.status === 0);
    assert.equal(posts, 1, 'un écrit incertain ne se rejoue pas');
  });
});
