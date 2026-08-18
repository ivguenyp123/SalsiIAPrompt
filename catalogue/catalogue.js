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
import { SOURCES, sourceProbable, estUnIdentifiant, chercher as chercherFichier,
         diffUnifie, resume, grosse } from '../lib/matiere.js';
import { rendre as rendreMd, ressembleADuMarkdown, lienSur } from '../lib/md.js';
import { rapportHtml, nomFichier } from '../lib/rapport.js';
import { sait as saitCalculer, surPlusieursDepots, surUneMr, listeDeChoix, zonesDepuisArbre,
         repartitionContributions, inventaireBranches, resumeCourt, resumeBranches,
         FENETRE, MAX_ZONES_INTERROGEES } from '../lib/signaux-matiere.js';
import { fichierSuspect, MAX_FICHIERS_LUS, rapportSecrets, resumeSecrets,
         ecosysteme, MAX_MANIFESTES_LUS, inventaireDependances, resumeDependances,
         rapportConformite, resumeConformite } from '../lib/signaux-securite.js';
import { chiffresDora, resumeDora, FENETRE_JOURS,
         MAX_PIPELINES, MAX_MR } from '../lib/signaux-dora.js';
import { chiffresDaily, resumeDaily,
         MAX_PIPELINES as MAX_PIPELINES_DAILY, MAX_MR as MAX_MR_DAILY,
         MAX_COMMITS as MAX_COMMITS_DAILY,
         MAX_DEPLOIEMENTS as MAX_DEPLOIEMENTS_DAILY, FENETRES } from '../lib/signaux-daily.js';
import { parcSecurite, resumeParc, MAX_DEPOTS } from '../lib/signaux-parc.js';
import { coupee } from '../lib/arret.js';
import { revueMr, resumeRevue } from '../lib/signaux-revue.js';
import { jobEnEchec, resumeCi } from '../lib/signaux-ci.js';
import { rapportDepot, resumeDepot } from '../lib/signaux-depot.js';
import { BRANCHE as BRANCHE_CORRECTIFS, fichiersAProposer, aProposer,
         descriptionMr, titreMr, messageCommit } from '../lib/correctifs.js';
import { indexer, chercher, etiquettes, porteEtiquettes } from '../lib/recherche.js';
import { ETAPES, VU, jouables, placer } from '../lib/tour.js';
import { niveau, pastille } from '../lib/niveau.js';
import { BUMPS } from '../runtime/livraison.js';
import { preparer as preparerLivraison, executer as executerLivraison } from '../runtime/executer.js';
import { knownScopes, guessScope } from '../app/scopes.js';
import { contexteDepot } from '../lib/repos.js';
import { dossier as dossierMien } from '../lib/mien.js';
import { champDepot, champDepots, estUnDepot } from '../app/depots.js';
import { makeValidator } from '../lib/schema.js';
import yaml from '../lib/yaml.js';
import { carte } from '../runtime/etat-derive.js';

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

const session = requireSession('../app/login.html');
if (!session) await new Promise(() => {});   // redirection en cours, on suspend

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

// L'onglet allumé suit le filtre d'ouverture : arriver par « 💾 Mes agents » et voir
// « 🧰 Les agents » en surbrillance ferait douter d'avoir cliqué au bon endroit.
const enMiens = new URLSearchParams(location.search).get('filtre') === 'miens';

mountShell({ active: enMiens ? 'miens' : 'catalogue', session, base: '../',
             onLogout: () => { clear(); location.replace('../app/login.html'); } });

if (enMiens) {
  document.getElementById('titre').textContent = 'Mes agents';
  document.getElementById('chapo').innerHTML =
    'Ce que tu as monté <b>pour toi</b> dans Fabriquer. Tu les lances d\'ici, directement — '
    + 'rien ne passe par l\'Admin, parce que rien n\'engage personne d\'autre. '
    + 'Personne ne les voit, et ils ne peuvent pas servir de brique à une suite. '
    + 'Le pré-vol tourne quand même à chaque lancement.';
}

const forge = createForge(session);
const repo = localStorage.getItem('salsi_ia_registry_repo');

const ICONS = { agent: '🤖', prompt: '📚', chain: '🔗' };

let items = [];
/*
 * Le filtre d'ouverture, et il peut venir de l'URL.
 *
 * `?filtre=miens` ouvre le Catalogue sur MES agents — c'est ce que l'onglet « 💾 Mes
 * agents » de la barre appelle. Pas un second écran : le même, ouvert au bon endroit.
 * Un catalogue dupliqué aurait divergé du premier au premier correctif, et il aurait
 * fallu corriger le lancement, l'export et le pré-vol à deux endroits.
 *
 * Une valeur inconnue retombe sur « Tout » plutôt que de vider l'écran : un lien mal
 * recopié doit montrer le catalogue, pas une page blanche.
 */
const FILTRES_CONNUS = new Set(['tout', 'agent', 'prompt', 'miens', 'ko']);
const filtreDemande = new URLSearchParams(location.search).get('filtre') || '';
let filter = FILTRES_CONNUS.has(filtreDemande) ? filtreDemande : 'tout';
let tagsRetenus = [];    // cumulatifs : chaque étiquette resserre
let ctx = null;        // registres + validateur, partagés avec le pré-vol
let scopes = [];       // périmètres connus, dérivés du registre des outils

/* ── Chargement ───────────────────────────────────────────────────────────── */

/*
 * L'état DÉRIVÉ, s'il existe.
 *
 * C'est ce fichier qui fait basculer la pastille de « officiel — visé », en pointillés,
 * à « officiel » tout court. Il n'existe qu'après un passage au banc d'essai
 * (`node runtime/banc-cli.js <id> --go`) — donc pas du tout, tant que personne n'a joué
 * les cas d'or.
 *
 * Absent, il rend `null`, et c'est la bonne valeur : `null` fait taire L016, P005 et P006
 * au lieu de leur faire dire « jamais certifié » sur tout le catalogue. Une plateforme
 * sans mesure ne doit pas ressembler à une plateforme dont tout échoue.
 */
async function etatDerive() {
  try {
    const r = await fetch('../derive/etat.json', FRAIS);
    return r.ok ? carte(await r.json()) : null;
  } catch {
    return null;                            // pas de banc, pas de mesure : on ne devine pas
  }
}

async function load() {
  if (!repo) {
    return fail('Aucun dépôt de registre choisi.',
                'Retourne à l\'accueil pour en sélectionner un — c\'est là que vivent les artefacts.');
  }
  $('source').textContent = `lus dans ${repo}`;
  

  const [tools, targets, entrees, schema, derive, repos] = await Promise.all([
    fetch('../registries/tools.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t).tools),
    fetch('../registries/targets.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t).targets),
    fetch('../entrees/index.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t)),
    fetch('../schema/artifact.schema.json', FRAIS).then((r) => r.json()),
    etatDerive(),
    // Le référentiel des dépôts. Absent ou vide, tout se comporte comme avant : la
    // sensibilité reste saisie à la main, et P002 demande au lieu de refuser.
    fetch('../registries/repos.yaml', FRAIS).then((r) => r.text())
      .then((t) => yaml.parse(t).repos || []).catch(() => [])
  ]);
  ctx = { tools, targets, entrees, derive, repos, validateArtifact: makeValidator(schema) };
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
      // L'index est calculé UNE FOIS. Replier les accents de cent trente artefacts à
      // chaque touche du clavier se sent.
      return { file, artifact, index: indexer(artifact),
               report: lint(artifact, { ...ctx, artifacts: [] }) };
    } catch (error) {
      return { file, artifact: null, error: error.message };
    }
  })));

  /*
   * LES MIENS — ce que j'ai sauvé chez moi, lu dans `mes-agents/` et `mes-chaines/`.
   *
   * Sans ça, « sauver chez moi » produisait un fichier qu'on pouvait rouvrir et jamais
   * lancer : le Catalogue ne lisait que `artifacts/`. Un agent qu'on ne peut pas lancer
   * n'est pas un agent, c'est un brouillon.
   *
   * Ils sont MÉLANGÉS aux autres, pas rangés à part, et portent un badge. Une section
   * séparée les ferait oublier — or ce sont ceux qu'on utilise le plus souvent. Le badge
   * et le filtre « les miens » suffisent à ne jamais les confondre avec du validé.
   */
  items = [...items, ...await chargerMiens(repo)];

  renderTags();
  render();

  /*
   * Un lien direct vers une fiche : `?agent=<id>`.
   *
   * C'est ce que la recommandation de l'accueil envoie. Sans lui, « ▶ Comprendre
   * pourquoi » déposerait dans un catalogue de cent trente lignes, à charge de retrouver
   * soi-même l'agent qu'on venait de nous désigner — une promesse suivie d'une corvée.
   */
  const vise = new URLSearchParams(location.search).get('agent');
  if (vise) {
    const trouve = items.find((e) => e.artifact?.id === vise);
    if (trouve) { openSheet(trouve); return; }
    // Identifiant inconnu : on ne se tait pas. La reco pointait quelque chose, et sa
    // disparition doit s'expliquer plutôt que ressembler à un clic sans effet.
    $('q').value = vise;
    render();
  }

  proposerTour();
}

/**
 * Mes artefacts personnels, prêts à être lancés comme les autres.
 *
 * Le lint tourne dessus exactement comme sur le reste : le fichier a beau être à moi, il
 * n'a aucun privilège. Et le pré-vol tournera au lancement, où qu'il vive.
 */
async function chargerMiens(repo) {
  const qui = session.username;
  const dossiers = [dossierMien(qui, 'prompt'), dossierMien(qui, 'chain')];

  const lots = await Promise.all(dossiers.map(async (dossier) => {
    try {
      const fichiers = (await forge.listFiles(repo, dossier))
        .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));

      return (await Promise.all(fichiers.map(async (file) => {
        try {
          const artifact = yaml.parse((await forge.getFile(repo, file.path)).content);
          if (!artifact?.id) return null;
          return { file, artifact, index: indexer(artifact), personnel: true,
                   report: lint(artifact, { ...ctx, artifacts: [] }) };
        } catch { return null; }
      }))).filter(Boolean);
    } catch {
      return [];   // dossier absent : normal tant qu'on n'a rien sauvé
    }
  }));

  return lots.flat();
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

/*
 * La recherche est déléguée à `lib/recherche.js` : elle PONDÈRE et elle CLASSE.
 *
 * L'ancienne collait tous les champs bout à bout et rendait les résultats dans l'ordre du
 * dossier. À seize artefacts ça passait ; à cent trente, chercher « revue » remonte autant
 * l'agent DONT C'EST LE TITRE que celui dont le `not_for` dit « pas pour une revue », et
 * l'alphabet tranche.
 */

const FILTERS = [
  { id: 'tout', label: 'Tout' },
  { id: 'agent', label: '🤖 Agents' },
  { id: 'prompt', label: '📚 Prompts' },
  // « Les miens » n'est pas un type mais une PROVENANCE, et c'est pour ça qu'il mérite
  // sa place ici : un agent sauvé chez soi n'a été relu par personne, et on doit pouvoir
  // ne regarder que ceux-là — ou les écarter.
  { id: 'miens', label: '💾 Les miens' },
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
  (filter === 'tout' ? true
   : filter === 'ko' ? (entry.report?.blocked || !entry.artifact)
   : filter === 'miens' ? entry.personnel === true
   : entry.artifact?.kind === filter)
  && porteEtiquettes(entry.artifact, tagsRetenus);

/*
 * Le nuage d'étiquettes, DÉRIVÉ du registre.
 *
 * Jamais une liste tenue à côté : elle divergerait au premier artefact publié. Les
 * comptes viennent de ce qui est réellement là, et les étiquettes qui rangent vraiment
 * quelque chose passent devant celles qui n'ont servi qu'une fois.
 */
function renderTags() {
  const host = $('tags');
  host.textContent = '';
  const tous = etiquettes(items.map((e) => e.artifact).filter(Boolean));
  if (tous.length === 0) return;

  host.append(el('span', { className: 'titre', textContent: 'Étiquettes' }));

  for (const { tag, n } of tous) {
    const on = tagsRetenus.includes(tag);
    const b = el('button', { className: on ? 'on' : '' },
      tag, el('span', { className: 'n', textContent: String(n) }));
    b.onclick = () => {
      tagsRetenus = on ? tagsRetenus.filter((t) => t !== tag) : [...tagsRetenus, tag];
      renderTags();
      render();
    };
    host.append(b);
  }

  if (tagsRetenus.length) {
    const v = el('button', { className: 'vider', textContent: `✕ ${tagsRetenus.length} filtre(s)` });
    v.onclick = () => { tagsRetenus = []; renderTags(); render(); };
    host.append(v);
  }
}

/* ── Rendu ────────────────────────────────────────────────────────────────── */

function render() {
  const query = $('q').value.trim();
  const trouves = chercher(items, query, passesFilter);

  $('count').textContent = trouves.length === items.length
    ? `${items.length} capacité(s)`
    : `${trouves.length} sur ${items.length}`;

  const host = $('cards');
  host.textContent = '';
  host.style.display = '';
  $('empty').style.display = trouves.length ? 'none' : 'block';

  if (trouves.length === 0) {
    showEmpty('Rien ne correspond.',
      tagsRetenus.length
        ? 'Les étiquettes retenues excluent peut-être ce que tu cherches — retire-les.'
        : 'Essaie d\'autres mots : la recherche accepte les préfixes, mais tous les '
          + 'fragments doivent correspondre.');
    return;
  }

  for (const { entree, pourquoi } of trouves) {
    const n = card(entree);
    /*
     * Pourquoi ce résultat est là. Sans ça, un classement inattendu ressemble à un bug —
     * et on cesse de faire confiance au champ, ce qui est bien pire qu'un mauvais ordre.
     */
    if (query && pourquoi.length) {
      n.append(el('div', { className: 'pourquoi', textContent: `trouvé par ${pourquoi.join(', ')}` }));
    }
    host.append(n);
  }
}

function card(entry) {
  const { artifact, report, file, error, personnel } = entry;

  if (!artifact) {
    return el('button', { className: 'item' },
      el('h3', {}, '⚠ ', file.name),
      el('p', { textContent: `Fichier illisible : ${error}` }));
  }

  const node = el('button', { className: `item${personnel ? ' mien' : ''}` },
    el('h3', {}, `${ICONS[artifact.kind] || '📄'} `, artifact.title || artifact.id),
    el('p', { textContent: artifact.intent?.purpose || '—' })
  );

  const foot = el('div', { className: 'foot' });

  /*
   * Le badge « à moi », en TÊTE de pied de carte.
   *
   * Il doit se lire avant le niveau, parce qu'il change ce que le niveau veut dire :
   * personne n'a relu cet agent. Le mettre en fin de ligne, après les étiquettes, le
   * ferait passer pour un détail de rangement.
   */
  if (personnel) {
    foot.append(el('span', { className: 'pill mien', textContent: '💾 à moi',
      title: 'Sauvé chez toi. Personne ne l\'a relu, il n\'apparaît chez personne d\'autre, '
           + 'et il ne peut pas servir de brique à une chaîne partagée.' }));
  }
  /*
   * La pastille de niveau porte sa PROVENANCE.
   *
   * Elle affichait « officiel » en vert, à côté du titre — donc exactement comme un
   * fait. Qui lit « officiel » comprend « ça a été éprouvé ». Rien ne l'a été : aucun
   * banc d'essai ne tourne. C'est la faute la plus grave que ce produit puisse commettre,
   * puisqu'elle porte sur ce qu'il vend — la séparation entre le déclaré et le dérivé.
   *
   * Tant que rien n'est mesuré, la pastille est en POINTILLÉS et dit « visé ».
   */
  const niv = pastille(artifact, ctx.derive);
  foot.append(el('span', { className: `pill ${niv.cle} ${niv.mesure ? '' : 'vise'}`,
                           textContent: niv.texte, title: niv.aide }));
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

  const entete = el('header', {},
    el('h2', {}, ICONS[artifact.kind] || '📄', ' ', artifact.title || artifact.id));

  /*
   * Deux façons de lancer, et elles ne font pas la même chose.
   *
   * 🚚 Livrer   un module DÉTERMINISTE agit sur le dépôt — bump du tag, overlays, MR.
   *             Aucun modèle n'intervient. Réservé à ce qui a un module derrière.
   * ▶ Exécuter  le SPEC part au modèle, et le contrat est évalué sur ce qui revient.
   *             Disponible sur tout : c'est ce que fait `runtime/cli.js`, à l'écran.
   *
   * Le second n'existait pas, et son absence donnait à croire qu'il manquait « le lien
   * IA ». Il ne manquait pas le modèle : il manquait par où passer, la clé Vertex ne
   * pouvant pas vivre dans l'onglet.
   */
  if (MODULES_DISPONIBLES.some((id) => (artifact.tools || []).some((t) => t.id === id))) {
    const livrer = el('button', { textContent: '🚚 Livrer',
      title: 'Exécuter le module déterministe : prépare la livraison, sans modèle' });
    livrer.onclick = () => ouvrirLancement(entry);
    entete.append(livrer);
  }

  const executerBtn = el('button', { className: 'primary', textContent: '▶ Exécuter',
    title: 'Envoyer le spec au modèle et évaluer le contrat sur sa réponse' });
  executerBtn.onclick = () => ouvrirExecution(entry);
  entete.append(executerBtn);

  entete.append(prevolBtn, modifier, close);
  inner.append(entete);

  const body = el('div', { className: 'body' });

  const dl = el('dl', { className: 'kv' });
  const pairs = [
    ['Identifiant', artifact.id],
    ['Type', artifact.kind],
    ['Owner', `${artifact.owner?.person || '—'} · ${artifact.owner?.scope || '—'}`],
    ['Niveau', niveau(artifact, ctx.derive).texte],
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

  const scope = el('select');
  scope.append(el('option', { value: '', textContent: '— périmètre inconnu —' }));
  for (const s of scopes) scope.append(el('option', { value: s, textContent: s }));
  scope.value = guessScope(chemin, scopes) || '';

  // Le dépôt vient du jeton. Et changer de dépôt redevine son périmètre : le laisser
  // sur celui du précédent donnerait un verdict P004 calculé sur la mauvaise cible.
  const depot = selecteurDepot((choisi) => {
    scope.value = guessScope(choisi, scopes) || '';
    run();
  });

  const sensibilite = el('select');
  sensibilite.append(el('option', { value: '', textContent: '— non classé —' }));
  for (const s of SENSIBILITES) sensibilite.append(el('option', { value: s, textContent: s, selected: s === 'interne' }));

  const criticite = el('select');
  for (const [v, lib] of [['test', 'test / bac à sable'], ['production', 'production']]) {
    criticite.append(el('option', { value: v, textContent: lib }));
  }

  const champ = (libelle, controle) => el('div', {}, el('label', { textContent: libelle }), controle);

  form.append(el('div', { className: 'champs' },
    champ('Dépôt cible', depot.champ),
    champ('Périmètre du dépôt', scope),
    champ('Sensibilité du dépôt', sensibilite),
    champ('Criticité de l\'exécution', criticite)));

  const note = el('p', { className: 'note' });
  form.append(note);

  /*
   * Le référentiel des dépôts, ou son absence.
   *
   * Tant qu'il ne connaît pas ce dépôt, on garde ce qu'on avait : deux listes déroulantes
   * et un contrôle qui croit sur parole. Dès qu'il le connaît, les champs se ferment —
   * c'est la seule chose qui sépare un référentiel d'un pré-remplissage. Laisser
   * l'utilisateur corriger un classement à la baisse rendrait `P002` décoratif tout en
   * lui donnant l'air de vérifier.
   */
  function appliquerReferentiel() {
    const su = contexteDepot(depot.valeur(), ctx.repos || [],
                             { scope: scope.value, sensibilite: sensibilite.value });
    const classe = su.provenance === 'referentiel';

    if (classe) {
      if (su.sensibilite) sensibilite.value = su.sensibilite;
      if (su.scope && [...scope.options].some((o) => o.value === su.scope)) scope.value = su.scope;
    }
    sensibilite.disabled = classe;
    scope.disabled = classe && !!su.scope;

    note.textContent = classe
      ? `Classé au référentiel des dépôts (${su.par}) : non modifiable ici, et le pré-vol `
        + 'refuse sur cette base au lieu de demander confirmation.'
      : 'Ce dépôt n\'est pas au référentiel (`registries/repos.yaml`) : la sensibilité et le '
        + 'périmètre se saisissent, et le pré-vol DEMANDE au lieu de refuser. Une ligne '
        + 'ajoutée au référentiel resserre le contrôle sur ce dépôt, sans toucher au code.';
    note.className = `note${classe ? ' classe' : ''}`;
    return su;
  }

  // Une saisie par variable déclarée : c'est ce que P003 va vérifier.
  const valeurs = {};
  const vars = artifact.variables || [];
  if (vars.length) {
    const grille = el('div', { className: 'champs' });
    for (const v of vars) {
      const input = el('input', { placeholder: v.source === 'repo' ? 'issu du dépôt' : 'saisie' });
      // Le dépôt cible remplit de lui-même ce que la plateforme saurait remplir.
      if (v.name === 'repo') input.value = (depot.valeur() || chemin).split('/').pop() || '';
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
    // Le référentiel d'abord : c'est LUI qui décide ce que le pré-vol compare, pas les
    // listes déroulantes. Elles ne servent que là où il ne sait pas.
    const rapport = prevol(artifact, {
      registres: { ...ctx, artifacts: [] },
      depot: appliquerReferentiel(),
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

    /*
     * La confirmation n'est pas un refus : c'est une condition de départ. Les confondre
     * ferait passer « il faut valider » pour « c'est interdit ».
     *
     * Et depuis que le pré-vol renvoie à l'humain ce qu'il IGNORE — dépôt non classé,
     * artefact jamais certifié, niveau jamais mesuré — cette liste est le prix du
     * desserrage. Une phrase générique la viderait de son sens : on assume des choses
     * précises, une par ligne, ou on n'assume rien.
     */
    conf.hidden = !rapport.confirmationRequise;
    conf.textContent = '';
    if (rapport.confirmationRequise) {
      conf.append(el('b', { textContent:
        `✋ ${rapport.raisons.length} point(s) que la plateforme ne peut pas trancher seule` }));
      const ul = el('ul');
      for (const c of rapport.raisons) {
        ul.append(el('li', {}, el('b', { textContent: c.code }), ` ${c.message}`));
      }
      conf.append(ul);
      const coche = el('input', { type: 'checkbox' });
      coche.onchange = () => { verdict.dataset.assume = coche.checked ? 'oui' : ''; };
      conf.append(el('label', {}, coche,
        el('span', { textContent: `Je l'assume, en tant que ${session.username}. Sans cette case, `
          + 'rien ne part — ni ici, ni depuis un appel automatique.' })));
    }

    /*
     * Le reste des constats — ce qui n'est PAS déjà dans l'encadré de confirmation.
     *
     * Les répéter mot pour mot deux écrans plus bas apprenait à sauter la liste, donc à
     * sauter aussi les refus qui s'y trouvent. Ce qu'on doit assumer est en haut ; ce
     * qui reste est ici.
     */
    const restants = rapport.constats.filter((c) => !c.confirme);
    liste.textContent = '';
    for (const c of restants) {
      liste.append(el('li', {}, c.severity === ERROR ? '🔴 ' : '🟡 ',
        el('code', { textContent: c.code }), ` ${c.message}`));
    }
    if (!restants.length) {
      liste.append(el('li', { textContent: rapport.constats.length
        ? 'Rien d\'autre : tout ce qui reste est dans l\'encadré ci-dessus.'
        : 'Aucun constat : les sept contrôles passent.' }));
    }
  }

  for (const controle of [scope, sensibilite, criticite]) {
    controle.oninput = run;
    controle.onchange = run;
  }

  body.append(form);
  inner.append(body);
  run();
  depot.remplir();
}

/*
 * Les dépôts viennent du JETON, pas de la mémoire de l'utilisateur.
 *
 * Taper `groupe/sous-groupe/projet` à la main, c'est demander de connaître par cœur une
 * chaîne qu'on ne voit jamais écrite, et se tromper d'une lettre pour un « dépôt
 * introuvable » qu'on croira être un problème de droits. La forge sait déjà répondre :
 * `listRepos()` rend exactement ce que le jeton peut atteindre.
 *
 * Le résultat est mis en cache pour la session : la liste ne bouge pas entre deux
 * ouvertures d'un écran, et la recharger à chaque fois ferait payer une latence pour
 * rien.
 */
let depotsConnus = null;

async function listerDepots() {
  if (depotsConnus) return depotsConnus;
  depotsConnus = await forge.listRepos({ perPage: 100 });
  return depotsConnus;
}

/**
 * Un sélecteur de dépôt alimenté par le jeton.
 *
 * @param {Function} surChoix  appelée avec le chemin choisi, ou '' si rien
 * @returns {{champ, valeur, remplir}}
 */
function selecteurDepot(surChoix) {
  const select = el('select');
  const libre = el('input', { placeholder: 'groupe/projet', hidden: true });
  const note = el('div', { className: 'note', style: 'margin-top:5px' });

  const AUTRE = '__autre__';
  const courant = localStorage.getItem('salsi_ia_project_path') || '';

  const valeur = () => (select.value === AUTRE ? libre.value.trim() : select.value);
  const prevenir = () => surChoix(valeur());

  select.onchange = () => {
    // « Autre » n'est pas un aveu d'échec de la liste : un jeton peut atteindre un dépôt
    // que la première centaine ne contient pas.
    libre.hidden = select.value !== AUTRE;
    if (!libre.hidden) libre.focus();
    prevenir();
  };
  libre.oninput = prevenir;

  async function remplir() {
    select.textContent = '';
    select.append(el('option', { value: '', textContent: '— chargement… —' }));
    select.disabled = true;
    try {
      const depots = await listerDepots();
      select.textContent = '';
      select.append(el('option', { value: '', textContent: `— choisir parmi ${depots.length} dépôt(s) —` }));
      for (const d of depots) {
        select.append(el('option', { value: d.path, textContent: d.path, selected: d.path === courant }));
      }
      select.append(el('option', { value: AUTRE, textContent: '— autre dépôt (saisir) —' }));
      note.textContent = `${depots.length} dépôt(s) atteignables avec ton jeton.`;
      if (courant && !depots.some((d) => d.path === courant)) {
        // Le dépôt de travail choisi à l'accueil n'est pas dans la liste : on ne le perd
        // pas en silence, on le propose quand même.
        select.append(el('option', { value: courant, textContent: `${courant} (dépôt de travail)`, selected: true }));
      }
    } catch (error) {
      // Un jeton restreint à un seul dépôt ne peut pas lister les autres. Ce n'est pas
      // une panne : c'est le jeton qui fait son travail. On bascule en saisie.
      select.textContent = '';
      select.append(el('option', { value: AUTRE, textContent: '— saisir le dépôt —', selected: true }));
      libre.hidden = false;
      libre.value = courant;
      note.textContent = `Liste indisponible (${error.message}) — saisis le chemin à la main.`;
    } finally {
      select.disabled = false;
      prevenir();
    }
  }

  return { champ: el('div', {}, select, libre, note), valeur, remplir };
}

/*
 * Les outils qui ont VRAIMENT un module derrière eux.
 *
 * Le registre en déclare d'autres — `check_branch`, `run_tests`, `scan_vulnerabilities` —
 * dont l'implémentation reste à écrire. Les lister ici comme disponibles ferait apparaître
 * un bouton qui échouerait à l'usage : mieux vaut que le produit dise ce qu'il sait faire.
 */
const MODULES_DISPONIBLES = ['bump_image_tag'];


/* ── Exécuter un artefact — le modèle répond, le contrat tranche ──────────────
 *
 * Ce que le catalogue savait faire jusqu'ici : montrer une capacité, et la lancer
 * uniquement si un module déterministe existait derrière un de ses outils — un seul,
 * `bump_image_tag`. Les quatorze autres n'avaient aucun bouton, ce qui donnait à croire
 * qu'il manquait « le lien IA ». Il ne manquait pas le modèle : il manquait par où
 * passer.
 *
 * La clé de compte de service ne peut pas vivre dans l'onglet — elle ouvre le projet GCP
 * entier. L'écran appelle donc `POST /api/lancer`, qui tourne côté serveur, et ne reçoit
 * en retour qu'une sortie et un verdict. Le prompt, lui, ne revient jamais : il contient
 * le spec que le catalogue masque volontairement, et la matière injectée peut venir d'un
 * dépôt confidentiel.
 *
 * Le bouton apparaît maintenant sur TOUT, y compris quand le moteur n'est pas joignable.
 * C'est un changement de règle assumé : ne rien afficher laissait l'utilisateur chercher
 * une explication que l'écran seul pouvait lui donner.
 */
const MOTEUR = { pret: false, raison: 'Moteur d\'exécution non interrogé.', charge: false };

async function etatMoteur() {
  if (MOTEUR.charge) return MOTEUR;
  MOTEUR.charge = true;
  try {
    const r = await fetch('../api/etat', FRAIS);
    if (!r.ok) throw new Error(`réponse ${r.status}`);
    Object.assign(MOTEUR, await r.json());
  } catch (error) {
    // Servi depuis Pages ou raw.githack : il n'y a pas de serveur derrière, et c'est
    // normal. Le dire vaut mieux que de faire échouer un bouton au clic — et dire ce
    // qui a échoué exactement évite de chercher une clé quand c'est l'URL qui est fausse.
    MOTEUR.pret = false;
    MOTEUR.raison = 'Aucun moteur d\'exécution derrière cette page : elle est servie en '
      + 'fichiers statiques. L\'exécution demande un serveur, parce que la clé Vertex ne '
      + `peut pas vivre dans le navigateur. (${error.message})`;
  }
  return MOTEUR;
}

/* ── La matière : la chercher dans la forge, la garder à toi ──────────────────
 *
 * Exécuter un agent supposait de COLLER sa matière — le diff, le fichier, la requête.
 * Ça marche une fois, pour la démonstration. Personne ne le fait deux fois, et un
 * registre d'agents que personne ne relance est un catalogue de bonnes intentions.
 *
 * Ici la plateforme va la chercher dans TON dépôt, avec TON jeton, depuis ton navigateur
 * — la clé de la forge ne franchit aucune frontière, comme partout ailleurs dans ce
 * produit. Et la règle qui gouverne tout l'écran :
 *
 *   elle PROPOSE, elle n'injecte jamais.
 *
 * Rien n'arrive sans un clic. Tout ce qui arrive reste modifiable. Et ce qui part au
 * modèle est exactement ce qui est affiché — pas une relecture faite au moment du
 * départ, qui aurait pu changer entre-temps. C'est le principe du pré-vol appliqué à
 * l'entrée : un contrôle refuse ce qu'il SAIT, il demande ce qu'il IGNORE. La plateforme
 * sait aller chercher un diff ; elle ignore si c'est CE diff-là que tu voulais.
 */

/** Ce qu'on a déjà chargé — un arbre de dépôt ne se redemande pas à chaque frappe. */
const CACHE = { depots: null, arbres: new Map(), branches: new Map() };

async function depots() {
  if (!CACHE.depots) CACHE.depots = await forge.listRepos({ perPage: 100 });
  return CACHE.depots;
}

async function arbre(depot) {
  if (!CACHE.arbres.has(depot)) {
    if (!CACHE.branches.has(depot)) {
      const info = await forge.projectInfo(depot);
      CACHE.branches.set(depot, info.defaultBranch || 'main');
    }
    CACHE.arbres.set(depot, await forge.listTree(depot, CACHE.branches.get(depot)));
  }
  return CACHE.arbres.get(depot);
}

/**
 * La matière d'un signal, ALLÉE CHERCHER puis CALCULÉE — jamais demandée.
 *
 * C'est la moitié déterministe du travail. Le modèle recevra des chiffres réels au lieu
 * d'un champ vide, et n'aura donc plus de raison d'en inventer. Tout passe par
 * `app/forge.js` : rien ici ne connaît GitHub ni GitLab, et c'est ce qui garantit que ça
 * marchera sur l'un comme sur l'autre.
 */
async function matiereCalculee(nom, depot) {
  const calcul = CALCULS[nom];
  return calcul ? calcul(depot) : null;
}

/*
 * Un signal, une façon d'aller le chercher. Une table plutôt qu'une chaîne de `if` :
 * chaque signal ajouté était une ligne de plus dans la même fonction, et le jour où l'un
 * d'eux manquait, l'écran retombait sur un champ vide sans rien dire.
 */
const CALCULS = {
  repartition_contributions: (depot) => matiereContributions(depot),
  inventaire_branches: (depot) => matiereBranches(depot),
  rapport_secrets: (depot) => matiereSecrets(depot),
  inventaire_dependances: (depot) => matiereDependances(depot),
  rapport_conformite: (depot) => matiereConformite(depot),
  chiffres_dora: (depot) => matiereDora(depot),
  /*
   * `activite_du_jour`, et non un nom neuf.
   *
   * C'est le nom que l'inventaire du hub donne déjà à l'entrée du module Daily Report —
   * cinq prompts s'en réclament. En inventer un autre aurait laissé le catalogue dire
   * « chiffres_daily » là où la plateforme dit « activite_du_jour », et l'écart se serait
   * payé au premier rapprochement entre les deux.
   *
   * Fenêtre de 7 jours : c'est le bouton « Semaine » du hub, et la fenêtre que le contrat
   * extrait décrit.
   */
  activite_du_jour: (depot) => matiereDaily(depot, FENETRES.semaine),
  rapport_depot: (depot) => matiereDepot(depot),
  parc_securite: (depots) => matiereParc(depots)
};

/** Le résumé d'une ligne, par signal. Sans entrée ici, l'écran n'afficherait rien. */
const RESUMES = {
  repartition_contributions: resumeCourt,
  inventaire_branches: resumeBranches,
  rapport_secrets: resumeSecrets,
  inventaire_dependances: resumeDependances,
  rapport_conformite: resumeConformite,
  chiffres_dora: resumeDora,
  activite_du_jour: resumeDaily,
  rapport_depot: resumeDepot,
  parc_securite: resumeParc
};

async function matiereContributions(depot) {
  const ref = await brancheDe(depot);
  const [commits, chemins] = await Promise.all([
    forge.listCommits(depot, undefined, { perPage: FENETRE, ref }),
    arbre(depot)
  ]);

  const toutes = zonesDepuisArbre(chemins);
  const interrogees = toutes.slice(0, MAX_ZONES_INTERROGEES);

  // Une zone qui échoue ne doit pas emporter les autres : le rapport sera partiel, et il
  // le dira, plutôt que de ne rien rendre du tout.
  const zones = await Promise.all(interrogees.map(async (z) => ({
    chemin: z.chemin,
    commits: await forge.listCommits(depot, z.chemin, { perPage: 100, ref }).catch(() => [])
  })));

  return repartitionContributions({ depot, commits, zones,
    ignorees: Math.max(0, toutes.length - interrogees.length) });
}

/**
 * L'état des branches — et la date qu'une des deux forges ne donne pas.
 *
 * GitLab rend `committed_date` avec chaque branche. GitHub ne rend que le SHA : sans
 * date, impossible de dire qu'une branche est morte, et l'inventer serait pire que de se
 * taire. On va donc la chercher, une branche à la fois, et seulement là où elle manque —
 * sur GitLab, aucun appel de plus.
 *
 * Les branches sans date restent dans le rapport, comptées à part : les faire disparaître
 * laisserait croire que le dépôt est plus propre qu'il ne l'est.
 */
/*
 * La datation elle-même, séparée de l'inventaire qui l'utilisait.
 *
 * Elle sert désormais à DEUX signaux — l'inventaire des branches et le rapport quotidien,
 * dont une pénalité du Health Score compte les branches dormantes. La recopier aurait été
 * la garantie que les deux divergent au premier ajustement du plafond, et qu'un rapport
 * date ses branches autrement que l'écran qui les liste.
 */
async function branchesDatees(depot) {
  const brutes = await forge.listBranches(depot);

  const aDater = brutes.filter((b) => !b.quand).slice(0, MAX_BRANCHES_DATEES);
  const dates = new Map(await Promise.all(aDater.map(async (b) => {
    const [dernier] = await forge.listCommits(depot, undefined, { perPage: 1, ref: b.name })
      .catch(() => []);
    return [b.name, dernier?.date || ''];
  })));

  return brutes.map((b) => ({ ...b, quand: b.quand || dates.get(b.name) || '' }));
}

async function matiereBranches(depot) {
  return inventaireBranches({ depot, branches: await branchesDatees(depot),
                              maintenant: new Date().toISOString() });
}

/**
 * Lire un lot de fichiers sans qu'un échec emporte les autres.
 *
 * Un `.env` illisible — droits, binaire, fichier trop gros — ne doit pas faire échouer le
 * scan entier : il manquerait alors le rapport ET la raison. Le fichier saute, le compte
 * des candidats ne bouge pas, et l'écart entre les deux est dit dans le texte produit.
 */
async function lireLot(depot, chemins, ref) {
  const lus = await Promise.all(chemins.map(async (chemin) => {
    const f = await forge.getFile(depot, chemin, ref).catch(() => null);
    // 200 ko : au-delà c'est un dump ou un binaire, et le scanner de la plateforme les
    // écarte pour la même raison — les lire coûte cher et ne trouve rien.
    if (!f?.content || f.content.length > 200000) return null;
    return { chemin, contenu: f.content };
  }));
  return lus.filter(Boolean);
}

/**
 * Les secrets exposés — l'arbre, puis les seuls fichiers à risque.
 *
 * On ne lit PAS tout le dépôt : ce serait des milliers d'appels pour un taux de faux
 * positifs qui rendrait le rapport inutilisable. Le filtre sur les noms de fichiers est
 * celui de la plateforme, et ce qu'il laisse de côté est compté.
 */
async function matiereSecrets(depot) {
  const ref = await brancheDe(depot);
  const chemins = await arbre(depot);
  const suspects = chemins.filter(fichierSuspect);
  const fichiers = await lireLot(depot, suspects.slice(0, MAX_FICHIERS_LUS), ref);
  return rapportSecrets({ depot, fichiers, candidats: suspects.length, total: chemins.length });
}

/** La chaîne d'approvisionnement — les manifestes, et rien d'autre. */
async function matiereDependances(depot) {
  const ref = await brancheDe(depot);
  const chemins = await arbre(depot);
  const cibles = chemins.map((c) => ({ chemin: c, eco: ecosysteme(c) })).filter((x) => x.eco);
  const lus = await lireLot(depot, cibles.slice(0, MAX_MANIFESTES_LUS).map((c) => c.chemin), ref);
  const ecoDe = new Map(cibles.map((c) => [c.chemin, c.eco]));
  return inventaireDependances({
    depot,
    fichiers: lus.map((f) => ({ ...f, eco: ecoDe.get(f.chemin) })),
    candidats: cibles.length
  });
}

/**
 * Le diff d'une merge request, assemblé — un appel, et le contexte avec.
 *
 * Le titre et les branches partent avec le diff : l'écart entre l'intention ANNONCÉE et ce
 * que le changement fait vraiment est le constat le plus utile d'une revue, et c'est le
 * seul qu'aucun outil ne sait voir. Un diff nu prive le relecteur de cette prise.
 */
async function matiereRevue(depot, pr) {
  const changements = await forge.pullRequestChanges(depot, pr.numero);
  const d = diffUnifie(changements);
  return revueMr({ depot, pr, diff: d.texte, fichiers: d.fichiers, binaires: d.ignores });
}

/**
 * La conformité d'un PARC — le même audit, sur les dépôts qu'on a cochés.
 *
 * Quatre appels par dépôt. Ils partent en parallèle mais un échec ne fait tomber que SON
 * dépôt : sur vingt-cinq dépôts il y en a toujours un d'archivé ou d'inaccessible, et
 * perdre tout l'audit pour celui-là serait absurde. Ceux qu'on n'a pas pu lire sont
 * remontés par leur nom et comptés à part — jamais tenus pour conformes.
 *
 * Le cache d'arbres et de branches par défaut est partagé avec le reste de l'écran : un
 * dépôt déjà audité seul ne sera pas relu.
 */
async function matiereParc(depots = []) {
  const choisis = [...depots].slice(0, MAX_DEPOTS);
  const echoues = [];

  const audits = await Promise.all(choisis.map(async (depot) => {
    try {
      return { depot, conformite: await matiereConformite(depot) };
    } catch (error) {
      echoues.push({ depot, pourquoi: error.message });
      return null;
    }
  }));

  return parcSecurite({
    depots: audits.filter(Boolean), echoues,
    ignores: Math.max(0, depots.length - choisis.length)
  });
}

/**
 * Les quatre métriques DORA — deux lectures, et l'aveu de ce qui a été coupé.
 *
 * Les pipelines et les merge requests fusionnées, sur la même fenêtre. Notre couche ne
 * pagine pas : une page pleine veut dire que le dépôt est plus actif qu'elle, et donc que
 * la fenêtre réelle est plus courte que trente jours. On le SIGNALE au calcul plutôt que
 * de laisser un score partiel se présenter comme un score du mois.
 *
 * Un échec sur l'un des deux ne fait pas tomber l'autre : sans la CI, le lead time reste
 * mesurable et les trois autres métriques passent en `N/A`, ce qui est la vérité.
 */
async function matiereDora(depot) {
  const ref = await brancheDe(depot);
  const depuis = new Date(Date.now() - FENETRE_JOURS * 86400000).toISOString();

  const [pipelines, mrs] = await Promise.all([
    forge.listRuns(depot, { perPage: MAX_PIPELINES, depuis }).catch(() => []),
    forge.listPullRequests(depot, { etat: 'fusionnees', perPage: MAX_MR, depuis }).catch(() => [])
  ]);

  return chiffresDora({
    depot, pipelines, mrs, brancheDefaut: ref,
    maintenant: new Date().toISOString(),
    tronque: pipelines.length >= MAX_PIPELINES || mrs.length >= MAX_MR
  });
}

/*
 * Combien de pipelines on liste, et combien d'échecs on propose.
 *
 * On demande une page de pipelines et on garde les échecs. Proposer les cinquante
 * derniers échecs ne servirait personne : on explique un échec RÉCENT, et une liste
 * déroulante de cinquante lignes ne se lit pas.
 */
const MAX_RUNS_LISTES = 60;
const MAX_ECHECS_LISTES = 12;

/*
 * Où vit la configuration de CI, selon la forge.
 *
 * On essaie dans l'ordre et on s'arrête au premier trouvé. Sans elle, un correctif ne
 * peut porter que sur le code — jamais sur le pipeline — et le signal le dit plutôt que
 * de laisser l'agent proposer de modifier un fichier qu'il n'a pas lu.
 */
const CONFIGS_CI = ['.gitlab-ci.yml', '.github/workflows/ci.yml', '.github/workflows/main.yml',
                    '.github/workflows/build.yml', '.github/workflows/test.yml',
                    'Jenkinsfile', 'azure-pipelines.yml'];

/**
 * L'état d'un dépôt et ses corrections à faire — cinq lectures, toutes déjà connues.
 *
 * Aucune n'est neuve : branches datées, arbre, commits, merge requests ouvertes,
 * pipelines. C'est la RECOMBINAISON qui produit les vingt-cinq contrôles, pas une lecture
 * de plus — et c'est ce qui rend ce signal peu cher malgré son rendement.
 *
 * Les merge requests ouvertes sont lues SANS filtre de date, et c'est important : un
 * contrôle qui cherche les MR abandonnées depuis plus de trente jours ne les trouverait
 * jamais dans une fenêtre de trente jours.
 */
async function matiereDepot(depot) {
  const ref = await brancheDe(depot);
  const [info, branches, chemins, commits, mrsOuvertes, pipelines] = await Promise.all([
    forge.projectInfo(depot).catch(() => ({})),
    branchesDatees(depot).catch(() => []),
    arbre(depot).catch(() => []),
    forge.listCommits(depot, undefined, { perPage: FENETRE, ref }).catch(() => []),
    forge.listPullRequests(depot, { etat: 'ouvertes', perPage: MAX_MR_DAILY }).catch(() => []),
    forge.listRuns(depot, { perPage: MAX_PIPELINES_DAILY }).catch(() => [])
  ]);

  return rapportDepot({
    depot, info: { defaut: info.defaultBranch || ref, visibilite: info.visibility || '' },
    branches, chemins, commits, mrsOuvertes, pipelines,
    maintenant: new Date().toISOString(),
    tronque: {
      commits: commits.length >= FENETRE,
      mrs: mrsOuvertes.length >= MAX_MR_DAILY,
      pipelines: pipelines.length >= MAX_PIPELINES_DAILY
    }
  });
}

/**
 * Le job qui a fait tomber un pipeline, et de quoi proposer un correctif.
 *
 * ── L'ORDRE DES LECTURES, ET POURQUOI IL COMPTE ──────────────────────────────
 *
 * On lit les jobs d'ABORD, on choisit celui qui a échoué, puis on lit SON log. Lire les
 * logs de tous les jobs coûterait des mégaoctets pour n'en garder qu'un — et sur un
 * pipeline à quinze jobs, la lecture prendrait plus longtemps que l'appel au modèle.
 *
 * Si plusieurs jobs ont échoué, on prend le PREMIER dans l'ordre du pipeline : les
 * suivants échouent en général parce que celui-là a échoué, et expliquer le dernier
 * enverrait chercher la cause au mauvais endroit.
 */
async function matiereJobEnEchec(depot, run) {
  const jobs = await forge.listJobs(depot, run.id).catch(() => []);
  const echoue = jobs.find((j) => j.statut === 'echec') || null;

  const [log, config] = await Promise.all([
    // `null` et non `''` : « pas lisible » et « vide » n'envoient pas chercher la même
    // chose, et le signal traite les deux cas séparément.
    echoue ? forge.jobLog(depot, echoue.id).catch(() => null) : Promise.resolve(null),
    trouverConfigCi(depot)
  ]);

  return jobEnEchec({ depot, run, jobs, job: echoue, log,
                      configCi: config?.contenu ?? null, cheminConfig: config?.chemin || '' });
}

/** Le premier fichier de CI trouvé à la racine, ou `null` si le dépôt n'en a pas. */
async function trouverConfigCi(depot) {
  const ref = await brancheDe(depot).catch(() => '');
  const chemins = await arbre(depot).catch(() => []);
  const trouve = CONFIGS_CI.find((c) => chemins.includes(c));
  if (!trouve) return null;
  const f = await forge.getFile(depot, trouve, ref).catch(() => null);
  return f ? { chemin: trouve, contenu: f.content } : null;
}

/**
 * Le rapport quotidien — cinq lectures, dont une qui a le droit d'échouer.
 *
 * ── POURQUOI LES DÉPLOIEMENTS SONT TRAITÉS À PART ────────────────────────────
 *
 * Les quatre autres lectures retombent sur une liste vide en cas d'échec, et c'est sans
 * conséquence : zéro pipeline lu et zéro pipeline existant donnent le même rapport, parce
 * qu'un dépôt sans pipeline est un cas réel qu'il faut savoir décrire.
 *
 * Les déploiements, non. La permission `deployments` du jeton est rarement cochée, et un
 * 403 rendrait « 0 déploiement » — c'est-à-dire l'affirmation qu'on n'a rien mis en
 * production. C'est le genre de phrase qui remonte en comité et qu'on ne peut pas
 * rattraper. On distingue donc `null`, « pas lisible », de `[]`, « lisible et vide », et
 * le signal écrit `N/A`.
 *
 * ── ET POURQUOI LES COMMITS SONT FILTRÉS ICI ─────────────────────────────────
 *
 * Cette couche n'expose pas de filtre de date sur `listCommits`. On demande donc une page
 * et on coupe sur la fenêtre — en notant si la page était pleine, puisque le compte
 * devient alors un minimum et non un total.
 */
async function matiereDaily(depot, fenetreJours = 7) {
  const ref = await brancheDe(depot);
  const debut = new Date();
  debut.setDate(debut.getDate() - fenetreJours + 1);
  debut.setHours(0, 0, 0, 0);
  const depuis = debut.toISOString();

  const [pipelines, mrsFusionnees, mrsOuvertes, commitsBruts, deploiements] = await Promise.all([
    forge.listRuns(depot, { perPage: MAX_PIPELINES_DAILY, depuis }).catch(() => []),
    forge.listPullRequests(depot, { etat: 'fusionnees', perPage: MAX_MR_DAILY, depuis }).catch(() => []),
    forge.listPullRequests(depot, { etat: 'ouvertes', perPage: MAX_MR_DAILY }).catch(() => []),
    forge.listCommits(depot, undefined, { perPage: MAX_COMMITS_DAILY, ref }).catch(() => []),
    forge.listDeployments(depot, { perPage: MAX_DEPLOIEMENTS_DAILY, depuis }).catch(() => null)
  ]);

  const commits = commitsBruts.filter((c) => c.date && c.date >= depuis);
  const branches = await branchesDatees(depot);

  return chiffresDaily({
    depot, fenetreJours, pipelines, mrsFusionnees, mrsOuvertes, commits, deploiements, branches,
    maintenant: new Date().toISOString(),
    tronque: {
      pipelines: pipelines.length >= MAX_PIPELINES_DAILY,
      mrs: mrsFusionnees.length >= MAX_MR_DAILY || mrsOuvertes.length >= MAX_MR_DAILY,
      commits: commitsBruts.length >= MAX_COMMITS_DAILY,
      deploiements: Array.isArray(deploiements) && deploiements.length >= MAX_DEPLOIEMENTS_DAILY
    }
  });
}

/**
 * La conformité CIS — trois lectures, et l'aveu de ce qu'on ne peut pas voir.
 *
 * `pom.xml` n'est lu que s'il existe : une lecture de plus sur un dépôt Java, aucune
 * ailleurs. Le reste des contrôles se déduit de l'arbre et des branches, déjà en cache.
 */
async function matiereConformite(depot) {
  const ref = await brancheDe(depot);
  const [info, branches, chemins] = await Promise.all([
    forge.projectInfo(depot).catch(() => ({})),
    forge.listBranches(depot).catch(() => []),
    arbre(depot)
  ]);

  const cheminPom = chemins.find((c) => c === 'pom.xml' || c.endsWith('/pom.xml'));
  const [pom, dernier] = await Promise.all([
    cheminPom ? forge.getFile(depot, cheminPom, ref).then((f) => f?.content ?? null).catch(() => null)
              : Promise.resolve(null),
    forge.listCommits(depot, undefined, { perPage: 1, ref }).catch(() => [])
  ]);

  return rapportConformite({
    depot, defaut: ref, visibilite: info.visibility || '', branches, chemins, pom,
    derniereActivite: dernier[0]?.date || '',
    maintenant: new Date().toISOString()
  });
}

/*
 * Combien de branches on date à la main quand la forge ne le fait pas.
 *
 * Un appel chacune : sans plafond, un dépôt à deux cents branches en déclencherait deux
 * cents. Celles qu'on n'a pas datées figurent quand même au rapport, dans « sans date ».
 */
const MAX_BRANCHES_DATEES = 40;

/** La branche par défaut du dépôt, mise en cache comme son arbre. */
async function brancheDe(depot) {
  if (!CACHE.branches.has(depot)) {
    const info = await forge.projectInfo(depot);
    CACHE.branches.set(depot, info.defaultBranch || 'main');
  }
  return CACHE.branches.get(depot);
}

/**
 * Un champ de matière CALCULÉE — c'est-à-dire pas un champ du tout.
 *
 * ── CE QU'IL REMPLACE ────────────────────────────────────────────────────────
 *
 * Pour lancer le bus factor, l'écran demandait de remplir `{{repartition_contributions}}`.
 * Le retour a été sans détour : « si je dois mettre des variables que je ne connais pas
 * partout, personne ne l'utilisera. » C'est juste — ce nom est un détail
 * d'implémentation du prompt, et il n'aurait jamais dû être montré.
 *
 * Ce qu'on montre à la place : le RÉSULTAT. « bus factor 1 — RISQUE CRITIQUE ·
 * 3 contributeurs · 9 zones ». On voit ce qui part avant de partir, sans avoir rien à
 * saisir, et le détail complet reste à un clic pour qui veut vérifier.
 *
 * La zone de texte existe encore et porte toujours la valeur — le reste de l'écran, le
 * pré-vol et l'exécution la lisent sans savoir d'où elle vient. Elle est simplement
 * repliée : personne n'a besoin de la voir pour s'en servir, et tout le monde doit
 * pouvoir la lire pour la contester.
 */
/*
 * Les deux listes déroulantes, décrites plutôt que codées deux fois.
 *
 * Chaque entrée dit : comment lister, comment étiqueter une ligne, ce que le choix
 * déclenche, et comment nommer chaque panne. Tout le reste — l'anti-concurrence, le
 * verrou du bouton, l'affichage de la matière — est commun et n'existe qu'une fois.
 */
const LISTES = {
  mr: {
    attente: 'Lecture des merge requests de',
    aucun: 'Aucune merge request ouverte sur ce dépôt — il n\'y a rien à relire.',
    invite: (n) => `— choisir parmi ${n} merge request(s) ouverte(s) —`,
    etiquette: (p) => `#${p.numero}  ${p.titre}  (${p.branche} → ${p.cible})`,
    cle: (p) => String(p.numero),
    choisir: 'Choisis la merge request à relire.',
    illisible: 'Merge requests illisibles',
    enCours: (p) => `Assemblage du diff de #${p.numero}…`,
    echec: 'Diff illisible',
    lister: (depot) => forge.listPullRequests(depot),
    calculer: (depot, p) => matiereRevue(depot, p),
    resume: resumeRevue
  },
  run: {
    attente: 'Lecture des pipelines de',
    /*
     * Ce message est une bonne nouvelle, et il doit se lire comme telle. « Aucun pipeline
     * en échec » sur un écran qui vient d'échouer à trouver quelque chose ressemble à une
     * panne — d'où la formulation explicite.
     */
    aucun: 'Aucun pipeline en échec récemment sur ce dépôt : il n\'y a rien à expliquer.',
    invite: (n) => `— choisir parmi ${n} pipeline(s) en échec —`,
    etiquette: (r) => `${r.branche || '(sans branche)'} · ${dateCourte(r.debut || r.quand)}`
                    + `${r.sha ? ` · ${r.sha.slice(0, 7)}` : ''}`,
    cle: (r) => String(r.id),
    choisir: 'Choisis le pipeline en échec à expliquer.',
    illisible: 'Pipelines illisibles',
    enCours: (r) => `Lecture des jobs et du log de ${r.branche || 'ce pipeline'}…`,
    echec: 'Log illisible',
    lister: (depot) => forge.listRuns(depot, { perPage: MAX_RUNS_LISTES })
      .then((runs) => runs.filter((r) => r.statut === 'echec').slice(0, MAX_ECHECS_LISTES)),
    calculer: (depot, run) => matiereJobEnEchec(depot, run),
    resume: resumeCi
  }
};

/** Une date lisible dans une liste déroulante — le jour et l'heure, rien de plus. */
function dateCourte(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'date inconnue';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit',
                                     minute: '2-digit' });
}

function champCalcule(variable, { surEtat = () => {} } = {}) {
  const zone = el('textarea', { rows: 8 });
  const etat = el('div', { className: 'calc-etat' });
  const refaire = el('button', { type: 'button', textContent: '↻ recalculer', hidden: true });

  const detail = el('details', { className: 'calc-detail' });
  detail.append(el('summary', { textContent: 'voir la matière envoyée' }), zone);

  /*
   * LA LISTE DES MERGE REQUESTS OUVERTES, quand le signal porte sur une MR.
   *
   * Elle existait déjà, mais derrière un menu « source » à trois entrées — un fichier, une
   * PR, un collage. On ne relit pas « une source » : on relit LA merge request de
   * quelqu'un. Trois clics dont le premier demande de choisir un mot qui n'est le
   * vocabulaire de personne, ça suffit à ce que l'outil ne serve pas.
   *
   * Ici, on choisit le dépôt en haut, on déroule, on choisit. Le diff s'assemble seul.
   */
  /*
   * Le second choix, quand il y en a un — et il est désormais PARAMÉTRÉ.
   *
   * `revue_mr` déroulait les merge requests ouvertes ; `job_en_echec` déroule les
   * pipelines en échec. Même geste, même raison : la matière coûte cher (un diff assemblé
   * fichier par fichier, un log de plusieurs mégaoctets), donc on ne la calcule pas pour
   * le premier élément venu. On remplit la liste, et c'est le CHOIX qui déclenche la
   * lecture.
   *
   * Deux branches jumelles auraient fini par diverger — l'une garderait un garde-fou que
   * l'autre perdrait, sur un écran où personne ne compare les deux chemins.
   */
  const liste2 = listeDeChoix(variable.name);
  const parMr = liste2 === 'mr';
  const choixMr = el('select', { hidden: !liste2 });
  let mrs = [];

  const noeud = el('div', { className: 'mat calc' },
    el('div', { className: 'mat-tete' },
      el('label', { textContent: SIGNAL_LISIBLE[variable.name] || `{{${variable.name}}}` }),
      refaire),
    choixMr, etat, detail);

  const dire = (texte, classe = '') => {
    etat.textContent = texte;
    etat.className = `calc-etat${classe ? ` ${classe}` : ''}`;
  };

  detail.hidden = true;
  dire('Choisis un dépôt ci-dessus.');

  let enCours = 0;
  let dernier = null;
  async function calculer(depot) {
    const mien = ++enCours;
    /*
     * On vide AVANT de recalculer, et c'est volontaire : garder les chiffres du dépôt
     * précédent le temps du calcul enverrait à l'agent la répartition d'un AUTRE dépôt,
     * sous le nom du nouveau. Le vide se voit, la confusion non.
     *
     * En contrepartie, il faut interdire de lancer pendant ce vide — sinon on part avec
     * un trou, et le pré-vol refuse pour P003 alors que rien n'est cassé. C'est ce que
     * `surEtat` sert à dire au bouton.
     */
    /*
     * `depot` est une chaîne, ou une LISTE quand le signal porte sur plusieurs dépôts.
     * Un tableau vide est truthy en JavaScript : sans ce test, cocher puis tout décocher
     * lancerait un audit sur zéro dépôt et rendrait « parc conforme ».
     */
    const liste = Array.isArray(depot);
    const vide = liste ? depot.length === 0 : !depot;

    zone.value = '';
    detail.hidden = true;
    refaire.hidden = vide;

    if (vide) {
      if (liste2) { choixMr.hidden = true; mrs = []; }
      dire(liste ? 'Coche les dépôts à auditer ci-dessus.' : 'Choisis un dépôt ci-dessus.');
      surEtat(false);
      return;
    }
    /*
     * Quand il y a un second choix, choisir le dépôt ne calcule rien : il REMPLIT la
     * liste. C'est la sélection qui déclenche la lecture coûteuse.
     */
    if (liste2) {
      const L = LISTES[liste2];
      dire(`${L.attente} ${depot}…`, 'attente');
      surEtat(true);
      try {
        mrs = await L.lister(depot);
        if (mien !== enCours) return;
        choixMr.textContent = '';
        choixMr.hidden = false;
        if (!mrs.length) {
          choixMr.hidden = true;
          dire(L.aucun);
          return;
        }
        choixMr.append(el('option', { value: '', textContent: L.invite(mrs.length) }));
        for (const p of mrs) {
          choixMr.append(el('option', { value: L.cle(p), textContent: L.etiquette(p) }));
        }
        dire(L.choisir);
      } catch (error) {
        if (mien !== enCours) return;
        dire(`${L.illisible} : ${error.message}`, 'ko');
      } finally {
        surEtat(false);
      }
      return;
    }

    dire(liste ? `Lecture de ${depot.length} dépôt(s)…` : `Lecture de ${depot}…`, 'attente');
    surEtat(true);

    try {
      const r = await matiereCalculee(variable.name, depot);
      // Un dépôt a pu être choisi entre-temps : une réponse en retard ne doit pas écraser
      // la bonne. Sans ce garde, changer deux fois de dépôt rapidement affiche le premier.
      if (mien !== enCours) return;
      dernier = r;
      zone.value = r.texte;
      detail.hidden = false;
      dire(`✔ ${(RESUMES[variable.name] || (() => 'matière calculée'))(r)}`, 'ok');
    } catch (error) {
      if (mien !== enCours) return;
      // On ne se rabat PAS sur un champ vide en silence : un agent lancé sans matière
      // répondrait quand même, et c'est exactement ce qu'on cherche à empêcher.
      dire(`Impossible de calculer : ${error.message}`, 'ko');
      detail.hidden = false;
    } finally {
      /*
       * Dans le `finally`, sans condition. Un calcul doublé par un plus récent sort par
       * `return` — s'il ne rendait pas son jeton, le compteur ne retomberait jamais à zéro
       * et le bouton resterait bloqué pour toujours. Chaque appel prend un jeton et le
       * rend, quelle que soit la sortie.
       */
      surEtat(false);
    }
  }

  // Le dernier choix est gardé en mémoire plutôt que dans un attribut : un `dataset` ne
  // stocke que des chaînes, et « recalculer » sur une liste de dépôts en rendrait une
  // chaîne à virgules dont personne ne saurait quoi faire.
  let dernierChoix = '';
  refaire.onclick = () => calculer(dernierChoix);

  /** Choisir dans la liste : c'est ICI que la lecture coûteuse se fait, et pas avant. */
  choixMr.onchange = async () => {
    if (!liste2) return;
    const L = LISTES[liste2];
    const choisi = mrs.find((p) => L.cle(p) === choixMr.value);
    zone.value = '';
    detail.hidden = true;
    if (!choisi) { dire(L.choisir); return; }

    const mien = ++enCours;
    dire(L.enCours(choisi), 'attente');
    surEtat(true);
    try {
      const r = await L.calculer(dernierChoix, choisi);
      if (mien !== enCours) return;
      dernier = r;
      zone.value = r.texte;
      detail.hidden = false;
      dire(`✔ ${L.resume(r)}`, 'ok');
    } catch (error) {
      if (mien !== enCours) return;
      dire(`${L.echec} : ${error.message}`, 'ko');
    } finally {
      surEtat(false);
    }
  };

  return {
    noeud,
    controle: zone,
    /*
     * Le dernier résultat, sous sa forme STRUCTURÉE et pas seulement en texte.
     *
     * Le rapport exporté en a besoin pour dresser ses propres tableaux — score,
     * contributeurs, zones — au lieu de reprendre ce que le modèle en a écrit. Ce sont
     * deux choses différentes : l'un est mesuré, l'autre est rédigé.
     */
    dernier: () => dernier,
    calculer: (depot) => { dernierChoix = depot || ''; return calculer(depot); }
  };
}

/**
 * Le nom qu'on MONTRE, pour n'importe quelle entrée.
 *
 * Le vocabulaire des entrées est une convention interne : il relie une variable au
 * calculateur ou au sélecteur qui sait la remplir. Il n'a jamais eu à être lu par
 * quelqu'un qui lance un agent — et un nom qu'on ne comprend pas est un champ qu'on ne
 * remplit pas.
 *
 * Une entrée inconnue retombe sur son propre nom, souligné remplacé par des espaces : mieux
 * vaut « inventaire flags » que `{{inventaire_flags}}`, et surtout mieux que rien.
 */
const lisible = (nom) => SIGNAL_LISIBLE[nom]
  || MATIERE_LISIBLE[nom]
  || String(nom).replace(/_/g, ' ');

/** Ce que désignent les entrées qu'on va chercher, plutôt que de les calculer. */
const MATIERE_LISIBLE = {
  code: 'Le code à lire — un fichier du dépôt, ou collé',
  diff: 'Le changement à relire — une pull request, ou collé',
  config_ci: 'La configuration de CI — un fichier du dépôt, ou collée',
  historique_commits: 'L\'historique des commits',
  inventaire_fichiers: 'L\'inventaire des fichiers',
  pipeline_log: 'Le journal du pipeline — à coller',
  besoin_metier: 'Le besoin métier, dans tes mots',
  notes_incident: 'Les notes d\'incident, dans tes mots',
  story: 'La user story, dans tes mots',
  requete: 'La requête SQL — un fichier du dépôt, ou collée'
};

/** Le nom qu'on montre. Personne ne doit lire `repartition_contributions` à l'écran. */
const SIGNAL_LISIBLE = {
  repartition_contributions: 'Qui contribue, et où — calculé depuis le dépôt',
  inventaire_branches: 'L\'état des branches — lu depuis le dépôt',
  rapport_secrets: 'Les secrets exposés — scannés dans le dépôt',
  inventaire_dependances: 'Les dépendances déclarées — lues dans les manifestes',
  rapport_conformite: 'La conformité CIS — contrôlée sur le dépôt',
  chiffres_dora: 'Les quatre métriques DORA — mesurées sur 30 jours',
  activite_du_jour: 'L\'activité de la semaine et le Health Score — calculés sur 7 jours',
  job_en_echec: 'Le pipeline en échec à expliquer — choisi dans la liste',
  rapport_depot: 'L\'état du dépôt et ses corrections à faire — 25 contrôles',
  parc_securite: 'La conformité du parc — auditée sur les dépôts cochés',
  revue_mr: 'La merge request à relire — choisie dans la liste'
};

/**
 * Un champ de matière : une zone de saisie, un bouton pour aller chercher, et le
 * sélecteur qui s'ouvre dessous.
 *
 * @returns {{noeud, controle}} — `controle` est la zone de texte, c'est elle qui fait foi
 */
function champMatiere(variable) {
  const zone = el('textarea', {
    rows: 4,
    placeholder: variable.source === 'signal'
      ? 'colle ici, ou va le chercher au dépôt →'
      : 'saisie libre, ou va la chercher au dépôt →'
  });

  const bouton = el('button', { type: 'button', textContent: '📥 Récupérer' });
  const info = el('div', { className: 'mat-info', hidden: true });
  const panneau = el('div', { className: 'picker', hidden: true });

  const noeud = el('div', { className: 'mat' },
    el('div', { className: 'mat-tete' },
      // Le nom LISIBLE, comme sur les champs calculés. « Si je dois mettre des variables
      // que je ne connais pas partout, personne ne l'utilisera » valait pour
      // `{{repartition_contributions}}` ; ça vaut tout autant pour `{{code}}`.
      el('label', { textContent: lisible(variable.name)
                               + (variable.required === false ? ' · facultative' : '') }),
      bouton),
    zone, info, panneau);

  /* ── Ce que l'écran dit de ce qu'on s'apprête à envoyer ── */
  const majInfo = (origine = '') => {
    const r = resume(zone.value, origine);
    if (!zone.value) { info.hidden = true; return; }
    info.hidden = false;
    info.textContent = '';
    info.className = `mat-info${grosse(zone.value) ? ' gros' : ''}`;
    // Chaque enfant est un élément flex : un « · » posé seul deviendrait une colonne à
    // lui, avec un écart de chaque côté. Les séparateurs vivent DANS le texte.
    if (r.origine) info.append(el('b', { textContent: r.origine }));
    info.append(`${r.lignes} ligne(s) · ≈ ${r.jetons} jetons`);
    if (grosse(zone.value)) {
      // Ni refus ni blocage : donner un gros fichier à un agent est légitime. Mais
      // l'envoyer sans le savoir coûte, et surtout DILUE — un agent noyé dans 2 000
      // lignes répond moins bien que sur les 80 qui comptent.
      info.append(el('span', { textContent: 'c\'est beaucoup : l\'agent risque de se diluer' }));
    }
    const vider = el('button', { type: 'button', textContent: 'vider' });
    vider.onclick = () => { zone.value = ''; majInfo(); };
    info.append(vider);
  };
  // Modifiable après récupération : dès qu'on y touche, l'origine ne vaut plus.
  zone.oninput = () => majInfo();

  /* ── Le sélecteur ── */
  const source = el('select');
  for (const s of SOURCES) source.append(el('option', { value: s.id, textContent: `${s.icone} ${s.libelle}` }));
  source.value = sourceProbable(variable);

  const depot = el('select');
  const recherche = el('input', { placeholder: 'chercher un chemin…' });
  const liste = el('div', { className: 'liste' });
  const aide = el('div', { className: 'vide' });

  panneau.append(el('div', { className: 'rangee' }, source, depot), recherche, aide, liste);

  const dire = (texte) => { aide.textContent = texte; };
  const vider = () => { liste.textContent = ''; };

  async function remplirDepots() {
    if (depot.options.length) return;
    const tous = await depots();
    for (const d of tous) depot.append(el('option', { value: d.path, textContent: d.path }));
    const prefere = localStorage.getItem('salsi_ia_project_path') || '';
    if (tous.some((d) => d.path === prefere)) depot.value = prefere;
  }

  /** Poser la matière dans la zone, et refermer. C'est le seul endroit qui écrit dedans. */
  const poser = (texte, origine) => {
    zone.value = texte;
    majInfo(origine);
    panneau.hidden = true;
    zone.focus();
  };

  async function chargerFichiers() {
    recherche.hidden = false;
    vider();
    dire('Chargement de l\'arbre du dépôt…');
    let chemins;
    try { chemins = await arbre(depot.value); }
    catch (error) { dire(`Lecture impossible : ${error.message}`); return; }

    const rendre = () => {
      vider();
      const q = recherche.value.trim();
      if (!q) { dire(`${chemins.length} fichier(s). Tape un fragment de chemin — « foo serv » trouve FooService.`); return; }
      const r = chercherFichier(chemins, q);
      dire(r.total === 0 ? 'Aucun chemin ne correspond.'
        : `${r.total} résultat(s)${r.tronque ? ` — les ${r.chemins.length} premiers` : ''}.`);
      for (const c of r.chemins) {
        const b = el('button', { type: 'button', className: 'ligne', textContent: c });
        b.onclick = async () => {
          dire(`Lecture de ${c}…`);
          try {
            const f = await forge.getFile(depot.value, c, CACHE.branches.get(depot.value));
            if (!f) { dire('Fichier introuvable sur cette branche.'); return; }
            poser(f.content, `${depot.value} · ${c}`);
          } catch (error) { dire(`Lecture impossible : ${error.message}`); }
        };
        liste.append(b);
      }
    };
    recherche.oninput = rendre;
    rendre();
  }

  async function chargerPulls() {
    recherche.hidden = true;
    vider();
    dire('Chargement des pull requests ouvertes…');
    let pulls;
    try { pulls = await forge.listPullRequests(depot.value); }
    catch (error) { dire(`Lecture impossible : ${error.message}`); return; }

    if (pulls.length === 0) { dire('Aucune pull request ouverte sur ce dépôt.'); return; }
    dire(`${pulls.length} en cours de relecture.`);

    for (const p of pulls) {
      const b = el('button', { type: 'button', className: 'ligne' },
        `#${p.numero}  ${p.titre}`,
        el('small', { textContent: `${p.branche} → ${p.cible}${p.auteur ? ` · par ${p.auteur}` : ''}` }));
      b.onclick = async () => {
        dire(`Assemblage du diff de #${p.numero}…`);
        try {
          const changements = await forge.pullRequestChanges(depot.value, p.numero);
          const d = diffUnifie(changements);
          if (!d.texte) { dire('Cette pull request ne change aucun fichier texte.'); return; }
          poser(d.texte, `${depot.value} · PR #${p.numero} · ${d.fichiers} fichier(s)`
                       + (d.ignores.length ? ` · ${d.ignores.length} binaire(s) non lisible(s)` : ''));
        } catch (error) { dire(`Lecture impossible : ${error.message}`); }
      };
      liste.append(b);
    }
  }

  async function ouvrirPanneau() {
    panneau.hidden = false;
    try { await remplirDepots(); }
    catch (error) { dire(`Dépôts illisibles : ${error.message}`); return; }
    charger();
  }

  function charger() {
    if (source.value === 'colle') {
      recherche.hidden = true;
      vider();
      dire('Rien ne sera récupéré : le champ est à toi. C\'est le bon choix pour un '
         + 'journal de pipeline, qui vit dans la CI et pas au dépôt.');
      return;
    }
    (source.value === 'pull' ? chargerPulls : chargerFichiers)();
  }

  bouton.onclick = () => { if (panneau.hidden) ouvrirPanneau(); else panneau.hidden = true; };
  source.onchange = charger;
  depot.onchange = charger;

  return { noeud, controle: zone };
}


function ouvrirExecution(entry) {
  const { artifact } = entry;
  const inner = $('sheetInner');
  inner.textContent = '';

  const retour = el('button', { textContent: '← Fiche' });
  retour.onclick = () => openSheet(entry);
  const close = el('button', { className: 'close', textContent: '✕', title: 'fermer' });
  close.onclick = () => $('sheet').classList.remove('on');

  inner.append(el('header', {}, el('h2', {}, '▶ Exécuter — ', artifact.title || artifact.id),
                  retour, close));

  const body = el('div', { className: 'body' });
  const form = el('div', { className: 'pv' });
  body.append(form);
  inner.append(body);

  const moteurBloc = el('div', { className: 'conf', hidden: true });
  form.append(moteurBloc);

  /*
   * Deux façons de fournir la matière, et la première est la bonne dans 9 cas sur 10 :
   * rejouer un cas d'or joue sur une entrée RÉELLE de la banque, déjà choisie, déjà
   * relue. Taper des valeurs à la main sert à essayer sur son propre cas.
   */
  const cas = artifact.golden_cases || [];
  const choixCas = el('select');
  choixCas.append(el('option', { value: '', textContent: '— valeurs libres —' }));
  for (const g of cas) choixCas.append(el('option', { value: g.id, textContent: `rejouer ${g.id}` }));

  const champ = (libelle, controle) => el('div', {}, el('label', { textContent: libelle }), controle);

  const criticite = el('select');
  for (const [v, lib] of [['test', 'test / bac à sable'], ['production', 'production']]) {
    criticite.append(el('option', { value: v, textContent: lib }));
  }

  /*
   * La sensibilité se saisit ici pour la même raison qu'au pré-vol : aucun référentiel
   * des dépôts n'est branché. Sans elle, P002 dirait « je ne sais pas » à CHAQUE
   * exécution et réclamerait une confirmation à chaque fois — une case qu'on finit par
   * cocher sans lire, ce qui vide le mécanisme de son sens.
   */
  const sensibilite = el('select');
  for (const sv of SENSIBILITES) {
    sensibilite.append(el('option', { value: sv, textContent: sv, selected: sv === 'interne' }));
  }

  /*
   * LE DÉPÔT, quand une matière se calcule.
   *
   * L'écran n'en demandait aucun : les variables se saisissaient à la main, donc la
   * question ne se posait pas. Dès qu'une matière se calcule, c'est le SEUL choix qui
   * revienne à l'utilisateur — et celui qu'il sait faire. Tout le reste en découle.
   *
   * Il n'apparaît que si quelque chose en dépend : un sélecteur qui ne sert à rien
   * apprend à ignorer les sélecteurs.
   */
  const calcules = [];
  /*
   * Combien de matières sont en train d'être calculées.
   *
   * Le défaut qu'il corrige : sur un dépôt à douze zones, le calcul demande une dizaine
   * d'appels et prend quelques secondes. Cliquer « Exécuter » pendant ce temps envoyait
   * un champ VIDE — et le pré-vol refusait pour `P003`, « variable requise non résolue ».
   * Ça ressemblait à un défaut du produit alors que c'était une course : le premier essai
   * passait, le suivant non, sans que rien d'autre ait changé.
   */
  let calculsEnCours = 0;
  const aCalculer = (artifact.variables || []).some((v) => saitCalculer(v.name));

  /*
   * UN dépôt, ou PLUSIEURS — c'est le signal qui décide, pas l'écran.
   *
   * La revue de parc audite N dépôts choisis ; tous les autres agents portent sur un seul.
   * Offrir des cases à cocher à un agent qui n'en lira qu'un ferait croire qu'il compare,
   * et offrir un menu déroulant à la revue de parc la rendrait inutile. Le descripteur du
   * signal porte l'information, donc les deux ne peuvent pas diverger.
   */
  const surParc = (artifact.variables || []).some((v) => surPlusieursDepots(v.name));
  const depotCalc = !aCalculer ? null
    : surParc
      ? champDepots({ forge, max: MAX_DEPOTS,
                      surChoix: (liste) => { for (const c of calcules) c.calculer(liste); } })
      : champDepot({ forge, surChoix: (choisi) => {
          localStorage.setItem('salsi_ia_project_path', choisi || '');
          for (const c of calcules) c.calculer(choisi);
        } });

  const tete = el('div', { className: 'champs' },
    champ('Entrée', choixCas), champ('Sensibilité du dépôt', sensibilite), champ('Criticité', criticite));
  if (depotCalc) tete.prepend(champ(surParc ? 'Les dépôts à auditer' : 'Dépôt', depotCalc.noeud));

  /*
   * Sur quoi le rapport a porté, en une chaîne — pour l'en-tête et le nom du fichier.
   *
   * Un audit de parc n'a pas UN dépôt : écrire le premier de la liste ferait passer un
   * rapport sur douze dépôts pour un rapport sur un seul, et le fichier exporté porterait
   * un nom qui ment.
   */
  const cible = () => {
    if (!depotCalc) return '';
    if (!surParc) return depotCalc.valeur();
    const n = depotCalc.valeurs().length;
    return n ? `${n} dépôt(s)` : '';
  };
  form.append(tete);

  /*
   * Une saisie par variable déclarée, et deux formes selon ce que la variable EST.
   *
   * `source: repo` désigne un identifiant — un nom de dépôt, une stack, une version.
   * Une ligne, pas de matière à aller chercher : un champ simple.
   *
   * `signal` et `user` désignent de la MATIÈRE — un diff, un fichier, une requête. Zone
   * de texte, et le bouton qui va la chercher dans la forge. Mettre un sélecteur de
   * fichiers sur « stack » n'aiderait personne et ferait douter du reste.
   */
  const saisies = {};
  const grille = el('div', { className: 'champs' });
  for (const v of artifact.variables || []) {
    /*
     * Une variable qui désigne un DÉPÔT reçoit la liste, jamais un champ vide.
     *
     * Demander d'écrire `groupe/sous-groupe/projet` quand la connexion connaît déjà la
     * liste, c'est demander de retenir par cœur ce que la machine a sous la main. Et une
     * faute de frappe ne rend pas une erreur : elle rend un agent qui tourne sur le
     * mauvais dépôt, ou qui échoue plus tard sans dire pourquoi.
     */
    if (estUnDepot(v)) {
      const picker = champDepot({ forge });
      grille.append(champ(lisible(v.name), picker.noeud));
      picker.remplir();

      // Le formulaire lit `.value` et pilote `.disabled` sur ce qu'il trouve ici. Avec
      // « un autre dépôt », c'est la saisie libre qui porte la valeur : on expose donc le
      // lecteur du champ plutôt qu'un élément précis.
      saisies[v.name] = {
        get value() { return picker.valeur(); },
        set value(_) { /* la liste décide */ },
        set disabled(x) {
          for (const n of picker.noeud.querySelectorAll('select, input')) n.disabled = x;
        },
        set placeholder(_) { /* la liste porte son propre libellé */ }
      };
      continue;
    }

    /*
     * Ce qu'on sait calculer ne se demande plus, et cette question se pose AVANT toutes
     * les autres.
     *
     * Elle venait après le test `source: repo`, et `inventaire_dependances` est déclaré
     * `repo` au vocabulaire — l'agent des dépendances retombait donc sur un champ texte
     * d'une ligne, alors que la plateforme sait lire ses manifestes. La source déclarée
     * dit d'où la matière VIENT ; elle ne dit pas qui va la chercher. Savoir la calculer
     * l'emporte, quelle que soit l'étiquette.
     *
     * Le reste continue de se demander — et c'est volontaire : prétendre calculer ce
     * qu'on ignore rendrait un champ vide sans dire pourquoi.
     */
    if (saitCalculer(v.name)) {
      const bloc = champCalcule(v, { surEtat: (occupe) => {
        calculsEnCours += occupe ? 1 : -1;
        if (calculsEnCours < 0) calculsEnCours = 0;
        majDepart();
      } });
      saisies[v.name] = bloc.controle;
      calcules.push(bloc);
      grille.append(bloc.noeud);
      continue;
    }

    /*
     * Une ligne de saisie SEULEMENT pour ce qui tient sur une ligne.
     *
     * Ce test portait sur `v.source === 'repo'` : deux agents qui font la même chose se
     * comportaient donc différemment, selon un mot que leur auteur n'a pas choisi
     * consciemment. `expliquer-un-code` déclare `code: signal` et recevait la zone avec le
     * sélecteur de fichiers ; `analyseur-de-code`, sorti de Fabriquer, déclare `code: repo`
     * et ne recevait qu'une ligne — où l'on ne peut ni choisir un fichier, ni même en
     * coller un.
     *
     * La zone de matière est un surensemble de la ligne : elle offre les sélecteurs ET le
     * collage. Le défaut penche donc de son côté, et seul ce qui est nommément court garde
     * la ligne.
     */
    if (estUnIdentifiant(v)) {
      const input = el('input', { placeholder: 'issu du dépôt' });
      saisies[v.name] = input;
      grille.append(champ(lisible(v.name) + (v.required === false ? ' · facultative' : ''), input));
      continue;
    }

    const bloc = champMatiere(v);
    saisies[v.name] = bloc.controle;
    grille.append(bloc.noeud);
  }
  if (artifact.variables?.length) {
    form.append(el('h4', { textContent: `Valeurs (${artifact.variables.length})` }), grille);
  }

  /*
   * La liste des dépôts se remplit après coup : elle demande un appel à la forge, et
   * l'écran doit s'afficher avant, pas après.
   *
   * On ne relance PAS le calcul derrière : `remplir()` prévient déjà `surChoix` une fois
   * la sélection faite. Le faire aussi ici lançait deux calculs concurrents, dont un
   * aussitôt périmé — et le bouton restait bloqué sur « lecture du dépôt ».
   */
  if (depotCalc) depotCalc.remplir();

  choixCas.onchange = () => {
    const rejoue = Boolean(choixCas.value);
    for (const input of Object.values(saisies)) {
      input.disabled = rejoue;
      input.placeholder = rejoue ? 'fourni par le cas d\'or' : 'saisie';
    }
  };

  /*
   * La confirmation. On ne l'affiche pas d'emblée : on ne sait pas encore ce que le
   * pré-vol dira, et cocher une case avant de savoir ce qu'on assume ne veut rien dire.
   * Elle apparaît quand le serveur a répondu 409 en nommant les points.
   */
  const conf = el('div', { className: 'conf', hidden: true });
  const assume = el('input', { type: 'checkbox' });
  form.append(conf);

  const actions = el('div', { className: 'acts' });
  const partir = el('button', { className: 'primary', textContent: '▶ Exécuter' });
  actions.append(partir);

  /*
   * On ne part que si le moteur répond ET si la matière est prête. Le bouton dit LAQUELLE
   * des deux manque : « moteur indisponible » et « matière en cours de calcul » ne
   * s'attendent pas de la même façon.
   */
  let moteurPret = false;
  function majDepart() {
    const occupe = calculsEnCours > 0;
    partir.disabled = !moteurPret || occupe;
    partir.textContent = occupe ? '… lecture du dépôt' : '▶ Exécuter';
    partir.title = occupe
      ? 'La matière est en train d\'être calculée depuis le dépôt. Partir maintenant '
        + 'enverrait un champ vide.'
      : '';
  }
  form.append(actions);

  const zone = el('div');
  form.append(zone);

  etatMoteur().then((m) => {
    moteurBloc.hidden = m.pret;
    moteurPret = m.pret;
    majDepart();
    if (m.pret) {
      actions.append(el('span', { className: 'note',
        textContent: `${m.fournisseur} · ${m.ou} · palier ${artifact.model_tier || 'mid'}` }));
      return;
    }
    moteurBloc.textContent = '';
    moteurBloc.append(el('b', { textContent: '⚙ Exécution indisponible' }),
      el('small', { textContent: m.raison }),
      el('small', { textContent: 'Depuis un poste : pose VERTEX_PROJECT et '
        + 'GOOGLE_SERVICE_ACCOUNT_JSON dans le shell, puis relance `node serve.js`. '
        + 'Sans serveur du tout, `node runtime/cli.js ' + artifact.id + '` fait la même chose.' }));
  });

  /*
   * Lire une réponse dont on n'est PAS sûr qu'elle contienne du JSON.
   *
   * ── LE MESSAGE QUE CECI REMPLACE ────────────────────────────────────────────
   *
   *   « Failed to execute 'json' on 'Response': Unexpected end of JSON input »
   *
   * C'est ce que rend `r.json()` sur un corps vide, et ça ne dit RIEN d'utile : ni qui n'a
   * pas répondu, ni quel statut est revenu, ni s'il faut regarder son réseau, son jeton ou
   * son serveur. On lit donc le texte D'ABORD, et on décide ensuite.
   *
   * Les deux cas qui arrivent vraiment :
   *
   *   · corps VIDE — le serveur a fermé la connexion sans répondre. Sur un lien qui
   *     tousse, un appel au fournisseur qui traîne finit comme ça, et le seul endroit où
   *     la cause est écrite est le terminal de `node serve.js` ;
   *   · corps qui n'est PAS du JSON — typiquement la page « 404 » en texte brut que ce
   *     serveur rend quand une route jette. Le corps est alors la meilleure indication
   *     qu'on ait, et il faut le montrer plutôt que de le perdre dans un message d'erreur
   *     de parseur.
   */
  async function enJson(r) {
    const texte = await r.text();
    if (!texte.trim()) {
      throw new Error(`Le serveur a fermé la connexion sans répondre (statut ${r.status}). `
        + 'Regarde le terminal où tourne `node serve.js` : la cause y est écrite. '
        + 'Sur une connexion lente, c\'est souvent un appel au fournisseur qui n\'a pas abouti.');
    }
    try { return JSON.parse(texte); }
    catch {
      throw new Error(`Le serveur a répondu ${r.status} sans JSON : `
        + `« ${texte.slice(0, 120).trim()} ».`);
    }
  }

  async function executer(avecAssume) {
    partir.disabled = true;
    partir.textContent = '… le modèle répond';
    zone.textContent = '';

    const valeurs = {};
    if (!choixCas.value) {
      for (const [nom, input] of Object.entries(saisies)) valeurs[nom] = input.value;
    }

    let r; let corps;
    try {
      r = await fetch('../api/lancer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: artifact.id, cas: choixCas.value || undefined, valeurs,
                               sensibilite: sensibilite.value, criticite: criticite.value,
                               assume: avecAssume === true })
      });
      corps = await enJson(r);
    } catch (error) {
      zone.append(el('div', { className: 'verdict ko', textContent: `✕ ${error.message}` }));
      // `majDepart` et pas `disabled = false` : un recalcul a pu démarrer pendant l'appel,
      // et rouvrir le bouton à la main le rendrait cliquable sur une matière vide.
      majDepart();
      return;
    }

    majDepart();
    rendreResultat(corps, r.status);
  }

  /*
   * La sortie, LUE — et non montrée telle quelle.
   *
   * Un agent qui répond en Markdown s'affichait en chasse fixe : on lisait « ## Ton bus
   * factor » et « **92 %** » au lieu d'un titre et d'un chiffre en gras. La réponse était
   * bonne et illisible, ce qui revient au même pour celui qui la reçoit.
   *
   * Deux précautions, parce que ce texte vient d'un MODÈLE et pas de nous :
   *
   *   · `rendre()` échappe tout AVANT de baliser — aucune balise du modèle ne devient du
   *     HTML. `lienSur` neutralise en plus les destinations `javascript:` et `data:`.
   *   · le texte EXACT reste à un clic. C'est lui que les critères ont évalué : le cacher
   *     derrière une mise en forme rendrait le verdict invérifiable.
   *
   * Du JSON n'est pas rendu : sa structure EST sa lisibilité, et la baliser l'effacerait.
   */
  function sortieLisible(brut) {
    const texte = String(brut ?? '');
    if (!ressembleADuMarkdown(texte)) return el('pre', { textContent: texte });

    const boite = el('div', {});
    const lu = el('div', { className: 'lu' });
    lu.innerHTML = rendreMd(texte, { lien: lienSur });
    boite.append(lu);

    const exact = el('details', { className: 'brut' });
    exact.append(el('summary', { textContent: 'le texte exact rendu par le modèle' }),
                 el('pre', { textContent: texte }));
    boite.append(exact);
    return boite;
  }

  /*
   * « Exporter le rapport » — la boucle qui se ferme.
   *
   * Une réponse qui ne vit que dans un onglet ne sert qu'une fois. Le hub DevOps le
   * faisait déjà pour ses modules (`exportReport()` dans `js/insights.js`) : un fichier
   * HTML autonome qu'on télécharge, qu'on envoie, qu'on ressort en comité. Un agent
   * n'avait pas de raison d'en être privé.
   *
   * Le fichier emporte aussi ce qui rend la réponse discutable : le dépôt, la date,
   * l'agent et sa version, le modèle, les critères et leur verdict, et LA MATIÈRE — les
   * chiffres calculés, en annexe, séparés du commentaire. Sans eux, le rapport serait une
   * opinion joliment mise en page.
   */
  function boutonExport(corps) {
    const b = el('button', { className: 'export', type: 'button', textContent: '⬇ Exporter le rapport',
      title: 'Un fichier HTML autonome : le rapport, sa provenance, ses contrôles et les '
           + 'chiffres qui l\'ont nourri.' });

    b.onclick = () => {
      const maintenant = new Date();
      const html = rapportHtml({
        titre: artifact.title || artifact.id,
        agent: artifact.id,
        version: artifact.version || '',
        auteur: artifact.owner?.person || '',
        perimetre: artifact.owner?.scope || '',
        depot: cible(),
        quand: maintenant.toLocaleString('fr-FR',
          { dateStyle: 'long', timeStyle: 'short' }),
        modele: corps.modele || '',
        sortie: corps.sortie || '',
        // La matière telle qu'elle est PARTIE, relue sur le champ lui-même : c'est elle
        // que le modèle a eue sous les yeux, pas ce qu'on croit lui avoir donné.
        matiere: calcules.map((c) => c.controle.value).filter(Boolean).join('\n\n'),
        /*
         * Les chiffres MESURÉS, à part du texte : le rapport en fait ses propres tableaux
         * plutôt que de faire confiance à ce que le modèle en a recopié.
         *
         * TOUTES les matières, et non plus la première. Un agent qui lit les secrets, les
         * dépendances et la conformité en même temps n'exportait qu'un tiers de ce qu'il
         * avait sous les yeux — et le rapport paraissait complet, ce qui est pire que de
         * n'en montrer aucun.
         */
        mesures: calcules.map((c) => c.dernier()).filter(Boolean),
        postvol: corps.postvol || null,
        jetons: corps.jetons || null,
        // Une reponse coupee le dit AUSSI dans le fichier exporte : il part en piece
        // jointe et se relit six mois plus tard, par quelqu'un qui n'etait pas la.
        motifArret: corps.motifArret || ''
      });

      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = el('a', { href: url, download: nomFichier({
        agent: artifact.id, depot: cible(),
        date: maintenant.toISOString() }) });
      document.body.append(a);
      a.click();
      a.remove();
      // Libérée après coup : révoquer trop tôt annule le téléchargement en cours.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    };

    return b;
  }

  /*
   * ── PROPOSER LES CORRECTIFS ─────────────────────────────────────────────────
   *
   * La seule action de ce produit qui ÉCRIT chez quelqu'un d'autre. Elle mérite donc plus
   * de garde-fous que tout le reste, et ils sont tous ici :
   *
   *   AUCUN MODÈLE NE DÉCIDE. Les dépôts visés, les fichiers posés et le texte de la
   *   description viennent de `lib/correctifs.js` — du code, dérivé de l'audit. Ce que le
   *   modèle a écrit dans son rapport n'entre nulle part dans ce qui est commité.
   *
   *   ON N'ÉCRIT QUE DEUX FICHIERS, et seulement s'ils manquent. Protéger une branche ou
   *   exiger deux approbateurs sont des RÉGLAGES : aucun commit ne les change, et la
   *   description le dit avec l'écran exact où aller les régler.
   *
   *   ON NE FUSIONNE JAMAIS. On ouvre une merge request, l'équipe décide. C'est ce qui a
   *   été demandé — « à valider par les équipes » — et c'est aussi la seule façon de ne
   *   pas se faire couper les droits la semaine suivante.
   *
   *   ON DIT AVANT DE FAIRE. La confirmation liste les dépôts visés et les fichiers, un
   *   par un. Un bouton qui écrit chez les autres sans montrer quoi ni où n'a rien à faire
   *   dans un produit qui prétend gouverner.
   */
  function boutonCorrectifs() {
    const b = el('button', { className: 'export', type: 'button',
      textContent: '📮 Proposer les correctifs' });

    /*
     * GitHub n'est pas servi, et le bouton le DIT plutôt que d'échouer au clic.
     *
     * `commitFiles` et `createMergeRequest` lèvent un 501 volontaire sur GitHub : la cible
     * est GitLab, et la reconstruction d'arbre git côté GitHub n'a jamais été écrite faute
     * d'usage. Laisser le bouton actif ferait découvrir le trou après coup, sur un message
     * technique — alors qu'il se dit en une phrase avant.
     */
    if (forge.kind !== 'gitlab') {
      b.disabled = true;
      b.title = 'Sur GitLab seulement. L\'ouverture d\'une merge request n\'est pas '
              + 'implémentée côté GitHub : la connexion actuelle ne peut pas écrire.';
      return b;
    }

    b.onclick = async () => {
      const parc = calcules.map((c) => c.dernier()).find((r) => r?.lignes);
      const aFaire = (parc?.lignes || [])
        .filter((d) => aProposer(d.conformite))
        .map((d) => ({ depot: d.depot, conformite: d.conformite,
                       fichiers: fichiersAProposer(d.conformite, d.depot) }));

      if (!aFaire.length) {
        alert('Aucun dépôt en écart parmi ceux audités — il n\'y a rien à proposer.');
        return;
      }

      const apercu = aFaire.map((x) => `  • ${x.depot}\n`
        + (x.fichiers.length
          ? x.fichiers.map((f) => `      + ${f.chemin}`).join('\n')
          : '      (aucun fichier à poser — la MR portera le constat)')).join('\n');

      if (!confirm(
        `Ouvrir ${aFaire.length} merge request(s), branche « ${BRANCHE_CORRECTIFS} ».\n\n`
        + `${apercu}\n\n`
        + 'Aucune ne sera fusionnée : ce sont des propositions, les équipes décident.\n'
        + 'Les réglages de projet — branches protégées, approbations, webhooks — ne sont '
        + 'PAS corrigés ; la description dit où les régler à la main.\n\nContinuer ?')) return;

      b.disabled = true;
      const suivi = el('div', { className: 'constats' });
      zone.append(el('h4', { textContent: 'Les correctifs proposés' }), suivi);

      for (const x of aFaire) {
        const ligne = el('div', { textContent: `⏳ ${x.depot}…` });
        suivi.append(ligne);
        try {
          const r = await proposerCorrectif(x);
          ligne.textContent = `✔ ${x.depot}${r.url ? ' — ' : ' — merge request déjà ouverte'}`;
          if (r.url) {
            ligne.append(el('a', { href: r.url, target: '_blank', rel: 'noopener',
                                   textContent: 'voir la merge request' }));
          }
        } catch (error) {
          // Un dépôt qui refuse n'arrête pas les autres : sur vingt dépôts il y en a
          // toujours un où le jeton n'a pas le droit d'écrire, et ce n'est pas une panne.
          ligne.textContent = `✕ ${x.depot} — ${error.message}`;
          ligne.className = 'ko';
        }
      }
      b.disabled = false;
    };

    return b;
  }

  /**
   * Une merge request de correctifs sur UN dépôt.
   *
   * Rejouable : la branche porte toujours le même nom, et une merge request déjà ouverte
   * depuis elle est réutilisée plutôt que doublée. Relancer l'audit trois fois ne doit pas
   * poser trois MR identiques sur le dos d'équipes qui n'ont rien demandé.
   */
  async function proposerCorrectif({ depot, conformite, fichiers }) {
    const cibleBranche = await brancheDe(depot);

    /*
     * Un dépôt sans fichier à poser reçoit quand même sa merge request : le constat et la
     * liste des réglages à faire à la main SONT le contenu utile. Le fichier ne sert que
     * de support — sans lui, il n'y a pas de commit, donc pas de MR possible.
     */
    const aEcrire = fichiers.length ? fichiers : [{
      chemin: 'CONFORMITE-CIS.md',
      contenu: descriptionMr({ depot, conformite, fichiers: [] })
    }];

    await forge.commitFiles(depot, {
      branch: BRANCHE_CORRECTIFS,
      depuis: cibleBranche,
      message: messageCommit(conformite),
      files: aEcrire.map((f) => ({ path: f.chemin, content: f.contenu }))
    });

    try {
      const mr = await forge.createMergeRequest(depot, {
        source: BRANCHE_CORRECTIFS, target: cibleBranche,
        title: titreMr(conformite),
        description: descriptionMr({ depot, conformite, fichiers })
      });
      return { url: mr.url };
    } catch (error) {
      // 409 : une MR est déjà ouverte depuis cette branche. Ce n'est pas un échec, c'est
      // l'idempotence qui fait son travail — la branche vient d'être mise à jour.
      if (error.status === 409) return { url: '' };
      throw error;
    }
  }

  /*
   * ── LES QUATRE GESTES D'UNE MERGE REQUEST ───────────────────────────────────
   *
   * Une revue qui ne débouche sur rien ne sert à rien. On lisait l'avis de l'agent, puis
   * on rouvrait la forge dans un autre onglet pour reporter la décision à la main — et ce
   * détour suffit à ce qu'on ne le fasse pas, ou qu'on le fasse trois jours plus tard.
   *
   * QUATRE RÈGLES GOUVERNENT CE BLOC, et elles sont toutes visibles à l'écran :
   *
   *   C'EST VOUS QUI SIGNEZ. Les quatre gestes partent sous le nom du porteur du jeton.
   *   Ce n'est pas « la plateforme » qui approuve, et la trace sur la forge le dira. Le
   *   bandeau le rappelle avant le premier clic, pas après.
   *
   *   LE MODÈLE NE DÉCIDE JAMAIS. Aucun des quatre boutons ne lit la réponse de l'agent
   *   pour choisir quoi que ce soit. Le commentaire est le seul à en reprendre le texte —
   *   et il est ÉDITABLE avant l'envoi, parce que c'est vous qui le signez.
   *
   *   ON CONFIRME AVANT D'ÉCRIRE. Les quatre, sans exception. Fusionner et fermer ne se
   *   défont pas d'un clic ; approuver et commenter laissent une trace publique.
   *
   *   ON DIT CE QUI S'EST PASSÉ, y compris l'échec. Un jeton sans droit d'approbation
   *   rend un 403 : c'est une information, pas une panne, et elle s'affiche telle quelle.
   */
  function gestesDeMr(matiere, corps) {
    const pr = matiere.pr;
    const depot = matiere.depot;
    const bloc = el('div', { className: 'gestes-mr' });

    bloc.append(el('div', { className: 'gestes-tete' },
      el('b', { textContent: `Merge request #${pr.numero}` }),
      el('span', { className: 'sp' }),
      el('small', { textContent: `Les quatre gestes partent sous ton nom — ${session.username} — `
                               + 'et laissent une trace sur la forge.' })));

    const etat = el('div', { className: 'gestes-etat', hidden: true });
    const rangee = el('div', { className: 'gestes-rangee' });

    const dire = (texte, classe) => {
      etat.hidden = false;
      etat.textContent = texte;
      etat.className = `gestes-etat ${classe}`;
    };

    /** Un geste : confirme, agit, dit ce qui s'est passé — succès comme échec. */
    const geste = (libelle, question, action, { danger = false } = {}) => {
      const b = el('button', { type: 'button', className: danger ? 'geste danger' : 'geste',
                               textContent: libelle });
      b.onclick = async () => {
        if (!confirm(question)) return;
        for (const x of rangee.querySelectorAll('button')) x.disabled = true;
        dire(`${libelle}…`, 'attente');
        try {
          dire(await action(), 'ok');
        } catch (error) {
          /*
           * Un 403 n'est pas une panne : c'est un jeton sans ce droit-là, et le dire
           * franchement vaut mieux qu'un message technique. Le reste remonte tel quel —
           * une MR déjà fusionnée, un conflit, une règle de protection.
           */
          dire(error.status === 403
            ? `${libelle} refusé : ton jeton n'a pas ce droit sur ${depot}.`
            : `${libelle} a échoué : ${error.message}`, 'ko');
        } finally {
          for (const x of rangee.querySelectorAll('button')) x.disabled = false;
        }
      };
      return b;
    };

    /*
     * Le commentaire porte la revue de l'agent, ÉDITABLE.
     *
     * C'est le geste qui rend toute la chaîne utile : l'agent lit la MR, écrit son avis,
     * et l'avis se pose là où l'équipe le lira. Mais il part sous votre nom, donc il doit
     * pouvoir être coupé, corrigé, complété avant l'envoi — poster tel quel ce qu'un
     * modèle a écrit, sous sa propre signature, n'est pas une revue, c'est un transfert
     * de responsabilité.
     */
    const zoneCommentaire = el('textarea', { rows: 8, className: 'gestes-commentaire',
      value: `${String(corps.sortie || '').trim()}\n\n---\n_Relu avec SalsiIAPrompt `
           + `(${artifact.id}). Les remarques sont à discuter, pas à appliquer telles quelles._` });
    const plieCommentaire = el('details', { className: 'gestes-detail' });
    plieCommentaire.append(el('summary', { textContent: '💬 Commenter — relire le texte avant de le poster' }),
      zoneCommentaire,
      geste('Poster le commentaire',
        `Poster ce commentaire sur #${pr.numero} de ${depot}, sous ton nom ?`,
        async () => {
          const texte = zoneCommentaire.value.trim();
          if (!texte) throw new Error('Le commentaire est vide.');
          await forge.commenterPullRequest(depot, pr.numero, texte);
          return `✔ Commentaire posté sur #${pr.numero}.`;
        }));

    rangee.append(
      geste('✅ Approuver',
        `Approuver la merge request #${pr.numero} de ${depot} ?\n\n`
        + 'Ton approbation apparaîtra publiquement sur la forge, à ton nom.',
        async () => {
          await forge.approuverPullRequest(depot, pr.numero);
          return `✔ #${pr.numero} approuvée par ${session.username}.`;
        }),
      geste('🔀 Fusionner',
        `FUSIONNER la merge request #${pr.numero} de ${depot} dans ${pr.cible} ?\n\n`
        + 'C\'est le seul geste de cette liste qu\'on ne défait pas d\'un clic : le code '
        + 'part dans la branche cible.\n\nContinuer ?',
        async () => {
          const r = await forge.fusionnerPullRequest(depot, pr.numero);
          return r.fusionne
            ? `✔ #${pr.numero} fusionnée dans ${pr.cible}.`
            : `La forge n'a pas fusionné — état : ${r.etat}. Un conflit ou une règle de `
              + 'protection l\'empêche.';
        }, { danger: true }),
      geste('🚫 Refuser',
        `Fermer la merge request #${pr.numero} de ${depot} sans la fusionner ?\n\n`
        + 'Le travail n\'est pas perdu : la branche reste, et la MR peut être rouverte '
        + 'sur la forge.\n\nContinuer ?',
        async () => {
          await forge.fermerPullRequest(depot, pr.numero);
          return `✔ #${pr.numero} fermée sans fusion. La branche, elle, existe toujours.`;
        }, { danger: true }));

    if (pr.url) {
      rangee.append(el('a', { className: 'geste lien', href: pr.url, target: '_blank',
                              rel: 'noopener', textContent: '↗ Ouvrir sur la forge' }));
    }

    bloc.append(rangee, plieCommentaire, etat);
    return bloc;
  }

  function rendreResultat(corps, status) {
    conf.hidden = true;
    zone.textContent = '';

    if (corps.erreur) {
      zone.append(el('div', { className: 'verdict ko', textContent: `✕ ${corps.erreur}` }));
      return;
    }

    if (corps.refuse) {
      zone.append(el('div', { className: 'verdict ko', textContent: `✕ ${corps.raison}` }));
      const liste = el('ul', { className: 'constats' });
      for (const c of corps.constats || []) {
        liste.append(el('li', {}, c.severity === ERROR ? '🔴 ' : '🟡 ',
          el('code', { textContent: c.code }), ` ${c.message}`));
      }
      zone.append(liste);

      // Refusé pour absence de confirmation : on montre ce qu'il y a à assumer, et on
      // laisse repartir. Refusé pour une erreur : il n'y a rien à cocher, ça se corrige.
      if (corps.confirmationRequise && (corps.raisons || []).length) {
        conf.hidden = false;
        conf.textContent = '';
        conf.append(el('b', { textContent:
          `✋ ${corps.raisons.length} point(s) que la plateforme ne peut pas trancher seule` }));
        const ul = el('ul');
        for (const c of corps.raisons) ul.append(el('li', {}, el('b', { textContent: c.code }), ` ${c.message}`));
        conf.append(ul);
        assume.checked = false;
        const relancer = el('button', { className: 'primary', textContent: 'Assumer et exécuter', disabled: true });
        assume.onchange = () => { relancer.disabled = !assume.checked; };
        relancer.onclick = () => executer(true);
        conf.append(el('label', {}, assume,
          el('span', { textContent: `Je l'assume, en tant que ${session.username}.` })), relancer);
      }
      return;
    }

    const tete = el('div', { className: 'sortie-tete' },
      el('h4', { textContent: `Sortie — ${corps.modele}${corps.cas ? ` · ${corps.cas}` : ''}` }),
      el('span', { className: 'sp' }),
      boutonExport(corps));
    // Le bouton n'apparaît que sur un audit de parc, et seulement s'il a trouvé un écart :
    // proposer des correctifs à un parc conforme n'aurait aucun sens, et le bouton visible
    // ferait douter du verdict.
    if (surParc && calcules.some((c) => (c.dernier()?.lignes || []).some((d) => aProposer(d.conformite)))) {
      tete.append(boutonCorrectifs());
    }
    zone.append(tete);

    // Les gestes de merge request, quand l'agent en a relu une : la revue n'a d'intérêt
    // que si elle débouche sur une décision, et aller la reporter à la main sur la forge
    // est exactement le détour qui fait qu'on ne le fait pas.
    const surMr = calcules.map((c) => c.dernier()).find((r) => r?.pr);
    if (surMr) zone.append(gestesDeMr(surMr, corps));

    /*
     * UNE RÉPONSE COUPÉE LE DIT, ET C'EST LE PLUS IMPORTANT DE CET ÉCRAN.
     *
     * Le motif d'arrêt remontait déjà du moteur jusqu'ici — et personne ne le lisait. Une
     * réponse tronquée par le plafond de jetons a l'air FINIE : elle a un début, des
     * sections, un ton assuré. On la lit, on agit dessus, et le plan d'action s'arrête là
     * où le modèle a été coupé sans que rien ne l'indique.
     *
     * C'est le même défaut que partout ailleurs dans ce produit — une mesure partielle qui
     * se présente comme complète — et il était ici sous nos yeux.
     */
    if (coupee(corps.motifArret)) {
      zone.append(el('div', { className: 'verdict ko' },
        el('span', { textContent: '✂' }),
        el('span', {},
          el('b', { textContent: 'Réponse coupée : elle s\'arrête au plafond de jetons.' }),
          el('div', { style: 'font-size:12px;margin-top:4px',
            textContent: 'Ce qui suit n\'a pas été écrit. Ne conclus rien de son absence — '
                       + 'les dernières sections manquent peut-être entièrement. Relance : '
                       + 'la matière est déjà calculée, le nouvel appel repart du même '
                       + 'point.' }))));
    }

    zone.append(sortieLisible(corps.sortie));

    /*
     * Le post-vol. C'est LA nouveauté visible : `criteria` était déclaré depuis le début
     * et jamais évalué. Chaque ligne ici est un verdict calculé par du code sur la sortie
     * réelle — pas un juge LLM, pas une impression.
     */
    const dit = corps.postvol.conforme
      ? '✔ contrat satisfait'
      : `✕ ${corps.postvol.violes.length} critère(s) violé(s)`;
    zone.append(el('div', { className: `verdict ${corps.postvol.conforme ? 'ok' : 'ko'}` },
      el('span', { textContent: dit }), el('span', { className: 'sp' }),
      el('span', { style: 'font-weight:600;font-size:12px', textContent:
        `${corps.jetons.entree} + ${corps.jetons.sortie} jetons`
        + (corps.cout === null ? '' : ` · ${(corps.cout * 100).toFixed(3)} centime(s)`) })));

    const liste = el('ul', { className: 'constats' });
    for (const c of corps.postvol.constats) {
      const icone = c.verdict === 'satisfait' ? '✔ ' : c.verdict === 'violé' ? '✕ ' : '· ';
      const vue = Array.isArray(c.valeur) ? `[${c.valeur.length}]` : JSON.stringify(c.valeur);
      liste.append(el('li', {}, icone, el('code', { textContent: c.cible }),
        ` ${c.op} ${JSON.stringify(c.attendu)} → ${vue}`,
        c.pourquoi ? el('small', { style: 'display:block;color:var(--tm)', textContent: c.pourquoi }) : ''));
    }
    zone.append(liste);
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  partir.onclick = () => executer(false);
  choixCas.onchange();
}

/* ── Lancer (moment 5) ────────────────────────────────────────────────────────
 *
 * Deux temps, et la séparation est tout l'intérêt :
 *
 *   Préparer  → lit le dépôt, affiche le plan. RIEN n'a bougé.
 *   Livrer    → écrit, sur la foi d'un plan que l'humain vient de lire.
 *
 * Le premier bouton est toujours disponible ; le second n'apparaît qu'une fois le plan
 * calculé. On ne peut donc pas livrer sans avoir vu ce qu'on livre — ce n'est pas une
 * politesse d'interface, c'est la confirmation qu'exige `P007`, rendue impossible à
 * sauter.
 */
function ouvrirLancement(entry) {
  const { artifact } = entry;
  const inner = $('sheetInner');
  inner.textContent = '';

  const retour = el('button', { textContent: '← Fiche' });
  retour.onclick = () => openSheet(entry);
  const close = el('button', { className: 'close', textContent: '✕', title: 'fermer' });
  close.onclick = () => $('sheet').classList.remove('on');

  inner.append(el('header', {},
    el('h2', {}, '▶ Lancer — ', artifact.title || artifact.id), retour, close));

  const body = el('div', { className: 'body' });
  const form = el('div', { className: 'pv' });

  const branche = el('select');
  branche.append(el('option', { value: '', textContent: '— choisis un dépôt —' }));

  // Choisir un dépôt charge ses branches : un bouton « charger » de plus serait une
  // étape que l'utilisateur n'a aucune raison de vouloir décider lui-même.
  const depot = selecteurDepot(() => { oublierPlan(); chargerBranches(); });

  const bump = el('span', { className: 'seg' });
  let bumpChoisi = 'patch';
  for (const t of BUMPS) {
    const b = el('button', { textContent: t, className: t === bumpChoisi ? 'on' : '' });
    b.onclick = () => { bumpChoisi = t; for (const x of bump.children) x.className = x.textContent === t ? 'on' : ''; oublierPlan(); };
    bump.append(b);
  }

  const champ = (libelle, controle) => el('div', {}, el('label', { textContent: libelle }), controle);
  form.append(el('div', { className: 'champs' },
    champ('Dépôt cible', depot.champ), champ('Branche à livrer', branche)));
  form.append(champ('Incrément de version', bump));

  const preparer_ = el('button', { className: 'primary', textContent: 'Préparer la livraison' });
  const livrer = el('button', { className: 'primary', textContent: '✋ Confirmer et livrer', hidden: true });
  form.append(el('div', { className: 'acts' }, preparer_, livrer));

  const etat = el('div', { className: 'verdict ok', hidden: true });
  const plan = el('div', { className: 'planbox', hidden: true });
  form.append(etat, plan);

  let planCourant = null;
  let brancheCible = '';

  const dire = (texte, ko = false) => {
    etat.hidden = false;
    etat.className = `verdict ${ko ? 'ko' : 'ok'}`;
    etat.textContent = '';
    etat.append(el('span', { textContent: texte }));
  };
  // Deux gestes distincts, et les confondre coûtait le lien vers la MR.
  //   oublier   : le contexte a changé, le plan affiché ne vaut plus rien → on l'efface
  //   consommer : la livraison a eu lieu → on empêche de relivrer, mais on GARDE l'écran,
  //               qui porte maintenant la référence du commit et le lien vers la MR
  const oublierPlan = () => { planCourant = null; livrer.hidden = true; plan.hidden = true; };
  const consommerPlan = () => { planCourant = null; livrer.hidden = true; };

  branche.onchange = oublierPlan;

  async function chargerBranches() {
    const repoCible = depot.valeur();
    branche.textContent = '';
    if (!repoCible) {
      branche.append(el('option', { value: '', textContent: '— choisis un dépôt —' }));
      return;
    }
    branche.append(el('option', { value: '', textContent: '— chargement… —' }));
    branche.disabled = true;
    try {
      const [info, branches] = await Promise.all([forge.projectInfo(repoCible), forge.listBranches(repoCible)]);
      brancheCible = info.defaultBranch;
      branche.textContent = '';
      branche.append(el('option', { value: '', textContent: '— choisir une branche —' }));
      // La branche par défaut est la CIBLE de la merge request : la proposer comme source
      // n'aurait pas de sens, le plan la refuserait.
      for (const b of branches.filter((b) => b.name !== brancheCible)) {
        branche.append(el('option', { value: b.name, textContent: b.name + (b.protectee ? ' (protégée)' : '') }));
      }
      dire(`${branches.length} branche(s) · cible de la MR : ${brancheCible}`);
    } catch (error) {
      branche.textContent = '';
      branche.append(el('option', { value: '', textContent: '— illisible —' }));
      dire(error.message, true);
    } finally { branche.disabled = false; }
  }

  preparer_.onclick = async () => {
    const repoCible = depot.valeur();
    if (!repoCible || !branche.value) return dire('Choisis un dépôt et une branche.', true);
    preparer_.disabled = true;
    dire('Lecture du dépôt…');
    try {
      const r = await preparerLivraison(forge, repoCible, { branche: branche.value, bump: bumpChoisi });
      brancheCible = r.brancheCible;
      planCourant = r.plan;

      plan.hidden = false;
      plan.textContent = '';
      if (!r.plan.ok) {
        livrer.hidden = true;
        dire(r.plan.raison, true);
        plan.hidden = true;
        return;
      }

      plan.append(el('h4', { textContent: 'Ce qui sera écrit — rien n\'a encore bougé' }));
      const dl = el('dl', { className: 'kv' });
      for (const [k, v] of [
        ['Version', `${r.plan.courante} → ${r.plan.cible}`],
        ['Branche', `${branche.value} → ${r.brancheCible}`],
        ['Commit', r.plan.message],
        ['Merge request', r.plan.titreMR],
        ['Overlays lus', `${r.overlaysLus} · ${r.plan.overlaysTouches} modifié(s)`]
      ]) dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
      plan.append(dl);

      const ul = el('ul', { className: 'constats' });
      for (const f of r.plan.fichiers) {
        ul.append(el('li', {}, el('code', { textContent: f.path }), ` — ${f.quoi}`));
      }
      plan.append(el('h4', { textContent: `Fichiers modifiés (${r.plan.fichiers.length})` }), ul);

      livrer.hidden = false;
      dire(`✔ Plan prêt — ${r.resume}`);
    } catch (error) {
      oublierPlan();
      dire(error.message, true);
    } finally { preparer_.disabled = false; }
  };

  livrer.onclick = async () => {
    if (!planCourant?.ok) return;
    if (!confirm(`Livrer ${planCourant.cible} ?\n\n${planCourant.fichiers.length} fichier(s) commités sur ${branche.value},`
               + `\npuis une merge request vers ${brancheCible}.\n\nLe merge déclenchera la livraison.`)) return;

    livrer.disabled = true;
    dire('Écriture…');
    try {
      const r = await executerLivraison(forge, depot.valeur(), planCourant,
        { branche: branche.value, brancheCible, auteur: session.username });

      const lignes = [`✔ Commit ${r.commit.sha?.slice(0, 8)} sur ${branche.value}`];
      if (r.mr) lignes.push(`merge request !${r.mr.number} ouverte vers ${brancheCible}`);
      dire(lignes.join(' · '));

      if (r.avertissement) plan.append(el('p', { className: 'note', textContent: '⚠ ' + r.avertissement }));
      if (r.mr?.url) {
        plan.append(el('p', {}, el('a', { href: r.mr.url, target: '_blank', rel: 'noopener',
                                          textContent: `Ouvrir la merge request !${r.mr.number} →` })));
      }
      // Le plan est consommé : le rejouer referait un bump par-dessus le précédent.
      // Mais l'écran reste — il porte la référence du commit et le lien vers la MR.
      consommerPlan();
    } catch (error) {
      dire(error.message, true);
    } finally { livrer.disabled = false; }
  };

  form.append(el('p', { className: 'note', textContent:
    'Aucun modèle n\'intervient : la version cible est calculée, les overlays sont découverts '
    + 'dans l\'arbre du dépôt, l\'écriture est faite par un module. C\'est ce que déclare '
    + 'l\'artefact — `executor: module` sur les outils d\'écriture.' }));

  body.append(form);
  inner.append(body);
  depot.remplir();
}

const section = (title, content) => el('section', {}, el('h4', { textContent: title }), content);

$('sheet').onclick = (e) => { if (e.target === $('sheet')) $('sheet').classList.remove('on'); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').classList.remove('on'); });
$('q').oninput = render;

renderFilters();
await load();

/* ── La visite guidée ─────────────────────────────────────────────────────────
 *
 * Cinq choses de cet écran ne se devinent pas, et toutes portent le sens du produit : une
 * pastille en pointillés, un verdict recalculé à l'instant, des critères, des cas d'or,
 * et deux boutons dont l'un écrit dans un dépôt. Celui qui les lit de travers croira que
 * « officiel » veut dire « éprouvé » — la faute exacte que ce registre existe pour
 * empêcher.
 *
 * Le tour n'apprend pas à cliquer : il dit ce que les mots VEULENT DIRE. D'où sa
 * brièveté — cinq étapes, une idée chacune. Un tour de quinze étapes se passe, et celui
 * qui l'a passé une fois ne le rouvre jamais.
 */

let tourEtapes = [];
let tourIndex = 0;

function tourPlacer() {
  const etape = tourEtapes[tourIndex];
  const cible = document.querySelector(etape.cible);
  if (!cible) return tourSuivant();

  /*
   * Défiler d'abord, mesurer ENSUITE — et `instant`, pas `smooth`.
   *
   * Bug vu à l'écran : avec un défilement animé, `getBoundingClientRect()` rend la
   * position d'AVANT, la page glisse sous le voile fixe, et le projecteur éclaire le
   * paragraphe d'à côté. Un tour qui montre le mauvais élément est pire que pas de tour.
   */
  cible.scrollIntoView({ block: 'center', behavior: 'instant' });
  requestAnimationFrame(() => dessiner(etape, cible));
}

function dessiner(etape, cible) {
  const r = cible.getBoundingClientRect();
  const trou = $('tourTrou');
  const P = 6;
  Object.assign(trou.style, {
    left: `${r.left - P}px`, top: `${r.top - P}px`,
    width: `${r.width + P * 2}px`, height: `${r.height + P * 2}px`
  });

  $('tourTitre').textContent = etape.titre;
  $('tourTexte').textContent = etape.texte;
  $('tourRang').textContent = `${tourIndex + 1} / ${tourEtapes.length}`;
  $('tourSuivant').textContent = tourIndex === tourEtapes.length - 1 ? 'Terminer' : 'Suivant';

  const bulle = $('tourBulle');
  const b = bulle.getBoundingClientRect();
  const pos = placer(
    { gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom, w: r.width, h: r.height },
    { w: b.width || 340, h: b.height || 160 },
    { w: innerWidth, h: innerHeight },
    etape.bord);
  bulle.style.left = `${pos.x}px`;
  bulle.style.top = `${pos.y}px`;
}

function tourSuivant() {
  tourIndex += 1;
  if (tourIndex >= tourEtapes.length) return tourFermer();
  tourPlacer();
}

function tourFermer() {
  $('tourVoile').classList.remove('on');
  // Un tour qui se rejoue à chaque visite est une publicité. Le bouton reste, lui.
  try { localStorage.setItem(VU, '1'); } catch { /* stockage refusé : tant pis */ }
}

function tourOuvrir() {
  // Une étape dont la cible est absente est SAUTÉE : le catalogue vide n'a pas de carte,
  // et un tour qui pointerait le néant apprendrait à se méfier de lui.
  tourEtapes = jouables(ETAPES, (sel) => Boolean(document.querySelector(sel)));
  if (tourEtapes.length === 0) return;
  tourIndex = 0;
  $('tourVoile').classList.add('on');
  requestAnimationFrame(tourPlacer);
}

/** À la première visite seulement — et jamais si l'écran n'a rien à montrer. */
function proposerTour() {
  let deja = '1';
  try { deja = localStorage.getItem(VU); } catch { /* stockage refusé */ }
  if (deja || items.length === 0) return;
  setTimeout(tourOuvrir, 700);
}

$('tourStart').onclick = tourOuvrir;
$('tourSuivant').onclick = tourSuivant;
$('tourPasser').onclick = tourFermer;
$('tourVoile').onclick = (e) => { if (e.target === $('tourVoile')) tourFermer(); };
addEventListener('keydown', (e) => {
  if (!$('tourVoile').classList.contains('on')) return;
  if (e.key === 'Escape') tourFermer();
  if (e.key === 'Enter' || e.key === 'ArrowRight') tourSuivant();
});
// Le projecteur suit la mise en page : redimensionner ne doit pas laisser le trou
// éclairer le vide à côté de sa cible.
addEventListener('resize', () => { if ($('tourVoile').classList.contains('on')) tourPlacer(); });
