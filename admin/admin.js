/*
 * Admin — la file de validation. Le moment 3.
 *
 * Le dossier porte l'état, faute d'état dérivé :
 *   artifacts/pending/  ce qui attend une décision humaine
 *   artifacts/          ce qui a été validé, et que le catalogue montre
 *
 * Valider = déplacer. Refuser = supprimer. Les deux sont des commits, donc l'historique
 * du dépôt EST le journal des décisions : qui a validé quoi, quand, et sur quel contenu
 * exactement. Aucune base à tenir.
 *
 * LIMITE ASSUMÉE, et elle est importante : rien n'empêche l'auteur de valider son propre
 * artefact. La séparation des rôles ne peut pas vivre dans le navigateur — celui qui a le
 * jeton a tous les droits. Elle vient des branches protégées et des CODEOWNERS du dépôt,
 * qui sont côté forge et ne se contournent pas en ouvrant la console.
 */
import { requireSession, clear } from '../app/session.js';
import { createForge } from '../app/forge.js';
import { mountShell } from '../app/shell.js';
import { lint, ERROR } from '../lint/index.js';
import { makeValidator } from '../lib/schema.js';
import yaml from '../lib/yaml.js';

const session = requireSession('../app/login.html');
if (!session) await new Promise(() => {});

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

mountShell({ active: 'admin', session, base: '../',
             onLogout: () => { clear(); location.replace('../app/login.html'); } });

const forge = createForge(session);
const repo = localStorage.getItem('salsi_ia_registry_repo');
const PENDING = 'artifacts/pending';

const LEVELS = { experimental: 'expérimental', team: 'équipe', officiel: 'officiel' };
const ICONS = { agent: '🤖', prompt: '📚', chain: '🔗' };

let ctx = null;

const flash = (text, kind) => { const f = $('flash'); f.textContent = text; f.className = `show ${kind}`; };

function showEmpty(title, detail) {
  const box = $('empty');
  box.style.display = 'block';
  box.textContent = '';
  box.append(el('b', { textContent: title }), detail);
}

/* ── Chargement ───────────────────────────────────────────────────────────── */

async function load() {
  $('queue').textContent = '';
  $('empty').style.display = 'none';

  if (!repo) {
    $('count').textContent = '';
    return showEmpty('Aucun dépôt de registre choisi.', 'Retourne à l\'accueil pour en sélectionner un.');
  }
  $('source').textContent = `${repo} · ${PENDING}/`;

  if (!ctx) {
    const [tools, targets, schema] = await Promise.all([
      fetch('../registries/tools.yaml').then((r) => r.text()).then((t) => yaml.parse(t).tools),
      fetch('../registries/targets.yaml').then((r) => r.text()).then((t) => yaml.parse(t).targets),
      fetch('../schema/artifact.schema.json').then((r) => r.json())
    ]);
    ctx = { tools, targets, validateArtifact: makeValidator(schema) };
  }

  let files;
  try {
    files = (await forge.listFiles(repo, PENDING)).filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));
  } catch (error) {
    $('count').textContent = '';
    return showEmpty('Lecture impossible', error.message);
  }

  if (files.length === 0) {
    $('count').textContent = '0 en attente';
    return showEmpty('La file est vide.', 'Tout ce qui a été soumis a été traité.');
  }

  const entries = await Promise.all(files.map(async (file) => {
    try {
      const found = await forge.getFile(repo, file.path);
      const artifact = yaml.parse(found.content);
      return { file, artifact, report: lint(artifact, { ...ctx, artifacts: [] }) };
    } catch (error) {
      return { file, artifact: null, error: error.message };
    }
  }));

  $('count').textContent = `${entries.length} en attente de décision`;
  for (const entry of entries) $('queue').append(row(entry));
}

/* ── Une ligne de la file ─────────────────────────────────────────────────── */

function row(entry) {
  const { artifact, report, file, error } = entry;
  const node = el('div', { className: 'row' });

  if (!artifact) {
    node.append(el('h3', {}, '⚠ ', file.name),
                el('p', { className: 'purpose', textContent: `Fichier illisible : ${error}` }));
    node.append(actions(entry, { lisible: false }));
    return node;
  }

  const ecrit = (artifact.tools || []).some((t) => t.mode === 'write');

  const titre = el('h3', {}, `${ICONS[artifact.kind] || '📄'} `, artifact.title || artifact.id);
  titre.append(el('span', { className: `pill ${report.blocked ? 'ko' : 'ok'}`,
                            textContent: report.blocked ? `porte : ${report.errors} erreur(s)` : 'porte franchie' }));
  if (ecrit) titre.append(el('span', { className: 'pill write', textContent: 'écriture' }));
  node.append(titre);

  node.append(el('p', { className: 'purpose', textContent: artifact.intent?.purpose || '—' }));

  const facts = el('div', { className: 'facts' });
  facts.append(el('span', { className: 'pill', textContent: LEVELS[artifact.target_level] || 'expérimental' }));
  facts.append(el('span', {}, `${artifact.owner?.person || '—'} · ${artifact.owner?.scope || '—'}`));
  facts.append(el('span', {}, `${(artifact.criteria || []).length} critère(s)`));
  facts.append(el('span', {}, `${(artifact.golden_cases || []).length} cas d'or`));
  node.append(facts);

  // Le relecteur doit voir ce qu'il valide, pas seulement son titre.
  const spec = el('details', { className: 'spec' });
  spec.append(el('summary', { textContent: 'Voir le prompt soumis' }),
              el('pre', { textContent: artifact.spec || '—' }));
  node.append(spec);

  if (report.findings.length) {
    const ul = el('ul', { className: 'findings' });
    for (const f of report.findings) {
      ul.append(el('li', {}, f.severity === ERROR ? '🔴 ' : '🟡 ', `${f.code} — ${f.message}`));
    }
    node.append(ul);
  }

  node.append(actions(entry, { lisible: true, ecrit }));
  return node;
}

function actions(entry, { lisible, ecrit }) {
  const { artifact, report, file } = entry;
  const box = el('div', { className: 'acts' });

  const valider = el('button', { className: 'primary', textContent: 'Valider et publier' });
  const refuser = el('button', { className: 'refuse', textContent: 'Refuser' });

  // Ce que la porte a déjà refusé ne se valide pas à la main : sinon la règle ne sert
  // plus à rien, et un « oui » humain devient un contournement.
  valider.disabled = !lisible || report?.blocked;
  valider.title = report?.blocked
    ? 'La porte automatique a refusé cet artefact : il doit être corrigé, pas validé.'
    : 'Déplace l\'artefact vers artifacts/, il devient visible au catalogue';

  valider.onclick = () => decider(entry, 'valider');
  refuser.onclick = () => decider(entry, 'refuser');

  box.append(valider, refuser, el('span', { className: 'sp' }));
  if (ecrit) {
    box.append(el('span', { className: 'hint' },
      'Cet artefact écrit : la revue sécurité s\'impose avant validation.'));
  }
  box.append(el('code', { className: 'mono', style: 'color:var(--tm)', textContent: file.path }));
  return box;
}

/* ── Décision ─────────────────────────────────────────────────────────────── */

async function decider(entry, action) {
  const { artifact, file } = entry;
  const nom = artifact?.title || file.name;

  const question = action === 'valider'
    ? `Valider « ${nom} » ? Il devient visible au catalogue.`
    : `Refuser « ${nom} » ? Le fichier est supprimé de la file.`;
  if (!confirm(question)) return;

  for (const b of document.querySelectorAll('.acts button')) b.disabled = true;

  try {
    if (action === 'valider') {
      const cible = `artifacts/${file.name}`;
      await forge.moveFile(repo, file.path, cible, {
        message: `registre : valider ${nom}\n\nValidé par ${session.username}. Publié en ${cible}.`
      });
      flash(`✔ « ${nom} » validé — il est au catalogue.`, 'ok');
    } else {
      await forge.deleteFile(repo, file.path, {
        message: `registre : refuser ${nom}\n\nRefusé par ${session.username}. Retiré de la file.`
      });
      flash(`« ${nom} » refusé et retiré de la file.`, 'ok');
    }
  } catch (error) {
    flash(error.message, 'err');
  }

  await load();
}

await load();
