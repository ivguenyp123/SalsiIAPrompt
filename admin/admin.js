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
import { depuisCommits, parJour, resume, horsParcours, ACTIONS } from './journal.js';

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

const SOURCES = { user: 'saisie utilisateur', signal: 'signal du poste', repo: 'métadonnée du dépôt' };

/** Un bloc titré. Rien n'est masqué : le relecteur décide sur ce qu'il voit. */
const bloc = (titre, contenu) => el('div', { className: 'bloc' },
  el('h4', { textContent: titre }), contenu);

const chips = (valeurs) => {
  const box = el('div', { className: 'chips' });
  for (const v of valeurs) box.append(v);
  return box;
};

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

  if (artifact.intent?.not_for) {
    node.append(bloc('Quand NE PAS l\'utiliser',
      el('p', { className: 'purpose', style: 'margin:0', textContent: artifact.intent.not_for })));
  }

  // ── Paramètres ──
  const dl = el('dl', { className: 'kv' });
  for (const [k, v] of [
    ['Identifiant', artifact.id],
    ['Type', artifact.kind || 'agent'],
    ['Owner', `${artifact.owner?.person || '—'} · ${artifact.owner?.scope || '—'}`],
    ['Niveau visé', LEVELS[artifact.target_level] || 'expérimental'],
    ['Palier de modèle', artifact.model_tier || '— (non précisé)'],
    ['Sensibilité maximale', artifact.classification?.max_repo_sensitivity || '— (non précisée)'],
    ['Étiquettes', (artifact.tags || []).join(', ') || '—']
  ]) { dl.append(el('dt', { textContent: k }), el('dd', { textContent: v })); }
  node.append(bloc('Paramètres', dl));

  // ── Variables ──
  const vars = artifact.variables || [];
  node.append(bloc(`Variables (${vars.length})`, vars.length
    ? chips(vars.map((v) => el('span', { className: 'chip' },
        el('code', { textContent: `{{${v.name}}}` }),
        ` ${SOURCES[v.source] || v.source}${v.required === false ? ' · facultative' : ''}`)))
    : el('p', { className: 'vide', textContent: 'Aucune — le prompt ne reçoit rien du contexte.' })));

  // ── Outils : c'est là que se joue le risque, donc mode et exécutant en évidence ──
  const tools = artifact.tools || [];
  node.append(bloc(`Outils (${tools.length})`, tools.length
    ? chips(tools.map((t) => el('span', { className: 'chip' },
        el('code', { textContent: t.id }),
        el('span', { className: `pill ${t.mode}`, textContent: t.mode }),
        el('span', { className: 'pill', textContent: `exécuté par ${t.executor}` }))))
    : el('p', { className: 'vide', textContent: 'Aucun — l\'artefact ne fait que produire du texte.' })));

  // ── Critères : le contrat vérifié à chaque exécution ──
  const crit = artifact.criteria || [];
  node.append(bloc(`Critères vérifiés à chaque exécution (${crit.length})`, crit.length
    ? (() => { const ul = el('ul', { className: 'plain' });
        for (const c of crit) ul.append(el('li', {},
          el('code', { textContent: c.target }), ` ${c.op} `, el('b', { textContent: String(c.value) })));
        return ul; })()
    : el('p', { className: 'vide', textContent: 'Aucun — rien ne sera vérifié au post-vol.' })));

  // ── Cas d'or ──
  // Le compte seul ne dit rien : cinq cas creux atteignent le seuil de L010 aussi bien
  // que cinq vrais. Le relecteur doit voir CE QUE chaque cas assertit pour juger si le
  // niveau visé est mérité, pas seulement combien il y en a.
  const gold = artifact.golden_cases || [];
  node.append(bloc(`Cas d'or (${gold.length})`, gold.length
    ? (() => { const ul = el('ul', { className: 'plain' });
        for (const g of gold) {
          const attentes = Object.entries(g.expect || {});
          const entrees = Object.entries(g.context || {});
          const li = el('li', {}, el('code', { textContent: g.id }),
            ` — ${g.pass_at_least ?? '?'} succès sur ${g.runs ?? 3}`);
          li.append(el('div', { style: 'color:var(--tm);font-size:11.5px;margin:2px 0 6px' },
            entrees.length ? `entrées : ${entrees.map(([k, v]) => `${k}=${v}`).join(', ')}`
                           : 'aucune entrée',
            ' · ',
            attentes.length ? `attend : ${attentes.map(([k, v]) => `${k} = ${v}`).join(', ')}`
                            : '⚠ n\'assertit rien'));
          ul.append(li);
        }
        return ul; })()
    : el('p', { className: 'vide', textContent: 'Aucun — suffisant pour « expérimental », bloquant au-delà.' })));

  // ── Le prompt, repliable : c'est le seul bloc vraiment long ──
  const spec = el('details', { className: 'spec' });
  spec.append(el('summary', { textContent: `Le prompt soumis (${(artifact.spec || '').length} caractères)` }),
              el('pre', { textContent: artifact.spec || '—' }));
  node.append(spec);

  if (report.findings.length) {
    const ul = el('ul', { className: 'findings' });
    for (const f of report.findings) {
      ul.append(el('li', {}, f.severity === ERROR ? '🔴 ' : '🟡 ', `${f.code} — ${f.message}`));
    }
    node.append(bloc('Constats du linter', ul));
  }

  node.append(actions(entry, { lisible: true, ecrit }));
  return node;
}

function actions(entry, { lisible, ecrit }) {
  const { artifact, report, file } = entry;
  const box = el('div', { className: 'acts' });

  const valider = el('button', { className: 'primary', textContent: 'Valider et publier' });
  const corriger = el('button', { textContent: 'Corriger' });
  const refuser = el('button', { className: 'refuse', textContent: 'Refuser' });

  // Le cas courant d'une file : ce n'est ni bon ni à jeter, il faut y retoucher. Sans ce
  // bouton, refuser obligeait l'auteur à tout retaper — donc on validait par lassitude.
  corriger.disabled = !lisible;
  corriger.title = 'Rouvrir dans le Studio pour retoucher, puis resoumettre';
  corriger.onclick = () => {
    sessionStorage.setItem('salsi_ia_edit', JSON.stringify({ artifact, path: file.path }));
    location.href = '../studio/index.html';
  };

  // Ce que la porte a déjà refusé ne se valide pas à la main : sinon la règle ne sert
  // plus à rien, et un « oui » humain devient un contournement.
  valider.disabled = !lisible || report?.blocked;
  valider.title = report?.blocked
    ? 'La porte automatique a refusé cet artefact : il doit être corrigé, pas validé.'
    : 'Déplace l\'artefact vers artifacts/, il devient visible au catalogue';

  valider.onclick = () => decider(entry, 'valider');
  refuser.onclick = () => decider(entry, 'refuser');

  box.append(valider, corriger, refuser, el('span', { className: 'sp' }));
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

/* ── Le journal des décisions ─────────────────────────────────────────────────
 *
 * Aucune base à tenir : l'Admin écrit un commit à chaque décision, donc l'historique du
 * dépôt EST le journal. Il n'était simplement pas affiché — on avait la traçabilité sans
 * l'auditabilité, ce qui revient à ne pas l'avoir.
 *
 * Le parsing vit dans `journal.js`, pur et testé. Cet écran ne fait que rendre.
 */
const JOURNAL_TAILLE = 100;

const jvue = { evenements: [], filtre: 'tout', charge: false };
const VUES = [['valider', '✅ À valider'], ['journal', '📜 Journal']];

function montrerVue(id) {
  $('vue-valider').hidden = id !== 'valider';
  $('vue-journal').hidden = id !== 'journal';
  for (const b of $('vues').children) b.className = b.dataset.vue === id ? 'on' : '';
  if (id === 'journal' && !jvue.charge) chargerJournal();
}

for (const [id, label] of VUES) {
  const b = el('button', { textContent: label });
  b.dataset.vue = id;
  b.onclick = () => montrerVue(id);
  $('vues').append(b);
}

async function chargerJournal() {
  if (!repo) {
    $('jcount').textContent = '';
    $('jempty').style.display = 'block';
    $('jempty').textContent = 'Aucun dépôt de registre choisi.';
    return;
  }
  $('jsource').textContent = `historique de ${repo} · artifacts/`;

  let commits;
  try {
    commits = await forge.listCommits(repo, 'artifacts', { perPage: JOURNAL_TAILLE });
  } catch (error) {
    $('jcount').textContent = '';
    $('jempty').style.display = 'block';
    $('jempty').textContent = `Lecture de l'historique impossible : ${error.message}`;
    return;
  }

  jvue.evenements = depuisCommits(commits);
  jvue.charge = true;
  renderJournal();
}

function renderJournal() {
  const total = resume(jvue.evenements);

  // Le résumé compte TOUT, pas ce que le filtre laisse voir : sinon filtrer changerait
  // les chiffres, et un chiffre qui bouge selon la vue ne prouve rien.
  const chiffres = $('chiffres');
  chiffres.textContent = '';
  for (const [cle, def] of Object.entries(ACTIONS)) {
    chiffres.append(el('div', { className: 'chiffre' },
      el('b', { textContent: String(total[cle] ?? 0) }),
      el('span', { textContent: `${def.icone} ${def.label}` })));
  }

  // Ce qui a touché le registre sans passer par l'application : le constat qui compte
  // pour un auditeur, puisqu'il contourne la porte du lint ET la file de validation.
  const hors = horsParcours(jvue.evenements);
  const alerte = $('alerte');
  alerte.hidden = hors.length === 0;
  if (hors.length) {
    alerte.textContent = `${hors.length} modification(s) du registre n'ont pas transité par le produit : `
      + 'écrites directement dans le dépôt, elles ont contourné la porte du lint et la file de '
      + 'validation. Seules des branches protégées peuvent l\'empêcher — les signaler est tout '
      + 'ce que le navigateur peut faire.';
  }

  renderFiltresJournal();

  const montres = jvue.filtre === 'tout'
    ? jvue.evenements
    : jvue.evenements.filter((e) => e.action === jvue.filtre);

  $('jcount').textContent = montres.length === jvue.evenements.length
    ? `${jvue.evenements.length} décision(s) — les ${JOURNAL_TAILLE} derniers commits`
    : `${montres.length} sur ${jvue.evenements.length}`;

  const host = $('jours');
  host.textContent = '';
  $('jempty').style.display = montres.length ? 'none' : 'block';
  if (!montres.length) {
    $('jempty').textContent = '';
    $('jempty').append(el('b', { textContent: 'Rien à cet endroit du journal.' }),
                       'Change de filtre, ou attends la première décision.');
    return;
  }

  for (const { jour, evenements } of parJour(montres)) {
    const bloc = el('div', { className: 'jour' }, el('h4', { textContent: dateLisible(jour) }));
    for (const e of evenements) bloc.append(ligneEvenement(e));
    host.append(bloc);
  }
}

function renderFiltresJournal() {
  const host = $('jfiltres');
  host.textContent = '';
  const choix = [['tout', 'Tout'], ...Object.entries(ACTIONS).map(([k, d]) => [k, `${d.icone} ${d.label}`])];
  for (const [id, label] of choix) {
    const b = el('button', { textContent: label, className: jvue.filtre === id ? 'on' : '' });
    b.onclick = () => { jvue.filtre = id; renderJournal(); };
    host.append(b);
  }
}

function ligneEvenement(e) {
  const def = ACTIONS[e.action] || ACTIONS.autre;
  const node = el('div', { className: `ev ${e.action}` });

  node.append(el('span', { textContent: def.icone }));

  const texte = el('div', {},
    el('b', { textContent: e.acteur || 'auteur inconnu' }), ` ${def.verbe} `,
    el('span', { className: 'quoi', textContent: e.cible || '—' }));

  const notes = [];
  if (e.artefactId) notes.push(e.artefactId);
  // Distinguer les deux noms n'est utile que quand ils diffèrent — ce qui arrivera le
  // jour où un back écrira avec un compte de service à la place de la personne.
  if (e.acteurDeclare && e.auteurCommit && e.auteurCommit !== e.acteur) {
    notes.push(`commit poussé par ${e.auteurCommit}`);
  }
  if (!e.acteurDeclare) notes.push('écrit hors de l\'application');
  if (e.ref) notes.push(e.ref.slice(0, 7));
  if (notes.length) texte.append(el('span', { className: 'note', textContent: notes.join(' · ') }));

  node.append(texte);
  node.append(el('span', { className: 'quand', textContent: heureLisible(e.date) }));
  return node;
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
              'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function dateLisible(jour) {
  const d = new Date(`${jour}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return jour;
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function heureLisible(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

montrerVue('valider');
await load();
