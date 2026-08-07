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
import { inventaire, aCorriger, ETATS } from './inventory.js';
import { QUESTIONS, composer } from './assistant.js';
import { SITUATIONS, PROPOSITIONS, composerCas } from './assistant-cas.js';
import { natureDeCle, entree as entreeDeLaBanque, chemin } from '../lib/entrees.js';
import { toYaml } from './to-yaml.js';
import { entete as enteteProvenance } from '../lib/provenance.js';

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

/*
 * `cache: 'no-cache'` sur les référentiels — pas une coquetterie.
 *
 * Le linter tranche à partir de CES fichiers. Un navigateur qui sert une version
 * périmée du manifeste des entrées fait refuser des artefacts parfaitement valides :
 * cinq erreurs `L023` sur « Explique-moi ce code » parce que la banque en cache ne
 * connaissait pas encore la nature `code`. L'auteur voit un artefact cassé, il ne l'est
 * pas, et rien à l'écran ne peut le lui dire.
 *
 * `no-cache` ne saute pas le cache : il le REVALIDE. Sur des fichiers inchangés, la
 * réponse est un 304 vide. Le coût est nul, le verdict cesse de dépendre de l'âge d'un
 * onglet.
 */
const FRAIS = { cache: 'no-cache' };

// ── Chargement des registres et du schéma ────────────────────────────────────
const [tools, targets, entrees, schema] = await Promise.all([
  fetch('../registries/tools.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t).tools),
  fetch('../registries/targets.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t).targets),
  fetch('../entrees/index.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t)),
  fetch('../schema/artifact.schema.json', FRAIS).then((r) => r.json())
]);

const ctx = { tools, targets, entrees, validateArtifact: makeValidator(schema) };

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
const state = { variables: [], tools: [], criteria: [], goldenCases: [], carried: {},
                editId: null, editFrom: null };

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
  passAtLeast: '',
  expectsViolation: false
});

/** Une ligne clé/valeur, quel que soit le nom du champ-clé. */
function ligne(rows, i, champCle, controleCle, onDelete, onChange) {
  const value = el('input', { value: rows[i].value ?? '', placeholder: 'valeur' });
  // `onChange` sert à rafraîchir ce qui DÉPEND de la valeur sans reconstruire la liste :
  // reconstruire ferait perdre le curseur à chaque frappe.
  value.oninput = () => { rows[i].value = value.value; run(); onChange?.(); };

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

    // Déclarer l'intention plutôt que la laisser deviner : un cas d'or peut légitimement
    // décrire une exécution que les critères refusent — c'est le test du chemin d'échec.
    // Ce qui ne va pas, c'est qu'on ne sache pas si c'était voulu (L022).
    const viol = el('input', { type: 'checkbox', checked: Boolean(g.expectsViolation) });
    viol.onchange = () => { g.expectsViolation = viol.checked; run(); };
    const lbl = el('label', { className: 'viol' }, viol,
      ' teste volontairement un chemin que les critères refusent');
    bloc.append(lbl);

    // ── Contexte : ce que le cas fournit en entrée ──
    bloc.append(el('h5', { textContent: 'Contexte fourni au cas' }));
    /*
     * Ce sur quoi le cas se joue VRAIMENT.
     *
     * Une clé `*_fixture` ne désigne pas une chaîne, elle désigne un fichier de la
     * banque. Afficher `diff_fixture = petit-fix` et s'arrêter là obligerait l'auteur à
     * aller ouvrir le fichier pour savoir ce qu'il teste — donc à ne pas le faire.
     *
     * Le bloc se redessine à CHAQUE frappe : une ligne qui resterait à « ✔ petit fix »
     * pendant qu'on tape autre chose serait pire que pas de ligne du tout.
     */
    const sources = el('div');
    const majSources = () => {
      sources.textContent = '';
      for (const row of g.context) {
        const nom = natureDeCle(row.key);
        if (!nom) continue;
        const e = entreeDeLaBanque(entrees, nom, row.value);
        sources.append(el('div', { className: `src ${e ? 'ok' : 'ko'}`, textContent: e
          ? `📄 ${e.titre} — ${e.lignes} ligne(s) · ${chemin(e)}`
          : `⚠ aucune entrée « ${row.value} » de nature « ${nom} » à la banque (L023)` }));
      }
    };

    g.context.forEach((row, i) => {
      const cle = el('input', { value: row.key ?? '', placeholder: 'repo' });
      // `list` n'a qu'un accesseur en lecture : il se pose en attribut, pas en propriété.
      cle.setAttribute('list', 'declared-vars');
      cle.oninput = () => { row.key = cle.value; run(); majSources(); };
      bloc.append(ligne(g.context, i, 'key', cle,
        () => { g.context.splice(i, 1); renderGolden(); run(); }, majSources));
    });
    bloc.append(sources);
    majSources();
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
  state.editFrom = form.editFrom ?? null;

  bandeauEdition();
  renderVariables(); renderTools(); renderCriteria(); renderGolden(); run();
}

/*
 * Dit ce que republier fera VRAIMENT, et ça dépend d'où vient l'artefact.
 *
 * Corriger un artefact PUBLIÉ ne le modifie pas : ça dépose une soumission dans la file,
 * et la version en ligne continue de servir jusqu'à la décision. Laisser croire le
 * contraire ferait partir l'auteur en pensant sa correction déployée.
 */
function bandeauEdition() {
  const barre = document.querySelector('.toolbar .sub');
  const texte = !state.editId ? 'les 23 règles, à la frappe · le lint n\'appelle aucun LLM'
    : state.editFrom === 'published'
      ? `correction de « ${state.editId} » — la version publiée sert jusqu'à la validation`
      : `reprise de « ${state.editId} » — republier remplacera la soumission en attente`;
  barre.textContent = texte;
  barre.style.color = state.editId ? 'var(--accent)' : '';
}


/* ── Salsi — le dialogue d'aide à l'écriture ──────────────────────────────────
 *
 * Une question à la fois, comme le scaffolder du hub. On répond à ce qu'on SAIT — ce
 * qu'on veut obtenir — au lieu de remplir un formulaire qui réclame le résultat de la
 * réflexion.
 *
 * À la fin, Salsi montre son raisonnement avant d'appliquer. Un choix qu'on ne comprend
 * pas, on le subit : on ne saura pas le corriger quand le contexte changera.
 */
function ouvrirSalsi() {
  const dlg = $('salsi');
  const fil = $('salsiFil');
  fil.textContent = '';
  dlg.classList.add('on');

  const reponses = {};
  let qi = 0;

  const bulle = (classe, ...contenu) => {
    const n = el('div', { className: `bul ${classe}` }, ...contenu);
    fil.append(n);
    fil.scrollTop = fil.scrollHeight;
    return n;
  };

  const dire = (texte) => bulle('bot', el('div', {}, texte));
  const repondu = (texte) => bulle('moi', el('div', { textContent: texte }));

  function poser() {
    if (qi >= QUESTIONS.length) return conclure();
    const q = QUESTIONS[qi];

    dire(q.q);
    if (q.aide) bulle('aide', el('div', { textContent: q.aide }));

    // La progression est affichée : savoir combien il reste change l'envie de continuer.
    const compteur = el('div', { className: 'qmeta' },
      el('span', { textContent: `question ${qi + 1} / ${QUESTIONS.length}` }));
    for (let k = 0; k < QUESTIONS.length; k++) {
      compteur.append(el('i', { className: k < qi ? 'done' : k === qi ? 'cur' : '' }));
    }
    fil.append(compteur);

    const choix = el('div', { className: 'choix' });
    for (const o of q.options) {
      const b = el('button', { className: 'opt' },
        el('span', { className: 'ic', textContent: o.icone }),
        el('span', {}, el('b', { textContent: o.titre }), el('small', { textContent: o.sous })));
      b.onclick = () => {
        reponses[q.cle] = o.id;
        choix.remove();
        compteur.remove();
        repondu(o.titre);
        qi += 1;
        poser();
      };
      choix.append(b);
    }
    fil.append(choix);
    fil.scrollTop = fil.scrollHeight;
  }

  function conclure() {
    const form = composer(reponses, ctx);

    dire('Voilà ce que j\'en tire. Rien n\'est écrit tant que tu n\'as pas appliqué.');

    const reco = el('div', { className: 'reco' });
    reco.append(el('div', { className: 'reco-h', textContent: 'Ce que je propose, et pourquoi' }));
    for (const [icone, decision, raison] of form.pourquoi) {
      reco.append(el('div', { className: 'sig' },
        el('span', { className: 'sg-ic', textContent: icone }),
        el('span', {}, el('b', { textContent: decision }), el('small', { textContent: raison }))));
    }

    // Ce que Salsi ne fait PAS. Le dire évite de croire l'artefact terminé.
    reco.append(el('div', { className: 'reste' },
      el('b', { textContent: 'Ce qui reste à toi' }),
      el('small', { textContent:
        'Le titre et « à quoi ça sert » : c\'est ce que tu sais et que je ne peux pas deviner. '
        + 'Et le prompt est une charpente — j\'y ai mis les règles qui valent pour tous, pas ton métier.' })));

    const appliquer = el('button', { className: 'primary', textContent: 'Appliquer au formulaire' });
    const refaire = el('button', { textContent: 'Recommencer' });
    const annuler = el('button', { textContent: 'Annuler' });

    appliquer.onclick = () => {
      /*
       * On n'écrase QUE ce que Salsi a rempli. Si l'auteur avait déjà saisi un titre ou
       * une intention avant d'appeler à l'aide, les perdre serait la pire des punitions
       * pour avoir demandé de l'aide.
       */
      const actuel = readForm();
      apply({
        ...form,
        title: actuel.title || form.title,
        purpose: actuel.purpose || form.purpose,
        ownerScope: actuel.ownerScope
      });
      dlg.classList.remove('on');
    };
    refaire.onclick = () => ouvrirSalsi();
    annuler.onclick = () => dlg.classList.remove('on');

    reco.append(el('div', { className: 'reco-foot' }, appliquer, refaire, annuler));
    fil.append(reco);
    fil.scrollTop = fil.scrollHeight;
  }

  dire('Salut 👋 moi c\'est Salsi. Écrire un artefact devant un formulaire vide, c\'est dur : '
     + 'il demande le résultat de ta réflexion, pas son point de départ.');
  dire('Je te pose quatre questions sur ce que tu veux OBTENIR, et je compose le reste. '
     + 'Je n\'invente rien : mes outils et mes critères viennent du registre, donc ce qui sort franchit la porte.');
  poser();
}


/* ── La dictée — une phrase, un artefact ──────────────────────────────────────
 *
 * « L'IA traduit l'intention, le noyau gouverne, l'humain valide. » La phrase est en tête
 * du dépôt depuis le premier jour ; cet écran est l'endroit où elle devient un geste.
 *
 * L'IA TRADUIT   une phrase en français devient un artefact YAML complet
 * LE NOYAU GOUVERNE  le brouillon passe au linter, et ce qu'il refuse repart au modèle
 *                    comme travail à faire. La porte ne s'assouplit jamais.
 * L'HUMAIN VALIDE    le résultat atterrit dans le FORMULAIRE, pas dans la file. Rien
 *                    n'est soumis sans relecture et sans clic.
 *
 * Ce qui la distingue de Salsi, et ça mérite d'être dit à l'écran : Salsi compose sans
 * LLM et ne peut donc pas se tromper de registre, mais il ne sait pas écrire ton métier.
 * La dictée écrit le spec — et n'a aucune garantie a priori. D'où la boucle.
 */

/** Le moteur, ou la raison de son absence. Interrogé au clic : la page n'a pas de serveur. */
async function moteurDispo() {
  try {
    const r = await fetch('../api/etat', { cache: 'no-cache' });
    if (!r.ok) return { pret: false, raison: `Le serveur a répondu ${r.status}.` };
    return await r.json();
  } catch (error) {
    return { pret: false, raison:
      'Aucun moteur derrière cette page — la dictée a besoin de `npm start`, pas d\'un simple '
      + `fichier ouvert dans le navigateur. (${error.message})` };
  }
}

const EXEMPLES = [
  'un agent qui relit une requête SQL lente et propose un index, sans jamais la modifier',
  'un prompt qui résume un incident en trois lignes pour la revue du lundi',
  'un agent qui repère les dépendances non utilisées dans un dépôt Java'
];

function ouvrirDictee() {
  const dlg = $('salsi');
  const fil = $('salsiFil');
  fil.textContent = '';
  $('salsiIcone').textContent = '✨';
  $('salsiTitre').textContent = 'Dictée — décris ton besoin, le registre fait le reste';
  dlg.classList.add('on');

  const bulle = (classe, ...contenu) => {
    const n = el('div', { className: `bul ${classe}` }, ...contenu);
    fil.append(n);
    fil.scrollTop = fil.scrollHeight;
    return n;
  };
  const dire = (texte) => bulle('bot', el('div', { textContent: texte }));
  const bas = () => { fil.scrollTop = fil.scrollHeight; };

  dire('Écris ce que tu veux obtenir, en une phrase. Pas un cahier des charges — '
     + 'une phrase, comme tu le dirais à un collègue.');
  dire('Un modèle la traduit en artefact. Ensuite le linter le juge, et tout ce qu\'il '
     + 'refuse repart au modèle comme correction. La porte ne bouge pas : c\'est le '
     + 'brouillon qui s\'y plie.');

  const champ = el('textarea', { placeholder: EXEMPLES[0], rows: 3 });
  const traduire = el('button', { className: 'primary', textContent: '✨ Traduire' });
  const annuler = el('button', { textContent: 'Annuler' });

  const exemples = el('div', { className: 'dic-ex' },
    el('span', { style: 'font-size:11px;color:var(--tm);align-self:center', textContent: 'exemples :' }));
  for (const ex of EXEMPLES) {
    const b = el('button', { type: 'button', textContent: ex.slice(0, 38) + '…', title: ex });
    b.onclick = () => { champ.value = ex; champ.focus(); };
    exemples.append(b);
  }

  const zone = el('div', { className: 'dic-zone' }, champ, exemples,
    el('div', { className: 'reco-foot' }, traduire, annuler));
  fil.append(zone);
  champ.focus();

  annuler.onclick = () => dlg.classList.remove('on');

  traduire.onclick = async () => {
    const phrase = champ.value.trim();
    if (phrase.length < 10) { champ.focus(); return; }

    zone.remove();
    bulle('moi', el('div', { textContent: phrase }));

    const etat = await moteurDispo();
    if (!etat.pret) {
      dire(`Je ne peux pas traduire : ${etat.raison}`);
      bulle('aide', el('div', { textContent:
        'Salsi, lui, n\'a besoin d\'aucun moteur : il compose à partir du registre. '
        + 'C\'est le bouton « 🌱 Salsi m\'aide ».' }));
      return;
    }

    const attente = dire(`Traduction en cours via ${etat.fournisseur}… au plus trois tours.`);

    let corps;
    try {
      const r = await fetch('../api/rediger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, auteur: session.username,
                               scope: readForm().ownerScope || undefined })
      });
      corps = await r.json();
      if (!r.ok) throw new Error(corps.erreur || `Le serveur a répondu ${r.status}.`);
    } catch (error) {
      attente.remove();
      dire(`✕ ${error.message}`);
      return;
    }
    attente.remove();

    /*
     * Le journal des tours est montré, pas caché. C'est ce qui rend la boucle honnête :
     * on voit ce que le linter a refusé, donc ce que la machine n'avait pas su faire du
     * premier coup. Un rédacteur qui ne montrerait que son résultat final demanderait
     * qu'on lui fasse confiance — c'est exactement ce que ce produit refuse.
     */
    for (const t of corps.tours) {
      if (t.illisible) {
        fil.append(el('div', { className: 'tour' },
          el('span', { className: 'tic', textContent: '⚠' }),
          el('span', {}, el('b', { textContent: `tour ${t.tour} — réponse illisible` }),
                          el('small', { textContent: t.illisible }))));
        continue;
      }
      const ok = t.erreurs === 0;
      const detail = t.constats.filter((c) => c.severity === ERROR)
        .map((c) => `${c.code} · ${c.message}`).join('\n');
      fil.append(el('div', { className: 'tour' },
        el('span', { className: 'tic', textContent: ok ? '✔' : '✕' }),
        el('span', {}, el('b', { textContent: ok
            ? `tour ${t.tour} — la porte est franchie`
            : `tour ${t.tour} — ${t.erreurs} refus, renvoyés au modèle` }),
          detail ? el('small', { textContent: detail }) : null)));
    }
    bas();

    if (!corps.artefact) { dire('Rien de lisible n\'est sorti. Réessaie en reformulant.'); return; }

    conclure(corps, phrase);
  };

  function conclure(corps, phrase) {
    const a = corps.artefact;
    const reco = el('div', { className: 'reco' });
    reco.append(el('div', { className: 'reco-h', textContent: 'Le brouillon' }));

    const chiffre = (n, un, pl) => `${n} ${n > 1 ? (pl || `${un}s`) : un}`;
    const lignes = [
      ['🏷️', a.title || '(sans titre)', a.intent?.purpose || ''],
      ['🧩', `${chiffre((a.variables || []).length, 'variable')} · `
           + `${chiffre((a.tools || []).length, 'outil')} · `
           + `${chiffre((a.criteria || []).length, 'critère')} · `
           + `${chiffre((a.golden_cases || []).length, 'cas d\'or', 'cas d\'or')}`,
        'Les outils viennent du registre, les critères des cibles assertables : '
        + 'le modèle n\'a pas pu en inventer, L004 et L009 les auraient refusés.'],
      ['📐', `Niveau visé : ${a.target_level || 'experimental'}`,
        'Plafonné à « équipe » : un niveau est un engagement, et « officiel » se '
        + 'dérive du banc d\'essai, il ne se déclare pas.']
    ];
    for (const [icone, titre, sous] of lignes) {
      reco.append(el('div', { className: 'sig' },
        el('span', { className: 'sg-ic', textContent: icone }),
        el('span', {}, el('b', { textContent: titre }),
                       sous ? el('small', { textContent: sous }) : null)));
    }

    /*
     * Ce que le linter dit, et ce qu'il ne dit PAS. Sans cette phrase, « conforme » se lit
     * « ça marche » — alors qu'aucun cas d'or n'a été joué. C'est la même faute que la
     * pastille « officiel » affichée comme un fait, et elle reviendrait ici par la porte
     * de derrière.
     */
    reco.append(el('div', { className: 'reste' },
      el('b', { textContent: corps.abandon
        ? `Refusé par la porte — ${corps.report?.errors || 0} erreur(s) restantes`
        : 'Le linter le laisse passer. Ce qu\'il FAIT reste à mesurer.' }),
      el('small', { textContent: corps.abandon
        ? 'Le brouillon est quand même là : une charpente à finir vaut mieux qu\'un '
          + 'formulaire vide. Applique-le, corrige ce qui reste, le verdict suit la frappe.'
        : 'Aucun cas d\'or n\'a été joué : la forme est vérifiée, pas le résultat. '
          + 'Envoie-le à la validation — le relecteur verra la phrase d\'origine et le '
          + 'nombre de tours — ou ouvre-le au formulaire si tu veux le retoucher d\'abord.' })));

    const envoyer = el('button', { className: 'primary', textContent: '📮 Envoyer à la validation' });
    const appliquer = el('button', { textContent: 'Ouvrir dans le formulaire' });
    const refaire = el('button', { textContent: 'Reformuler' });
    const fermer = el('button', { textContent: 'Annuler' });

    /*
     * Le dépôt direct dans la file, sans passer par le formulaire.
     *
     * On a d'abord obligé à relire au Studio avant de soumettre. C'était une précaution
     * de trop : `artifacts/pending/` EST la validation humaine. Rien de ce qui s'y trouve
     * n'est exécutable, ni visible au Catalogue, et l'écran d'Admin refuse ou accepte
     * pièce par pièce. Le relecteur voit le même formulaire, avec le verdict du lint et
     * le fichier entier — il est mieux placé que l'auteur pour trancher, c'est son rôle.
     *
     * Ce qui reste non négociable : le lint bloquant avant l'envoi — `deposer()` s'en
     * charge, et c'est le même code que le bouton « Soumettre » — et la PROVENANCE. Un
     * artefact rédigé par un modèle ne se présente pas comme un artefact écrit à la main :
     * l'en-tête du fichier porte la phrase d'origine et le nombre de tours, et le message
     * de commit aussi. Le relecteur relit autrement ce qu'une machine a écrit.
     */
    envoyer.onclick = async () => {
      envoyer.disabled = true;
      const avant = envoyer.textContent;
      envoyer.textContent = 'Envoi…';

      // Le même générateur que l'écran « Demander » et que la CLI : l'écran d'Admin ne
      // sait lire qu'un seul format de provenance, et trois écritures auraient divergé.
      const entete = enteteProvenance({
        origine: 'dictee', phrase, auteur: session.username,
        date: new Date().toISOString().slice(0, 10),
        tours: corps.tours.length, modele: corps.modele, fournisseur: corps.fournisseur });

      try {
        const ok = await deposer(a, { entete, motif:
          `Rédigé par la dictée à partir de : « ${phrase.replace(/\n/g, ' ')} ».\n`
          + `${corps.tours.length} tour(s) de correction par le linter, modèle ${corps.modele}.` });
        if (ok) dlg.classList.remove('on');
      } catch (error) {
        dire(`✕ ${error.message}`);
      } finally {
        envoyer.disabled = false;
        envoyer.textContent = avant;
      }
    };

    appliquer.onclick = () => {
      /*
       * `artifactToForm` et pas une recopie champ par champ : c'est la MÊME traduction que
       * pour reprendre un artefact publié, donc les cas d'or, le palier et les étiquettes
       * arrivent par le même chemin déjà testé en aller-retour.
       *
       * `id: null` : le brouillon est un artefact NEUF, pas une reprise. Le laisser
       * prendre l'identifiant proposé ferait croire au Studio qu'on édite un existant, et
       * le bandeau annoncerait une correction qui n'en est pas une.
       */
      apply({ ...artifactToForm(a), id: null, editFrom: null,
              ownerScope: a.owner?.scope || readForm().ownerScope });
      dlg.classList.remove('on');
      $('title').focus();
    };
    refaire.onclick = () => ouvrirDictee();
    fermer.onclick = () => dlg.classList.remove('on');

    /*
     * Un brouillon refusé n'a PAS de bouton d'envoi. Ce n'est pas une politesse : le
     * dépôt est refusé de toute façon par `deposer()`, et un bouton qui échoue toujours
     * finit par se cliquer par habitude jusqu'à ce qu'on cherche à le contourner.
     */
    reco.append(el('div', { className: 'reco-foot' },
      corps.abandon ? null : envoyer, appliquer, refaire, fermer));
    fil.append(reco);

    const euros = corps.cout === null || corps.cout === undefined
      ? 'tarif inconnu' : `${(corps.cout * 100).toFixed(3)} centime(s)`;
    bulle('aide', el('div', { textContent:
      `${corps.tours.length} appel(s) · ${corps.modele} via ${corps.fournisseur} · `
      + `${corps.jetons.entree} + ${corps.jetons.sortie} jetons → ${euros}` }));
    bas();
  }
}


/* ── Salsi — les cas d'or ─────────────────────────────────────────────────────
 *
 * Le formulaire demande quatre concepts d'un coup, dans un vocabulaire que personne n'a
 * jamais vu. Ici on ne demande qu'une chose, en français : QUEL GENRE de situation.
 *
 * Tout le reste est déjà dans l'artefact — le contexte vient des variables déclarées,
 * l'attente des critères déclarés. Ne pas les redemander est ce qui rend les cas
 * cohérents par construction, donc L022 satisfaite sans y penser.
 */
function ouvrirSalsiCas() {
  const dlg = $('salsi');
  const fil = $('salsiFil');
  fil.textContent = '';
  dlg.classList.add('on');

  const bulle = (classe, texte) => {
    const n = el('div', { className: `bul ${classe}` }, el('div', { textContent: texte }));
    fil.append(n); fil.scrollTop = fil.scrollHeight; return n;
  };

  const form = readForm();
  const niveau = form.targetLevel || 'experimental';
  const requis = GOLDEN_THRESHOLDS[niveau] ?? 0;

  bulle('bot', 'Les cas d\'or, c\'est ce qui rejoue ton artefact quand le modèle change. '
             + 'Sans eux, une montée de version se constate en production.');
  bulle('bot', `Tu vises « ${niveau} » : ${requis === 0 ? 'aucun n\'est exigé, mais un seul change déjà tout' : `il en faut ${requis}`}. `
             + 'Je n\'ai besoin que d\'une chose — le genre de situation. Le reste, je le prends dans tes variables et tes critères.');

  if (!form.criteria.some((c) => c?.target)) {
    bulle('aide', 'Attention : tu n\'as aucun critère déclaré. Je peux composer les cas, '
                + 'mais ils n\'attendront rien — remplis d\'abord les critères, ce sera bien plus utile.');
  }

  const choisies = [...(PROPOSITIONS[niveau] || PROPOSITIONS.experimental)];

  const liste = el('div', { className: 'choix' });
  const reco = el('div', { className: 'reco' });
  fil.append(liste, reco);

  function dessiner() {
    /*
     * On compose à chaque redessin, pas seulement au clic final : c'est ce qui permet
     * de MONTRER sur quelle entrée chaque cas va se jouer. Un auteur qui ne voit pas
     * la matière ne peut pas juger si le test vaut quelque chose.
     */
    const actuel = readForm();
    const apercu = composerCas({ situations: choisies, variables: actuel.variables,
                                 criteria: actuel.criteria, targets, entrees });

    liste.textContent = '';
    for (const [i, id] of choisies.entries()) {
      const s = SITUATIONS.find((x) => x.id === id);
      const del = el('button', { className: 'del', textContent: '✕', title: 'retirer' });
      del.onclick = () => { choisies.splice(i, 1); dessiner(); };

      const detail = el('span', { style: 'flex:1' },
        el('b', { textContent: s.titre }), el('small', { textContent: s.pourquoi }));
      for (const e of apercu[i]?.entrees || []) {
        detail.append(el('small', { className: 'src',
          textContent: `📄 ${e.titre} — ${e.lignes} ligne(s), ${e.origine}` }));
      }
      liste.append(el('div', { className: 'opt', style: 'cursor:default' },
        el('span', { className: 'ic', textContent: s.icone }), detail, del));
    }

    const ajout = el('div', { className: 'choix', style: 'margin-top:8px' });
    for (const s of SITUATIONS) {
      const b = el('button', { className: 'opt' },
        el('span', { className: 'ic', textContent: s.icone }),
        el('span', {}, el('b', { textContent: `＋ ${s.titre}` }), el('small', { textContent: s.sous })));
      b.onclick = () => { choisies.push(s.id); dessiner(); };
      ajout.append(b);
    }
    liste.append(ajout);

    reco.textContent = '';
    const manque = requis - choisies.length;
    reco.append(el('div', { className: 'reco-h',
      textContent: manque > 0 ? `${choisies.length} cas — il en manque ${manque} pour « ${niveau} »`
                              : `${choisies.length} cas — le seuil de « ${niveau} » est atteint` }));
    /*
     * Ce qui reste à l'auteur — et ce qui ne lui reste plus.
     *
     * Les entrées de `source: signal` sont servies par la banque : de vrais diffs, de
     * vrais journaux. Il n'a rien à capturer, rien à coller. Ce qui reste tient aux
     * chaînes — un nom de dépôt, une branche — et seulement si le banc en a besoin.
     */
    const servies = apercu.flatMap((c) => c.entrees || []).length;
    reco.append(el('div', { className: 'reste' },
      el('b', { textContent: 'Ce qui reste à toi' }),
      el('small', { textContent: servies > 0
        ? `Rien à capturer : ${servies} entrée(s) réelle(s) viennent de la banque, listées ci-dessus. `
          + 'Les autres valeurs du contexte sont des exemples lisibles — un nom de dépôt à remplacer '
          + 'si tu veux que le cas parle de quelque chose de précis.'
        : 'Les valeurs du contexte sont des exemples lisibles, pas tes vraies données. '
          + 'Remplace-les par des dépôts et des branches qui existent — c\'est ce qui rendra le banc d\'essai utile.' })));

    const appliquer = el('button', { className: 'primary', textContent: `Ajouter ces ${choisies.length} cas` });
    appliquer.disabled = choisies.length === 0;
    appliquer.onclick = () => {
      // `pourquoi` et `entrees` sont de l'affichage : ils ne descendent pas dans l'artefact.
      // On AJOUTE : écraser les cas déjà écrits punirait celui qui a commencé seul.
      state.goldenCases.push(...apercu.map(({ pourquoi, entrees: _e, ...c }) => c));
      renderGolden(); run();
      dlg.classList.remove('on');
    };
    const annuler = el('button', { textContent: 'Annuler' });
    annuler.onclick = () => dlg.classList.remove('on');
    reco.append(el('div', { className: 'reco-foot' }, appliquer, annuler));
    fil.scrollTop = fil.scrollHeight;
  }

  dessiner();
}

// ── Câblage ──────────────────────────────────────────────────────────────────
for (const id of ['title', 'purpose', 'notFor', 'spec']) $(id).oninput = run;
for (const id of ['kind', 'targetLevel', 'ownerScope']) $(id).onchange = run;

$('add-var').onclick = () => { state.variables.push({ name: '', source: 'repo' }); renderVariables(); run(); };
$('add-tool').onclick = () => { state.tools.push({ id: '' }); renderTools(); run(); };
$('add-crit').onclick = () => { state.criteria.push({ target: '', op: 'eq', value: '' }); renderCriteria(); run(); };
$('add-gold').onclick = () => { state.goldenCases.push(casVide()); renderGolden(); run(); };

$('salsi-open').onclick = ouvrirSalsi;
$('salsi-cas').onclick = ouvrirSalsiCas;
$('dictee-open').onclick = ouvrirDictee;

/*
 * Le même appel depuis l'établi. C'est là que la question « par où je commence ? » se
 * pose vraiment : dans le formulaire, on a déjà commencé. Proposer l'aide uniquement une
 * fois entré, c'est la proposer une étape trop tard.
 */
$('salsi-start').onclick = () => {
  apply({ variables: [], tools: [], criteria: [], goldenCases: [] });
  montrer('editeur');
  ouvrirSalsi();
};
$('dictee-start').onclick = () => {
  apply({ variables: [], tools: [], criteria: [], goldenCases: [] });
  montrer('editeur');
  ouvrirDictee();
};
$('salsi-close').onclick = () => $('salsi').classList.remove('on');
$('salsi').onclick = (e) => { if (e.target === $('salsi')) $('salsi').classList.remove('on'); };

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

/**
 * Dépose un artefact dans la file de validation.
 *
 * Extrait du bouton « Soumettre » pour que la dictée emprunte EXACTEMENT le même chemin :
 * même dossier, même branche, même lint bloquant avant l'envoi. Deux chemins de dépôt
 * auraient divergé au premier correctif, et l'un des deux aurait fini plus permissif que
 * l'autre — probablement celui qu'une machine emprunte.
 *
 * @param {object} artifact
 * @param {object} [provenance]  { entete, motif } — ce que le relecteur doit savoir de
 *                               l'origine du fichier. Un artefact rédigé par un modèle
 *                               ne se présente pas comme un artefact écrit à la main.
 * @returns {boolean} déposé ou non
 */
async function deposer(artifact, { entete = '', motif = '' } = {}) {
  const report = lint(artifact, ctx);
  if (report.blocked) {
    sayPub('La porte est fermée : corrige les erreurs listées.', 'err');
    return false;
  }

  const repo = localStorage.getItem('salsi_ia_registry_repo');
  if (!repo) {
    sayPub('Aucun dépôt de registre choisi — reviens à l\'accueil pour le sélectionner.', 'err');
    return false;
  }

  const path = `artifacts/pending/${artifact.id}.yaml`;
  await createForge(session).putFile(repo, path, {
    content: toBase64(entete + toYaml(artifact)),
    message: `registre : soumettre ${artifact.title}\n\n`
           + `Artefact ${artifact.id} soumis depuis le Studio par ${session.username}.\n`
           + `${motif ? `${motif}\n` : ''}`
           + `Lint : ${report.errors} erreur(s), ${report.warnings} avertissement(s).\n`
           + 'En attente de validation humaine.',
    branch: 'main'
  });

  sayPub(`✔ Soumis pour validation — ${path}. Il apparaîtra au catalogue une fois validé dans l'Admin.`, 'ok');
  // Retour à l'établi : la soumission y apparaît « en revue ». Rester sur le formulaire
  // laissait l'auteur sans preuve que quelque chose s'était produit.
  montrer('liste');
  await chargerInventaire();
  return true;
}

$('publish').onclick = async () => {
  const button = $('publish');
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Publication…';
  try { await deposer(artefactCourant()); }
  catch (error) { sayPub(error.message, 'err'); }
  finally { button.textContent = label; run(); }
};

$('load-example').onclick = () => apply(EXEMPLE_OK);
$('load-broken').onclick = () => apply(EXEMPLE_KO);
$('reset').onclick = () => apply({ variables: [], tools: [], criteria: [], goldenCases: [] });

/*
 * ── L'établi : la liste de ce qu'on a écrit ──────────────────────────────────
 *
 * Le Studio ouvrait sur un formulaire vide. On soumettait un artefact et on ne le
 * revoyait plus JAMAIS depuis le Studio : le Catalogue ne montre que le validé, donc une
 * soumission en attente devenait introuvable dès l'onglet fermé. On écrivait dans le
 * vide en espérant qu'un administrateur passe.
 *
 * L'état vient du dossier — `artifacts/pending/` contre `artifacts/` — faute d'état
 * dérivé. Un identifiant présent aux deux endroits est une correction en attente sur une
 * capacité publiée, et c'est un état à part entière : la version publiée sert toujours.
 */
const forge = createForge(session);

const vue = { entrees: [], statut: 'tout', query: '', mien: true, charge: false };

const STATUTS = [['tout', 'Tout'], ['revue', 'En revue'], ['correction', 'Correction'], ['publie', 'Publiés']];

/** Bascule liste / éditeur, et la barre d'outils avec — les deux modes n'ont rien en commun. */
function montrer(mode) {
  const liste = mode === 'liste';
  $('listView').hidden = !liste;
  $('editView').hidden = liste;
  for (const [id, enListe] of [['new-artifact', true], ['salsi-start', true], ['dictee-start', true],
                               ['back-list', false], ['load-example', false],
                               ['load-broken', false], ['reset', false], ['verdict', false], ['publish', false]]) {
    $(id).hidden = liste !== enListe;
  }
  if (liste) bandeauListe(); else bandeauEdition();
  scrollTo(0, 0);
}

function bandeauListe() {
  const barre = document.querySelector('.toolbar .sub');
  barre.textContent = 'ce que tu as écrit, et où ça en est';
  barre.style.color = '';
}

/** Ouvre un artefact existant dans l'éditeur, en retenant d'où il vient. */
function ouvrir(entree) {
  const source = aCorriger(entree);
  if (!source?.artifact) {
    sayPub(`« ${entree.id} » est illisible : il faut corriger ${source?.path} directement dans le dépôt.`, 'err');
    return;
  }
  apply({ ...artifactToForm(source.artifact), editFrom: entree.pending ? 'pending' : 'published' });
  montrer('editeur');
}

async function chargerInventaire() {
  const repo = localStorage.getItem('salsi_ia_registry_repo');
  if (!repo) {
    $('lcount').textContent = '';
    return vide('Aucun dépôt de registre choisi.', 'Retourne à l\'accueil pour en sélectionner un.');
  }
  $('lsource').textContent = `lu dans ${repo}`;

  const lire = async (dossier) => {
    const fichiers = (await forge.listFiles(repo, dossier))
      .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));
    // En parallèle, et chacun protégé : un YAML cassé doit apparaître comme une ligne
    // illisible, pas rendre tout l'établi vide.
    return Promise.all(fichiers.map(async (f) => {
      try { return { path: f.path, artifact: yaml.parse((await forge.getFile(repo, f.path)).content) }; }
      catch { return { path: f.path, artifact: null }; }
    }));
  };

  try {
    const [pending, published] = await Promise.all([lire('artifacts/pending'), lire('artifacts')]);
    vue.entrees = inventaire({ pending, published, me: session.username });
    vue.charge = true;
  } catch (error) {
    $('lcount').textContent = '';
    return vide('Lecture impossible', error.message);
  }
  renderListe();
}

const plie = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function vide(titre, detail) {
  const box = $('lempty');
  box.hidden = false;
  box.textContent = '';
  box.append(el('b', { textContent: titre }), detail);
}

function renderStatuts() {
  const host = $('lstatus');
  host.textContent = '';
  for (const [id, label] of STATUTS) {
    const b = el('button', { textContent: label, className: vue.statut === id ? 'on' : '' });
    b.onclick = () => { vue.statut = id; renderStatuts(); renderListe(); };
    host.append(b);
  }
}

function renderListe() {
  const q = plie(vue.query);
  const montrees = vue.entrees.filter((e) =>
    (vue.statut === 'tout' || e.etat === vue.statut) &&
    // Un fichier illisible échappe au filtre : il n'appartient à personne, et c'est
    // exactement celui qu'il faut retrouver pour le réparer.
    (!vue.mien || e.mien || !e.lisible) &&
    (!q || plie(`${e.titre} ${e.id} ${e.purpose} ${e.scope}`).includes(q)));

  $('lcount').textContent = vue.entrees.length === 0 ? ''
    : montrees.length === vue.entrees.length ? `${vue.entrees.length} artefact(s)`
    : `${montrees.length} sur ${vue.entrees.length}`;

  const host = $('llist');
  host.textContent = '';
  $('lempty').hidden = montrees.length > 0;

  if (montrees.length === 0) {
    return vue.entrees.length === 0
      ? vide('Rien dans le registre.', 'Écris un premier artefact avec « ＋ Nouvel artefact ».')
      : vide('Rien ne correspond.', vue.mien ? 'Décoche « seulement les miens » pour voir ceux des autres.'
                                             : 'Essaie d\'autres mots, ou change de statut.');
  }

  for (const e of montrees) host.append(ligneListe(e));
}

const ICONE = { prompt: '📚', chain: '🔗' };

function ligneListe(entree) {
  const gauche = el('div', {});
  const titre = el('h3', {}, entree.lisible ? `${ICONE[entree.kind] || '🤖'} ` : '⚠ ', entree.titre);
  titre.append(el('span', { className: `st ${entree.etat}`, textContent: ETATS[entree.etat].label,
                            title: ETATS[entree.etat].aide }));
  if (!entree.lisible) titre.append(el('span', { className: 'st ko', textContent: 'illisible' }));
  else if (!entree.mien) titre.append(el('span', { className: 'st', textContent: entree.auteur || 'sans owner' }));

  gauche.append(titre);
  gauche.append(el('p', { textContent: entree.lisible ? (entree.purpose || '—')
    : 'Le YAML de ce fichier ne se relit pas. Le Studio ne peut pas l\'ouvrir sans risquer d\'en perdre le contenu.' }));
  gauche.append(el('div', { className: 'facts',
    textContent: `${entree.id} · ${entree.niveau}${entree.scope ? ` · ${entree.scope}` : ''}` }));

  // La correction en attente est le seul état où deux fichiers coexistent. Le dire, sinon
  // l'auteur croit voir la version en ligne alors qu'il édite sa soumission.
  if (entree.etat === 'correction') {
    gauche.append(el('div', { className: 'facts', style: 'color:var(--accent)',
      textContent: 'une correction attend une décision ; la version publiée sert toujours' }));
  }

  const bouton = el('button', { className: 'primary',
                                textContent: entree.etat === 'publie' ? 'Corriger' : 'Reprendre' });
  // Rouvrir un fichier illisible produirait un formulaire vide qu'on republierait
  // par-dessus l'original : la réparation détruirait ce qu'elle vient réparer.
  bouton.disabled = !entree.lisible;
  bouton.title = entree.lisible ? 'Rouvrir dans le formulaire'
    : `À réparer directement dans le dépôt : ${aCorriger(entree)?.path}`;
  bouton.onclick = () => ouvrir(entree);

  return el('div', { className: 'lrow' }, gauche, el('div', { className: 'acts' }, bouton));
}

// ── Câblage de la liste ──────────────────────────────────────────────────────
$('lq').oninput = () => { vue.query = $('lq').value; renderListe(); };
$('lmine').onchange = () => { vue.mien = $('lmine').checked; renderListe(); };

$('new-artifact').onclick = () => {
  apply({ variables: [], tools: [], criteria: [], goldenCases: [] });
  montrer('editeur');
};

$('back-list').onclick = async () => {
  pubMsg.className = '';                  // le message de la soumission précédente a fait son office
  montrer('liste');
  await chargerInventaire();              // relu : une soumission vient peut-être d'y entrer
};

// ── Ouverture ────────────────────────────────────────────────────────────────
renderStatuts();

const repris = reprendre();
if (repris) {
  // Arrivée depuis le Catalogue ou l'Admin : on va droit à ce qui vient d'être demandé.
  apply({ ...artifactToForm(repris.artifact),
          editFrom: repris.path?.includes('/pending/') ? 'pending' : 'published' });
  montrer('editeur');
  chargerInventaire();                    // en fond, prêt pour le retour à la liste
} else {
  apply(EXEMPLE_OK);                      // le formulaire est prêt derrière la liste
  montrer('liste');
  await chargerInventaire();
}
