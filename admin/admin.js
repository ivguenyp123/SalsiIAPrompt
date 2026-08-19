/*
 * Admin — la file de validation. Le moment 3.
 *
 * Le dossier porte l'état, faute d'état dérivé :
 *   artifacts/pending/  ce qui attend une décision humaine
 *   artifacts/          ce qui a été validé, et que le catalogue montre
 *   artifacts/retires/  ce qui a servi et ne sert plus — invisible au catalogue
 *
 * La liste des trois vit dans `parc.js` : l'ecran et le module ne peuvent pas diverger.
 *
 * Valider = déplacer. Refuser = supprimer. Retirer = déplacer, réactiver = déplacer en
 * sens inverse. Tout est un commit, donc l'historique du dépôt EST le journal des
 * décisions : qui a validé quoi, quand, et sur quel contenu exactement. Aucune base à
 * tenir.
 *
 * ── POURQUOI RETIRER PLUTÔT QUE SUPPRIMER ────────────────────────────────────
 *
 * Un parc ne grandit pas seulement : il se nettoie. Sans moyen de sortir un agent du
 * catalogue, la seule issue est la suppression — donc on ne le fait pas, et le catalogue
 * se remplit de choses que plus personne n'utilise mais que personne n'ose enlever. Un
 * catalogue qu'on ne croit plus ne se consulte plus.
 *
 * Retirer est réversible et se lit dans l'historique comme un renommage. C'est ce qui
 * rend le geste facile à faire — et un geste facile à faire est un geste qu'on fait.
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
import yaml from '../lib/yaml.js';
import { depuisCommits, parJour, resume, horsParcours, ACTIONS } from './journal.js';
import { STATUTS, DOSSIERS, dossiersDe, inventaireParc, compter, filtrer } from './parc.js';
import { niveau } from '../lib/niveau.js';
import { lire as lireProvenance } from '../lib/provenance.js';
import { chargerExecutions, monterPas, chargeEs } from './executions.js';
import { lireLePack } from './import.js';
import { contexte } from './contexte.js';

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

const ICONS = { agent: '🤖', chain: '🔗' };
/*
 * Le prompt n'a plus d'emoji : sa « pile de livres » faisait catalogue de
 * bibliothèque. À la place, la marque Salsi du hub — un élément, pas un
 * caractère, donc partout où l'icône apparaît on append un nœud.
 */
const icKind = (kind) => kind === 'prompt'
  ? el('span', { className: 'ic-salsi' })
  : document.createTextNode(ICONS[kind] || '📄');

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
  $('source').textContent = repo;

    
  // Les référentiels vivent dans `contexte.js` : l'import s'en sert aussi, et deux
  // chargements séparés donneraient deux verdicts sur le même fichier selon l'onglet.
  if (!ctx) ctx = await contexte();

  let files;
  try {
    files = (await forge.listFiles(repo, PENDING)).filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));
  } catch (error) {
    $('count').textContent = '';
    return showEmpty('Lecture impossible', error.message);
  }

  if (files.length === 0) {
    $('count').textContent = '0 en attente';
    attente.textContent = '';
    return showEmpty('La file est vide.', 'Tout ce qui a été soumis a été traité.');
  }

  const entries = await Promise.all(files.map(async (file) => {
    try {
      const found = await forge.getFile(repo, file.path);
      const artifact = yaml.parse(found.content);
      // La provenance vit en commentaires de tête : le parseur YAML les jette, donc elle
      // se lit sur le TEXTE. C'est voulu — elle ne décrit pas la capacité, elle décrit
      // comment le fichier est arrivé ici, et le relecteur doit le savoir avant de lire.
      return { file, artifact, provenance: lireProvenance(found.content),
               report: lint(artifact, { ...ctx, artifacts: [] }) };
    } catch (error) {
      return { file, artifact: null, error: error.message };
    }
  }));

  $('count').textContent = `${entries.length} en attente de décision`;
  // Le même chiffre sur le sélecteur : on n'atterrit plus sur la file, elle doit donc
  // s'annoncer d'elle-même depuis le parc comme depuis le journal.
  attente.textContent = entries.length ? String(entries.length) : '';
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
  const { artifact, report, file, error, provenance } = entry;
  const node = el('div', { className: 'row' });

  if (!artifact) {
    node.append(el('h3', {}, '⚠ ', file.name),
                el('p', { className: 'purpose', textContent: `Fichier illisible : ${error}` }));
    node.append(actions(entry, { lisible: false }));
    return node;
  }

  const ecrit = (artifact.tools || []).some((t) => t.mode === 'write');

  const titre = el('h3', {}, icKind(artifact.kind), ' ', artifact.title || artifact.id);
  titre.append(el('span', { className: `pill ${report.blocked ? 'ko' : 'ok'}`,
                            textContent: report.blocked ? `porte : ${report.errors} erreur(s)` : 'porte franchie' }));
  if (ecrit) titre.append(el('span', { className: 'pill write', textContent: 'écriture' }));
  node.append(titre);

  node.append(el('p', { className: 'purpose', textContent: artifact.intent?.purpose || '—' }));

  /*
   * Le bandeau de provenance, quand une machine a écrit le fichier.
   *
   * Il n'accuse pas : un artefact dicté n'est ni meilleur ni pire qu'un artefact tapé.
   * Mais il se relit autrement. La phrase d'origine dit ce que le demandeur VOULAIT, ce
   * qu'aucune règle ne peut vérifier — c'est exactement le travail que le relecteur est
   * là pour faire, et sans elle il le ferait à l'aveugle.
   */
  if (provenance) {
    const detail = [
      provenance.auteur ? `demandé par ${provenance.auteur}` : '',
      provenance.date,
      provenance.tours ? `${provenance.tours} tour(s) de correction par le linter` : '',
      provenance.modele
    ].filter(Boolean).join(' · ');

    node.append(el('div', { className: 'prov' },
      el('span', { className: 'prov-ic', textContent: '✨' }),
      el('span', {},
        el('b', { textContent: provenance.libelle }),
        provenance.phrase
          ? el('q', { textContent: provenance.phrase })
          : null,
        el('small', { textContent: `${detail}${detail ? ' · ' : ''}`
          + 'aucun cas d\'or n\'a été joué : la forme est vérifiée, pas le résultat.' }))));
  }

  if (artifact.intent?.not_for) {
    node.append(bloc('Quand NE PAS l\'utiliser',
      el('p', { className: 'purpose', style: 'margin:0', textContent: artifact.intent.not_for })));
  }

  /*
   * Les libellés disent CE QUE LE CHAMP VEUT DIRE, pas comment il s'appelle dans le
   * fichier. « Owner » et « palier de modèle » sont des noms de propriété ; celui qui
   * relit une soumission a besoin de savoir QUI EN RÉPOND et CE QUE ÇA A LE DROIT DE
   * LIRE. Le nom technique reste dans le fichier, que la fiche montre plus bas.
   */
  const dl = el('dl', { className: 'kv' });
  for (const [k, v] of [
    ['Son nom court', artifact.id],
    ['Ce que c\'est', artifact.kind === 'chain' ? 'une suite d\'agents' : 'un agent'],
    ['Qui en répond', `${artifact.owner?.person || '—'} · équipe ${artifact.owner?.scope || '—'}`],
    ['Maturité', niveau(artifact, ctx?.derive).texte],
    ['Puissance du modèle', artifact.model_tier || '— (non précisée)'],
    ['Ce qu\'il a le droit de lire',
      artifact.classification?.max_repo_sensitivity || '— (non précisé)'],
    ['Étiquettes', (artifact.tags || []).join(', ') || '—']
  ]) { dl.append(el('dt', { textContent: k }), el('dd', { textContent: v })); }
  node.append(bloc('En bref', dl));

  // ── Variables ──
  const vars = artifact.variables || [];
  node.append(bloc(`Ce qu'il lui faut pour travailler (${vars.length})`, vars.length
    ? chips(vars.map((v) => el('span', { className: 'chip' },
        el('code', { textContent: `{{${v.name}}}` }),
        ` ${SOURCES[v.source] || v.source}${v.required === false ? ' · facultative' : ''}`)))
    : el('p', { className: 'vide', textContent: 'Rien : il travaille sans qu\'on lui fournisse quoi que ce soit.' })));

  // ── Outils : c'est là que se joue le risque, donc mode et exécutant en évidence ──
  const tools = artifact.tools || [];
  node.append(bloc(`Ce qu'il a le droit de faire (${tools.length})`, tools.length
    ? chips(tools.map((t) => el('span', { className: 'chip' },
        el('code', { textContent: t.id }),
        el('span', { className: `pill ${t.mode}`, textContent: t.mode }),
        el('span', { className: 'pill', textContent: `exécuté par ${t.executor}` }))))
    : el('p', { className: 'vide', textContent: 'Rien d\'autre que produire du texte. Il ne touche à aucun système.' })));

  // ── Critères : le contrat vérifié à chaque exécution ──
  const crit = artifact.criteria || [];
  node.append(bloc(`Ce qui sera vérifié sur sa réponse, à chaque fois (${crit.length})`, crit.length
    ? (() => { const ul = el('ul', { className: 'plain' });
        for (const c of crit) ul.append(el('li', {},
          el('code', { textContent: c.target }), ` ${c.op} `, el('b', { textContent: String(c.value) })));
        return ul; })()
    : el('p', { className: 'vide', textContent: 'Rien. Sa réponse ne sera confrontée à aucune exigence.' })));

  // ── Cas d'or ──
  // Le compte seul ne dit rien : cinq cas creux atteignent le seuil de L010 aussi bien
  // que cinq vrais. Le relecteur doit voir CE QUE chaque cas assertit pour juger si le
  // niveau visé est mérité, pas seulement combien il y en a.
  const gold = artifact.golden_cases || [];
  node.append(bloc(`Exemples de référence (${gold.length})`, gold.length
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

  /*
   * ── L'AIDE À LA VALIDATION ──────────────────────────────────────────────────
   *
   * Les 25 règles vérifient la FORME. Elles ne peuvent pas dire que le spec ne fait pas ce
   * que l'intention annonce — c'est écrit en tête du dépôt depuis le début, et jusqu'ici
   * c'était au relecteur de le voir seul.
   *
   * Ce bouton demande à un modèle UNE chose : ce fichier se contredit-il lui-même ? Pas
   * « est-il bon » — sans réponse, et un modèle à qui on le demande invente une note.
   *
   * Il n'est PAS une porte. Il n'active ni ne désactive « Valider » : au pire il ajoute du
   * doute. S'il devenait ce qui autorise à valider, le jour où il se trompe c'est lui qui
   * aurait validé — et personne ne saurait le dire.
   */
  const relire = el('button', { className: 'relire', textContent: '🔎 L\'IA relit' });
  relire.disabled = !lisible;
  relire.title = 'Cherche les contradictions internes de l\'artefact. Conseil, jamais verdict.';
  relire.onclick = () => demanderCoherence(entry, relire, box);

  box.append(valider, corriger, refuser, relire, el('span', { className: 'sp' }));
  if (ecrit) {
    box.append(el('span', { className: 'hint' },
      'Cet artefact écrit : la revue sécurité s\'impose avant validation.'));
  }
  box.append(el('code', { className: 'mono', style: 'color:var(--tm)', textContent: file.path }));
  return box;
}

/* ── L'aide à la validation ───────────────────────────────────────────────── */

/**
 * Demande une relecture de cohérence et l'affiche SOUS les actions.
 *
 * Ce qui est montré est fait de citations : deux extraits du fichier qui ne tiennent pas
 * ensemble. Jamais un verdict. Un constat sans ses deux citations a déjà été jeté côté
 * serveur — c'est ce qui empêche de tamponner sans lire : on ne tamponne pas deux extraits
 * qu'on a sous les yeux.
 */
async function demanderCoherence(entry, bouton, box) {
  const { artifact } = entry;
  const ancien = box.parentElement.querySelector('.coherence');
  if (ancien) ancien.remove();

  bouton.disabled = true;
  const libelle = bouton.textContent;
  bouton.textContent = 'Lecture…';

  const zone = el('div', { className: 'coherence' });
  box.after(zone);

  const dire = (classe, ...contenu) => {
    zone.textContent = '';
    zone.className = `coherence ${classe}`;
    zone.append(...contenu);
  };

  try {
    const r = await fetch('../api/coherence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artefact: artifact })
    });
    const corps = await r.json();
    if (!r.ok) throw new Error(corps.erreur || `Le serveur a répondu ${r.status}.`);

    if (corps.illisible) {
      // « Rien de lisible » et « aucune contradiction » ne sont PAS la même chose.
      // Les confondre ferait passer une panne pour un feu vert.
      dire('flou', el('b', { textContent: '⚠ Réponse illisible' }),
        el('small', { textContent: 'Le modèle n\'a rien rendu d\'exploitable. Ce n\'est pas '
          + 'un feu vert : relance, ou relis toi-même.' }));
      return;
    }

    if (corps.constats.length === 0) {
      dire('ok', el('b', { textContent: '✔ Aucune contradiction interne trouvée' }),
        el('small', { textContent:
          'Le modèle n\'a rien vu qui se contredise. Ça ne dit RIEN de la qualité de '
          + 'l\'agent, ni de son utilité — seulement que ses déclarations tiennent '
          + 'ensemble. Le jugement reste le tien.'
          + (corps.jetes.length ? ` (${corps.jetes.length} constat(s) écarté(s) : citations introuvables dans le fichier.)` : '') }));
      return;
    }

    dire('ko', el('b', { textContent:
      `🔎 ${corps.constats.length} contradiction(s) à vérifier — ce n'est pas un refus` }));

    for (const c of corps.constats) {
      zone.append(el('div', { className: 'contra' },
        el('div', { className: 'ou', textContent: c.ou }),
        el('blockquote', { textContent: c.cite_a }),
        el('div', { className: 'contre', textContent: '…contre…' }),
        el('blockquote', { textContent: c.cite_b }),
        el('div', { className: 'pourquoi', textContent: c.pourquoi })));
    }

    zone.append(el('small', { textContent:
      'Deux extraits du fichier, à confronter toi-même. Si tu leur donnes tort, ignore-les : '
      + 'ce bouton ne décide de rien, et le verdict de la porte n\'a pas bougé.' }));
  } catch (error) {
    dire('flou', el('b', { textContent: '✕ Relecture impossible' }),
      el('small', { textContent: error.message }));
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
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

/* ── Le parc — ce qui est publié, ce qui attend, ce qui ne sert plus ──────────
 *
 * L'écran qui manquait. On savait faire ENTRER un artefact au registre et pas l'en faire
 * sortir : la seule porte de sortie était la file de validation, donc AVANT publication.
 * Après, plus rien — un catalogue qui ne peut que grossir finit par contenir surtout des
 * choses que plus personne n'utilise, et un catalogue qu'on ne croit plus ne se consulte
 * plus.
 *
 * L'état vient du dossier, comme partout ici :
 *   artifacts/          actif    · visible au catalogue, lançable
 *   artifacts/pending/  en revue · attend une décision
 *   artifacts/retires/  retiré   · a servi, ne sert plus
 *
 * Les trois dans UNE liste : devant un parc, la question n'est jamais « montre-moi le
 * dossier pending », c'est « où en est cet agent-là ».
 *
 * Deux gestes, et la différence entre les deux est tout le sujet :
 *
 *   RETIRER    déplace. Le catalogue ne le montre plus, il n'est plus lançable, mais le
 *              fichier existe toujours et le geste se défait d'un clic. Neuf fois sur dix
 *              c'est ce qu'on veut — et c'est pour ça qu'il doit être facile.
 *   SUPPRIMER  efface. L'historique du dépôt le garde — rien ne disparaît vraiment d'un
 *              dépôt git — mais plus aucun écran ne le retrouvera.
 *
 * La colonne « Usages » reste vide, et c'est délibéré : voir parc.js.
 */
const pvue = { entrees: [], q: '', kind: '', statut: '', charge: false };
const KINDS = [['', 'Tout'], ['agent', 'Agents'], ['prompt', 'Prompts']];

async function chargerParc() {
  if (!repo) {
    $('pcount').textContent = '';
    $('pempty').style.display = 'block';
    $('pempty').textContent = 'Aucun dépôt de registre choisi.';
    return;
  }
  $('psource').textContent = repo;

  // `type === 'file'` écarte de lui-même les sous-dossiers : chaque dossier ne rend que
  // ce qui lui appartient, et un artefact ne peut donc pas être compté deux fois.
  const lire = async (dossier) => {
    const fichiers = (await forge.listFiles(repo, dossier))
      .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));
    return Promise.all(fichiers.map(async (file) => {
      try {
        const found = await forge.getFile(repo, file.path);
        const artifact = yaml.parse(found.content);
        return { path: file.path, artifact, report: lint(artifact, { ...ctx, artifacts: [] }) };
      } catch (error) {
        // Un fichier illisible est justement celui qu'on veut pouvoir retirer : on ne le
        // cache pas derrière son erreur de lecture.
        return { path: file.path, artifact: null, error: error.message };
      }
    }));
  };

  /*
   * Les dossiers de CETTE personne : les trois gouvernés, plus les siens. Un dossier
   * personnel absent — on n'a jamais rien sauvé chez soi — rend une liste vide plutôt
   * qu'une erreur : ce n'est pas une panne, c'est un parc sans brouillon.
   */
  const dossiers = dossiersDe(session.username);

  try {
    const lots = await Promise.all(dossiers.map(([, d]) => lire(d).catch(() => [])));
    // Deux dossiers portent le statut « mien » : on les fusionne au lieu d'écraser l'un
    // par l'autre — sinon les chaînes personnelles disparaissaient derrière les agents.
    const parStatut = {};
    dossiers.forEach(([statut], i) => { (parStatut[statut] ||= []).push(...lots[i]); });
    // `ctx.derive` vient de `derive/etat.json`, écrit par le banc d'essai. Il vaut `null`
    // tant que personne n'a joué de cas d'or : les niveaux restent alors « visé ». Le
    // basculement en « atteint » s'est fait sans revenir ici — c'était tout l'intérêt de
    // le passer avant qu'il existe.
    pvue.entrees = inventaireParc(parStatut, ctx.derive);
    pvue.charge = true;
  } catch (error) {
    $('pcount').textContent = '';
    $('pempty').style.display = 'block';
    $('pempty').textContent = `Lecture impossible : ${error.message}`;
    return;
  }
  renderParc();
}

function renderBarreParc() {
  // Le résumé compte TOUT, pas ce que le filtre laisse voir : un chiffre qui bouge selon
  // la vue ne prouve rien.
  const total = compter(pvue.entrees);
  const som = $('psummary');
  som.textContent = '';
  for (const [cle, def] of Object.entries(STATUTS)) {
    const carte = el('div', { className: 'sm' },
      el('span', { className: `d d-${cle}`, title: def.aide }),
      el('b', { textContent: String(total[cle]) }), ` ${def.label}`);
    // Cliquer un compteur filtre dessus : le chiffre EST le filtre, sinon on lit un
    // nombre puis on va chercher la liste déroulante pour voir de quoi il parle.
    carte.style.cursor = 'pointer';
    carte.title = def.aide;
    carte.onclick = () => { pvue.statut = pvue.statut === cle ? '' : cle; $('pstatut').value = pvue.statut; renderParc(); };
    som.append(carte);
  }
  som.append(el('div', { className: 'sm', style: 'margin-left:auto' },
    el('b', { textContent: String(pvue.entrees.length) }), ' au total'));

  const seg = $('pkind');
  if (!seg.children.length) {
    for (const [id, label] of KINDS) {
      const b = id ? el('button', {}, icKind(id), ` ${label}`) : el('button', { textContent: label });
      b.dataset.k = id;
      b.onclick = () => { pvue.kind = id; renderParc(); };
      seg.append(b);
    }
    const sel = $('pstatut');
    sel.append(el('option', { value: '', textContent: 'Tous les statuts' }));
    for (const [cle, def] of Object.entries(STATUTS)) {
      sel.append(el('option', { value: cle, textContent: def.label }));
    }
    sel.onchange = () => { pvue.statut = sel.value; renderParc(); };
    $('psearch').oninput = () => { pvue.q = $('psearch').value; renderParc(); };
  }
  for (const b of seg.children) b.className = b.dataset.k === pvue.kind ? 'on' : '';
}

function renderParc() {
  renderBarreParc();

  const montres = filtrer(pvue.entrees, pvue);
  $('pcount').textContent = montres.length === pvue.entrees.length
    ? `${pvue.entrees.length} agent(s) en service`
    : `${montres.length} sur ${pvue.entrees.length}`;

  const host = $('parc');
  host.textContent = '';
  $('pempty').style.display = 'none';

  if (!montres.length) {
    host.append(el('div', { className: 'tempty', textContent: pvue.entrees.length
      ? 'Aucun résultat pour ces filtres.'
      : 'Le parc est vide — rien n\'a encore été soumis.' }));
    return;
  }
  for (const e of montres) host.append(ligneParc(e));
}

/** La colonne « La porte » : la seule chose qu'on SACHE de la santé d'un artefact. */
function celluleParc(e) {
  if (!e.lisible) return el('span', { className: 'porte' }, el('b', { style: 'color:var(--err)', textContent: 'illisible' }));
  if (!e.porte) return el('span', { className: 'jamais', textContent: '—' });
  if (e.porte === 'conforme') return el('span', { className: 'porte' }, el('b', { style: 'color:var(--ok)', textContent: '✔ conforme' }));
  return el('span', { className: 'porte' },
    el('b', { style: 'color:var(--err)', textContent: `✕ ${e.erreurs} erreur(s)` }),
    el('span', { className: 'flag', textContent: 'ne franchit plus' }));
}

function ligneParc(e) {
  const row = el('div', { className: `trow${e.statut === 'retire' ? ' off' : ''}` });

  row.append(el('div', { className: 'nm' },
    el('span', { className: 'ic' }, e.lisible ? icKind(e.kind) : '⚠'),
    el('div', { style: 'min-width:0' },
      el('div', { className: 't', textContent: e.titre, title: e.titre }),
      el('div', { className: 'o', title: e.path,
                  textContent: [e.owner, e.scope, e.niveauTexte].filter(Boolean).join(' · ') || e.path }))));

  row.append(el('span', {}, e.kind
    ? el('span', { className: `kb ${e.kind}` }, icKind(e.kind), e.kind === 'agent' ? ' Agent' : ' Prompt')
    : el('span', { className: 'jamais', textContent: '—' })));

  const def = STATUTS[e.statut];
  row.append(el('span', {}, el('span', { className: `st ${e.statut}`, title: def.aide },
    el('span', { className: `d d-${e.statut}` }), def.label)));

  row.append(el('span', { className: 'c4' }, celluleParc(e)));

  /*
   * La colonne que la maquette remplit de chiffres, et qu'on laisse vide.
   *
   * Le nombre d'usages est un état DÉRIVÉ, et rien ne le mesure encore. Écrire « 480 »
   * serait exactement ce que ce produit reproche aux autres — et le pire mensonge
   * possible ici, puisque toute sa thèse tient à la séparation entre le déclaré et le
   * mesuré. Une colonne vide qui s'explique vaut mieux qu'une colonne pleine qui ment.
   */
  row.append(el('span', { className: 'c5 jamais', textContent: 'jamais mesuré',
    title: 'Aucune capture d\'exécution n\'est branchée : ce chiffre serait inventé.' }));

  row.append(el('span', { className: 'c6 pacts' }, ...actionsParc(e)));
  return row;
}

function actionsParc(e) {
  const out = [];

  if (e.statut === 'revue') {
    const versFile = el('button', { className: 'btn pub', textContent: 'À valider →' });
    versFile.onclick = () => montrerVue('valider');
    out.push(versFile);
  } else if (e.statut === 'mien') {
    /*
     * Un agent gardé chez soi n'a ni retrait ni remise : il n'est au catalogue de
     * personne d'autre, donc il n'y a rien à en sortir. Restent l'édition et
     * l'effacement — et c'est justement l'effacement qui manquait.
     */
  } else if (e.statut === 'actif') {
    const retirer = el('button', { className: 'btn off', textContent: '⏸ Retirer' });
    retirer.onclick = () => agirParc(e, 'retirer');
    out.push(retirer);
  } else {
    const remettre = el('button', { className: 'btn on', textContent: '▶ Remettre' });
    remettre.onclick = () => agirParc(e, 'reactiver');
    out.push(remettre);
  }

  // Éditer rouvre au Studio et repasse par la file de validation : corriger n'est pas
  // contourner. Un fichier illisible n'a rien à y ouvrir.
  const editer = el('button', { className: 'btn ghost', textContent: 'Éditer', disabled: !e.lisible });
  editer.onclick = () => {
    sessionStorage.setItem('salsi_ia_edit', JSON.stringify({ artifact: e.artifact, path: e.path }));
    location.href = '../studio/index.html';
  };
  out.push(editer);

  const supprimer = el('button', { className: 'btn danger', textContent: '🗑' , title: 'Supprimer du registre' });
  supprimer.onclick = () => agirParc(e, 'supprimer');
  out.push(supprimer);
  return out;
}

/*
 * La confirmation dit ce qu'on PERD, pas « êtes-vous sûr ».
 *
 * « Êtes-vous sûr » se clique sans lire. Nommer la conséquence — et surtout dire que
 * retirer se défait alors que supprimer non — est ce qui permet de choisir entre les deux
 * au lieu de prendre le bouton le plus proche.
 */
const QUESTIONS = {
  retirer: (nom) => `Retirer « ${nom} » du catalogue ?\n\n`
    + 'Il n\'y sera plus visible et ne pourra plus être lancé. Le fichier reste dans le '
    + 'dépôt : ce geste se défait d\'un clic.',
  reactiver: (nom) => `Remettre « ${nom} » au catalogue ?\n\n`
    + 'Il redevient visible et lançable. La porte s\'applique à nouveau : s\'il n\'est '
    + 'plus conforme, le pré-vol le refusera.',
  supprimer: (nom) => `Supprimer « ${nom} » ?\n\n`
    + 'Le fichier est effacé du registre. L\'historique du dépôt le garde — rien ne '
    + 'disparaît vraiment d\'un dépôt git — mais plus aucun écran ne le retrouvera.\n\n'
    + 'Pour le sortir du catalogue sans l\'effacer, utilise « Retirer ».',
  // Un artefact personnel n'a pas de « Retirer » à proposer en repli : la question doit
  // donc dire tout de suite que c'est sans retour, et où il disparaît.
  supprimerMien: (nom) => `Supprimer « ${nom} » ?\n\n`
    + 'C\'est un agent que tu as sauvé chez toi. Il disparaîtra de TON catalogue, et il '
    + 'n\'y a pas de « Retirer » pour celui-là : le geste est sans retour.\n\n'
    + 'L\'historique du dépôt en gardera la trace.'
};

const CIBLE = { retirer: 'artifacts/retires', reactiver: 'artifacts' };

async function agirParc(e, action) {
  const nom = e.titre;
  const question = action === 'supprimer' && e.statut === 'mien' ? 'supprimerMien' : action;
  if (!confirm(QUESTIONS[question](nom))) return;

  for (const b of document.querySelectorAll('#vue-parc .btn')) b.disabled = true;

  const fichier = e.path.split('/').pop();
  const signe = (verbe) => `Artefact ${e.id}. ${verbe} par ${session.username}.`;

  try {
    if (action === 'supprimer') {
      await forge.deleteFile(repo, e.path, {
        message: `registre : supprimer ${nom}\n\n${signe('Supprimé')} Effacé du registre.`
      });
      flash(`« ${nom} » supprimé. L'historique du dépôt en garde la trace.`, 'ok');
    } else {
      const cible = `${CIBLE[action]}/${fichier}`;
      await forge.moveFile(repo, e.path, cible, {
        message: `registre : ${action} ${nom}\n\n`
          + `${signe(action === 'retirer' ? 'Retiré' : 'Réactivé')} Déplacé en ${cible}.`
      });
      flash(action === 'retirer'
        ? `« ${nom} » retiré du catalogue. Réversible d'un clic.`
        : `« ${nom} » est de nouveau au catalogue.`, 'ok');
    }
  } catch (error) {
    flash(error.message, 'err');
  }

  pvue.charge = false;
  await chargerParc();
  jvue.charge = false;          // le journal a une décision de plus à montrer
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
/*
 * Le parc EN PREMIER, et c'est un choix.
 *
 * L'écran s'ouvrait sur la file de validation. Avec un onglet renommé « À relire »,
 * l'ensemble donnait un écran qui semblait ne servir qu'à ça — alors que sa vue la plus
 * utile au quotidien est le parc : où en est cet agent, qui en répond, franchit-il encore
 * la porte, et comment le retirer.
 *
 * Ne plus atterrir sur la file ne doit pas revenir à ignorer qu'elle se remplit : le
 * nombre en attente est porté par le sélecteur, donc visible depuis n'importe quelle vue.
 */
/*
 * Une QUATRIÈME vue : ce qui a réellement tourné.
 *
 * Les trois premières décrivent le parc DÉCLARÉ — ce qui existe, ce qui attend, ce qui a
 * été décidé. Aucune ne dit ce qui a été fait. Un registre gouverné qui ne sait pas
 * combien de jetons il a consommés ni combien de ses agents tiennent leur contrat décrit
 * une intention, pas une activité.
 *
 * Elle vit dans `executions.js` : mettre ses graphiques ici aurait ajouté trois cents
 * lignes à un fichier qui en fait déjà mille, pour un métier qui n'est pas le sien.
 */
/*
 * Une CINQUIÈME : lire un pack de compétences venu d'ailleurs.
 *
 * Elle est en dernier, et c'est voulu. Ce n'est pas le geste courant — on administre un
 * parc tous les jours, on adopte un pack tiers trois fois par an — et surtout, la mettre
 * en avant reviendrait à promettre un import qu'elle ne fait pas : elle lit, elle montre
 * ce qui manque, elle n'écrit rien.
 */
const VUES = [['parc', '📦 Le parc'], ['valider', '✅ À valider'],
              ['executions', '📊 Exécutions'], ['journal', '📜 Journal'],
              ['import', '📥 Importer un pack']];
const VUE_DEFAUT = 'parc';

/** Le compte d'attente, sur son bouton. Vide tant que la file n'est pas connue. */
const attente = el('span', { className: 'att' });

function montrerVue(id) {
  for (const [v] of VUES) $(`vue-${v}`).hidden = v !== id;
  for (const b of $('vues').children) b.className = b.dataset.vue === id ? 'on' : '';
  // L'adresse suit la vue : une vue se partage, et un rechargement ne renvoie pas
  // ailleurs. `replaceState` plutôt qu'un `hash =` pour ne pas empiler l'historique.
  history.replaceState(null, '', `#${id}`);
  if (id === 'journal' && !jvue.charge) chargerJournal();
  if (id === 'parc' && !pvue.charge) chargerParc();
  if (id === 'executions' && !chargeEs()) chargerExecutions();
  /*
   * La file de validation, elle, se RECHARGE à chaque venue — pas de garde `charge`.
   *
   * Défaut vu en montant la démonstration d'import : on dépose une capacité depuis
   * l'écran d'import, on clique l'onglet « À valider »… et la file est vide. `load()` ne
   * tournait qu'au démarrage du module ; revenir sur la vue par un bouton ne la
   * rafraîchissait pas. Et c'est justement la vue dont le sens est « ce qui attend
   * MAINTENANT » : la seule dont une donnée périmée ment sur une décision en attente.
   */
  if (id === 'valider') load();
}

// Le pack se lit sur demande : pas de chargement à l'ouverture de la vue, parce qu'aucun
// dépôt n'est choisi tant que personne ne l'a écrit.
$('imbtn').onclick = () => lireLePack(forge, { session, repo });

for (const [id, label] of VUES) {
  const b = el('button', { textContent: label });
  b.dataset.vue = id;
  if (id === 'valider') b.append(attente);
  b.onclick = () => montrerVue(id);
  $('vues').append(b);
}

/** La vue demandée par l'adresse, si elle existe. Sinon celle par défaut. */
function vueDemandee() {
  const voulue = location.hash.replace('#', '');
  return VUES.some(([v]) => v === voulue) ? voulue : VUE_DEFAUT;
}

/*
 * Suivre l'adresse quand elle change, pas seulement au chargement.
 *
 * Sans ça, coller `admin/#parc` depuis l'écran déjà ouvert ne fait rien : le navigateur
 * change le fragment sans recharger la page. Le lien marche à froid et pas à chaud — le
 * genre d'incohérence qu'on met vingt minutes à s'expliquer.
 */
addEventListener('hashchange', () => montrerVue(vueDemandee()));

async function chargerJournal() {
  if (!repo) {
    $('jcount').textContent = '';
    $('jempty').style.display = 'block';
    $('jempty').textContent = 'Aucun dépôt de registre choisi.';
    return;
  }
  $('jsource').textContent = `historique de ${repo}`;

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

monterPas();
montrerVue(vueDemandee());
await load();
