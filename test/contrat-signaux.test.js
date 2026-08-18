/*
 * LE CONTRAT ENTRE LES SIGNAUX ET L'ÉCRAN.
 *
 * ── LE DÉFAUT QUI A MOTIVÉ CE FICHIER ────────────────────────────────────────
 *
 * `chiffres_daily` a été livré, testé sur trente cas, confronté à la formule du hub sur
 * neuf scénarios — et il ne produisait PAS de champ `texte`.
 *
 * C'est le seul champ qui compte. L'écran fait `zone.value = r.texte`, et cette zone EST
 * la matière injectée dans le prompt. Sans lui, `zone.value` vaut `undefined`, le champ
 * part vide, l'agent répond quand même — et invente les chiffres qu'on ne lui a pas
 * donnés. Précisément la faute que ce registre existe pour empêcher, introduite par
 * l'oubli d'un seul champ, et invisible à trente tests qui vérifiaient le calcul.
 *
 * Ce fichier ne teste donc AUCUN calcul. Il teste le contrat : tout signal calculable
 * rend un texte non vide, qui porte le nom du dépôt, et qui ne fuite rien.
 *
 * Il est écrit pour ne pas avoir à être mis à jour : la liste des signaux est LUE dans
 * la table de dispatch du catalogue, jamais recopiée. Un signal ajouté sans texte devient
 * rouge tout seul.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repartitionContributions, inventaireBranches, sait } from '../lib/signaux-matiere.js';
import { rapportSecrets, inventaireDependances, rapportConformite } from '../lib/signaux-securite.js';
import { chiffresDora } from '../lib/signaux-dora.js';
import { chiffresDaily } from '../lib/signaux-daily.js';
import { parcSecurite } from '../lib/signaux-parc.js';
import { revueMr } from '../lib/signaux-revue.js';
import { jobEnEchec } from '../lib/signaux-ci.js';
import { rapportDepot } from '../lib/signaux-depot.js';
import { planDeLivraison } from '../lib/signaux-livraison.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAINTENANT = '2026-08-17T18:00:00Z';
const DEPOT = 'lcl/paiement';

/*
 * La liste des signaux CALCULABLES, lue dans le catalogue.
 *
 * Recopiée à la main, elle aurait oublié le prochain signal ajouté — c'est-à-dire
 * exactement le cas que ce fichier existe pour attraper.
 */
function signauxDuCatalogue() {
  const src = readFileSync(join(ROOT, 'catalogue/catalogue.js'), 'utf8');
  const debut = src.indexOf('const CALCULS = {');
  const fin = src.indexOf('const RESUMES', debut);
  assert.ok(debut > 0 && fin > debut, 'la table CALCULS doit être trouvable');
  return [...src.slice(debut, fin).matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}

/*
 * Une invocation minimale mais RÉALISTE de chaque signal.
 *
 * Le `revue_mr` et le `job_en_echec` ne passent pas par `CALCULS` — ils sont déclenchés
 * par une liste déroulante — mais ils obéissent au même contrat et sont testés ici pour
 * la même raison.
 */
const INVOCATIONS = {
  repartition_contributions: () => repartitionContributions({
    depot: DEPOT, commits: [{ auteur: 'a.b', date: MAINTENANT }], zones: [] }),

  inventaire_branches: () => inventaireBranches({
    depot: DEPOT, branches: [{ name: 'main', quand: MAINTENANT, default: true }],
    maintenant: MAINTENANT }),

  rapport_secrets: () => rapportSecrets({
    depot: DEPOT, fichiers: [], candidats: 0, total: 0 }),

  inventaire_dependances: () => inventaireDependances({
    depot: DEPOT, fichiers: [], candidats: 0 }),

  rapport_conformite: () => rapportConformite({
    depot: DEPOT, defaut: 'main', visibilite: 'private',
    branches: [{ name: 'main', protectee: true, default: true }],
    chemins: ['README.md'], pom: null, derniereActivite: MAINTENANT,
    maintenant: MAINTENANT }),

  chiffres_dora: () => chiffresDora({
    depot: DEPOT, pipelines: [], mrs: [], brancheDefaut: 'main', maintenant: MAINTENANT }),

  activite_du_jour: () => chiffresDaily({
    depot: DEPOT, fenetreJours: 7,
    pipelines: [{ statut: 'succes', branche: 'main', quand: MAINTENANT }],
    mrsFusionnees: [], mrsOuvertes: [], commits: [],
    branches: [{ name: 'main', quand: MAINTENANT }], deploiements: [],
    maintenant: MAINTENANT }),

  /*
   * `conformite`, pas `rapport` — le nom que le module attend.
   *
   * Écrit `rapport` du premier coup, ce test rendait « 0 dépôt scanné » et passait quand
   * même la vérification du texte : le signal décrit très bien un parc vide. C'est
   * exactement la classe de défaut que ce fichier traque, prise sur lui-même — un champ
   * mal nommé ne jette pas, il produit un texte plausible qui ne parle de rien.
   */
  parc_securite: () => parcSecurite({
    depots: [{ depot: DEPOT, conformite: rapportConformite({
      depot: DEPOT, defaut: 'main', visibilite: 'private',
      branches: [{ name: 'main', protectee: true, default: true }],
      chemins: [], pom: null, derniereActivite: MAINTENANT, maintenant: MAINTENANT }) }],
    ignores: 0, echoues: [] }),

  revue_mr: () => revueMr({
    depot: DEPOT,
    pr: { numero: 1, titre: 'Un titre', branche: 'feat/x', cible: 'main', auteur: 'a.b' },
    diff: '--- a/x.js\n+++ b/x.js\n@@\n+const a = 1;\n', fichiers: 1, binaires: [] }),

  rapport_depot: () => rapportDepot({
    depot: DEPOT, info: { defaut: 'main', visibilite: 'private' },
    branches: [{ name: 'main', default: true, protectee: false, quand: MAINTENANT }],
    chemins: ['src/a.js'],
    commits: [{ message: 'wip', author: 'a.b', date: MAINTENANT }],
    mrsOuvertes: [], mrsFusionnees: [], pipelines: [], maintenant: MAINTENANT }),

  job_en_echec: () => jobEnEchec({
    depot: DEPOT, run: { id: 7, branche: 'feat/x', quand: MAINTENANT, sha: 'abc1234' },
    jobs: [{ nom: 'unit', etape: 'test', statut: 'echec', secondes: 12 }],
    job: { nom: 'unit', etape: 'test', statut: 'echec', secondes: 12 },
    log: 'npm ERR! le test a échoué\nERROR: Job failed: exit code 1',
    configCi: 'unit:\n  script: npm test\n', cheminConfig: '.gitlab-ci.yml' }),

  /*
   * Le seul signal du lot qui reçoive des RÉGLAGES.
   *
   * L'invocation en pose donc de vrais : sans branche, `planifier` refuse, et le contrat
   * serait vérifié sur un texte d'échec — qui le satisfait pourtant, puisqu'un refus
   * nomme lui aussi le dépôt. C'est la même chausse-trape que `parc_securite` plus haut :
   * une mauvaise invocation ne jette pas, elle produit un texte plausible qui ne parle
   * de rien.
   */
  plan_de_livraison: () => planDeLivraison({
    depot: DEPOT, branche: 'feat/x', brancheCible: 'main', bump: 'patch',
    ci: { path: '.gitlab-ci.yml', content: 'variables:\n  IMAGE_TAG: "1.4.2"\n' },
    overlays: [{ path: 'Manifests/overlays/uat/kustomization.yaml',
                 content: 'images:\n  - newTag: "1.4.2"\n' }],
    mrs: [], runs: [], deploiements: [], stack: ['maven'],
    maintenant: new Date(MAINTENANT) })
};

/* ── Le contrat ───────────────────────────────────────────────────────────── */

describe('tout signal calculable rend un texte utilisable', () => {
  test('tout signal CALCULÉ est DÉCLARÉ calculable', () => {
    /*
     * ── LE SECOND DÉFAUT DE CETTE FAMILLE, ET IL EST PIRE QUE LE PREMIER ──────
     *
     * Un signal doit être inscrit à DEUX endroits :
     *
     *   CALCULS, dans le catalogue     COMMENT on le calcule
     *   SIGNAUX, dans signaux-matiere  QUE la plateforme sait le calculer
     *
     * `activite_du_jour` n'était inscrit que dans le premier. `sait()` répondait donc non,
     * et l'écran en concluait — logiquement — que la matière devait être saisie à la main :
     * un champ vide, un bouton « Récupérer », et pas de sélecteur de dépôt. Le calcul
     * existait et n'était jamais appelé.
     *
     * Le symptôme ne ressemble pas à une panne : l'agent s'affiche, se lance, et répond —
     * sur un champ vide. C'est la même faute que le `texte` oublié, par une autre porte, et
     * elle a survécu au test qui vérifiait le `texte` parce que celui-ci n'interrogeait
     * jamais `sait()`.
     */
    for (const nom of signauxDuCatalogue()) {
      assert.ok(sait(nom),
        `\`${nom}\` est calculé par le catalogue mais absent de SIGNAUX : l'écran `
        + 'demandera de le saisir à la main et n\'appellera jamais le calcul');
    }
  });

  test('aucun signal du catalogue n\'est absent de ce test', () => {
    // Sans ceci, ajouter un signal sans le tester ferait passer ce fichier en silence —
    // et le fichier ne servirait plus qu'à rassurer.
    for (const nom of signauxDuCatalogue()) {
      assert.ok(INVOCATIONS[nom], `le signal \`${nom}\` n'est pas confronté au contrat`);
    }
  });

  for (const [nom, invoquer] of Object.entries(INVOCATIONS)) {
    test(`\`${nom}\` rend un \`texte\` non vide`, () => {
      /*
       * LE test. `zone.value = r.texte` : sans ce champ, le prompt part avec un trou, le
       * modèle répond quand même et invente ce qu'on ne lui a pas donné.
       */
      const r = invoquer();
      assert.equal(typeof r.texte, 'string', `\`${nom}\` doit rendre un \`texte\``);
      assert.ok(r.texte.trim().length > 40,
        `le texte de \`${nom}\` est trop court pour porter une matière`);
    });

    test(`\`${nom}\` nomme le dépôt sur lequel il porte`, () => {
      // Une matière qui ne se nomme pas est irrattachable : relue dans une réponse, on ne
      // sait plus de quel dépôt elle parlait — et un rapport archivé devient inutile.
      assert.match(invoquer().texte, new RegExp(DEPOT.replace('/', '\\/')),
        `\`${nom}\` doit citer le dépôt dans son texte`);
    });

    test(`\`${nom}\` ne rend pas \`[object Object]\``, () => {
      /*
       * La trace d'un objet interpolé dans un gabarit sans avoir été mis en forme. Ça
       * n'échoue pas, ça ne se voit pas dans un test de calcul, et ça part au modèle comme
       * une donnée — qui répond alors sur une matière qu'il n'a pas reçue.
       */
      assert.ok(!invoquer().texte.includes('[object Object]'),
        `\`${nom}\` interpole un objet sans le mettre en forme`);
      assert.ok(!/\bundefined\b/.test(invoquer().texte),
        `\`${nom}\` laisse passer un \`undefined\` dans son texte`);
    });
  }
});
