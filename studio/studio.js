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
import { lint, ERROR } from '../lint/index.js';
import { makeValidator } from '../lib/schema.js';
import yaml from '../lib/yaml.js';
import { formToArtifact } from './form-to-artifact.js';
import { toYaml } from './to-yaml.js';

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

// ── État du formulaire ───────────────────────────────────────────────────────
const state = { variables: [], tools: [], criteria: [] };

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

// ── Lecture du formulaire, lint, rendu ───────────────────────────────────────
function readForm() {
  return {
    title: $('title').value,
    kind: $('kind').value,
    targetLevel: $('targetLevel').value,
    ownerPerson: $('ownerPerson').value,
    ownerScope: $('ownerScope').value,
    purpose: $('purpose').value,
    notFor: $('notFor').value,
    spec: $('spec').value,
    variables: state.variables,
    tools: state.tools,
    criteria: state.criteria
  };
}

function run() {
  const artifact = formToArtifact(readForm(), ctx);
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
}

// ── Exemples ─────────────────────────────────────────────────────────────────
const EXEMPLE_OK = {
  title: 'Vérifier les migrations Flyway',
  ownerPerson: 'm.dubois', ownerScope: 'Plateforme',
  purpose: 'Analyser les scripts de migration et signaler les ruptures de compatibilité ascendante.',
  notFor: 'Ne pas utiliser sur un dépôt sans migrations versionnées, ni pour appliquer une migration.',
  spec: 'Tu analyses les migrations du dépôt {{repo}}.\n\nPour la stack {{stack}} :\n'
      + '- repère les changements de schéma non rétrocompatibles\n'
      + '- signale toute colonne supprimée ou renommée\n'
      + '- rédige un résumé des risques pour la merge request',
  variables: [{ name: 'repo', source: 'repo' }, { name: 'stack', source: 'repo' }],
  tools: [{ id: 'read_repo_metadata' }],
  criteria: [{ target: 'output.length', op: 'lte', value: '2000' },
             { target: 'output.contains_secret', op: 'eq', value: 'false' }]
};

// Chaque défaut vise une règle : L002, L009, L011, L018, L019 et L013.
const EXEMPLE_KO = {
  title: 'Analyser le code',
  ownerPerson: '—', ownerScope: 'Plateforme',
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
  for (const k of ['title', 'ownerPerson', 'ownerScope', 'purpose', 'notFor', 'spec']) $(k).value = form[k] ?? '';
  state.variables = structuredClone(form.variables ?? []);
  state.tools = structuredClone(form.tools ?? []);
  state.criteria = structuredClone(form.criteria ?? []);
  renderVariables(); renderTools(); renderCriteria(); run();
}

// ── Câblage ──────────────────────────────────────────────────────────────────
for (const id of ['title', 'ownerPerson', 'ownerScope', 'purpose', 'notFor', 'spec']) $(id).oninput = run;
for (const id of ['kind', 'targetLevel']) $(id).onchange = run;

$('add-var').onclick = () => { state.variables.push({ name: '', source: 'repo' }); renderVariables(); run(); };
$('add-tool').onclick = () => { state.tools.push({ id: '' }); renderTools(); run(); };
$('add-crit').onclick = () => { state.criteria.push({ target: '', op: 'eq', value: '' }); renderCriteria(); run(); };

$('load-example').onclick = () => apply(EXEMPLE_OK);
$('load-broken').onclick = () => apply(EXEMPLE_KO);
$('reset').onclick = () => apply({ variables: [], tools: [], criteria: [] });

apply(EXEMPLE_OK);
