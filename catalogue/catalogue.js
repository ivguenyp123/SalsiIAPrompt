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
import { prevol, SENSIBILITES } from '../preflight/index.js';
import { knownScopes, guessScope } from '../app/scopes.js';
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
let ctx = null;        // registres + validateur, partagés avec le pré-vol
let scopes = [];       // périmètres connus, dérivés du registre des outils

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
  ctx = { tools, targets, validateArtifact: makeValidator(schema) };
  scopes = knownScopes(tools);

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

  // Reprendre : le registre n'est plus en écriture unique. La correction repasse par la
  // file de validation comme toute soumission — corriger n'est pas contourner.
  const modifier = el('button', { textContent: 'Modifier', title: 'Rouvrir dans le Studio' });
  modifier.onclick = () => {
    sessionStorage.setItem('salsi_ia_edit', JSON.stringify({ artifact, path: file.path }));
    location.href = '../studio/index.html';
  };

  // « Puis-je l'utiliser sur MON dépôt ? » est la vraie question d'un utilisateur de
  // catalogue, et c'est exactement celle du moment 4.
  const prevolBtn = el('button', { textContent: '🛫 Pré-vol', title: 'Vérifier si cette capacité peut tourner sur un dépôt donné' });
  prevolBtn.onclick = () => ouvrirPrevol(entry);

  inner.append(el('header', {},
    el('h2', {}, ICONS[artifact.kind] || '📄', ' ', artifact.title || artifact.id),
    prevolBtn, modifier, close));

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

  // Ce qui a été testé au banc d'essai, et à quel seuil. C'est la seule chose qui
  // distingue une capacité `officielle` d'une capacité simplement bien rédigée.
  if (artifact.golden_cases?.length) {
    const ul = el('ul', { className: 'plain' });
    for (const g of artifact.golden_cases) {
      const attend = Object.entries(g.expect || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
      ul.append(el('li', {}, el('code', { textContent: g.id }),
        ` — ${g.pass_at_least ?? '?'}/${g.runs ?? 3}`,
        attend ? ` · attend ${attend}` : ' · n\'assertit rien'));
    }
    body.append(section(`Cas d'or rejoués à chaque montée de modèle (${artifact.golden_cases.length})`, ul));
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


/* ── Pré-vol (moment 4) ───────────────────────────────────────────────────────
 *
 * La fiche décrit la capacité ; le pré-vol répond à la question suivante, la seule qui
 * intéresse vraiment celui qui la trouve au catalogue : « puis-je m'en servir SUR MON
 * DÉPÔT ? »
 *
 * Cet écran ne lance rien — il n'y a pas encore de moteur d'exécution. Il rend le verdict
 * qui précéderait le lancement, et c'est déjà utile : il répond avant qu'on ait dépensé
 * un jeton, et il dit POURQUOI.
 */
function ouvrirPrevol(entry) {
  const { artifact } = entry;
  const inner = $('sheetInner');
  inner.textContent = '';

  const retour = el('button', { textContent: '← Fiche' });
  retour.onclick = () => openSheet(entry);
  const close = el('button', { className: 'close', textContent: '✕', title: 'fermer' });
  close.onclick = () => $('sheet').classList.remove('on');

  inner.append(el('header', {},
    el('h2', {}, '🛫 Pré-vol — ', artifact.title || artifact.id), retour, close));

  const body = el('div', { className: 'body' });
  const form = el('div', { className: 'pv' });

  // Le dépôt de travail choisi à l'accueil sert de proposition : c'est celui sur lequel
  // on veut lancer neuf fois sur dix.
  const chemin = localStorage.getItem('salsi_ia_project_path') || '';

  const depot = el('input', { value: chemin, placeholder: 'groupe/depot' });

  const scope = el('select');
  scope.append(el('option', { value: '', textContent: '— périmètre inconnu —' }));
  for (const s of scopes) scope.append(el('option', { value: s, textContent: s }));
  scope.value = guessScope(chemin, scopes) || '';

  const sensibilite = el('select');
  sensibilite.append(el('option', { value: '', textContent: '— non classé —' }));
  for (const s of SENSIBILITES) sensibilite.append(el('option', { value: s, textContent: s, selected: s === 'interne' }));

  const criticite = el('select');
  for (const [v, lib] of [['test', 'test / bac à sable'], ['production', 'production']]) {
    criticite.append(el('option', { value: v, textContent: lib }));
  }

  const champ = (libelle, controle) => el('div', {}, el('label', { textContent: libelle }), controle);

  form.append(el('div', { className: 'champs' },
    champ('Dépôt cible', depot),
    champ('Périmètre du dépôt', scope),
    champ('Sensibilité du dépôt', sensibilite),
    champ('Criticité de l\'exécution', criticite)));

  form.append(el('p', { className: 'note', textContent:
    'La sensibilité et le périmètre se saisissent ici parce qu\'aucun référentiel n\'est '
    + 'branché. En production ils viendraient du référentiel des dépôts, pas d\'une liste '
    + 'déroulante — ce qui rend le contrôle opposable au lieu d\'être déclaratif.' }));

  // Une saisie par variable déclarée : c'est ce que P003 va vérifier.
  const valeurs = {};
  const vars = artifact.variables || [];
  if (vars.length) {
    const grille = el('div', { className: 'champs' });
    for (const v of vars) {
      const input = el('input', { placeholder: v.source === 'repo' ? 'issu du dépôt' : 'saisie' });
      // Le dépôt cible remplit de lui-même ce que la plateforme saurait remplir.
      if (v.name === 'repo') input.value = chemin.split('/').pop() || '';
      input.oninput = () => { valeurs[v.name] = input.value; run(); };
      valeurs[v.name] = input.value;
      grille.append(champ(`{{${v.name}}}${v.required === false ? ' · facultative' : ''}`, input));
    }
    form.append(el('h4', { textContent: `Valeurs des variables (${vars.length})` }), grille);
  }

  const verdict = el('div', { className: 'verdict ok' });
  const conf = el('div', { className: 'conf' });
  const liste = el('ul', { className: 'constats' });
  form.append(verdict, conf, liste);

  function run() {
    const rapport = prevol(artifact, {
      registres: { ...ctx, artifacts: [] },
      depot: { path: depot.value.trim(), scope: scope.value || undefined,
               sensibilite: sensibilite.value || undefined },
      valeurs,
      criticite: criticite.value
    });

    verdict.className = `verdict ${rapport.bloque ? 'ko' : 'ok'}`;
    verdict.textContent = '';
    verdict.append(
      el('span', { textContent: rapport.bloque ? '✕ décollage refusé' : '✔ décollage autorisé' }),
      el('span', { className: 'sp' }),
      el('span', { style: 'font-weight:600;font-size:12px',
                   textContent: `${rapport.erreurs} erreur(s) · ${rapport.avertissements} avertissement(s)` }));

    // La confirmation n'est pas un refus : c'est une condition de départ. Les confondre
    // ferait passer « il faut valider » pour « c'est interdit ».
    conf.hidden = !rapport.confirmationRequise;
    if (rapport.confirmationRequise) {
      conf.textContent = '✋ Cette capacité écrit. Même autorisée, elle ne part pas seule : '
        + 'aperçu puis confirmation humaine. C\'est le système qui l\'impose, pas la discipline de l\'appelant.';
    }

    liste.textContent = '';
    for (const c of rapport.constats) {
      liste.append(el('li', {}, c.severity === ERROR ? '🔴 ' : '🟡 ',
        el('code', { textContent: c.code }), ` ${c.message}`));
    }
    if (!rapport.constats.length) {
      liste.append(el('li', {}, 'Aucun constat : les sept contrôles passent.'));
    }
  }

  for (const controle of [depot, scope, sensibilite, criticite]) {
    controle.oninput = run;
    controle.onchange = run;
  }

  body.append(form);
  inner.append(body);
  run();
}

const section = (title, content) => el('section', {}, el('h4', { textContent: title }), content);

$('sheet').onclick = (e) => { if (e.target === $('sheet')) $('sheet').classList.remove('on'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').classList.remove('on'); });
$('q').oninput = render;

renderFilters();
await load();
