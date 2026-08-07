/*
 * Lancer un artefact, et évaluer son contrat.
 *
 * ── CE QUE CES TESTS PROTÈGENT ───────────────────────────────────────────────
 *
 * `criteria` était déclaré depuis le début et jamais ÉVALUÉ : le registre décrivait des
 * vérifications que personne ne faisait. C'est exactement la gouvernance de papier qu'il
 * est censé remplacer. Les résolveurs la rendent exécutable — encore faut-il qu'ils
 * disent vrai, sinon on a remplacé un vœu par un mensonge.
 *
 * Et deux portes qu'un appel automatique ne doit jamais pouvoir sauter :
 *   · le pré-vol tranche AVANT le premier jeton dépensé
 *   · la confirmation humaine n'est pas contournable en appelant la fonction autrement
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { resoudre, satisfait, postvol, RESOLVABLES } from '../runtime/resolveurs.js';
import { lancer, rendre, trous, valeursDepuisContexte } from '../runtime/lancer.js';
import { chemin } from '../lib/entrees.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

const registres = {
  tools: load('registries/tools.yaml').tools,
  targets: load('registries/targets.yaml').targets,
  entrees: load('entrees/index.yaml'),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const models = load('registries/models.yaml').models;

/** Un Vertex simulé qui rend ce qu'on lui dit, et note ce qu'il a reçu. */
const faux = (texte) => {
  const vu = {};
  return { vu, modele: () => 'gemini-test',
           generer: async ({ prompt, tier }) => {
             vu.prompt = prompt; vu.tier = tier;
             return { texte, modele: 'gemini-test', tier,
                      jetons: { entree: 100, sortie: 50 }, motifArret: 'STOP' };
           } };
};

const contexteOk = (extra = {}) => ({
  registres, depot: { path: 'x/y', scope: 'Plateforme', sensibilite: 'interne' },
  criticite: 'test', ...extra
});

/* ── Le rendu ──────────────────────────────────────────────────────────────── */

describe('le spec devient un prompt', () => {
  test('chaque variable reçoit sa valeur', () => {
    assert.equal(rendre('dépôt {{repo}}, stack {{stack}}', { repo: 'a', stack: 'b' }),
                 'dépôt a, stack b');
  });

  test('une variable sans valeur RESTE visible au lieu de disparaître', () => {
    // Devenir la chaîne vide ferait partir un prompt à trou qui a l'air complet, et le
    // modèle répondrait quelque chose — c'est le pire des deux mondes.
    assert.equal(rendre('dépôt {{repo}}', {}), 'dépôt {{repo}}');
    assert.deepEqual(trous(rendre('{{a}} et {{b}}', { a: 'x' })), ['b']);
  });

  test('une valeur vide compte comme absente', () => {
    assert.deepEqual(trous(rendre('{{a}}', { a: '' })), ['a']);
    assert.deepEqual(trous(rendre('{{a}}', { a: 0 })), []);
  });
});

describe('le contexte d\'un cas d\'or devient de la matière', () => {
  const lire = (e) => readFileSync(join(ROOT, chemin(e)), 'utf8');

  test('`diff_fixture` remplit `{{diff}}` avec le contenu du fichier', () => {
    // Le moment où la banque cesse d'être un manifeste : un vrai diff entre dans un
    // vrai prompt.
    const v = valeursDepuisContexte({ repo: 'demo', diff_fixture: 'petit-fix' },
                                     registres.entrees, lire);
    assert.equal(v.repo, 'demo');
    assert.match(v.diff, /^commit /);
    assert.ok(v.diff.length > 1000);
    assert.equal(v.diff_fixture, undefined, 'la clé de désignation ne devient pas une variable');
  });

  test('une entrée absente lève au lieu de rendre du vide', () => {
    // L023 l'a déjà refusée au lint. Laisser passer ici transformerait un test cassé en
    // test qui passe sur une chaîne vide.
    assert.throws(() => valeursDepuisContexte({ diff_fixture: 'fantome' }, registres.entrees, lire),
      /absente de la banque/);
  });

  test('tous les cas d\'or du registre se résolvent en vraies valeurs', () => {
    // La propriété d'ensemble : aucun artefact publié ne porte un cas injouable.
    for (const f of ['expliquer-un-code.yaml', 'relire-un-changement.yaml',
                     'commit-message.yaml', 'expliquer-un-pipeline-en-echec.yaml']) {
      const art = load(`artifacts/${f}`);
      for (const g of art.golden_cases || []) {
        const v = valeursDepuisContexte(g.context, registres.entrees, lire);
        for (const decl of art.variables || []) {
          if (decl.required === false) continue;
          assert.ok(v[decl.name] !== undefined, `${f} · ${g.id} : ${decl.name} sans valeur`);
        }
      }
    }
  });
});

/* ── Les résolveurs ────────────────────────────────────────────────────────── */

describe('le contrat devient évaluable', () => {
  test('la longueur, les sections, le JSON', () => {
    assert.equal(resoudre('output.length', 'abcd'), 4);
    assert.deepEqual(resoudre('output.sections', '# Cause\ntexte\n## Première action'),
                     ['Cause', 'Première action']);
    assert.equal(resoudre('output.is_valid_json', '{"a":1}'), true);
    // Un modèle encadre volontiers son JSON : le refuser pour ça ferait échouer un cas
    // d'or sur la mise en forme au lieu du fond.
    assert.equal(resoudre('output.is_valid_json', '```json\n{"a":1}\n```'), true);
    assert.equal(resoudre('output.is_valid_json', 'voici : {"a":1}'), false);
  });

  test('la convention de commit se lit sur la PREMIÈRE ligne', () => {
    assert.equal(resoudre('output.matches_convention', 'feat(auth): ajouter le login\n\ncorps'), true);
    assert.equal(resoudre('output.matches_convention', 'fix!: casser le contrat'), true);
    assert.equal(resoudre('output.matches_convention', 'Ajout du login'), false);
    assert.equal(resoudre('output.matches_convention', 'texte\nfeat: trop tard'), false);
  });

  test('le secret est cherché dans la SORTIE, avec les motifs du lint', () => {
    // Un agent qui relit un diff contenant un jeton ne doit pas le recopier. Deux listes
    // de motifs finiraient par diverger, et c'est celle-ci qui compte ce jour-là.
    assert.equal(resoudre('output.contains_secret',
      'la ligne 12 contient ghp_AbCdEfGhIjKlMnOpQrStUvWxYz01'), true);
    assert.equal(resoudre('output.contains_secret',
      'la ligne 12 contient un jeton GitHub en clair'), false);
  });

  test('un patch se compte et se contrôle sans être appliqué', () => {
    const patch = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,2 +1,3 @@\n a\n+b\n c\n';
    assert.equal(resoudre('output.files_touched', patch), 1);
    assert.equal(resoudre('output.patch_applies', patch), true);
    // Les comptes annoncés ne collent plus : c'est le patch tronqué ou halluciné.
    assert.equal(resoudre('output.patch_applies',
      'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,9 +1,9 @@\n a\n'), false);
    assert.equal(resoudre('output.patch_applies', 'voici un patch, promis'), false);
  });

  test('une cible `state` n\'est pas résolvable ici, et rend `undefined`', () => {
    // Ni satisfaite ni violée : une vérification qui n'a pas eu lieu, et il faut que ça
    // se voie. La confondre avec un succès ferait passer un agent dont on n'a vérifié
    // que la longueur pour un agent conforme.
    for (const cible of ['pipeline.status', 'branch.mergeable', 'tests.passed']) {
      assert.equal(resoudre(cible, 'peu importe'), undefined, cible);
    }
  });

  test('toute cible de classe `form` du registre a son résolveur', () => {
    // Sans ça, un auteur déclarerait un critère que le post-vol ignorerait en silence.
    const form = registres.targets.filter((t) => t.class === 'form').map((t) => t.target);
    for (const t of form) assert.ok(RESOLVABLES.includes(t), `${t} n'a pas de résolveur`);
  });
});

describe('les opérateurs', () => {
  test('les comparaisons portent sur des nombres, pas sur des chaînes', () => {
    assert.equal(satisfait(9, 'lte', '10'), true);
    assert.equal(satisfait(100, 'lte', '20'), false);
  });

  test('`contains` sur un tableau de sections cherche sans la casse', () => {
    assert.equal(satisfait(['Cause probable', 'Action'], 'contains', 'cause'), true);
    assert.equal(satisfait(['Cause'], 'contains', 'remédiation'), false);
  });

  test('`exists` sur un tableau vide est faux — une section absente n\'existe pas', () => {
    assert.equal(satisfait([], 'exists', true), false);
    assert.equal(satisfait(['A'], 'exists', true), true);
  });

  test('un motif invalide ne fait pas exploser le post-vol', () => {
    assert.equal(satisfait('x', 'matches', '('), false);
  });
});

describe('le post-vol rend un verdict, pas une impression', () => {
  const artefact = { criteria: [
    { target: 'output.length', op: 'lte', value: 100 },
    { target: 'output.contains_secret', op: 'eq', value: false },
    { target: 'pipeline.status', op: 'eq', value: 'success' }
  ] };

  test('il sépare ce qui passe, ce qui viole, et ce qu\'il n\'a pas pu juger', () => {
    const r = postvol(artefact, 'une sortie courte et propre');
    assert.equal(r.conforme, true);
    assert.equal(r.violes.length, 0);
    assert.equal(r.nonResolus.length, 1);
    assert.match(r.nonResolus[0].pourquoi, /banc d'essai/);
  });

  test('un critère violé rend le tout non conforme', () => {
    const r = postvol(artefact, 'x'.repeat(200));
    assert.equal(r.conforme, false);
    assert.equal(r.violes[0].cible, 'output.length');
    assert.equal(r.violes[0].valeur, 200);
  });

  test('le non-résolu ne compte JAMAIS comme un succès', () => {
    const r = postvol({ criteria: [{ target: 'tests.passed', op: 'eq', value: true }] }, 'ok');
    assert.equal(r.constats[0].verdict, 'non résolu');
    assert.equal(r.nonResolus.length, 1);
  });
});

/* ── Le lancement ──────────────────────────────────────────────────────────── */

describe('lancer un artefact', () => {
  const lecture = () => load('artifacts/expliquer-un-code.yaml');
  const valeursOk = { repo: 'demo-front', code: 'const a = 1;' };

  test('le prompt part rendu, au palier déclaré', async () => {
    const v = faux('## À quoi ça sert\nÀ rien.\n## Comment ça marche\nBien.\n## Ce qui surprend\nRien.');
    const r = await lancer(lecture(), { vertex: v, valeurs: valeursOk, contexte: contexteOk(), models });
    assert.equal(r.refuse, false);
    assert.match(v.vu.prompt, /dépôt demo-front/);
    assert.match(v.vu.prompt, /const a = 1;/);
    assert.equal(v.vu.tier, 'small');
    assert.ok(!v.vu.prompt.includes('{{'), 'aucun trou ne part au modèle');
  });

  test('le contrat est évalué sur la sortie réelle', async () => {
    const v = faux('## À quoi ça sert\nÀ rien.');
    const r = await lancer(lecture(), { vertex: v, valeurs: valeursOk, contexte: contexteOk(), models });
    assert.equal(r.postvol.conforme, true);
    assert.deepEqual(r.postvol.constats.map((c) => c.cible).sort(),
                     ['output.contains_secret', 'output.length', 'output.sections']);
  });

  test('une sortie qui viole le contrat est signalée, pas maquillée', async () => {
    const v = faux('pas de section du tout');
    const r = await lancer(lecture(), { vertex: v, valeurs: valeursOk, contexte: contexteOk(), models });
    assert.equal(r.postvol.conforme, false);
    assert.equal(r.postvol.violes[0].cible, 'output.sections');
  });

  test('le pré-vol tranche AVANT le premier jeton dépensé', async () => {
    // Refuser après l'appel coûterait le prix de l'appel et aurait laissé partir le
    // prompt : c'est toute la raison d'être du moment 4.
    let appele = false;
    const v = { modele: () => 'x', generer: async () => { appele = true; return { texte: 'a' }; } };
    const casse = { ...lecture(), criteria: [] };          // L008 le refuse désormais
    const r = await lancer(casse, { vertex: v, valeurs: valeursOk, contexte: contexteOk(), models });
    assert.equal(r.refuse, true);
    assert.equal(appele, false, 'aucun appel n\'a été fait');
    assert.match(r.raison, /P001/);
  });

  test('la confirmation humaine ne se contourne pas en appelant autrement', async () => {
    // P007 rend la confirmation obligatoire pour ce qui écrit. Si `lancer()` l'ignorait,
    // la contrainte ne tiendrait plus qu'à la discipline de l'appelant — exactement ce
    // que le pré-vol existe pour supprimer.
    const ecrit = load('artifacts/prep-delivery.yaml');
    const v = faux('ok');
    const sans = await lancer(ecrit, { vertex: v, models,
      valeurs: { repo: 'demo', stack: 'java' }, contexte: contexteOk() });
    assert.equal(sans.refuse, true);
    assert.match(sans.raison, /confirmation humaine/);

    const avec = await lancer(ecrit, { vertex: v, models, assume: true,
      valeurs: { repo: 'demo', stack: 'java' }, contexte: contexteOk() });
    assert.equal(avec.refuse, false);
  });

  test('un prompt à trou ne part pas', async () => {
    let appele = false;
    const v = { modele: () => 'x', generer: async () => { appele = true; return { texte: 'a' }; } };
    const r = await lancer(lecture(), { vertex: v, models, contexte: contexteOk(),
                                        valeurs: { repo: 'demo-front' } });
    assert.equal(r.refuse, true);
    assert.equal(appele, false);
  });

  test('le coût est rendu avec la sortie, toujours', async () => {
    // Une sortie sans son coût rend le FinOps impossible à reconstituer après coup.
    const v = faux('## A\nx');
    const r = await lancer(lecture(), { vertex: v, valeurs: valeursOk, contexte: contexteOk(), models });
    assert.equal(typeof r.cout, 'number');
    assert.deepEqual(r.jetons, { entree: 100, sortie: 50 });
  });
});
