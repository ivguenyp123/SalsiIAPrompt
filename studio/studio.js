/*
 * Studio — lint en direct (moment 1).
 *
 * La page importe les VRAIS modules du registre : `lint/index.js`, `lib/schema.js`,
 * `lib/yaml.js`, et charge les registres réels. Aucune copie, aucun portage, aucun
 * bundler — exactement le code qui tourne en CI au moment 2.
 *
 * C'est la raison pour laquelle le linter a été écrit sans dépendance, et pourquoi
 * ajv et js-yaml ont été remplacés : les deux points de contrôle partagent une seule
 * implémentation, donc rien ne peut diverger entre ce que l'auteur voit ici et ce que
 * la porte décidera là-bas.
 */
import { requireSession, clear } from '../app/session.js';
import { mountShell } from '../app/shell.js';
import { createForge, toBase64 } from '../app/forge.js';
import { knownScopes, guessScope } from '../app/scopes.js';
import { lint, ERROR } from '../lint/index.js';
import { GOLDEN_THRESHOLDS } from '../lint/rules/criteria.js';
import { makeValidator } from '../lib/schema.js';
import yaml from '../lib/yaml.js';
import { formToArtifact } from './form-to-artifact.js';
import { artifactToForm, restoreCarried } from './artifact-to-form.js';
import { toYaml } from './to-yaml.js';

const session = requireSession('../app/login.html');
// Sans session, requireSession a déjà lancé la redirection. On suspend l'évaluation du
// module plutôt que de lever : une exception ici s'afficherait en erreur console et
// masquerait les vraies.
if (!session) await new Promise(() => {});

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) n.append(k);
  return n;
};

// ── Chargement des registres et du schéma ────────────────────────────────────
const [tools, targets, schema] = await Promise.all([
  fetch('../registries/tools.yaml').then((r) => r.text()).then((t) => yaml.parse(t).tools),
  fetch('../registries/targets.yaml').then((r) => r.text()).then((t) => yaml.parse(t).targets),
  fetch('../schema/artifact.schema.json').then((r) => r.json())
]);

const ctx = { tools, targets, validateArtifact: makeValidator(schema) };

// ── Identité : l'owner vient de la connexion, il ne se saisit pas ────────────
// Un artefact est SIGNÉ. Laisser l'auteur taper le nom de quelqu'un d'autre — ou un
// tiret — vide la propriété de son sens, et L013 ne rattrape que le tiret.
mountShell({ active: 'studio', session, base: '../',
             onLogout: () => { clear(); location.replace('../app/login.html'); } });

$('ownerPerson').value = session.username;

// Les périmètres sont DÉRIVÉS du registre des outils : la liste n'est pas une saisie.
// Celui du dépôt de travail est présélectionné quand il correspond à un périmètre connu.
const scopes = knownScopes(tools);
const devine = guessScope(localStorage.getItem('salsi_ia_project_path') || '', scopes);
const scopeSelect = $('ownerScope');
scopeSelect.append(new Option('— choisir un périmètre —', ''));
for (const s of scopes) scopeSelect.append(new Option(s, s, false, s === devine));
scopeSelect.value = devine;

/*
 * État du formulaire.
 *
 * `carried` transporte ce que le formulaire ne sait pas afficher — étiquettes, moment,
 * palier de modèle, classification. Sans lui, rouvrir un artefact pour corriger une
 * virgule lui ferait perdre ces champs en silence : ce qu'on ne montre pas, on ne le
 * détruit pas.
 *
 * Les cas d'or en sont sortis : ils ont maintenant leurs propres champs, donc ils se
 * modifient au lieu de traverser intacts.
 */
const state = { variables: [], tools: [], criteria: [], goldenCases: [], carried: {}, editId: null };

/*
 * Reprise d'un artefact existant. Le Catalogue et la file de validation déposent ici ce
 * qu'ils veulent faire corriger, puis renvoient sur le Studio.
 */
const EDIT_KEY = 'salsi_ia_edit';
function reprendre() {
  const brut = sessionStorage.getItem(EDIT_KEY);
  if (!brut) return null;
  sessionStorage.removeItem(EDIT_KEY);        // une reprise, pas un mode collant
  try { return JSON.parse(brut); } catch { return null; }
}

const SOURCES = [['user', 'saisie utilisateur'], ['signal', 'signal du poste'], ['repo', 'métadonnée du dépôt']];

// ── Lignes répétables ────────────────────────────────────────────────────────
function renderVariables() {
  const host = $('variables');
  host.textContent = '';
  state.variables.forEach((v, i) => {
    const name = el('input', { value: v.name, placeholder: 'repo' });
    name.oninput = () => { v.name = name.value; run(); };

    const source = el('select');
    for (const [val, lib] of SOURCES) source.append(el('option', { value: val, textContent: lib, selected: v.source === val }));
    source.onchange = () => { v.source = source.value; run(); };

    const del = el('button', { className: 'del', textContent: '✕', title: 'retirer' });
    del.onclick = () => { state.variables.splice(i, 1); renderVariables(); run(); };

    host.append(el('div', { className: 'row var' }, name, source, del));
  });
}

function renderTools() {
  const host = $('tools');
  host.textContent = '';
  state.tools.forEach((t, i) => {
    const pick = el('select');
    pick.append(el('option', { value: '', textContent: '— choisir un outil —' }));
    for (const ref of tools) pick.append(el('option', { value: ref.id, textContent: ref.id, selected: t.id === ref.id }));
    pick.onchange = () => { t.id = pick.value; renderTools(); run(); };

    // Le registre fait autorité : on AFFICHE mode et executor, on ne les saisit pas.
    const ref = tools.find((x) => x.id === t.id);
    const badges = el('span');
    if (ref) {
      badges.append(el('span', { className: `badge ${ref.mode}`, textContent: ref.mode }));
      badges.append(document.createTextNode(' '));
      badges.append(el('span', { className: 'badge', textContent: ref.executor }));
    }

    const del = el('button', { className: 'del', textContent: '✕', title: 'retirer' });
    del.onclick = () => { state.tools.splice(i, 1); renderTools(); run(); };

    host.append(el('div', { className: 'row tool' }, pick, badges, del));
  });
}

function renderCriteria() {
  const host = $('criteria');
  host.textContent = '';
  state.criteria.forEach((c, i) => {
    const pick = el('select');
    pick.append(el('option', { value: '', textContent: '— choisir une cible —' }));
    for (const cls of ['state', 'form']) {
      const group = el('optgroup', { label: cls === 'state' ? 'état du monde' : 'forme de la sortie' });
      for (const t of targets.filter((t) => t.class === cls)) {
        group.append(el('option', { value: t.target, textContent: t.target, selected: c.target === t.target }));
      }
      pick.append(group);
    }
    pick.onchange = () => { c.target = pick.value; c.op = ''; renderCriteria(); run(); };

    // Les opérateurs proposés sont ceux que la cible autorise : L009 devient improbable.
    const ref = targets.find((t) => t.target === c.target);
    const op = el('select');
    for (const o of ref ? ref.ops : ['eq']) op.append(el('option', { value: o, textContent: o, selected: c.op === o }));
    if (ref && !ref.ops.includes(c.op)) c.op = ref.ops[0];
    op.onchange = () => { c.op = op.value; run(); };

    const value = el('input', { value: c.value ?? '', placeholder: ref ? `${ref.type}` : 'valeur' });
    value.oninput = () => { c.value = value.value; run(); };

    const del = el('button', { className: 'del', textContent: '✕', title: 'retirer' });
    del.onclick = () => { state.criteria.splice(i, 1); renderCriteria(); run(); };

    host.append(el('div', { className: 'row crit' }, pick, op, value, del));
  });
}

/*
 * ── Cas d'or ─────────────────────────────────────────────────────────────────
 *
 * Ils étaient le trou du produit : sans champ pour les saisir, aucun artefact écrit ici
 * ne pouvait franchir L010 — `équipe` en demande 3, `officiel` 5. L'échelle de maturité
 * était donc inatteignable depuis l'interface, et tout ce qui sortait du Studio restait
 * `expérimental` à vie.
 *
 * Un cas d'or n'est pas un critère. Le critère est un contrat de production, vérifié à
 * chaque exécution ; le cas d'or est un test de développement, rejoué au banc d'essai
 * quand le modèle bouge. C'est la seule chose qui rend la non-régression constatable
 * ailleurs qu'en production.
 */
const casVide = () => ({
  id: '',
  // Le contexte est amorcé avec les variables DÉCLARÉES : c'est exactement ce que le cas
  // doit fournir pour que le prompt s'interpole. L'auteur n'a plus qu'à donner les valeurs.
  context: state.variables.filter((v) => v.name?.trim()).map((v) => ({ key: v.name.trim(), value: '' })),
  expect: [{ target: '', value: '' }],
  runs: '3',
  passAtLeast: ''
});

/** Une ligne clé/valeur, quel que soit le nom du champ-clé. */
function ligne(rows, i, champCle, controleCle, onDelete) {
  const value = el('input', { value: rows[i].value ?? '', placeholder: 'valeur' });
  value.oninput = () => { rows[i].value = value.value; run(); };

  const del = el('button', { className: 'del', textContent: '✕', title: 'retirer' });
  del.onclick = onDelete;

  return el('div', { className: `row ${champCle === 'key' ? 'ctx' : 'exp'}` }, controleCle, value, del);
}

function renderGolden() {
  const host = $('golden');
  host.textContent = '';

  state.goldenCases.forEach((g, gi) => {
    const bloc = el('div', { className: 'gold' });

    const id = el('input', { value: g.id ?? '', placeholder: 'gc-01-nominal' });
    id.oninput = () => { g.id = id.value; run(); };

    // k/n côte à côte : c'est un seul geste de pensée, « combien de succès sur combien
    // d'essais ». Séparés, on saisit l'un et on oublie l'autre — et L017 avertit.
    const pass = el('input', { value: g.passAtLeast ?? '', placeholder: 'k', inputMode: 'numeric' });
    const runs = el('input', { value: g.runs ?? '', placeholder: 'n', inputMode: 'numeric' });
    pass.oninput = () => { g.passAtLeast = pass.value; run(); };
    runs.oninput = () => { g.runs = runs.value; run(); };

    const delCas = el('button', { className: 'del', textContent: '✕', title: 'retirer ce cas d\'or' });
    delCas.onclick = () => { state.goldenCases.splice(gi, 1); renderGolden(); run(); };

    bloc.append(el('div', { className: 'head' }, id,
      el('span', { className: 'kn' }, 'succès ', pass, ' sur ', runs, ' exécutions'), delCas));

    // ── Contexte : ce que le cas fournit en entrée ──
    bloc.append(el('h5', { textContent: 'Contexte fourni au cas' }));
    g.context.forEach((row, i) => {
      const cle = el('input', { value: row.key ?? '', placeholder: 'repo' });
      // `list` n'a qu'un accesseur en lecture : il se pose en attribut, pas en propriété.
      cle.setAttribute('list', 'declared-vars');
      cle.oninput = () => { row.key = cle.value; run(); };
      bloc.append(ligne(g.context, i, 'key', cle,
        () => { g.context.splice(i, 1); renderGolden(); run(); }));
    });
    const addCtx = el('button', { className: 'mini sub', textContent: '＋ entrée' });
    addCtx.onclick = () => { g.context.push({ key: '', value: '' }); renderGolden(); run(); };
    bloc.append(addCtx);

    // ── Attendu : ce que le cas assertit. Mêmes cibles que les critères, sans opérateur :
    //    un cas d'or compare à une valeur, il ne pose pas de seuil.
    bloc.append(el('h5', { textContent: 'Attendu — au moins une cible' }));
    g.expect.forEach((row, i) => {
      const pick = el('select');
      pick.append(el('option', { value: '', textContent: '— choisir une cible —' }));
      for (const cls of ['state', 'form']) {
        const group = el('optgroup', { label: cls === 'state' ? 'état du monde' : 'forme de la sortie' });
        for (const t of targets.filter((t) => t.class === cls)) {
          group.append(el('option', { value: t.target, textContent: t.target, selected: row.target === t.target }));
        }
        pick.append(group);
      }
      // Une attente peut porter sur une cible hors registre : on ne l'efface pas.
      if (row.target && !targets.some((t) => t.target === row.target)) {
        pick.append(el('option', { value: row.target, textContent: `${row.target} (hors registre)`, selected: true }));
      }
      pick.onchange = () => { row.target = pick.value; run(); };
      bloc.append(ligne(g.expect, i, 'target', pick,
        () => { g.expect.splice(i, 1); renderGolden(); run(); }));
    });
    const addExp = el('button', { className: 'mini sub', textContent: '＋ attente' });
    addExp.onclick = () => { g.expect.push({ target: '', value: '' }); renderGolden(); run(); };
    bloc.append(addExp);

    host.append(bloc);
  });

  // La liste des variables déclarées alimente l'autocomplétion des clés de contexte.
  const list = el('datalist', { id: 'declared-vars' });
  for (const v of state.variables) if (v.name?.trim()) list.append(el('option', { value: v.name.trim() }));
  host.append(list);

  compteurCasDor();
}

/** Dit combien il en faut pour le niveau visé, avant que L010 ne le reproche. */
function compteurCasDor() {
  const level = $('targetLevel').value || 'experimental';
  const need = GOLDEN_THRESHOLDS[level] ?? 0;
  const have = state.goldenCases.filter((g) => g.id?.trim()).length;
  $('goldHint').textContent = need === 0
    ? `Niveau « expérimental » : aucun cas d'or exigé. Il en faut ${GOLDEN_THRESHOLDS.team} pour « équipe », ${GOLDEN_THRESHOLDS.officiel} pour « officiel ».`
    : `Niveau visé « ${level} » : ${need} cas d'or requis, ${have} saisi(s).`;
}

// ── Lecture du formulaire, lint, rendu ───────────────────────────────────────
function readForm() {
  return {
    title: $('title').value,
    kind: $('kind').value,
    targetLevel: $('targetLevel').value,
    ownerPerson: session.username,          // jamais la saisie : la connexion fait foi
    ownerScope: $('ownerScope').value,
    purpose: $('purpose').value,
    notFor: $('notFor').value,
    spec: $('spec').value,
    variables: state.variables,
    tools: state.tools,
    criteria: state.criteria,
    goldenCases: state.goldenCases,
    id: state.editId || undefined      // à l'édition, l'identifiant existant fait foi
  };
}

/** L'artefact tel qu'il sera écrit : formulaire + ce qui est transporté. */
function artefactCourant() {
  return restoreCarried(formToArtifact(readForm(), ctx), state.carried);
}

function run() {
  const artifact = artefactCourant();
  // Le compteur suit la frappe : nommer un cas d'or le fait compter, l'effacer le retire.
  // Rafraîchi au seul re-rendu, il annonçait un total périmé pendant qu'on saisissait.
  compteurCasDor();
  const report = lint(artifact, ctx);

  // Verdict
  const verdict = $('verdict');
  verdict.className = `verdict ${report.blocked ? 'ko' : 'ok'}`;
  verdict.textContent = report.blocked ? `✕ refusé — ${report.errors} erreur(s)` : '✔ accepté';

  $('counts').textContent = `${report.errors} 🔴 · ${report.warnings} 🟡`;

  // Constats, erreurs d'abord
  const host = $('findings');
  host.textContent = '';
  if (report.findings.length === 0) {
    host.append(el('p', { className: 'clean', textContent: '✔ conforme — aucun constat' }));
  } else {
    const sorted = [...report.findings].sort((a, b) => (a.severity === ERROR ? 0 : 1) - (b.severity === ERROR ? 0 : 1));
    for (const f of sorted) {
      const msg = el('div', {}, f.message);
      if (f.path) msg.append(el('code', { className: 'path', textContent: f.path }));
      host.append(el('div', { className: 'finding' },
        el('span', { textContent: f.severity === ERROR ? '🔴' : '🟡' }),
        el('code', { className: 'code', textContent: f.code }),
        msg
      ));
    }
  }

  $('yaml').textContent = toYaml(artifact);

  // La publication n'est offerte que si la porte est franchie. Un bouton grisé explique
  // mieux qu'un refus après coup : l'auteur voit ce qui lui manque avant de tenter.
  const publish = $('publish');
  publish.disabled = report.blocked || !artifact.id;
  publish.title = report.blocked
    ? `Corrige les ${report.errors} erreur(s) avant de soumettre.`
    : `Dépose artifacts/pending/${artifact.id}.yaml dans la file de validation`;
}

// ── Exemples ─────────────────────────────────────────────────────────────────
const EXEMPLE_OK = {
  title: 'Vérifier les migrations Flyway',
  purpose: 'Analyser les scripts de migration et signaler les ruptures de compatibilité ascendante.',
  notFor: 'Ne pas utiliser sur un dépôt sans migrations versionnées, ni pour appliquer une migration.',
  spec: 'Tu analyses les migrations du dépôt {{repo}}.\n\nPour la stack {{stack}} :\n'
      + '- repère les changements de schéma non rétrocompatibles\n'
      + '- signale toute colonne supprimée ou renommée\n'
      + '- rédige un résumé des risques pour la merge request',
  variables: [{ name: 'repo', source: 'repo' }, { name: 'stack', source: 'repo' }],
  tools: [{ id: 'read_repo_metadata' }],
  criteria: [{ target: 'output.length', op: 'lte', value: '2000' },
             { target: 'output.contains_secret', op: 'eq', value: 'false' }],
  // Deux cas d'or : de quoi montrer la forme sans prétendre atteindre un seuil. Le
  // niveau visé reste `expérimental`, qui n'en exige aucun — l'exemple enseigne, il ne
  // fabrique pas une maturité qu'il n'a pas.
  goldenCases: [
    { id: 'gc-01-rupture-detectee',
      context: [{ key: 'repo', value: 'demo-spring' }, { key: 'stack', value: 'java' }],
      expect: [{ target: 'output.contains_secret', value: 'false' }],
      runs: '5', passAtLeast: '4' },
    { id: 'gc-02-aucune-migration',
      context: [{ key: 'repo', value: 'demo-front' }, { key: 'stack', value: 'node' }],
      expect: [{ target: 'output.length', value: '800' }],
      runs: '3', passAtLeast: '3' }
  ]
};

// Chaque défaut vise une règle : L002, L009, L011, L018, L019 et L013.
const EXEMPLE_KO = {
  title: 'Analyser le code',
  purpose: 'Faire une revue du code pour voir si tout va bien.',
  notFor: '',
  spec: 'Tu analyses le code de {{repo}} sur la branche {{branche}}.\n\n'
      + 'Si le pipeline est rouge alors relance les tests unitaires.\n'
      + 'TODO : préciser le comportement en cas de conflit de merge.',
  variables: [{ name: 'repo', source: 'repo' }],
  tools: [{ id: 'read_repo_metadata' }],
  criteria: []
};

function apply(form) {
  // L'owner n'est pas rechargeable : il vient de la session et du périmètre choisi.
  for (const k of ['title', 'purpose', 'notFor', 'spec']) $(k).value = form[k] ?? '';
  if (form.kind) $('kind').value = form.kind;
  if (form.targetLevel) $('targetLevel').value = form.targetLevel;
  if (form.ownerScope) scopeSelect.value = form.ownerScope;

  state.variables = structuredClone(form.variables ?? []);
  state.tools = structuredClone(form.tools ?? []);
  state.criteria = structuredClone(form.criteria ?? []);
  state.goldenCases = structuredClone(form.goldenCases ?? []);
  state.carried = structuredClone(form.carried ?? {});
  state.editId = form.id || null;

  bandeauEdition();
  renderVariables(); renderTools(); renderCriteria(); renderGolden(); run();
}

/** Dit clairement qu'on corrige un artefact existant, et lequel. */
function bandeauEdition() {
  const barre = document.querySelector('.toolbar .sub');
  barre.textContent = state.editId
    ? `reprise de « ${state.editId} » — republier remplacera ce fichier`
    : 'les 21 règles, à la frappe · aucun LLM';
  barre.style.color = state.editId ? 'var(--accent)' : '';
}

// ── Câblage ──────────────────────────────────────────────────────────────────
for (const id of ['title', 'purpose', 'notFor', 'spec']) $(id).oninput = run;
for (const id of ['kind', 'targetLevel', 'ownerScope']) $(id).onchange = run;

$('add-var').onclick = () => { state.variables.push({ name: '', source: 'repo' }); renderVariables(); run(); };
$('add-tool').onclick = () => { state.tools.push({ id: '' }); renderTools(); run(); };
$('add-crit').onclick = () => { state.criteria.push({ target: '', op: 'eq', value: '' }); renderCriteria(); run(); };
$('add-gold').onclick = () => { state.goldenCases.push(casVide()); renderGolden(); run(); };

/*
 * Soumission — l'artefact part dans la FILE DE VALIDATION, pas au catalogue.
 *
 * Le dossier porte l'état, faute d'état dérivé : `artifacts/pending/` est ce qui attend
 * une décision humaine, `artifacts/` ce qui a été validé. Le catalogue ne lit que le
 * second, donc rien n'est visible avant d'avoir été relu. C'est le moment 3.
 *
 * Le lint reste la porte d'avant : le bouton est inerte tant qu'une erreur subsiste. La
 * porte filtre ce qui est vérifiable, l'humain tranche le reste — il n'a pas à relire ce
 * qu'une règle sait décider.
 */
const pubMsg = $('pubMsg');
const sayPub = (text, kind) => { pubMsg.textContent = text; pubMsg.className = `show ${kind}`; };

$('publish').onclick = async () => {
  const artifact = artefactCourant();
  const report = lint(artifact, ctx);
  if (report.blocked) { sayPub('La porte est fermée : corrige les erreurs listées.', 'err'); return; }

  const repo = localStorage.getItem('salsi_ia_registry_repo');
  if (!repo) { sayPub('Aucun dépôt de registre choisi — reviens à l\'accueil pour le sélectionner.', 'err'); return; }

  const button = $('publish');
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Publication…';

  const path = `artifacts/pending/${artifact.id}.yaml`;
  try {
    await createForge(session).putFile(repo, path, {
      content: toBase64(toYaml(artifact)),
      message: `registre : soumettre ${artifact.title}\n\nArtefact ${artifact.id} soumis depuis le Studio par ${session.username}.\nLint : ${report.errors} erreur(s), ${report.warnings} avertissement(s).\nEn attente de validation humaine.`,
      branch: 'main'
    });
    sayPub(`✔ Soumis pour validation — ${path}. Il apparaîtra au catalogue une fois validé dans l'Admin.`, 'ok');
  } catch (error) {
    sayPub(error.message, 'err');
  } finally {
    button.textContent = label;
    run();
  }
};

$('load-example').onclick = () => apply(EXEMPLE_OK);
$('load-broken').onclick = () => apply(EXEMPLE_KO);
$('reset').onclick = () => apply({ variables: [], tools: [], criteria: [], goldenCases: [] });

const repris = reprendre();
apply(repris ? artifactToForm(repris.artifact) : EXEMPLE_OK);
