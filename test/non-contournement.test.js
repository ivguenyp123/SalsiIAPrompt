/*
 * LES TESTS DE NON-CONTOURNEMENT — chaque test raconte son attaque.
 *
 * ── POURQUOI UN FICHIER À PART ───────────────────────────────────────────────
 *
 * Les autres tests vérifient que les choses MARCHENT. Ceux-ci vérifient qu'elles ne se
 * CONTOURNENT pas — que la validation humaine, l'isolement et la péremption tiennent
 * quand on attaque l'API directement, sans passer par un écran. Un contrôle qui ne tient
 * qu'à travers l'écran n'est pas un contrôle : il suffit d'un curl.
 *
 * Deux de ces attaques ont été des TROUS RÉELS, trouvés à la relecture du 2026-08-18 :
 * l'exécution cherchait dans `pending/` et `retires/`, et l'isolement décidé à l'import
 * vivait dans des commentaires que le parseur YAML jette. Les tests portent la date pour
 * que personne ne les prenne pour de la paranoïa décorative.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { executer, LANCABLE, DOSSIERS } from '../runtime/api.js';
import { prevol } from '../preflight/index.js';
import { attestationsPar } from '../lib/executeur.js';
import { versArtefact, DOSSIER_IMPORTE } from '../lib/import-artefact.js';
import { lireCapacite } from '../lib/import-pack.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

const registres = {
  tools: lire('registries/tools.yaml').tools,
  targets: lire('registries/targets.yaml').targets,
  entrees: lire('entrees/index.yaml'),
  isolements: lire('registries/isolements.yaml').isolements,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const ECRITURES = lire('registries/isolements.yaml').ecritures;
const models = lire('registries/models.yaml').models;

/** Un artefact minimal et conforme, qu'on placera dans le dossier de l'attaque. */
const AGENT = {
  id: 'agent-attaque', kind: 'prompt', title: 'Agent visé par l\'attaque',
  owner: { person: 'testeur', scope: 'Plateforme' },
  intent: { purpose: 'Servir de cible aux tests de contournement.',
            not_for: 'Ne sert à rien d\'autre.' },
  model_tier: 'nano', target_level: 'experimental',
  variables: [{ name: 'code', source: 'user', required: true }],
  criteria: [{ target: 'output.contains_secret', op: 'eq', value: false }],
  spec: 'Explique ce code sans rien inventer et sans conclure :\n\n{{code}}'
};

/** Le modèle ne doit JAMAIS être atteint par une attaque : il compte ses appels. */
const vertexTemoin = () => {
  const temoin = { appels: 0 };
  return { temoin, vertex: { fournisseur: 'vertex', ou: 'x', modele: () => 'gemini-test',
    generer: async () => { temoin.appels += 1;
      return { texte: 'ok', modele: 'gemini-test', tier: 'nano',
               jetons: { entree: 1, sortie: 1 }, motifArret: 'STOP' }; } } };
};

/** `charger` qui place l'agent dans UN dossier précis — le poste de l'attaque. */
const chargerDepuis = (dossier, artefact = AGENT) => (id, dossiers) =>
  (id === artefact.id && dossiers.includes(dossier)) ? artefact : null;

const deps = (dossier, extra = {}) => {
  const { temoin, vertex } = vertexTemoin();
  return { temoin, d: {
    registres, models, banque: registres.entrees,
    charger: chargerDepuis(dossier, extra.artefact || AGENT),
    lireEntree: () => '', creerVertex: () => vertex, ...extra
  } };
};

const REQ = { id: 'agent-attaque', valeurs: { code: 'const a = 1;' },
              sensibilite: 'interne', criticite: 'test', assume: true };

/* ── Attaque 1 : lancer ce qui attend une validation ──────────────────────── */

describe('la validation humaine ne se contourne pas par l\'API', () => {
  test('TROU DU 2026-08-18 : un artefact EN ATTENTE ne se lance plus', async () => {
    /*
     * L'attaque : l'id est visible dans la MR de dépôt ; un `POST /executer` avec cet id
     * le trouvait dans `artifacts/pending/` et le lançait. La file de validation était
     * une porte d'écran, pas d'exécution.
     */
    const { temoin, d } = deps('artifacts/pending');
    const r = await executer(REQ, d);
    assert.equal(r.status, 403);
    assert.match(r.corps.erreur, /attend une validation humaine/);
    assert.match(r.corps.erreur, /une porte, pas un dossier/);
    assert.equal(temoin.appels, 0, 'le modèle ne doit jamais être atteint');
  });

  test('un artefact RETIRÉ ne se lance plus non plus', async () => {
    // Retirer un agent du catalogue doit retirer son droit d'exécution — sinon « retiré »
    // veut dire « caché », et un catalogue qui cache ne gouverne pas.
    const { temoin, d } = deps('artifacts/retires');
    const r = await executer(REQ, d);
    assert.equal(r.status, 403);
    assert.match(r.corps.erreur, /retiré du catalogue/);
    assert.equal(temoin.appels, 0);
  });

  test('VU LE 2026-08-19 : un BROUILLON PERSONNEL est refusé nommément, pas « introuvable »', async () => {
    /*
     * Le cas réel : un agent tout juste sauvé depuis Fabriquer (`mes-agents/<qui>/`)
     * s'affichait au catalogue avec son panneau de lancement, et l'exécution répondait
     * « introuvable au registre ». Le fichier EXISTE ; ce qui lui manque est une
     * validation — et c'est ce que le refus doit dire. Il ne se lance toujours pas :
     * la recherche des dossiers personnels sert à nommer, jamais à ouvrir.
     */
    const { temoin, d } = deps('mes-agents');
    const r = await executer(REQ, d);
    assert.equal(r.status, 403, 'refusé, pas absent');
    assert.match(r.corps.erreur, /brouillon personnel/);
    assert.match(r.corps.erreur, /dépose-le en attente/);
    assert.equal(temoin.appels, 0, 'le modèle ne doit jamais être atteint');

    const chaine = deps('mes-chaines');
    const rc = await executer(REQ, chaine.d);
    assert.equal(rc.status, 403);
    assert.match(rc.corps.erreur, /chaîne personnelle/);
  });

  test('le refus est un 403 NOMMÉ, pas un 404 déguisé', async () => {
    // Un refus qui se présente comme une absence ne se comprend pas : l'auteur voit
    // « introuvable » sur un artefact qu'il vient de déposer, et conclut à un bug.
    const { d } = deps('artifacts/pending');
    const r = await executer(REQ, d);
    assert.notEqual(r.status, 404);
    assert.match(r.corps.erreur, /`agent-attaque`/);
  });

  test('le même artefact, VALIDÉ, se lance — la porte est la seule différence', async () => {
    // Le contrôle ne doit pas être un mur : exactement le même fichier, déplacé par la
    // validation Admin dans `artifacts/`, part sans autre formalité.
    const { temoin, d } = deps(LANCABLE);
    const r = await executer(REQ, d);
    assert.equal(r.status, 200, JSON.stringify(r.corps).slice(0, 300));
    assert.equal(temoin.appels, 1);
  });

  test('seul le PREMIER dossier de DOSSIERS est lançable', () => {
    // Si quelqu'un réordonne la liste, ce test rougit avant que le trou ne rouvre.
    assert.equal(LANCABLE, 'artifacts');
    assert.equal(DOSSIERS[0], LANCABLE);
  });
});

/* ── Attaque 2 : exécuter malgré un isolement non tenu ─────────────────────── */

const IMPORTE = { ...AGENT, id: 'importe-conteneur', tags: ['importe'],
                  isolement: 'conteneur-sans-reseau' };

describe('P009 — l\'isolement se recalcule au lancement, il ne se croit pas', () => {
  const REQ_IMP = { ...REQ, id: 'importe-conteneur' };

  test('TROU DU 2026-08-18 : « elle ne se lance pas » est maintenant un refus', async () => {
    /*
     * L'isolement décidé à l'import vivait dans les commentaires d'en-tête — que le
     * parseur YAML jette. L'artefact lancé ne portait rien, aucun P00x ne regardait, et
     * la promesse était de la prose. Le champ `isolement` du schéma et P009 la rendent
     * exécutoire.
     */
    const { temoin, d } = deps(LANCABLE, { artefact: IMPORTE });
    const r = await executer(REQ_IMP, d);
    assert.equal(r.status, 409, JSON.stringify(r.corps).slice(0, 300));
    const p009 = (r.corps.constats || []).find((c) => c.code === 'P009');
    assert.ok(p009, 'P009 doit porter le refus');
    assert.match(p009.message, /NON VÉRIFIABLE/);
    assert.match(p009.message, /Ce qu'on ne sait pas ne se lance pas/);
    assert.equal(temoin.appels, 0);
  });

  test('un isolement INCONNU du registre refuse aussi', async () => {
    // `non résolu` ne vaut jamais `satisfait` — y compris pour un champ qui référence un
    // vocabulaire. Un id inventé ne doit pas passer parce que personne ne le connaît.
    const { d } = deps(LANCABLE, { artefact: { ...IMPORTE, isolement: 'sandbox-magique' } });
    const r = await executer({ ...REQ_IMP }, d);
    assert.equal(r.status, 409);
    assert.match((r.corps.constats || []).find((c) => c.code === 'P009').message,
      /inconnu du registre/);
  });

  test('L\'ATTESTATION NE COUVRE PAS CE QUE LA PLATEFORME LIT ELLE-MÊME', async () => {
    /*
     * Une attestation couvre les preuves invérifiables d'ici — jamais celles que la
     * plateforme sait établir seule. Ici l'administrateur atteste l'exécuteur jetable et
     * le réseau coupé ; mais `job_ci_declare` est LISIBLE (la CI du dépôt), et personne
     * ne l'a lue. Le verdict reste non vérifiable : on n'atteste pas à la place d'un fait
     * qu'on pourrait constater. Le desserrage complet est prouvé dans circuit-import #5.
     */
    const attestations = attestationsPar([{ id: 'r', par: 'prenom.nom',
      le: new Date().toISOString().slice(0, 10),
      preuves: ['executeur_jetable', 'reseau_coupe'] }], new Date());
    const { temoin, d } = deps(LANCABLE, { artefact: IMPORTE, attestations });
    const r = await executer(REQ_IMP, { ...d, attestations });   // pas de `ci` : non lue
    assert.equal(r.status, 409);
    const p009 = (r.corps.constats || []).find((c) => c.code === 'P009');
    assert.match(p009.message, /job_ci_declare/);
    assert.ok(!/executeur_jetable|reseau_coupe/.test(p009.message.split('manquent :')[1]),
      'les preuves attestées ne manquent plus — seule la preuve lisible manque');
    assert.equal(temoin.appels, 0);
  });

  test('une attestation PÉRIMÉE re-refuse — la péremption est un fait d\'exécution', async () => {
    const attestations = attestationsPar([{ id: 'r', par: 'prenom.nom', le: '2025-01-01',
      preuves: ['executeur_jetable', 'reseau_coupe'] }], new Date());
    const { d } = deps(LANCABLE, { artefact: IMPORTE, attestations });
    const r = await executer(REQ_IMP, { ...d, attestations });
    assert.equal(r.status, 409);
    assert.match((r.corps.constats || []).find((c) => c.code === 'P009').message,
      /executeur_jetable/);
  });

  test('un artefact SANS le champ reste muet — les 30 existants ne bloquent pas', async () => {
    // Comme un budget absent laisse P008 muet : les faire tous refuser au nom d'une
    // exigence qu'ils n'ont jamais déclarée serait un mur, pas une porte.
    const { temoin, d } = deps(LANCABLE);
    const r = await executer(REQ, d);
    assert.equal(r.status, 200);
    assert.equal(temoin.appels, 1);
  });

  test('P009, seul : `aucune-execution` est tenu par la plateforme sans signature', () => {
    const { constats } = prevol({ ...AGENT, isolement: 'aucune-execution' },
      { registres, valeurs: { code: 'x' }, depot: { scope: 'Plateforme' } });
    assert.ok(!constats.some((c) => c.code === 'P009'),
      'un prompt sans exécution ne doit dépendre de personne');
  });
});

/* ── Attaque 3 : le générateur d'import ne peut pas produire un contournement ─ */

describe('l\'import écrit l\'exigence DANS l\'artefact — plus jamais dans la prose', () => {
  const SKILL = '---\nname: x-review\ndescription: >-\n  Reviews things carefully.\n---\nbody\n';

  test('le champ `isolement` sort dans le YAML, pas seulement dans l\'en-tête', () => {
    const { artefact } = versArtefact({
      capacite: lireCapacite({ chemin: 'a/SKILL.md', contenu: SKILL, commit: 'c',
                               hacher: () => 'f'.repeat(64) }),
      decisions: { entrees: 'des constats', sorties: 'un tri', ecrit: 'rien',
                   outils: ['read_repo_metadata'], isolement: 'conteneur-sans-reseau' },
      corps: 'body', pack: { source: 's', commit: 'c' },
      outils: registres.tools, isolements: registres.isolements, ecritures: ECRITURES,
      personne: 'testeur', perimetre: 'Plateforme'
    });
    assert.equal(artefact.isolement, 'conteneur-sans-reseau');
    // Et le schéma l'accepte : un champ écrit que le schéma refuse ne protégerait rien.
    assert.equal(registres.validateArtifact(artefact).valid, true);
  });

  test('déposé en attente ET exigeant un conteneur : les DEUX portes le tiennent', async () => {
    // L'attaque combinée : même si quelqu'un vole l'id avant la validation, le 403 du
    // dossier tombe d'abord ; et une fois validé, P009 tient tant que rien n'est prouvé.
    const importe = { ...IMPORTE, id: 'importe-vole' };
    const enAttente = deps('artifacts/pending', { artefact: importe });
    const r1 = await executer({ ...REQ, id: 'importe-vole' }, enAttente.d);
    assert.equal(r1.status, 403);

    const valide = deps(LANCABLE, { artefact: importe });
    const r2 = await executer({ ...REQ, id: 'importe-vole' }, valide.d);
    assert.equal(r2.status, 409);
    assert.equal(enAttente.temoin.appels + valide.temoin.appels, 0);
  });

  test('le dossier d\'atterrissage de l\'import est bien le dossier NON lançable', () => {
    assert.equal(DOSSIER_IMPORTE, 'artifacts/pending');
    assert.notEqual(DOSSIER_IMPORTE, LANCABLE);
  });
});
