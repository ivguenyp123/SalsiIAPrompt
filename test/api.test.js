/*
 * Le point d'entrée d'exécution.
 *
 * C'est le seul morceau du produit qui tourne côté serveur, et le seul qui touche à une
 * clé. Deux familles de propriétés, et la seconde compte plus que la première :
 *
 *   1. il exécute — l'artefact part au modèle, le contrat est évalué, le coût remonte
 *   2. il ne relâche RIEN — le pré-vol tourne, la confirmation reste obligatoire, aucun
 *      chemin ne vient de la requête, et ni le prompt ni la clé ne repartent vers la page
 *
 * Un point d'entrée qui relâcherait les contrôles « parce qu'il est côté serveur »
 * rendrait tout le moment 4 décoratif : il suffirait d'appeler l'API au lieu de cliquer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { executer, etat, DOSSIERS, ID_VALIDE } from '../runtime/api.js';
import { VertexError } from '../runtime/vertex.js';
import { chemin } from '../lib/entrees.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

const registres = {
  tools: lire('registries/tools.yaml').tools,
  targets: lire('registries/targets.yaml').targets,
  entrees: lire('entrees/index.yaml'),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const models = lire('registries/models.yaml').models;

/** Un Vertex simulé qui note ce qu'il a reçu. */
const fauxVertex = (texte = '## À quoi ça sert\nÀ tester.') => {
  const vu = {};
  return { vu, project: 'p', region: 'r', modele: () => 'gemini-test',
           generer: async ({ prompt, tier }) => { vu.prompt = prompt; vu.tier = tier;
             return { texte, modele: 'gemini-test', tier,
                      jetons: { entree: 900, sortie: 40 }, motifArret: 'STOP' }; } };
};

const deps = (extra = {}) => ({
  registres, models, banque: registres.entrees,
  charger: (id, dossiers) => {
    const p = dossiers.map((d) => `${d}/${id}.yaml`)
      .find((r) => { try { readFileSync(join(ROOT, r)); return true; } catch { return false; } });
    return p ? lire(p) : null;
  },
  lireEntree: (e) => readFileSync(join(ROOT, chemin(e)), 'utf8'),
  creerVertex: () => fauxVertex(),
  ...extra
});

const REQUETE = { id: 'expliquer-un-code', cas: 'gc-01-module-court',
                  sensibilite: 'interne', criticite: 'test' };

/* ── 1. Il exécute ─────────────────────────────────────────────────────────── */

describe('l\'écran obtient une sortie et un verdict', () => {
  test('un cas d\'or se rejoue de bout en bout', async () => {
    const v = fauxVertex();
    const { status, corps } = await executer(REQUETE, deps({ creerVertex: () => v }));

    assert.equal(status, 200);
    assert.equal(corps.refuse, false);
    assert.equal(corps.cas, 'gc-01-module-court');
    // La banque a été LUE : le vrai fichier est entré dans le prompt.
    assert.match(v.vu.prompt, /basculer|thème|theme|const/i);
    assert.ok(v.vu.prompt.length > 1000, 'le module réel fait plus de mille caractères');
    assert.equal(v.vu.tier, 'small', 'le palier vient de l\'artefact');
  });

  test('le contrat est évalué, avec les valeurs réelles', async () => {
    const { corps } = await executer(REQUETE, deps());
    assert.equal(corps.postvol.conforme, true);
    const longueur = corps.postvol.constats.find((c) => c.cible === 'output.length');
    assert.equal(typeof longueur.valeur, 'number');
    assert.equal(longueur.verdict, 'satisfait');
  });

  test('une sortie qui viole le contrat n\'est pas maquillée en succès', async () => {
    const { status, corps } = await executer(REQUETE,
      deps({ creerVertex: () => fauxVertex('aucune section, juste du texte') }));
    assert.equal(status, 200, 'ce n\'est pas une erreur d\'API : l\'appel a réussi');
    assert.equal(corps.postvol.conforme, false);
    assert.equal(corps.postvol.violes[0].cible, 'output.sections');
  });

  test('le coût remonte avec la sortie', async () => {
    // Une sortie sans son coût rend le FinOps impossible à reconstituer après coup.
    const { corps } = await executer(REQUETE, deps());
    assert.deepEqual(corps.jetons, { entree: 900, sortie: 40 });
    assert.equal(typeof corps.cout, 'number');
  });

  test('les valeurs de l\'écran l\'emportent sur celles du cas d\'or', async () => {
    // Sinon rejouer un cas rendrait le formulaire inopérant sans le dire.
    const v = fauxVertex();
    await executer({ ...REQUETE, valeurs: { repo: 'mon-vrai-depot' } },
                   deps({ creerVertex: () => v }));
    assert.match(v.vu.prompt, /dépôt mon-vrai-depot/);
  });
});

/* ── 2. Il ne relâche rien ─────────────────────────────────────────────────── */

describe('aucun contrôle ne saute parce qu\'on passe par l\'API', () => {
  test('la confirmation humaine reste obligatoire pour ce qui écrit', async () => {
    // C'est LE test. Si l'API contournait P007, il suffirait d'appeler l'API au lieu de
    // cliquer, et « l'humain valide » redeviendrait une intention.
    const req = { id: 'prep-delivery', sensibilite: 'interne', criticite: 'test',
                  valeurs: { repo: 'demo', stack: 'java' } };
    const sans = await executer(req, deps());
    assert.equal(sans.status, 409);
    assert.equal(sans.corps.refuse, true);
    assert.match(sans.corps.raison, /confirmation humaine/);
    assert.ok(sans.corps.raisons.some((c) => c.code === 'P007'));

    const avec = await executer({ ...req, assume: true }, deps());
    assert.equal(avec.status, 200);
  });

  test('`assume` n\'a aucune valeur par défaut permissive', async () => {
    // Une chaîne, un 1, un objet : rien d'autre que `true` ne doit ouvrir la porte.
    const req = { id: 'prep-delivery', sensibilite: 'interne',
                  valeurs: { repo: 'demo', stack: 'java' } };
    for (const valeur of ['oui', 'true', 1, {}, [], 'assume']) {
      const r = await executer({ ...req, assume: valeur }, deps());
      assert.equal(r.status, 409, `assume=${JSON.stringify(valeur)} a ouvert la porte`);
    }
  });

  test('un artefact qui ne franchit plus la porte est refusé avant tout appel', async () => {
    let appele = false;
    const v = { ...fauxVertex(), generer: async () => { appele = true; return { texte: 'x' }; } };
    const casse = { ...lire('artifacts/expliquer-un-code.yaml'), criteria: [] };
    const r = await executer(REQUETE, deps({ charger: () => casse, creerVertex: () => v }));
    assert.equal(r.status, 409);
    assert.match(r.corps.raison, /P001/);
    assert.equal(appele, false, 'rien n\'a été dépensé');
  });

  test('aucun chemin ne vient de la requête', async () => {
    // L'identifiant sert à CHOISIR un fichier dans une liste de dossiers connus, jamais
    // à en composer un.
    for (const id of ['../../etc/passwd', '/etc/passwd', 'a/../b', 'A-MAJUSCULE', '', '.']) {
      const r = await executer({ id }, deps());
      assert.equal(r.status, 400, `\`${id}\` n'a pas été refusé`);
    }
    assert.ok(ID_VALIDE.test('expliquer-un-code'));
    assert.deepEqual(DOSSIERS, ['artifacts', 'artifacts/pending', 'artifacts/retires']);
  });

  test('le prompt ne repart JAMAIS vers la page', async () => {
    // Il contient le spec — que le catalogue masque volontairement — et la matière
    // injectée, qui peut venir d'un dépôt confidentiel. Le renvoyer par confort de
    // débogage le ferait fuiter dans la console de tout le monde.
    const { corps } = await executer(REQUETE, deps());
    assert.equal(corps.prompt, undefined);
    const json = JSON.stringify(corps);
    assert.ok(!json.includes('Structure ta réponse'), 'le spec ne doit pas transiter');
  });
});

/* ── 3. Il dit ce qui ne va pas ────────────────────────────────────────────── */

describe('les erreurs se distinguent les unes des autres', () => {
  test('artefact inconnu : 404, pas 500', async () => {
    const r = await executer({ id: 'nexiste-pas' }, deps({ charger: () => null }));
    assert.equal(r.status, 404);
  });

  test('cas d\'or inconnu : 400, et on le dit', async () => {
    const r = await executer({ id: 'expliquer-un-code', cas: 'gc-99' }, deps());
    assert.equal(r.status, 400);
    assert.match(r.corps.erreur, /gc-99/);
  });

  test('entrée absente de la banque : 409, pas un prompt sur du vide', async () => {
    const art = lire('artifacts/expliquer-un-code.yaml');
    art.golden_cases[0].context.code_fixture = 'fantome';
    const r = await executer(REQUETE, deps({ charger: () => art }));
    assert.equal(r.status, 409);
    assert.match(r.corps.erreur, /absente de la banque/);
  });

  test('plateforme non configurée : 503, avec ce qu\'il faut poser', async () => {
    const r = await executer(REQUETE, deps({ creerVertex: () => {
      throw new VertexError('Aucun identifiant Vertex : renseigne GOOGLE_SERVICE_ACCOUNT_JSON…', 0);
    } }));
    assert.equal(r.status, 503);
    assert.match(r.corps.erreur, /GOOGLE_SERVICE_ACCOUNT_JSON/);
  });

  test('le statut de Vertex est relayé, pas aplati', async () => {
    // Un quota et une clé refusée ne se corrigent pas de la même façon : afficher
    // « échec » pour les deux ferait chercher au mauvais endroit.
    const r = await executer(REQUETE, deps({ creerVertex: () => ({
      ...fauxVertex(), generer: async () => { throw new VertexError('Quota exceeded', 429); } }) }));
    assert.equal(r.status, 429);
    assert.match(r.corps.erreur, /Quota/);
  });
});

describe('l\'état, pour que l\'écran ne propose pas un bouton qui échouera', () => {
  test('configuré : il annonce le projet et les paliers', () => {
    const e = etat({ creerVertex: () => fauxVertex(), models });
    assert.equal(e.pret, true);
    assert.equal(e.projet, 'p');
    assert.equal(e.paliers.length, models.length);
  });

  test('non configuré : il dit quoi poser', () => {
    const e = etat({ creerVertex: () => { throw new VertexError('renseigne VERTEX_PROJECT', 0); },
                     models });
    assert.equal(e.pret, false);
    assert.match(e.raison, /VERTEX_PROJECT/);
  });

  test('il ne rend jamais rien qui ressemble à un identifiant', () => {
    const e = etat({ creerVertex: () => fauxVertex(), models });
    const json = JSON.stringify(e);
    for (const mot of ['private', 'PRIVATE', 'key', 'token', 'assertion']) {
      assert.ok(!json.includes(mot), `« ${mot} » ne doit pas sortir de l'état`);
    }
  });
});
