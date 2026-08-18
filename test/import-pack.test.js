/*
 * Le lecteur de packs de capacités externes.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. IL NE DÉDUIT RIEN. C'est la contrainte I001, et c'est tout le sujet : l'importeur
 *    serait l'agent le plus privilégié de la plateforme — il lit du markdown écrit par
 *    des tiers et en produit des artefacts gouvernés. Un champ tiré d'une phrase anglaise
 *    n'est pas un droit.
 * 2. Un indice n'est pas une déduction. « `--network none` apparaît ligne 3 » est un fait
 *    sur le texte ; « exige un bac à sable » est une décision, et elle est humaine.
 * 3. Sur le VRAI Mantis, le résultat est « 0 gouvernable ». C'est le résultat qu'on veut
 *    afficher — pas un import en un clic qui aurait l'air de marcher.
 *
 * ── LES FIXTURES SONT RÉELLES ───────────────────────────────────────────────
 *
 * Les front-matters ci-dessous sont ceux de `google/mantis`, relevés le 2026-08-18 sur le
 * dépôt. Ils ne sont pas écrits pour ce test : c'est exactement ce qu'un `SKILL.md`
 * déclare, et c'est pour ça que le test prouve quelque chose.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { CHAMPS, fiable, decouper, indicesDe, lireCapacite, lirePack,
         resumePack, MAX_INDICES } from '../lib/import-pack.js';

const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

/* ── Les fixtures, relevées sur google/mantis le 2026-08-18 ───────────────── */

const REVIEW = `---
name: mantis-review
description: >-
  Independently reviews findings and filters out false positives.
  Use when consolidated findings need validation against the actual source code.
---

Assume every finding is a false positive by default. Your job is to disprove the
finding using an adversarial stance.

Findings with a discovery_commit mismatching the current SNAPSHOT_ID are finalized as
drift NEEDS_RESEARCH. Writes to workspace/findings/<uuid>.json via the helper script.
See schema.json for the status VALID contract.
`;

const REPRODUCE = `---
name: mantis-reproduce
description: >-
  Generates and runs crash reproducers to verify security flaws.
  Use when viable findings exist and you need to write and execute a script or payload.
---

All reproducer executions must run isolated. Host command execution is strictly
prohibited. Run inside a containerized sandbox with --network none.
Reads from findings/ and archive/.repro_attempts.json.
Companion tool mantis-patch handles the re-attack workflow.
`;

const PACK = [
  { chemin: 'mantis-review/SKILL.md', contenu: REVIEW },
  { chemin: 'mantis-reproduce/SKILL.md', contenu: REPRODUCE },
  { chemin: 'workspace/helpers/append_review.py', contenu: '# MANTIS_HELPER_VERSION = 2\n' },
  { chemin: 'mantis-review/append_review.py', contenu: '# MANTIS_HELPER_VERSION = 2\n' },
  { chemin: 'schema.json', contenu: '{"$schema":"https://json-schema.org/draft/2020-12/schema"}' },
  { chemin: 'README.md', contenu: '# Mantis\n' }
];

const pack = (extra = {}) => lirePack({
  fichiers: PACK, source: 'https://github.com/google/mantis',
  commit: 'abc1234', hacher: sha, ...extra });

/* ── Le découpage ─────────────────────────────────────────────────────────── */

describe('le front-matter se lit, et son absence se dit', () => {
  test('l\'en-tête et le corps sont séparés', () => {
    const { entete, corps } = decouper(REVIEW);
    assert.equal(entete.name, 'mantis-review');
    assert.match(corps, /adversarial stance/);
    assert.ok(!corps.includes('name:'), 'l\'en-tête ne fuit pas dans le corps');
  });

  test('sans front-matter, tout est du corps — et rien n\'est inventé', () => {
    const { entete, corps } = decouper('# Un skill\n\nsans en-tête.\n');
    assert.equal(entete, null);
    assert.match(corps, /sans en-tête/);
  });

  test('un front-matter ILLISIBLE se distingue d\'un front-matter vide', () => {
    // « la capacité ne déclare rien » et « on n'a pas su lire » appellent deux gestes
    // différents. Les confondre ferait chercher au mauvais endroit.
    const r = decouper('---\n: : :\n\tmauvais\n---\ncorps\n');
    assert.ok(r.entete === null);
    assert.equal(r.illisible, true);
  });
});

/* ── Ce qu'il lit, et ce qu'il refuse de deviner ──────────────────────────── */

describe('IL NE DÉDUIT RIEN — la contrainte I001', () => {
  test('sur un VRAI SKILL.md, deux champs sont lus et le reste manque', () => {
    /*
     * Le test qui porte le module. Un `SKILL.md` de Mantis déclare `name` et
     * `description`. Le reste — isolement, outils, entrées, sorties — vit dans la prose
     * anglaise. Un importeur qui remplirait ces champs les aurait DEVINÉS.
     */
    const c = lireCapacite({ chemin: 'mantis-reproduce/SKILL.md', contenu: REPRODUCE,
                             commit: 'abc1234', hacher: sha });

    assert.equal(c.champs.id.origine, 'lu');
    assert.equal(c.champs.id.valeur, 'mantis-reproduce');
    assert.equal(c.champs.titre.origine, 'lu');
    assert.equal(c.champs.empreinte.origine, 'lu');

    for (const nom of ['isolement', 'outils', 'entrees', 'sorties', 'ecrit']) {
      assert.equal(c.champs[nom].origine, 'manquant', `${nom} a été deviné`);
      assert.equal(c.champs[nom].valeur, null);
    }
  });

  test('AUCUN champ ne sort en `deduit` — l\'étape 1 n\'infère pas', () => {
    for (const c of pack().capacites) {
      for (const [nom, v] of Object.entries(c.champs)) {
        assert.notEqual(v.origine, 'deduit', `${c.chemin} · ${nom}`);
      }
    }
  });

  test('la prose la plus explicite du monde ne remplit toujours rien', () => {
    /*
     * `mantis-reproduce` écrit noir sur blanc « Host command execution is strictly
     * prohibited » et « --network none ». C'est aussi clair qu'un texte peut l'être — et
     * ça reste une phrase anglaise dans un fichier écrit par un tiers. Accorder un
     * isolement là-dessus serait accorder un droit sur une lecture.
     */
    const c = lireCapacite({ chemin: 'x/SKILL.md', contenu: REPRODUCE, hacher: sha });
    assert.equal(c.champs.isolement.origine, 'manquant');
    assert.ok(c.manquants.includes('isolement'));
    assert.equal(c.gouvernable, false);
  });

  test('sans hacheur injecté, l\'empreinte MANQUE au lieu d\'être choisie ici', () => {
    // Un module pur ne choisit pas son algorithme de cryptographie. Sans déclaration de
    // l'appelant, on n'en invente pas un.
    const c = lireCapacite({ chemin: 'x/SKILL.md', contenu: REVIEW });
    assert.equal(c.champs.empreinte.origine, 'manquant');
  });

  test('l\'empreinte épingle le fichier ET le commit', () => {
    // C'est ce qui rend un ré-import VISIBLE : l'amont bouge, le hachage change, et la
    // décision se reprend au lieu de se propager en silence.
    const c = lireCapacite({ chemin: 'a/SKILL.md', contenu: REVIEW, commit: 'abc1234', hacher: sha });
    assert.equal(c.champs.empreinte.valeur.commit, 'abc1234');
    assert.equal(c.champs.empreinte.valeur.sha, sha(REVIEW));
    assert.notEqual(sha(REVIEW), sha(REPRODUCE), 'deux sources, deux empreintes');
  });
});

/* ── Les indices ──────────────────────────────────────────────────────────── */

describe('un INDICE n\'est pas une déduction', () => {
  test('il porte la ligne et l\'extrait, jamais une conclusion', () => {
    const c = lireCapacite({ chemin: 'x/SKILL.md', contenu: REPRODUCE, hacher: sha });
    const i = c.champs.isolement.indices;
    assert.ok(i.length > 0, 'la prose parle d\'isolement, il faut le signaler');
    assert.ok(i.every((x) => Number.isInteger(x.ligne) && x.extrait));
    // Et le champ RESTE manquant : l'indice aide à remplir, il ne remplit pas.
    assert.equal(c.champs.isolement.origine, 'manquant');
  });

  test('un texte muet ne produit aucun indice — pas d\'indice de complaisance', () => {
    const c = lireCapacite({ chemin: 'x/SKILL.md',
      contenu: '---\nname: x\ndescription: y\n---\n\nRien de particulier.\n', hacher: sha });
    assert.deepEqual(c.champs.isolement.indices, []);
  });

  test('les indices sont plafonnés — au-delà on ne les lit plus, on les subit', () => {
    const bruyant = `---\nname: x\ndescription: y\n---\n${'sandbox\n'.repeat(50)}`;
    assert.equal(indicesDe('isolement', bruyant).length, MAX_INDICES);
  });
});

/* ── Le pack ──────────────────────────────────────────────────────────────── */

describe('le pack entier', () => {
  test('il trouve les SKILL.md, et rien d\'autre', () => {
    const p = pack();
    assert.equal(p.capacites.length, 2);
    assert.deepEqual(p.capacites.map((c) => c.champs.id.valeur).sort(),
      ['mantis-reproduce', 'mantis-review']);
  });

  test('les scripts d\'aide du DOSSIER sont vus — ils changent la nature de la capacité', () => {
    /*
     * Une capacité qui dépend d'un script n'est pas un prompt, c'est un programme. Mantis
     * en a un, avec un numéro de version dans un commentaire. Sa présence est un FAIT de
     * l'arborescence, pas une lecture de prose.
     */
    const review = pack().capacites.find((c) => c.champs.id.valeur === 'mantis-review');
    assert.deepEqual(review.scripts, ['mantis-review/append_review.py']);
    const repro = pack().capacites.find((c) => c.champs.id.valeur === 'mantis-reproduce');
    assert.deepEqual(repro.scripts, [], 'le script d\'un autre dossier ne lui est pas attribué');
  });

  test('la présence de `schema.json` est notée, et rien n\'en est encore tiré', () => {
    assert.equal(pack().schema, true);
    assert.equal(lirePack({ fichiers: [PACK[0]], hacher: sha }).schema, false);
  });

  test('la source et le commit voyagent avec le pack', () => {
    const p = pack();
    assert.equal(p.source, 'https://github.com/google/mantis');
    assert.equal(p.commit, 'abc1234');
  });
});

/* ── Le résumé que l'Admin lit ────────────────────────────────────────────── */

describe('l\'écran d\'import dit la vérité', () => {
  test('sur le VRAI Mantis : découvertes, ZÉRO gouvernable', () => {
    /*
     * Le résultat qu'on veut afficher. Moins spectaculaire qu'un import en un clic — et
     * c'est la seule plateforme de la pièce qui refuse de faire semblant d'avoir compris.
     */
    const r = pack().resume;
    assert.equal(r.decouvertes, 2);
    assert.equal(r.sansZoneDombre, 0);
    assert.equal(r.isolementNonResolu, 2);
    assert.equal(r.outilsNonResolus, 2);
    assert.equal(r.contratIncomplet, 2);
  });

  test('`mesurees` vaut TOUJOURS zéro à l\'import', () => {
    // Aucune capacité importée n'a passé le banc. Sans cette ligne, on affiche seize
    // promesses avec de jolies pastilles.
    assert.equal(pack().resume.mesurees, 0);
    assert.equal(resumePack([]).mesurees, 0);
  });

  test('il compte celles qui portent un script', () => {
    assert.equal(pack().resume.avecScripts, 1);
  });

  test('un pack vide ne casse rien et n\'annonce rien', () => {
    const r = resumePack([]);
    assert.equal(r.decouvertes, 0);
    assert.equal(r.sansZoneDombre, 0);
  });
});

/* ── Le formulaire lui-même ───────────────────────────────────────────────── */

describe('le formulaire est le garde-fou, pas une doc', () => {
  test('chaque question dit POURQUOI elle est posée', () => {
    // Une question sans raison se fait remplir au hasard, puis retirer parce qu'« elle
    // ne sert à rien ».
    for (const c of CHAMPS) {
      assert.ok(c.quoi && c.quoi.length > 10, `${c.nom} : pas de « quoi »`);
      assert.ok(c.pourquoi && c.pourquoi.length > 30, `${c.nom} : pas de « pourquoi »`);
    }
  });

  test('seuls `lu` et `impose` rendent lançable', () => {
    // I003, en une ligne : un champ tiré de la prose ne rend rien lançable.
    assert.equal(fiable('lu'), true);
    assert.equal(fiable('impose'), true);
    assert.equal(fiable('deduit'), false);
    assert.equal(fiable('manquant'), false);
  });

  test('les champs qui portent un DROIT sont tous requis', () => {
    // Outils et isolement décident de ce que la capacité aura le droit de faire. Les
    // rendre facultatifs ferait de l'oubli le chemin le plus permissif.
    const requis = CHAMPS.filter((c) => c.requis).map((c) => c.nom);
    for (const n of ['outils', 'isolement', 'ecrit', 'empreinte']) assert.ok(requis.includes(n), n);
  });
});
