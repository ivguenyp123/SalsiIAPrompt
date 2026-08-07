/*
 * Tests de Salsi — l'aide à l'écriture.
 *
 * Une seule propriété compte vraiment, et elle est vérifiée EXHAUSTIVEMENT : quel que
 * soit le chemin suivi dans le dialogue, l'artefact produit franchit la porte.
 *
 * C'est ce qu'un assistant génératif ne pourrait pas garantir. Salsi ne rédige pas, il
 * COMPOSE à partir des registres — il ne peut donc pas proposer un outil qui n'existe pas
 * ni une cible non assertable, les deux erreurs que `L004` et `L009` refusent et les plus
 * fréquentes quand on écrit à la main.
 *
 * 4 questions × 4·3·3·3 options = 108 chemins. Ils sont tous joués.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR } from '../lint/index.js';
import { QUESTIONS, composer, tousLesChemins } from '../studio/assistant.js';
import { formToArtifact } from '../studio/form-to-artifact.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};

/** Ce que Salsi produit, complété de ce que seul l'auteur peut donner. */
const artefactDe = (reponses) => formToArtifact({
  ...composer(reponses, ctx),
  title: 'Vérifier les migrations Flyway',
  ownerPerson: 'ivguenyp123',
  ownerScope: 'Plateforme',
  purpose: 'Analyser les scripts de migration et signaler les ruptures de compatibilité.'
}, ctx);

/* ── LA propriété ─────────────────────────────────────────────────────────── */

describe('quel que soit le chemin, l\'artefact franchit la porte', () => {
  const chemins = tousLesChemins();

  test('le dialogue a bien 108 chemins, et ils sont tous couverts', () => {
    assert.equal(chemins.length, 4 * 3 * 3 * 3);
  });

  test('aucun chemin ne produit d\'artefact refusé au niveau expérimental', () => {
    const refuses = [];
    for (const chemin of chemins.filter((c) => c.niveau === 'experimental')) {
      const rapport = lint(artefactDe(chemin), ctx);
      if (rapport.blocked) {
        refuses.push(`${JSON.stringify(chemin)} → ${rapport.findings.filter((f) => f.severity === ERROR).map((f) => f.code).join(',')}`);
      }
    }
    assert.deepEqual(refuses, [], 'chemins refusés');
  });

  test('viser plus haut n\'est refusé que par L010 — le manque de cas d\'or, rien d\'autre', () => {
    // C'est la seule règle que Salsi ne peut pas satisfaire seul : un cas d'or décrit un
    // comportement attendu, et ça, l'auteur seul le sait.
    for (const chemin of chemins.filter((c) => c.niveau !== 'experimental')) {
      const codes = lint(artefactDe(chemin), ctx).findings
        .filter((f) => f.severity === ERROR).map((f) => f.code);
      assert.deepEqual([...new Set(codes)], ['L010'], JSON.stringify(chemin));
    }
  });
});

/* ── Pourquoi la propriété tient ──────────────────────────────────────────── */

describe('Salsi compose depuis le registre, il n\'invente pas', () => {
  test('tout outil proposé existe au registre des outils', () => {
    const connus = new Set(ctx.tools.map((t) => t.id));
    for (const chemin of tousLesChemins()) {
      for (const t of composer(chemin, ctx).tools) {
        assert.ok(connus.has(t.id), `${t.id} n'existe pas au registre`);
      }
    }
  });

  test('toute cible proposée existe au registre des cibles, avec un opérateur autorisé', () => {
    const cibles = new Map(ctx.targets.map((t) => [t.target, t]));
    for (const chemin of tousLesChemins()) {
      for (const c of composer(chemin, ctx).criteria) {
        const ref = cibles.get(c.target);
        assert.ok(ref, `${c.target} n'est pas assertable`);
        assert.ok(ref.ops.includes(c.op), `${c.op} interdit sur ${c.target}`);
      }
    }
  });

  test('un outil retiré du registre n\'est plus proposé', () => {
    // Le registre fait autorité, y compris quand il rétrécit. Sans ce filtre, Salsi
    // produirait un artefact que L004 refuserait — l'assistant contre le produit.
    const ampute = { tools: ctx.tools.filter((t) => t.id !== 'create_mr') };
    const form = composer({ but: 'agir' }, ampute);
    assert.ok(!form.tools.some((t) => t.id === 'create_mr'));
  });
});

describe('le spec assemblé est utilisable tel quel', () => {
  test('chaque variable déclarée est interpolée', () => {
    // L002 refuse une variable non déclarée, L021 refuse un spec qui n'en utilise
    // aucune. Assembler le spec à partir des variables satisfait les deux d'un coup.
    for (const chemin of tousLesChemins()) {
      const form = composer(chemin, ctx);
      for (const v of form.variables) {
        assert.match(form.spec, new RegExp(`\\{\\{${v.name}\\}\\}`),
          `${v.name} n'est pas interpolée (${JSON.stringify(chemin)})`);
      }
    }
  });

  test('un artefact qui écrit dit qu\'il n\'écrit pas lui-même', () => {
    const form = composer({ but: 'agir' }, ctx);
    assert.match(form.spec, /tu NE FAIS PAS les écritures/);
  });

  test('le spec invite à compléter au lieu de faire semblant d\'être fini', () => {
    // Salsi donne une charpente correcte, pas un prompt terminé. Prétendre rédiger à la
    // place de l'auteur demanderait un modèle, et un modèle ne garantit rien.
    assert.match(composer({}, ctx).spec, /Salsi ne peut pas deviner/);
  });

  test('le titre et l\'intention restent vides — c\'est ce que l\'auteur sait, lui', () => {
    const form = composer({}, ctx);
    assert.equal(form.title, '');
    assert.equal(form.purpose, '');
    assert.ok(form.notFor.length > 10, 'mais le "quand ne pas l\'utiliser" est amorcé');
  });
});

describe('le raisonnement est montré, pas caché', () => {
  test('chaque question donne une ligne d\'explication', () => {
    const form = composer({ but: 'verifier', entree: 'depot_branche', preuve: 'monde', niveau: 'team' }, ctx);
    assert.equal(form.pourquoi.length, QUESTIONS.length);
    for (const [icone, titre, raison] of form.pourquoi) {
      assert.ok(icone && titre && raison, 'icône, décision et raison');
    }
  });

  test('l\'explication nomme les règles concernées', () => {
    // Un choix qu'on ne comprend pas, on le subit — et on ne saura pas le corriger
    // quand le contexte changera.
    const texte = composer({}, ctx).pourquoi.flat().join(' ');
    for (const regle of ['L002', 'L009', 'L010']) assert.ok(texte.includes(regle), regle);
  });

  test('viser « équipe » annonce les cas d\'or AVANT que L010 ne les réclame', () => {
    const form = composer({ niveau: 'team' }, ctx);
    assert.match(form.pourquoi.map((p) => p[2]).join(' '), /L010 exigera des cas d'or/);
  });
});

describe('robustesse', () => {
  test('sans réponse, on obtient le premier chemin, pas une erreur', () => {
    const form = composer({}, ctx);
    assert.ok(form.spec.length > 50);
    assert.equal(lint(artefactDe({}), ctx).blocked, false);
  });

  test('une réponse inconnue retombe sur le défaut', () => {
    assert.deepEqual(composer({ but: 'n-importe-quoi' }, ctx).tools,
                     composer({ but: 'expliquer' }, ctx).tools);
  });

  test('sans registre, Salsi propose quand même — il ne filtre simplement plus', () => {
    assert.ok(composer({ but: 'agir' }, {}).tools.length > 0);
  });
});
