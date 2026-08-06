/*
 * Catalogue — ce que le registre contient réellement.
 *
 * La liste est LUE dans le dépôt, jamais écrite à la main : chaque carte correspond à un
 * `artifacts/*.yaml` réel. C'est la moitié manquante de la boucle — le Studio écrivait,
 * rien ne relisait.
 *
 * Chaque artefact est repassé au linter à la lecture. Ce n'est pas redondant avec la
 * porte : les règles évoluent, et un artefact publié hier peut ne plus être conforme
 * aujourd'hui. Le catalogue le montre au lieu de le laisser pourrir en silence.
 */
import { requireSession, clear } from '../app/session.js';
import { createForge } from '../app/forge.js';
import { mountShell } from '../app/shell.js';
import { lint, ERROR } from '../lint/index.js';
import { makeValidator } from '../lib/schema.js';
import yaml from '../lib/yaml.js';

const session = requireSession('../app/login.html');
if (!session) await new Promise(() => {});   // redirection en cours, on suspend

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

mountShell({ active: 'catalogue', session, base: '../',
             onLogout: () => { clear(); location.replace('../app/login.html'); } });

const forge = createForge(session);
const repo = localStorage.getItem('salsi_ia_registry_repo');

const LEVELS = { experimental: 'expérimental', team: 'équipe', officiel: 'officiel' };
const ICONS = { agent: '🤖', prompt: '📚', chain: '🔗' };

let items = [];
let filter = 'tout';

/* ── Chargement ───────────────────────────────────────────────────────────── */

async function load() {
  if (!repo) {
    return fail('Aucun dépôt de registre choisi.',
                'Retourne à l\'accueil pour en sélectionner un — c\'est là que vivent les artefacts.');
  }
  $('source').textContent = `lu dans ${repo} · artifacts/`;

  const [tools, targets, schema] = await Promise.all([
    fetch('../registries/tools.yaml').then((r) => r.text()).then((t) => yaml.parse(t).tools),
    fetch('../registries/targets.yaml').then((r) => r.text()).then((t) => yaml.parse(t).targets),
    fetch('../schema/artifact.schema.json').then((r) => r.json())
  ]);
  const ctx = { tools, targets, validateArtifact: makeValidator(schema) };

  let files;
  try {
    // `type === 'file'` écarte de lui-même le sous-dossier `pending/` : ce qui attend une
    // validation n'a rien à faire au catalogue.
    files = (await forge.listFiles(repo, 'artifacts')).filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));
  } catch (error) {
    return fail('Lecture impossible', error.message);
  }

  if (files.length === 0) {
    return fail('Aucune capacité validée.',
                'Rien n\'a encore été validé. Écris un agent au Studio, soumets-le, puis valide-le dans l\'Admin.');
  }

  // Chargement en parallèle : un fichier illisible ne doit pas emporter les autres.
  items = (await Promise.all(files.map(async (file) => {
    try {
      const found = await forge.getFile(repo, file.path);
      const artifact = yaml.parse(found.content);
      return { file, artifact, report: lint(artifact, { ...ctx, artifacts: [] }) };
    } catch (error) {
      return { file, artifact: null, error: error.message };
    }
  })));

  render();
}

function showEmpty(title, detail) {
  const box = $('empty');
  box.style.display = 'block';
  box.textContent = '';
  box.append(el('b', { textContent: title }), detail);
}

/** Échec de chargement : là, il n'y a pas de compte à afficher. */
function fail(title, detail) {
  $('count').textContent = '';
  $('cards').style.display = 'none';
  showEmpty(title, detail);
}

/* ── Recherche et filtres ─────────────────────────────────────────────────── */

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Cherche dans ce qui décrit l'intention, pas dans le spec : on cherche un besoin. */
function matches(entry, query) {
  if (!query) return true;
  const a = entry.artifact || {};
  const haystack = fold([a.title, a.intent?.purpose, a.intent?.not_for, (a.tags || []).join(' '),
                         a.owner?.scope, a.id].join(' '));
  return fold(query).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

const FILTERS = [
  { id: 'tout', label: 'Tout' },
  { id: 'agent', label: '🤖 Agents' },
  { id: 'prompt', label: '📚 Prompts' },
  { id: 'ko', label: '⚠ Non conformes' }
];

function renderFilters() {
  const host = $('filters');
  host.textContent = '';
  for (const f of FILTERS) {
    const b = el('button', { textContent: f.label, className: f.id === filter ? 'on' : '' });
    b.onclick = () => { filter = f.id; renderFilters(); render(); };
    host.append(b);
  }
}

const passesFilter = (entry) =>
  filter === 'tout' ? true
  : filter === 'ko' ? (entry.report?.blocked || !entry.artifact)
  : entry.artifact?.kind === filter;

/* ── Rendu ────────────────────────────────────────────────────────────────── */

function render() {
  const query = $('q').value.trim();
  const shown = items.filter((e) => passesFilter(e) && matches(e, query));

  $('count').textContent = shown.length === items.length
    ? `${items.length} capacité(s)`
    : `${shown.length} sur ${items.length}`;

  const host = $('cards');
  host.textContent = '';
  host.style.display = '';
  $('empty').style.display = shown.length ? 'none' : 'block';

  if (shown.length === 0) {
    showEmpty('Rien ne correspond.', 'Essaie d\'autres mots, ou retire les filtres.');
    return;
  }

  for (const entry of shown) host.append(card(entry));
}

function card(entry) {
  const { artifact, report, file, error } = entry;

  if (!artifact) {
    return el('button', { className: 'item' },
      el('h3', {}, '⚠ ', file.name),
      el('p', { textContent: `Fichier illisible : ${error}` }));
  }

  const node = el('button', { className: 'item' },
    el('h3', {}, `${ICONS[artifact.kind] || '📄'} `, artifact.title || artifact.id),
    el('p', { textContent: artifact.intent?.purpose || '—' })
  );

  const foot = el('div', { className: 'foot' });
  foot.append(el('span', { className: `pill ${artifact.target_level || ''}`,
                           textContent: LEVELS[artifact.target_level] || 'expérimental' }));
  if (report.blocked) {
    foot.append(el('span', { className: 'pill ko', textContent: `${report.errors} erreur(s)` }));
  }
  foot.append(el('span', {}, `${artifact.owner?.person || '—'} · ${artifact.owner?.scope || '—'}`));
  for (const tag of (artifact.tags || []).slice(0, 3)) foot.append(el('span', { className: 'pill', textContent: tag }));

  node.append(foot);
  node.onclick = () => openSheet(entry);
  return node;
}

/* ── Fiche ────────────────────────────────────────────────────────────────── */

function openSheet(entry) {
  const { artifact, report, file } = entry;
  const inner = $('sheetInner');
  inner.textContent = '';

  const close = el('button', { className: 'close', textContent: '✕', title: 'fermer' });
  close.onclick = () => $('sheet').classList.remove('on');

  inner.append(el('header', {},
    el('h2', {}, ICONS[artifact.kind] || '📄', ' ', artifact.title || artifact.id),
    close));

  const body = el('div', { className: 'body' });

  const dl = el('dl', { className: 'kv' });
  const pairs = [
    ['Identifiant', artifact.id],
    ['Type', artifact.kind],
    ['Owner', `${artifact.owner?.person || '—'} · ${artifact.owner?.scope || '—'}`],
    ['Niveau visé', LEVELS[artifact.target_level] || 'expérimental'],
    ['Palier de modèle', artifact.model_tier || '—'],
    ['Porte', report.blocked ? `✕ ${report.errors} erreur(s)` : '✔ conforme'],
    ['Fichier', file.path]
  ];
  for (const [k, v] of pairs) { dl.append(el('dt', { textContent: k }), el('dd', { textContent: v })); }
  body.append(section('Identité', dl));

  if (artifact.intent?.not_for) {
    body.append(section('Quand NE PAS l\'utiliser', el('p', { className: 'hint', textContent: artifact.intent.not_for })));
  }

  body.append(section('Spécification', el('pre', { textContent: artifact.spec || '—' })));

  if (artifact.tools?.length) {
    const ul = el('ul', { className: 'plain' });
    for (const t of artifact.tools) {
      ul.append(el('li', {}, el('code', { textContent: t.id }), ` — ${t.mode} · exécuté par ${t.executor}`));
    }
    body.append(section('Outils', ul));
  }

  if (artifact.criteria?.length) {
    const ul = el('ul', { className: 'plain' });
    for (const c of artifact.criteria) {
      ul.append(el('li', {}, el('code', { textContent: c.target }), ` ${c.op} `, String(c.value)));
    }
    body.append(section('Contrat vérifié à chaque exécution', ul));
  }

  if (report.findings.length) {
    const ul = el('ul', { className: 'plain' });
    for (const f of report.findings) {
      ul.append(el('li', {}, f.severity === ERROR ? '🔴 ' : '🟡 ', el('code', { textContent: f.code }), ` ${f.message}`));
    }
    body.append(section('Constats du linter', ul));
  }

  inner.append(body);
  $('sheet').classList.add('on');
}

const section = (title, content) => el('section', {}, el('h4', { textContent: title }), content);

$('sheet').onclick = (e) => { if (e.target === $('sheet')) $('sheet').classList.remove('on'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').classList.remove('on'); });
$('q').oninput = render;

renderFilters();
await load();
