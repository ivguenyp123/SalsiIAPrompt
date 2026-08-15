/*
 * L'aide à la validation — un conseil, jamais un verdict.
 *
 * Le risque de cette fonctionnalité n'est pas qu'elle se trompe : c'est qu'on la croie.
 * Un conseil souvent juste finit par être tamponné sans lecture, et le jour où il se
 * trompe, c'est LUI qui aura validé sans que personne puisse le dire.
 *
 * D'où ce que ces tests verrouillent : un constat sans ses deux citations est jeté, une
 * citation qui n'existe pas dans le fichier est jetée, et « aucune contradiction » ne se
 * confond jamais avec « le modèle n'a rien rendu ».
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { consigne, extraireJson, retenir, relire } from '../runtime/coherence.js';
import { coherence } from '../runtime/api.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTEFACT = yaml.load(readFileSync(join(ROOT, 'artifacts/optimiser-une-requete-sql.yaml'), 'utf8'));

const moteurDePapier = (texte) => {
  const vus = [];
  return { vus, fournisseur: 'papier',
           generer: async ({ prompt, temperature }) => {
             vus.push({ prompt, temperature });
             return { texte, modele: 'papier', jetons: { entree: 10, sortie: 5 } };
           } };
};

/* ── La consigne ──────────────────────────────────────────────────────────── */

describe('la consigne', () => {
  const c = consigne(ARTEFACT);

  test('montre les déclarations à confronter entre elles', () => {
    assert.ok(c.includes(ARTEFACT.title));
    assert.ok(c.includes(ARTEFACT.intent.purpose.slice(0, 40)));
    assert.ok(c.includes(ARTEFACT.spec.slice(0, 40)));
    for (const v of ARTEFACT.variables) assert.ok(c.includes(v.name), v.name);
  });

  test('interdit le jugement de qualité', () => {
    // « Cet agent est-il bon » est sans réponse : un modèle à qui on le demande invente
    // une note, et une note inventée dans un écran de validation est un poison.
    assert.match(c, /Tu ne juges PAS sa qualité/);
    assert.match(c, /CONTREDIT LUI-MÊME/);
  });

  test('exige deux citations exactes, et le dit deux fois', () => {
    assert.match(c, /extraits COPIÉS du fichier/);
    assert.match(c, /Sans les deux, ne rends pas le constat/);
  });

  test('dit qu\'aucune contradiction est une bonne réponse', () => {
    // Sans ça, le modèle en invente une pour avoir quelque chose à dire.
    assert.match(c, /C'est une bonne réponse/);
    assert.match(c, /N'INVENTE PAS/);
  });

  test('écarte ce qui est déjà l\'affaire des règles', () => {
    assert.match(c, /ni le style, ni la longueur, ni ce qui manque/);
  });
});

/* ── Le tri, qui est le vrai garde-fou ────────────────────────────────────── */

describe('les constats retenus', () => {
  const vrai = {
    ou: 'purpose vs spec',
    cite_a: ARTEFACT.intent.purpose.slice(0, 60),
    cite_b: ARTEFACT.spec.slice(0, 60),
    pourquoi: 'Les deux ne tiennent pas ensemble.'
  };

  test('un constat complet et cité passe', () => {
    const r = retenir([vrai], ARTEFACT);
    assert.equal(r.constats.length, 1);
    assert.equal(r.jetes.length, 0);
  });

  test('sans ses deux citations, il est JETÉ', () => {
    // C'est ce qui empêche le relecteur de tamponner sans lire : on ne tamponne pas deux
    // extraits qu'on a sous les yeux.
    for (const partiel of [{ ...vrai, cite_b: '' }, { ...vrai, cite_a: '' },
                           { ...vrai, pourquoi: '' }, { ou: 'x' }]) {
      const r = retenir([partiel], ARTEFACT);
      assert.equal(r.constats.length, 0);
      assert.equal(r.jetes.length, 1);
    }
  });

  test('une citation absente du fichier est JETÉE', () => {
    /*
     * Le signe d'une contradiction inventée — et c'est exactement ce qu'on ne veut pas
     * montrer à quelqu'un qui s'apprête à valider.
     */
    const r = retenir([{ ...vrai, cite_b: 'ceci ne figure nulle part dans cet artefact' }], ARTEFACT);
    assert.equal(r.constats.length, 0);
    assert.match(r.jetes[0].raison, /absente du fichier/);
  });

  test('l\'indentation et la casse ne font pas jeter un constat juste', () => {
    // Un modèle recopie le fond fidèlement et réindente. Refuser sur un retour à la ligne
    // jetterait des constats vrais.
    const r = retenir([{ ...vrai, cite_a: `  ${vrai.cite_a.toUpperCase()}\n ` }], ARTEFACT);
    assert.equal(r.constats.length, 1);
  });

  test('une citation trop longue est jetée', () => {
    // On doit pouvoir la confronter au fichier d'un coup d'œil, sinon on tamponne.
    const r = retenir([{ ...vrai, cite_a: ARTEFACT.spec }], ARTEFACT);
    assert.equal(r.constats.length, 0);
  });

  test('n\'importe quoi en entrée ne casse rien', () => {
    for (const rien of [null, undefined, 'texte', 42, [null], [{}]]) {
      assert.equal(retenir(rien, ARTEFACT).constats.length, 0);
    }
  });
});

/* ── La lecture de la réponse ─────────────────────────────────────────────── */

describe('extraire le JSON', () => {
  test('accepte un bloc clôturé', () => {
    assert.deepEqual(extraireJson('```json\n{"constats":[]}\n```'), { constats: [] });
  });
  test('accepte du bavardage autour', () => {
    assert.deepEqual(extraireJson('Voici :\n{"constats":[]}\nVoilà.'), { constats: [] });
  });
  test('rend `null` sur du non-JSON, sans exploser', () => {
    assert.equal(extraireJson('je ne peux pas'), null);
    assert.equal(extraireJson(''), null);
  });
});

/* ── Le tout ──────────────────────────────────────────────────────────────── */

describe('relire', () => {
  test('« aucune contradiction » ne se confond pas avec « rien de lisible »', async () => {
    /*
     * Les confondre ferait passer une PANNE pour un feu vert — la pire faute possible
     * pour un écran de validation.
     */
    const vide = await relire(ARTEFACT, { moteur: moteurDePapier('{"constats":[]}') });
    assert.equal(vide.aucune, true);
    assert.equal(vide.illisible, false);

    const cassee = await relire(ARTEFACT, { moteur: moteurDePapier('je ne peux pas') });
    assert.equal(cassee.aucune, false);
    assert.equal(cassee.illisible, true);
  });

  test('demande une température de 0', () => {
    // Une relecture qui change d'avis d'un appel à l'autre ne se compare pas, et un
    // relecteur qui relance jusqu'à obtenir « rien » a gagné pour de mauvaises raisons.
    const m = moteurDePapier('{"constats":[]}');
    return relire(ARTEFACT, { moteur: m }).then(() => {
      assert.equal(m.vus[0].temperature, 0);
    });
  });

  test('un constat inventé n\'atteint jamais l\'écran', async () => {
    const r = await relire(ARTEFACT, { moteur: moteurDePapier(JSON.stringify({ constats: [
      { ou: 'x', cite_a: 'inventé de toutes pièces', cite_b: 'aussi', pourquoi: 'parce que' }
    ] })) });
    assert.equal(r.constats.length, 0);
    assert.equal(r.jetes.length, 1);
    assert.equal(r.aucune, false, 'ce n\'est pas « aucune contradiction » : c\'est un rejet');
  });
});

describe('POST /api/coherence', () => {
  const deps = (moteur) => ({ creerVertex: () => moteur });

  test('refuse un artefact illisible', async () => {
    for (const rien of [{}, { artefact: null }, { artefact: { id: 'x' } }]) {
      const { status } = await coherence(rien, deps(moteurDePapier('{}')));
      assert.equal(status, 400);
    }
  });

  test('sans moteur : 503, et le message dit quoi poser', async () => {
    const { status, corps } = await coherence({ artefact: ARTEFACT },
      { creerVertex: () => { throw new Error('Aucune clé DeepSeek : renseigne DEEPSEEK_API_KEY.'); } });
    assert.equal(status, 503);
    assert.match(corps.erreur, /DEEPSEEK_API_KEY/);
  });

  test('ne rend jamais de verdict, seulement des constats', async () => {
    // Rien de ce qui sort d'ici ne doit pouvoir faire ACCEPTER quelque chose.
    const { corps } = await coherence({ artefact: ARTEFACT },
      deps(moteurDePapier('{"constats":[]}')));
    const texte = JSON.stringify(corps);
    for (const mot of ['valide', 'accepte', 'conforme', 'score', 'note']) {
      assert.ok(!new RegExp(`"${mot}"`).test(texte), `« ${mot} » n'a rien à faire ici`);
    }
    assert.equal(corps.aucune, true);
  });

  test('ne renvoie pas la consigne à la page', async () => {
    const { corps } = await coherence({ artefact: ARTEFACT },
      deps(moteurDePapier('{"constats":[]}')));
    assert.ok(!JSON.stringify(corps).includes('Tu ne juges PAS'));
  });
});
