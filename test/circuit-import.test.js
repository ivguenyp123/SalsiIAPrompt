/*
 * LE CIRCUIT COMPLET, du pack importé au lancement gouverné.
 *
 * La démonstration en navigateur (URL → analyse → décisions → attente → refus →
 * validation → lancement → journal) prouve le parcours HUMAIN. Ce test prouve la même
 * chose en MÉCANIQUE, sans navigateur ni clé : une capacité lue, transformée en artefact,
 * puis passée par la SEULE route d'exécution — d'abord depuis le dossier d'attente
 * (refusée), puis depuis le dossier validé (autorisée ou refusée selon son isolement).
 *
 * Il tient en un fichier parce que c'est le résumé de tout ce qui précède : l'import, la
 * porte des dossiers (#21), P009 (#22). Si l'un cède, ce test le dit d'un coup.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lireCapacite } from '../lib/import-pack.js';
import { versArtefact } from '../lib/import-artefact.js';
import { executer, LANCABLE } from '../runtime/api.js';
import { attestationsPar } from '../lib/executeur.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

const registres = {
  tools: lire('registries/tools.yaml').tools,
  targets: lire('registries/targets.yaml').targets,
  entrees: lire('entrees/index.yaml'),
  isolements: lire('registries/isolements.yaml').isolements,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const ECRITURES = lire('registries/isolements.yaml').ecritures;
const models = lire('registries/models.yaml').models;

/* ── Le pack, importé pour de vrai ────────────────────────────────────────── */

const skill = (nom, desc, corps) =>
  `---\nname: ${nom}\ndescription: >-\n  ${desc}\n---\n\n${corps}\n`;

const construire = (nom, decisions, corps) => versArtefact({
  capacite: lireCapacite({ chemin: `skills/${nom}/SKILL.md`,
    contenu: skill(nom, `${nom} does things.`, corps), commit: 'c1', hacher: sha }),
  decisions, corps, pack: { source: 'google/mantis@main', commit: 'c1' },
  outils: registres.tools, isolements: registres.isolements, ecritures: ECRITURES,
  personne: 'daniel', perimetre: 'Plateforme'
}).artefact;

// mantis-review : lecture seule, aucune exécution → lançable une fois validée.
const REVIEW = construire('mantis-review', {
  entrees: 'Des constats et le code auquel ils renvoient.',
  sorties: 'Les constats retenus, avec leur ligne.',
  ecrit: 'rien', outils: ['read_repo_metadata'], isolement: 'aucune-execution'
}, 'Reads each finding and checks it against the source.');

// mantis-reproduce : exige un conteneur → non lançable sans attestation.
const REPRO = construire('mantis-reproduce', {
  entrees: 'Un rapport de crash.',
  sorties: 'Un reproducteur exécutable.',
  ecrit: 'rien', outils: ['read_repo_metadata'], isolement: 'conteneur-sans-reseau'
}, 'USE THIS ONLY IN ISOLATED ENVIRONMENTS. Runs crash reproducers.');

/* ── Le registre en mémoire, indexé par dossier ───────────────────────────── */

const registre = {
  'artifacts/pending': new Map([['mantis-review', REVIEW], ['mantis-reproduce', REPRO]]),
  'artifacts': new Map()
};

/** `charger` dossier par dossier, comme la vraie route depuis #21. */
const charger = (id, dossiers) => {
  for (const d of dossiers) { const a = registre[d]?.get(id); if (a) return a; }
  return null;
};

/** Valider = déplacer de pending vers le dossier lançable. C'est ce que fait l'Admin. */
const valider = (id) => {
  const a = registre['artifacts/pending'].get(id);
  registre['artifacts/pending'].delete(id);
  registre.artifacts.set(id, a);
};

let appels = 0;
const deps = (extra = {}) => ({
  registres, models, banque: registres.entrees, charger,
  lireEntree: () => '',
  creerVertex: () => ({ fournisseur: 'vertex', ou: 'test', modele: () => 'g',
    generer: async () => { appels += 1;
      return { texte: '## Ce que fait ce changement\nÇa lit du code.',
               modele: 'g', tier: 'nano', jetons: { entree: 1, sortie: 1 }, motifArret: 'STOP' }; } }),
  ...extra
});

const REQ = (id) => ({ id, valeurs: { matiere: 'const a = 1;' },
                       sensibilite: 'interne', criticite: 'test', assume: true });

/* ── Le circuit ───────────────────────────────────────────────────────────── */

describe('le circuit : import → attente → refus → validation → lancement', () => {
  test('1. les deux capacités importées portent bien leur exigence', () => {
    assert.equal(REVIEW.isolement, 'aucune-execution');
    assert.equal(REPRO.isolement, 'conteneur-sans-reseau');
    assert.equal(REVIEW.target_level, 'experimental');
    assert.deepEqual(registres.validateArtifact(REVIEW).errors, []);
    assert.deepEqual(registres.validateArtifact(REPRO).errors, []);
  });

  test('2. EN ATTENTE, aucune ne se lance — 403 nommé, modèle jamais atteint', async () => {
    appels = 0;
    for (const id of ['mantis-review', 'mantis-reproduce']) {
      const r = await executer(REQ(id), deps());
      assert.equal(r.status, 403, id);
      assert.match(r.corps.erreur, /attend une validation humaine/);
    }
    assert.equal(appels, 0);
  });

  test('3. VALIDÉE, mantis-review se lance — la porte était la seule différence', async () => {
    appels = 0;
    valider('mantis-review');
    const r = await executer(REQ('mantis-review'), deps());
    assert.equal(r.status, 200, JSON.stringify(r.corps).slice(0, 300));
    assert.equal(appels, 1);
  });

  test('4. VALIDÉE mais conteneur, mantis-reproduce reste refusée — P009', async () => {
    /*
     * Le cœur de la démonstration : la validation humaine ne suffit PAS à lancer ce qui
     * exige un isolement que la plateforme ne sait pas tenir. Deux portes indépendantes.
     */
    appels = 0;
    valider('mantis-reproduce');
    const r = await executer(REQ('mantis-reproduce'), deps());
    assert.equal(r.status, 409);
    const p009 = (r.corps.constats || []).find((c) => c.code === 'P009');
    assert.ok(p009, 'P009 porte le refus');
    assert.match(p009.message, /NON VÉRIFIABLE/);
    assert.equal(appels, 0, 'le modèle n\'est jamais atteint sur un isolement non tenu');
  });

  test('5. avec une attestation FRAÎCHE et la CI lue, elle passerait', async () => {
    /*
     * La preuve que P009 recalcule au lieu de croire un état figé. On fournit les deux
     * preuves attestables ET la lecture de CI ; l'isolement devient tenu, et le même
     * artefact — inchangé — part.
     */
    appels = 0;
    const attestations = attestationsPar([{ id: 'r', par: 'admin.runners',
      le: new Date().toISOString().slice(0, 10),
      preuves: ['executeur_jetable', 'reseau_coupe'] }], new Date());
    const r = await executer(REQ('mantis-reproduce'),
      deps({ attestations, ci: { 'salsi-isole': { image: `d@sha256:${'a'.repeat(64)}` } } }));
    assert.equal(r.status, 200, JSON.stringify(r.corps).slice(0, 300));
    assert.equal(appels, 1);
  });

  test('6. l\'attestation PÉRIMÉE re-refuse — la sécurité n\'est pas un état figé', async () => {
    appels = 0;
    const attestations = attestationsPar([{ id: 'r', par: 'admin.runners', le: '2025-01-01',
      preuves: ['executeur_jetable', 'reseau_coupe'] }], new Date());
    const r = await executer(REQ('mantis-reproduce'),
      deps({ attestations, ci: { 'salsi-isole': { image: `d@sha256:${'a'.repeat(64)}` } } }));
    assert.equal(r.status, 409);
    assert.equal(appels, 0);
  });
});
