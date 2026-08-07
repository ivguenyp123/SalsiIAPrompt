/*
 * Le connecteur Vertex.
 *
 * ── CE QU'ON VÉRIFIE SANS APPELER GOOGLE ─────────────────────────────────────
 *
 * Tout, sauf la réponse du modèle. Le JWT est signé pour de vrai avec une paire de clés
 * générée ici et VÉRIFIÉ avec la clé publique : si la signature était mal formée, aucun
 * test ne le dirait avant le premier appel réel, c'est-à-dire devant l'utilisateur.
 *
 * `fetch` et l'horloge sont injectés. Sans ça, la mise en cache du jeton — la seule
 * optimisation de ce fichier, et celle qui évite mille allers-retours pendant un banc
 * d'essai — ne serait vérifiable qu'en attendant une heure.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { createVertex, identifiants, signer, modelePour, cout, VertexError } from '../runtime/vertex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const models = yaml.load(readFileSync(join(ROOT, 'registries/models.yaml'), 'utf8')).models;

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});

const CLE = { client_email: 'salsi@projet.iam.gserviceaccount.com', private_key: privateKey,
              project_id: 'lcl-ia-preprod' };
const ENV = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(CLE), VERTEX_LOCATION: 'europe-west9' };
const T0 = 1_754_000_000_000;

/** Un `fetch` simulé qui enregistre ce qu'on lui demande. */
function forge({ token = { access_token: 'jeton-1', expires_in: 3600 }, generate } = {}) {
  const appels = [];
  const fetchImpl = async (url, init) => {
    appels.push({ url, init });
    if (url.includes('oauth2.googleapis.com')) {
      return { ok: !token.error, status: token.error ? 401 : 200, json: async () => token };
    }
    const rep = typeof generate === 'function' ? generate(JSON.parse(init.body)) : generate;
    return { ok: !rep?.error, status: rep?.status || (rep?.error ? 400 : 200), json: async () => rep };
  };
  return { fetchImpl, appels };
}

const REPONSE_OK = {
  candidates: [{ content: { parts: [{ text: '## À quoi ça sert\nÀ basculer le thème.' }] },
                 finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 180 }
};

/* ── Les identifiants ──────────────────────────────────────────────────────── */

describe('les identifiants viennent de l\'environnement, jamais du dépôt', () => {
  test('la clé peut être dans la variable', () => {
    const ids = identifiants(ENV);
    assert.equal(ids.email, CLE.client_email);
    assert.equal(ids.project, 'lcl-ia-preprod');
    assert.equal(ids.region, 'europe-west9');
  });

  test('ou dans un fichier — les deux conventions existent pour de vrai', () => {
    // Un runner de CI passe la clé en variable, un poste pointe un fichier. Refuser
    // l'une des deux ferait recopier la clé quelque part, donc la ferait fuiter.
    const ids = identifiants({ GOOGLE_APPLICATION_CREDENTIALS: '/cle.json' },
                             () => JSON.stringify(CLE));
    assert.equal(ids.email, CLE.client_email);
  });

  test('la région a un défaut, le projet non', () => {
    assert.equal(identifiants({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(CLE) }).region, 'europe-west1');
    const sansProjet = { ...CLE }; delete sansProjet.project_id;
    assert.throws(() => identifiants({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(sansProjet) }),
      /VERTEX_PROJECT/);
  });

  test('les messages d\'erreur disent quoi faire, pas juste ce qui manque', () => {
    assert.throws(() => identifiants({}), /GOOGLE_SERVICE_ACCOUNT_JSON/);
    assert.throws(() => identifiants({ GOOGLE_SERVICE_ACCOUNT_JSON: 'pas du json' }), /JSON de la clé/);
    assert.throws(() => identifiants({ GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"a"}' }),
      /private_key/);
  });
});

/* ── La signature ──────────────────────────────────────────────────────────── */

describe('le JWT est signé pour de vrai', () => {
  const jwt = signer({ email: CLE.client_email, cle: privateKey }, T0);
  const [entete, corps, signature] = jwt.split('.');
  const lire = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

  test('la signature se vérifie avec la clé publique', () => {
    // LE test de ce fichier. Une signature mal formée ne se verrait qu'au premier appel
    // réel, c'est-à-dire devant l'utilisateur, sous la forme d'un 401 inexplicable.
    const v = createVerify('RSA-SHA256').update(`${entete}.${corps}`).end();
    assert.ok(v.verify(publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64')));
  });

  test('l\'en-tête annonce RS256, seul algorithme que Google accepte ici', () => {
    assert.deepEqual(lire(entete), { alg: 'RS256', typ: 'JWT' });
  });

  test('les revendications visent le bon public et la bonne portée', () => {
    const c = lire(corps);
    assert.equal(c.iss, CLE.client_email);
    assert.equal(c.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(c.scope, 'https://www.googleapis.com/auth/cloud-platform');
    assert.equal(c.exp - c.iat, 3600);
    assert.equal(c.iat, Math.floor(T0 / 1000));
  });

  test('rien dans le JWT ne contient la clé privée', () => {
    assert.ok(!jwt.includes('PRIVATE KEY'));
    assert.ok(!Buffer.from(corps, 'base64').toString().includes('PRIVATE'));
  });
});

/* ── Le palier ─────────────────────────────────────────────────────────────── */

describe('le palier déclaré, et le modèle réel derrière', () => {
  test('chaque palier du registre se résout', () => {
    for (const m of models) assert.equal(modelePour(m.tier, models, {}), m.vertex);
  });

  test('un palier inconnu retombe sur `mid` plutôt que d\'exploser', () => {
    // Un artefact écrit à la main dans le dépôt peut porter n'importe quoi : mieux vaut
    // le palier par défaut qu'un plantage à l'exécution.
    assert.equal(modelePour('gigantesque', models, {}), modelePour('mid', models, {}));
    assert.equal(modelePour(undefined, models, {}), modelePour('mid', models, {}));
  });

  test('une variable d\'environnement force un modèle, pour une montée de version', () => {
    // C'est ce qui permet de rejouer les cas d'or sur un modèle candidat sans toucher
    // aux 200 artefacts.
    assert.equal(modelePour('mid', models, { VERTEX_MODEL_MID: 'gemini-3-pro' }), 'gemini-3-pro');
  });

  test('sans registre du tout, on refuse plutôt que de deviner un nom de modèle', () => {
    assert.throws(() => modelePour('mid', [], {}), VertexError);
  });
});

/* ── Le client ─────────────────────────────────────────────────────────────── */

describe('un appel complet', () => {
  test('le jeton est échangé puis le modèle appelé', async () => {
    const { fetchImpl, appels } = forge({ generate: REPONSE_OK });
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => T0 });
    const r = await v.generer({ prompt: 'explique', tier: 'small' });

    assert.equal(appels.length, 2);
    assert.match(appels[0].url, /oauth2\.googleapis\.com/);
    assert.match(appels[1].url, /europe-west9-aiplatform\.googleapis\.com/);
    assert.match(appels[1].url, /projects\/lcl-ia-preprod\/locations\/europe-west9/);
    assert.match(appels[1].url, /gemini-2\.5-flash:generateContent$/);
    assert.equal(appels[1].init.headers.Authorization, 'Bearer jeton-1');
    assert.equal(JSON.parse(appels[1].init.body).contents[0].parts[0].text, 'explique');

    assert.match(r.texte, /basculer le thème/);
    assert.deepEqual(r.jetons, { entree: 1200, sortie: 180 });
  });

  test('le jeton est réutilisé — un banc d\'essai en ferait mille sinon', () => {
    // 5 exécutions × 200 artefacts = 1000 allers-retours d'authentification pour rien.
    const { fetchImpl, appels } = forge({ generate: REPONSE_OK });
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => T0 });
    return v.generer({ prompt: 'a' })
      .then(() => v.generer({ prompt: 'b' }))
      .then(() => {
        assert.equal(appels.filter((a) => a.url.includes('oauth2')).length, 1);
        assert.equal(appels.length, 3);
      });
  });

  test('mais il est redemandé quand il expire', async () => {
    const { fetchImpl, appels } = forge({ generate: REPONSE_OK });
    let maintenant = T0;
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => maintenant });
    await v.generer({ prompt: 'a' });
    maintenant = T0 + 3_600_000;                    // une heure plus tard
    await v.generer({ prompt: 'b' });
    assert.equal(appels.filter((a) => a.url.includes('oauth2')).length, 2);
  });

  test('un refus d\'authentification dit quoi vérifier', async () => {
    // « 401 » tout seul envoie chercher pendant une heure du côté du réseau.
    const { fetchImpl } = forge({ token: { error: 'unauthorized_client',
                                           error_description: 'Client is unauthorized' } });
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => T0 });
    await assert.rejects(() => v.generer({ prompt: 'a' }), (e) => {
      assert.equal(e.status, 401);
      assert.match(e.message, /Utilisateur Vertex AI/);
      return true;
    });
  });

  test('une réponse vide est une erreur, pas une sortie vide', async () => {
    // Sinon un cas d'or échouerait sur « la sortie ne respecte pas la convention » au
    // lieu de « le modèle n'a rien répondu, et voilà pourquoi ».
    const { fetchImpl } = forge({ generate: { candidates: [{ finishReason: 'SAFETY' }] } });
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => T0 });
    await assert.rejects(() => v.generer({ prompt: 'a' }), /filtre de sécurité/);
  });

  test('une erreur de l\'API garde le message de Google', async () => {
    const { fetchImpl } = forge({ generate: { error: { message: 'Quota exceeded' }, status: 429 } });
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => T0 });
    await assert.rejects(() => v.generer({ prompt: 'a' }), /Quota exceeded/);
  });

  test('aucun identifiant ne transite dans le corps de l\'appel au modèle', async () => {
    const { fetchImpl, appels } = forge({ generate: REPONSE_OK });
    const v = createVertex({ env: ENV, models, fetchImpl, now: () => T0 });
    await v.generer({ prompt: 'a' });
    assert.ok(!appels[1].init.body.includes('PRIVATE'));
    assert.ok(!appels[1].init.body.includes(CLE.client_email));
  });
});

/* ── Le coût ───────────────────────────────────────────────────────────────── */

describe('ce que l\'appel a coûté', () => {
  test('se calcule depuis le registre, pas depuis une constante cachée', () => {
    const c = cout({ tier: 'large', jetons: { entree: 1_000_000, sortie: 100_000 } }, models);
    assert.equal(c, 1.25 + 1.0);
  });

  test('un palier sans tarif rend `null`, pas zéro', () => {
    // Zéro serait une mesure : « cet appel n'a rien coûté ». `null` dit qu'on ne sait pas.
    assert.equal(cout({ tier: 'inconnu', jetons: { entree: 10, sortie: 10 } }, models), null);
    assert.equal(cout({ tier: 'mid' }, models), null);
  });

  test('le registre des modèles couvre tous les paliers que les artefacts déclarent', () => {
    // Un artefact qui déclarerait un palier absent du registre tomberait sur le défaut
    // sans que personne le sache — et paierait le prix d'un autre modèle.
    const paliers = new Set(models.map((m) => m.tier));
    for (const t of ['nano', 'small', 'mid', 'large']) assert.ok(paliers.has(t), t);
  });
});
