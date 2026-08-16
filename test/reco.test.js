/*
 * La recommandation contextuelle.
 *
 * Ce qui se vérifie ici tient en une règle : ON NE PROPOSE RIEN SANS FAIT. Tout le reste
 * du fichier en découle. Une bande « pour toi » qui s'affiche toujours devient un décor —
 * on cesse de la lire, et le jour où elle dit quelque chose d'utile, personne ne le voit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { SIGNAUX, REPONSES, FRAICHEUR_HEURES, ageHeures, ilYA, agentsPour,
         recommander } from '../lib/reco.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = readdirSync(join(ROOT, 'artifacts'))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => yaml.load(readFileSync(join(ROOT, 'artifacts', f), 'utf8')));

/** Un instant fixe : le module n'a pas d'horloge, les tests non plus. */
const MAINTENANT = Date.parse('2026-08-16T12:00:00Z');
const ilYAHeures = (h) => new Date(MAINTENANT - h * 3_600_000).toISOString();

/* ── La règle qui tient tout ──────────────────────────────────────────────── */

describe('rien sans fait', () => {
  test('aucun signal, aucune recommandation', () => {
    assert.deepEqual(recommander([], AGENTS, { maintenant: MAINTENANT }), []);
  });

  test('un signal d\'une nature inconnue est ignoré, pas deviné', () => {
    const r = recommander([{ type: 'humeur-du-lundi', quand: ilYAHeures(1) }], AGENTS,
                          { maintenant: MAINTENANT });
    assert.deepEqual(r, []);
  });

  test('un fait PÉRIMÉ ne se montre pas « en plus petit » : il ne se montre pas', () => {
    const vieux = { type: 'ci-echec', branche: 'main', quand: ilYAHeures(FRAICHEUR_HEURES + 1) };
    assert.deepEqual(recommander([vieux], AGENTS, { maintenant: MAINTENANT }), []);

    const frais = { ...vieux, quand: ilYAHeures(FRAICHEUR_HEURES - 1) };
    assert.equal(recommander([frais], AGENTS, { maintenant: MAINTENANT }).length, 1);
  });

  test('sans agent au registre, on se tait plutôt que d\'approximer', () => {
    /*
     * La table dit ce qui AIDERAIT ; le registre dit ce qui EXISTE. Proposer un agent
     * vaguement proche parce qu'on n'a pas le bon, c'est envoyer quelqu'un vers un outil
     * qui ne fait pas le travail — et lui apprendre à ignorer la bande.
     */
    assert.deepEqual(
      recommander([{ type: 'ci-echec', branche: 'main', quand: ilYAHeures(1) }], [],
                  { maintenant: MAINTENANT }), []);
  });
});

/* ── Ce que la reco porte ─────────────────────────────────────────────────── */

describe('une recommandation se conteste', () => {
  const r = recommander([{ type: 'ci-echec', branche: 'feat/paiement', quand: ilYAHeures(2),
                           url: 'https://x.test/run/1' }],
                        AGENTS, { maintenant: MAINTENANT })[0];

  test('elle nomme le fait dont elle vient', () => {
    assert.ok(r, 'une reco attendue');
    assert.match(r.titre, /CI a échoué/);
    assert.match(r.titre, /feat\/paiement/);
  });

  test('elle dit QUAND, en français', () => {
    assert.equal(r.quand, 'il y a 2 h');
    assert.match(r.pourquoi, /il y a 2 h/);
  });

  test('elle garde le fait brut, pour qu\'on puisse aller le voir', () => {
    assert.equal(r.signal.url, 'https://x.test/run/1');
  });

  test('elle désigne un agent RÉEL du registre', () => {
    assert.ok(AGENTS.some((a) => a.id === r.agent.id), `${r.agent.id} doit exister`);
  });
});

/* ── Le choix de l'agent ──────────────────────────────────────────────────── */

describe('quel agent répond à quoi', () => {
  test('l\'identifiant nommé passe devant l\'étiquette', () => {
    // Quand la plateforme sait exactement quoi proposer, proposer « quelque chose
    // d'étiqueté pipeline » à la place serait moins bon.
    const nomme = { id: 'expliquer-un-pipeline-en-echec', tags: [] };
    const etiquete = { id: 'autre-chose', tags: ['pipeline'] };
    assert.equal(agentsPour('ci-echec', [etiquete, nomme])[0].id, nomme.id);
  });

  test('à défaut, l\'étiquette suffit', () => {
    assert.equal(agentsPour('ci-echec', [{ id: 'x', tags: ['pipeline'] }])[0].id, 'x');
  });

  test('l\'accent d\'une étiquette ne fait pas rater l\'agent', () => {
    assert.equal(agentsPour('pr-a-moi', [{ id: 'x', tags: ['qualité'] }]).length, 1);
  });

  test('sur le VRAI registre, chaque signal trouve quelqu\'un', () => {
    /*
     * Le test qui empêche la table de pourrir. Un signal sans réponse possible est du
     * code mort : il s'observe, il se range, et il ne produit jamais rien.
     */
    for (const type of Object.keys(SIGNAUX)) {
      assert.ok(agentsPour(type, AGENTS).length > 0,
        `aucun agent du registre ne répond à « ${type} »`);
    }
  });

  test('chaque signal a sa réponse déclarée, et réciproquement', () => {
    assert.deepEqual(Object.keys(SIGNAUX).sort(), Object.keys(REPONSES).sort());
  });
});

/* ── L'ordre ──────────────────────────────────────────────────────────────── */

describe('l\'ordre', () => {
  const signaux = [
    { type: 'branches-nombreuses', n: 12, quand: ilYAHeures(1) },
    { type: 'ci-echec', branche: 'main', quand: ilYAHeures(5) },
    { type: 'pr-a-relire', n: 2, quand: ilYAHeures(3) }
  ];

  test('le plus urgent d\'abord, quelle que soit la fraîcheur', () => {
    // Une CI cassée il y a 5 h compte plus que 12 branches mortes découvertes il y a 1 h.
    const r = recommander(signaux, AGENTS, { maintenant: MAINTENANT });
    assert.deepEqual(r.map((x) => x.signal.type),
                     ['ci-echec', 'pr-a-relire', 'branches-nombreuses']);
  });

  test('il est STABLE : deux chargements proposent la même chose', () => {
    const a = recommander(signaux, AGENTS, { maintenant: MAINTENANT });
    const b = recommander([...signaux].reverse(), AGENTS, { maintenant: MAINTENANT });
    assert.deepEqual(a.map((x) => x.signal.type), b.map((x) => x.signal.type));
  });
});

/* ── Les entrées limites ──────────────────────────────────────────────────── */

describe('les entrées limites', () => {
  test('un fait sans date reste montrable — il n\'est pas périmé, il est indaté', () => {
    const r = recommander([{ type: 'ci-echec', branche: 'main' }], AGENTS,
                          { maintenant: MAINTENANT });
    assert.equal(r.length, 1);
    assert.equal(r[0].quand, '');
    assert.ok(!r[0].pourquoi.includes('undefined'), r[0].pourquoi);
  });

  test('une date illisible ne jette pas', () => {
    assert.equal(ageHeures({ quand: 'pas une date' }, MAINTENANT), null);
    assert.doesNotThrow(() => recommander([{ type: 'ci-echec', quand: 'zzz' }], AGENTS,
                                          { maintenant: MAINTENANT }));
  });

  test('les durées se disent comme on les dit', () => {
    assert.equal(ilYA(0.2), 'à l\'instant');
    assert.equal(ilYA(1.5), 'il y a une heure');
    assert.equal(ilYA(6), 'il y a 6 h');
    assert.equal(ilYA(30), 'hier');
    assert.equal(ilYA(80), 'il y a 3 jours');
    assert.equal(ilYA(null), '');
  });
});
