/*
 * Le parc — ce qui sort du catalogue.
 *
 * Le registre savait faire ENTRER un artefact et pas l'en faire sortir. La sortie
 * ajoutée est un déplacement de dossier, comme l'entrée : `artifacts/` → `artifacts/
 * retires/`. Deux propriétés à protéger, et elles ne sont pas dans le même fichier.
 *
 *   1. la CI ne se met pas à refuser ce qu'on a retiré — on retire souvent PARCE QUE
 *      quelque chose ne va plus, et casser la porte pour du code que plus personne
 *      n'exécute ferait abandonner la porte, pas l'archive
 *   2. le journal lit ces décisions comme des décisions, pas comme un contournement
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { depuisCommits, horsParcours, ACTIONS } from '../admin/journal.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONFORME = readFileSync(join(ROOT, 'artifacts/commit-message.yaml'), 'utf8');
/** Le même, volontairement non conforme : sans `criteria`, L008 le refuse. */
const CASSE = CONFORME.replace(/^criteria:[\s\S]*?(?=^golden_cases:)/m, '');

/** Lance le lint de CI sur un arbre jetable et rend son code de sortie. */
function lintCli(arbre) {
  const dir = mkdtempSync(join(tmpdir(), 'salsi-parc-'));
  try {
    for (const [chemin, contenu] of Object.entries(arbre)) {
      mkdirSync(join(dir, dirname(chemin)), { recursive: true });
      writeFileSync(join(dir, chemin), contenu);
    }
    try {
      execFileSync('node', [join(ROOT, 'lint/cli.js'), dir], { encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status ?? 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('un artefact retiré ne casse plus la porte', () => {
  test('le même fichier refusé à la racine passe inaperçu sous retires/', () => {
    // C'est la propriété entière, en une comparaison : seul le DOSSIER change.
    assert.equal(lintCli({ 'bon.yaml': CONFORME, 'casse.yaml': CASSE }), 1,
      'publié, il doit être refusé');
    assert.equal(lintCli({ 'bon.yaml': CONFORME, 'retires/casse.yaml': CASSE }), 0,
      'retiré, il n\'est plus une promesse');
  });

  test('retirer n\'ouvre pas une porte dérobée pour le reste', () => {
    // L'exclusion porte sur le dossier d'archive, pas sur le voisinage d'une archive :
    // un artefact cassé resté publié est toujours refusé.
    assert.equal(lintCli({ 'retires/vieux.yaml': CASSE, 'actif.yaml': CASSE }), 1);
  });

  test('un dossier retires/ ne dispense pas d\'avoir quelque chose à vérifier', () => {
    // Tout archiver ne doit pas rendre la CI verte par vacuité : le CLI refuse déjà de
    // ne rien avoir à contrôler, et l'archive ne contourne pas ce garde-fou.
    assert.equal(lintCli({ 'retires/casse.yaml': CASSE }), 1);
  });
});

describe('les décisions du parc sont des décisions', () => {
  const commit = (action, corps) => ({
    sha: action, author: 'ivguenyp123', date: '2026-08-07T10:00:00Z',
    message: `registre : ${action} Expliquer un pipeline\n\n${corps}`
  });

  test('retirer, réactiver et supprimer ont chacun leur verbe', () => {
    for (const a of ['retirer', 'reactiver', 'supprimer']) {
      assert.ok(ACTIONS[a]?.verbe, `${a} n'a pas de verbe : le journal l'afficherait en « hors parcours »`);
    }
  });

  test('elles ne sont pas comptées comme un contournement du produit', () => {
    // `horsParcours` est ce qu'un auditeur regarde en premier : ce qui a touché le
    // registre sans passer par la porte. Y faire tomber une décision légitime rendrait
    // l'alerte inexploitable — donc ignorée.
    const evs = depuisCommits([
      commit('retirer', 'Artefact expliquer-un-pipeline-en-echec. Retiré par ivguenyp123.'),
      commit('reactiver', 'Artefact expliquer-un-pipeline-en-echec. Réactivé par ivguenyp123.'),
      commit('supprimer', 'Artefact test. Supprimé par ivguenyp123.')
    ]);
    assert.deepEqual(horsParcours(evs), []);
    assert.ok(evs.every((e) => e.acteur === 'ivguenyp123' && e.acteurDeclare));
  });

  test('l\'identifiant de l\'artefact se lit, pas seulement son titre', () => {
    // Le titre change, l'identifiant non : c'est lui qui permet de recoudre l'histoire
    // d'un artefact à travers ses renommages.
    const [e] = depuisCommits([commit('retirer',
      'Artefact expliquer-un-pipeline-en-echec. Retiré par ivguenyp123. Déplacé en artifacts/retires/x.yaml.')]);
    assert.equal(e.artefactId, '');   // le motif d'identifiant ne couvre que la soumission
    assert.equal(e.cible, 'Expliquer un pipeline');
    assert.equal(e.action, 'retirer');
  });
});
