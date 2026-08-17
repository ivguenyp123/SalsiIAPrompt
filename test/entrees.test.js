/*
 * La banque d'entrées.
 *
 * ── CE QUE CES TESTS PROTÈGENT ───────────────────────────────────────────────
 *
 * Un cas d'or ne vaut que par la matière sur laquelle il se joue. Trois façons de le
 * vider de son sens, et une famille de tests pour chacune :
 *
 *   1. le manifeste ment           → un fichier annoncé qui n'existe pas, un décompte
 *                                     de lignes inventé, une origine absente
 *   2. le cas pointe dans le vide  → `diff_fixture: ce-qui-nexiste-pas`, que rien ne
 *                                     signalait avant L023
 *   3. Salsi sert du vent          → des cas composés sur des valeurs d'exemple alors
 *                                     que la banque avait de la vraie matière
 *
 * Le premier est le plus important : c'est le seul que ni le lint ni l'écran ne peuvent
 * rattraper, parce qu'il porte sur des fichiers qu'aucun des deux ne lit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR, WARN } from '../lint/index.js';
import { natureDeCle, naturesRequises, nature, entree, pourGenre, references, chemin, toutes }
  from '../lib/entrees.js';
import { composerCas, SITUATIONS, PROPOSITIONS } from '../studio/assistant-cas.js';
import { artifactToForm } from '../studio/artifact-to-form.js';
import { formToArtifact } from '../studio/form-to-artifact.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));

const banque = loadYaml(join(ROOT, 'entrees/index.yaml'));
const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  entrees: banque,
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const codes = (a, severity) =>
  lint(a, ctx).findings.filter((f) => f.severity === severity).map((f) => f.code);

/* ── 1. Le manifeste ne ment pas ───────────────────────────────────────────── */

describe('le manifeste décrit des fichiers qui existent vraiment', () => {
  const entrs = toutes(banque);

  test('chaque entrée annoncée est un fichier présent', () => {
    for (const e of entrs) {
      assert.ok(existsSync(join(ROOT, chemin(e))),
        `${e.nature}/${e.id} annonce ${chemin(e)}, qui n'existe pas`);
    }
  });

  test('le décompte de lignes est le vrai', () => {
    // Ce chiffre n'est pas décoratif : c'est lui qui distingue un cas courant d'un cas
    // limite dans l'écran. Un chiffre à la louche ferait choisir le mauvais fichier.
    for (const e of entrs) {
      if (e.lignes === undefined) continue;
      const reel = readFileSync(join(ROOT, chemin(e)), 'utf8').split('\n').length - 1;
      assert.equal(e.lignes, reel, `${e.nature}/${e.id} annonce ${e.lignes} ligne(s), en compte ${reel}`);
    }
  });

  test('toute entrée dit d\'où elle vient', () => {
    // Une entrée sans origine est une entrée inventée, et un banc d'essai qui tourne sur
    // des entrées inventées ne prouve rien.
    for (const e of entrs) assert.ok(e.origine && e.origine.length >= 10, `${e.id} sans origine`);
  });

  test('la banque est majoritairement récoltée, pas écrite', () => {
    const inventees = entrs.filter((e) => e.synthetique);
    assert.ok(inventees.length * 4 <= entrs.length,
      `${inventees.length} entrées sur ${entrs.length} sont synthétiques : la banque dérive`);
  });

  test('les identifiants ne se répètent pas au sein d\'une nature', () => {
    for (const n of banque.natures) {
      const ids = n.entrees.map((e) => e.id);
      assert.equal(new Set(ids).size, ids.length, `doublon dans ${n.nature}`);
    }
  });

  test('chaque nature couvre au moins le cas courant et un cas de refus', () => {
    // Sans ces deux-là, Salsi ne peut pas composer une proposition de niveau « équipe »
    // sans resservir deux fois le même fichier.
    for (const n of banque.natures) {
      const genres = new Set(n.entrees.map((e) => e.genre));
      assert.ok(genres.has('nominal'), `${n.nature} n'a aucune entrée nominale`);
      assert.ok(genres.has('refus'), `${n.nature} n'a aucune entrée de refus`);
    }
  });

  test('le manifeste respecte son schéma', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'schema/entree-registry.schema.json'), 'utf8'));
    const verdict = makeValidator(schema)(banque);
    assert.equal(verdict.valid, true, JSON.stringify(verdict.errors));
  });
});

/* ── 2. La résolution ──────────────────────────────────────────────────────── */

describe('la clé de contexte relie l\'artefact à la banque', () => {
  test('`<nature>_fixture` porte la nature dans son préfixe', () => {
    // Aucun champ nouveau dans l'artefact : la convention qui existait déjà à la main
    // dans commit-message.yaml devient exécutable.
    assert.equal(natureDeCle('diff_fixture'), 'diff');
    assert.equal(natureDeCle('pipeline_log_fixture'), 'pipeline_log');
    assert.equal(natureDeCle('repo'), null);
    assert.equal(natureDeCle('fixture'), null);
  });

  test('seules les variables de source `signal` appellent de la matière', () => {
    // `repo` et `stack` sont des chaînes : il n'y a rien à capturer.
    assert.deepEqual(naturesRequises([
      { name: 'repo', source: 'repo' },
      { name: 'diff', source: 'signal' },
      { name: 'ton', source: 'user' }
    ]), ['diff']);
  });

  test('une référence distingue « nature inconnue » de « identifiant inconnu »', () => {
    // Les deux ne se corrigent pas de la même façon : l'une demande d'alimenter la
    // banque, l'autre de corriger une faute de frappe.
    const [a, b] = references({ diff_fixture: 'petit-fix', cafe_fixture: 'noir' }, banque);
    assert.equal(a.natureConnue, true);
    assert.ok(a.entree, 'petit-fix se résout');
    assert.equal(b.natureConnue, false);
  });

  test('le chemin rendu est celui du dépôt', () => {
    assert.equal(chemin(entree(banque, 'diff', 'petit-fix')), 'entrees/diff/petit-fix.txt');
  });
});

describe('le choix d\'une entrée pour un genre de situation', () => {
  test('rend une entrée du genre demandé', () => {
    assert.equal(pourGenre(banque, 'diff', 'limite').genre, 'limite');
    assert.equal(pourGenre(banque, 'diff', 'vide').genre, 'vide');
  });

  test('ne resert pas la même entrée deux fois', () => {
    // Deux cas nominaux joués sur le même fichier testeraient deux fois la même chose,
    // et le compte de L010 serait un trompe-l'œil.
    const premier = pourGenre(banque, 'diff', 'nominal');
    const second = pourGenre(banque, 'diff', 'nominal', [premier.id]);
    assert.notEqual(second.id, premier.id);
  });

  test('à défaut du genre demandé, retombe sur du réel plutôt que sur rien', () => {
    const e = pourGenre(banque, 'pipeline_log', 'vide');
    assert.ok(e, 'une entrée du mauvais genre reste plus utile qu\'un cas joué sur du vide');
  });

  test('sans banque, ne rend rien — et ne lève pas', () => {
    assert.equal(pourGenre(null, 'diff', 'nominal'), undefined);
    assert.equal(nature(undefined, 'diff'), undefined);
  });
});

/* ── 3. L023 ───────────────────────────────────────────────────────────────── */

describe('L023 — un cas d\'or joue sur une entrée qui existe', () => {
  const charger = (p) => loadYaml(join(ROOT, p));

  test('refuse un cas qui désigne une entrée absente', () => {
    const a = charger('fixtures/invalid/L023-entree-absente.yaml');
    assert.ok(codes(a, ERROR).includes('L023'));
  });

  test('le message dit ce qui existe, pas seulement ce qui manque', () => {
    // Un refus qui n'indique pas la sortie fait rouvrir le manifeste à la main.
    const a = charger('fixtures/invalid/L023-entree-absente.yaml');
    const f = lint(a, ctx).findings.find((x) => x.code === 'L023');
    assert.match(f.message, /petit-fix/, f.message);
  });

  test('avertit quand la matière existe et que le cas ne la prend pas', () => {
    const a = charger('fixtures/warn/L023-signal-sans-entree.yaml');
    assert.ok(codes(a, WARN).includes('L023'));
    assert.equal(lint(a, ctx).blocked, false, 'un cas sans matière se discute, il ne se refuse pas');
  });

  test('se tait entièrement sans banque', () => {
    // Comme L001 sans validateur : mieux vaut une règle absente qu'une règle qui
    // invente son référentiel. Sinon le Studio hors ligne refuserait tout.
    const a = charger('fixtures/invalid/L023-entree-absente.yaml');
    const sans = { ...ctx, entrees: null };
    assert.ok(!lint(a, sans).findings.some((f) => f.code === 'L023'));
  });

  test('ne dit rien d\'une nature dont la banque n\'a aucune matière', () => {
    // Reprocher à un auteur de ne pas fournir ce que la banque n'a pas serait une
    // exigence sans issue.
    const a = charger('fixtures/warn/L023-signal-sans-entree.yaml');
    const vide = { ...ctx, entrees: { natures: [] } };
    assert.ok(!lint(a, vide).findings.some((f) => f.code === 'L023'));
  });

  test('les artefacts du registre s\'y conforment — TOUS, pas une liste écrite ici', () => {
    /*
     * Ce test nommait quatre fichiers en dur. `artifacts/` est un dossier que les gens
     * administrent depuis l'écran : le jour où l'un d'eux a retiré « Vérifier les
     * migrations Flyway », la suite est devenue rouge sur un geste parfaitement normal.
     *
     * Un test qui casse quand le produit s'utilise correctement apprend à ignorer les
     * tests. On lit donc le dossier tel qu'il est — ce qui couvre aussi tout ce qui y
     * sera ajouté sans que personne pense à revenir ici.
     */
    const fichiers = readdirSync(join(ROOT, 'artifacts')).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(fichiers.length, 'aucun artefact au registre : vérifier le test');

    for (const f of fichiers) {
      const rapport = lint(charger(`artifacts/${f}`), ctx);
      assert.equal(rapport.blocked, false,
        `${f} : ${rapport.findings.filter((x) => x.severity === ERROR).map((x) => x.code).join(', ')}`);
    }
  });
});

/* ── 4. Salsi sert de la vraie matière ─────────────────────────────────────── */

describe('Salsi choisit les entrées sans rien demander', () => {
  const formDe = (f) => artifactToForm(loadYaml(join(ROOT, 'artifacts', f)));

  test('un artefact qui consomme un signal reçoit des entrées réelles', () => {
    const form = formDe('commit-message.yaml');
    const cas = composerCas({ situations: PROPOSITIONS.officiel, variables: form.variables,
                              criteria: form.criteria, targets: ctx.targets, entrees: banque });

    for (const c of cas) {
      const cle = c.context.find((x) => x.key === 'diff_fixture');
      assert.ok(cle, `${c.id} n'a reçu aucune entrée`);
      assert.ok(entree(banque, 'diff', cle.value), `${c.id} désigne ${cle.value}, absent de la banque`);
    }
  });

  test('l\'entrée choisie est du genre de la situation', () => {
    for (const s of SITUATIONS) {
      const [c] = composerCas({ situations: [s.id], variables: [{ name: 'diff', source: 'signal' }],
                                criteria: [], targets: ctx.targets, entrees: banque });
      const id = c.context.find((x) => x.key === 'diff_fixture').value;
      assert.equal(entree(banque, 'diff', id).genre, s.id, `${s.id} → ${id}`);
    }
  });

  test('deux cas du même genre ne jouent pas sur le même fichier', () => {
    const cas = composerCas({ situations: ['nominal', 'nominal'],
                              variables: [{ name: 'diff', source: 'signal' }],
                              criteria: [], targets: ctx.targets, entrees: banque });
    const [a, b] = cas.map((c) => c.context.find((x) => x.key === 'diff_fixture').value);
    assert.notEqual(a, b);
  });

  test('une variable de source `repo` garde une valeur d\'exemple lisible', () => {
    // Elle n'a pas de matière à recevoir : lui inventer un fichier serait faux.
    const [c] = composerCas({ situations: ['nominal'],
                              variables: [{ name: 'repo', source: 'repo' }, { name: 'diff', source: 'signal' }],
                              criteria: [], targets: ctx.targets, entrees: banque });
    assert.deepEqual(c.context.map((x) => x.key), ['repo', 'diff_fixture']);
    assert.match(c.context[0].value, /repo/);
  });

  test('ce que Salsi propose franchit L023 — et le niveau visé', () => {
    // LA propriété. Un générateur qui produirait des cas bien formés mais pointant à
    // côté ferait apparaître autant d'erreurs L023, et l'auteur conclurait que l'aide
    // est cassée.
    for (const [niveau, situations] of Object.entries(PROPOSITIONS)) {
      const form = formDe('commit-message.yaml');
      const cas = composerCas({ situations, variables: form.variables, criteria: form.criteria,
                                targets: ctx.targets, entrees: banque });
      const a = formToArtifact({ ...form, goldenCases: cas, targetLevel: niveau }, ctx);
      const rapport = lint(a, ctx);
      assert.equal(rapport.blocked, false,
        `${niveau} refusé : ${rapport.findings.filter((f) => f.severity === ERROR).map((f) => f.code).join(', ')}`);
      assert.ok(!rapport.findings.some((f) => f.code === 'L023'),
        `${niveau} : ${rapport.findings.filter((f) => f.code === 'L023').map((f) => f.message).join(' | ')}`);
    }
  });

  test('sans banque, l\'aide continue de fonctionner comme avant', () => {
    // Le Studio doit rester utilisable si le manifeste n'est pas chargé.
    const [c] = composerCas({ situations: ['nominal'], variables: [{ name: 'diff', source: 'signal' }],
                              criteria: [], targets: ctx.targets });
    assert.deepEqual(c.context.map((x) => x.key), ['diff']);
  });

  test('l\'aperçu porte de quoi montrer la matière à l\'auteur', () => {
    // Un auteur qui ne voit pas sur quoi le cas se joue ne peut pas juger s'il vaut
    // quelque chose. Le titre et l'origine remontent donc jusqu'à l'écran.
    const [c] = composerCas({ situations: ['limite'], variables: [{ name: 'diff', source: 'signal' }],
                              criteria: [], targets: ctx.targets, entrees: banque });
    assert.equal(c.entrees.length, 1);
    assert.ok(c.entrees[0].titre && c.entrees[0].origine && c.entrees[0].lignes >= 0);
  });
});
