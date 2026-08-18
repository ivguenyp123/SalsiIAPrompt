/*
 * Le second fournisseur, et ce qu'il prouve.
 *
 * ── LA PROPRIÉTÉ QUI COMPTE ──────────────────────────────────────────────────
 *
 * Ce n'est pas « DeepSeek répond ». C'est que le brancher n'a demandé AUCUNE modification
 * à une règle, un contrôle, un critère ou un artefact. Un registre de capacités IA qui ne
 * saurait parler qu'à un fournisseur serait périmé au premier appel d'offres — et à LCL,
 * le fournisseur se décide bien au-dessus de l'équipe qui écrit les agents.
 *
 * Les tests ci-dessous vérifient donc surtout des FRONTIÈRES : le même artefact part chez
 * l'un ou chez l'autre sans rien changer, le tarif de l'un ne s'applique pas à l'autre,
 * et personne ne peut ignorer qui a répondu.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { createDeepseek, identifiantsDeepseek, modeleDeepseek } from '../runtime/deepseek.js';
import { createMoteur, fournisseurChoisi, FOURNISSEURS } from '../runtime/moteur.js';
import { cout, VertexError } from '../runtime/vertex.js';
import { lancer } from '../runtime/lancer.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lireY = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));
const registreModeles = lireY('registries/models.yaml');
const models = registreModeles.models;
const fournisseurs = registreModeles.fournisseurs || {};

const ENV = { DEEPSEEK_API_KEY: 'sk-secrete' };

const REPONSE = {
  choices: [{ message: { content: '## À quoi ça sert\nÀ tester.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1500, completion_tokens: 120 }
};

function forge(rep = REPONSE, status = 200) {
  const appels = [];
  return { appels, fetchImpl: async (url, init) => {
    appels.push({ url, init });
    return { ok: status < 400, status, json: async () => rep };
  } };
}

/* ── Le client ─────────────────────────────────────────────────────────────── */

describe('DeepSeek répond, et se comporte comme l\'autre', () => {
  test('un appel part au bon endroit, avec la clé en en-tête', async () => {
    const { fetchImpl, appels } = forge();
    const d = createDeepseek({ env: ENV, models, fetchImpl });
    const r = await d.generer({ prompt: 'explique', tier: 'small' });

    assert.equal(appels[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(appels[0].init.headers.Authorization, 'Bearer sk-secrete');
    const corps = JSON.parse(appels[0].init.body);
    assert.equal(corps.model, 'deepseek-chat');
    assert.equal(corps.messages[0].content, 'explique');
    assert.equal(corps.stream, false, 'le flux compliquerait tout pour rien ici');

    assert.match(r.texte, /À tester/);
    assert.deepEqual(r.jetons, { entree: 1500, sortie: 120 });
    assert.equal(r.fournisseur, 'deepseek');
  });

  test('la réponse rend la MÊME forme que Vertex', () => {
    // C'est ce qui permet à `lancer()`, au CLI et à la route de n'avoir aucune branche.
    const attendu = ['texte', 'modele', 'tier', 'fournisseur', 'jetons', 'motifArret'];
    return createDeepseek({ env: ENV, models, fetchImpl: forge().fetchImpl })
      .generer({ prompt: 'x' })
      .then((r) => assert.deepEqual(Object.keys(r).sort(), attendu.sort()));
  });

  test('sans clé, il dit quoi poser — et rappelle l\'autre chemin', () => {
    assert.throws(() => identifiantsDeepseek({}), /DEEPSEEK_API_KEY/);
    assert.throws(() => identifiantsDeepseek({}), /GOOGLE_SERVICE_ACCOUNT_JSON/);
  });

  test('un 402 ne se lit pas comme un 401', () => {
    // « Solde insuffisant » et « clé invalide » ne se corrigent pas au même endroit.
    const d = (s) => createDeepseek({ env: ENV, models, fetchImpl: forge({ error: { message: 'x' } }, s).fetchImpl });
    return Promise.all([
      assert.rejects(() => d(401).generer({ prompt: 'x' }), /DEEPSEEK_API_KEY/),
      assert.rejects(() => d(402).generer({ prompt: 'x' }), /Solde insuffisant/)
    ]);
  });

  test('une réponse coupée par max_tokens le dit', async () => {
    const { fetchImpl } = forge({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
    await assert.rejects(() => createDeepseek({ env: ENV, models, fetchImpl }).generer({ prompt: 'x' }),
      /coupée par max_tokens/);
  });

  test('sur `deepseek-reasoner`, c\'est la RÉPONSE qui est évaluée, pas le raisonnement', async () => {
    // Le raisonnement arrive dans `reasoning_content`. L'évaluer contre le contrat
    // porterait sur des brouillons : un critère de longueur exploserait pour une
    // réponse finale courte.
    const { fetchImpl } = forge({
      choices: [{ message: { reasoning_content: 'x'.repeat(9000), content: 'court' },
                  finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } });
    const r = await createDeepseek({ env: ENV, models, fetchImpl }).generer({ prompt: 'x', tier: 'large' });
    assert.equal(r.texte, 'court');
    assert.equal(r.modele, 'deepseek-reasoner');
  });

  test('une base personnalisée est respectée — proxy d\'entreprise', () => {
    const d = createDeepseek({ env: { ...ENV, DEEPSEEK_BASE: 'https://passerelle.interne/v1/' },
                               models, fetchImpl: forge().fetchImpl });
    assert.equal(d.ou, 'passerelle.interne');
  });
});

/* ── Le choix ──────────────────────────────────────────────────────────────── */

describe('qui répond, et comment on le sait', () => {
  test('le choix explicite l\'emporte', () => {
    assert.equal(fournisseurChoisi({ SALSI_FOURNISSEUR: 'vertex', DEEPSEEK_API_KEY: 'k' }), 'vertex');
    assert.equal(fournisseurChoisi({ SALSI_FOURNISSEUR: 'DeepSeek' }), 'deepseek');
  });

  test('à défaut, la clé présente décide', () => {
    assert.equal(fournisseurChoisi({ DEEPSEEK_API_KEY: 'k' }), 'deepseek');
    assert.equal(fournisseurChoisi({}), 'vertex');
  });

  test('un fournisseur inconnu est refusé, jamais ignoré', () => {
    // L'ignorer ferait partir le prompt chez quelqu'un d'autre que celui qu'on a demandé.
    assert.throws(() => fournisseurChoisi({ SALSI_FOURNISSEUR: 'mistral' }), /mistral/);
    assert.deepEqual(FOURNISSEURS, ['vertex', 'deepseek']);
  });

  test('le moteur annonce toujours QUI il est et OÙ il tape', () => {
    // Dans un registre gouverné, « quel modèle a répondu » est la moitié de ce qu'un
    // auditeur demandera. Aucun client ne doit pouvoir rester anonyme.
    const m = createMoteur({ env: ENV, models, fetchImpl: forge().fetchImpl });
    assert.equal(m.fournisseur, 'deepseek');
    assert.equal(m.ou, 'api.deepseek.com');
    assert.equal(typeof m.modele, 'function');
  });

  test('la clé DeepSeek ne sort jamais du client', () => {
    const m = createMoteur({ env: ENV, models, fetchImpl: forge().fetchImpl });
    assert.ok(!JSON.stringify(Object.keys(m)).includes('cle'));
    assert.ok(!JSON.stringify(m.ou).includes('sk-'));
  });
});

/* ── La frontière ──────────────────────────────────────────────────────────── */

describe('brancher un fournisseur n\'a touché à aucune règle', () => {
  const artefact = lireY('artifacts/expliquer-un-code.yaml');
  const contexte = { registres: {
    tools: lireY('registries/tools.yaml').tools,
    targets: lireY('registries/targets.yaml').targets },
    depot: { path: 'x/y', scope: 'Plateforme', sensibilite: 'interne' }, criticite: 'test' };

  test('le MÊME artefact part chez l\'un ou chez l\'autre, sans rien changer', async () => {
    // L'artefact ne nomme ni modèle ni fournisseur : il déclare un palier. C'est tout
    // l'intérêt du registre des modèles, et ce test est sa démonstration.
    const { fetchImpl, appels } = forge();
    const moteur = createMoteur({ env: ENV, models, fetchImpl });
    const r = await lancer(artefact, { vertex: moteur, models, contexte,
                                       valeurs: { repo: 'demo', code: 'const a = 1;' } });

    assert.equal(r.refuse, false);
    assert.equal(r.modele, 'deepseek-chat', 'palier `small` → modèle DeepSeek');
    assert.equal(r.postvol.conforme, true, 'le contrat s\'évalue pareil');
    assert.match(JSON.parse(appels[0].init.body).messages[0].content, /const a = 1;/);
  });

  test('le coût d\'un appel DeepSeek n\'est PAS celui de Vertex', () => {
    // Le tarif vit sous le fournisseur. Au niveau du palier, il facturerait un appel
    // DeepSeek au prix de Gemini — un coût faux, affiché avec l'aplomb d'un coût mesuré.
    const jetons = { entree: 1_000_000, sortie: 100_000 };
    const v = cout({ tier: 'mid', jetons, fournisseur: 'vertex' }, models);
    const d = cout({ tier: 'mid', jetons, fournisseur: 'deepseek' }, models);
    assert.equal(typeof v, 'number');
    assert.equal(typeof d, 'number');
    assert.notEqual(v, d, 'deux fournisseurs, deux additions');
  });

  test('un palier dont le tarif n\'a PAS été relevé rend `null`, pas zéro', () => {
    /*
     * `large` répond par `deepseek-reasoner`, dont le tarif n'a pas été lu : sur la
     * capture de la grille officielle, l'en-tête des colonnes était hors cadre. Il aurait
     * fallu le DÉDUIRE, et un tarif déduit dans un registre bancaire est exactement le
     * genre de nombre plausible et faux que ce dépôt existe pour empêcher.
     *
     * Absent, l'écran affiche « tarif inconnu ». Zéro afficherait « gratuit ».
     */
    assert.equal(cout({ tier: 'large', jetons: { entree: 1e6, sortie: 1e6 },
                        fournisseur: 'deepseek' }, models), null);
  });

  test('l\'heure de l\'appel change le tarif, et sans heure on prend le plus cher', () => {
    /*
     * DeepSeek facture le DOUBLE en heures pleines — 01:00-04:00 et 06:00-10:00 UTC. Un
     * tarif unique se serait trompé d'un facteur deux la moitié du temps.
     *
     * Sans heure — une estimation avant lancement, un plan de banc — on applique le
     * plein : majorant, jamais minorant. Un coût annoncé sous la réalité dans un outil
     * qui se vend sur le FinOps est pire qu'un coût absent.
     */
    const j = { entree: 1e6, sortie: 1e6 };
    const arg = (quand) => cout({ tier: 'mid', jetons: j, fournisseur: 'deepseek', quand },
                                 models, fournisseurs);
    const plein = arg(new Date('2026-08-18T02:00:00Z'));
    const creux = arg(new Date('2026-08-18T14:00:00Z'));

    assert.equal(plein, 0.44 + 1.32);
    assert.equal(creux, 0.22 + 0.66);
    assert.equal(creux, plein / 2, 'le creux est la moitié du plein, comme la grille le dit');
    assert.equal(arg(null), plein, 'sans heure, le majorant');

    // 04:00 pile n'est plus une heure pleine : « 01:00 - 04:00 » a une borne haute
    // exclue, sinon deux plages contiguës compteraient deux fois la même heure.
    assert.equal(arg(new Date('2026-08-18T04:00:00Z')), creux);
    assert.equal(arg(new Date('2026-08-18T09:59:00Z')), plein);
  });

  test('un tarif inconnu ne devient pas zéro le jour où on le déclare', () => {
    // Le calcul est le même pour tous : seul le tarif change de place.
    const avecTarif = models.map((m) => m.tier === 'mid'
      ? { ...m, tarifs: { ...m.tarifs, deepseek: { entree_mtok: 0.5, sortie_mtok: 1 } } } : m);
    assert.equal(cout({ tier: 'mid', jetons: { entree: 2_000_000, sortie: 1_000_000 },
                        fournisseur: 'deepseek' }, avecTarif), 2);
  });

  test('aucun artefact du registre ne nomme un fournisseur ni un modèle', () => {
    // La propriété de fond : le catalogue survit à un changement de fournisseur.
    const noms = [...models.map((m) => m.vertex), ...models.map((m) => m.deepseek)];
    // Le DOSSIER, jamais une liste à la main : « le catalogue » veut dire tout le
    // catalogue, et une liste figée ne vérifie que ce qu'on a pensé à y mettre.
    for (const f of readdirSync(join(ROOT, 'artifacts')).filter((n) => /\.ya?ml$/.test(n))) {
      /*
       * L'ARTEFACT, pas le fichier brut.
       *
       * La lecture brute attrapait aussi l'EN-TÊTE DE PROVENANCE — « # modele:
       * deepseek-chat via deepseek » — que le Studio écrit pour tracer qui a rédigé quoi.
       * C'est une trace d'origine, en commentaire, que le parseur ignore et qui ne part
       * jamais au modèle. La refuser reviendrait à interdire de dire d'où vient un
       * artefact, pour satisfaire une règle qui parle d'autre chose.
       *
       * Ce que la règle veut dire, et ce qu'on vérifie désormais : le CONTENU — spec,
       * intention, critères — ne nomme ni modèle ni fournisseur, pour que le catalogue
       * survive à un changement de l'un comme de l'autre.
       */
      const contenu = JSON.stringify(yaml.load(readFileSync(join(ROOT, `artifacts/${f}`), 'utf8')));
      for (const n of noms) assert.ok(!contenu.includes(n), `${f} nomme le modèle ${n}`);
      for (const p of FOURNISSEURS) assert.ok(!contenu.toLowerCase().includes(p), `${f} nomme ${p}`);
    }
  });
});
