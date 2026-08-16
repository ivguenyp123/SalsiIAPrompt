/*
 * L'établi de composition — tirer des briques validées dans une chaîne.
 *
 * ── CE QUI SE PASSE ICI, ET CE QUI NE S'Y PASSE PAS ──────────────────────────
 *
 * On assemble. On n'écrit pas. Il n'y a aucun champ de prompt sur cet écran, et c'est la
 * promesse à laquelle tout le reste se raccroche : une chaîne ne contient que des
 * références à des artefacts qui ont déjà franchi la porte, plus un câblage. Elle hérite
 * de leur validation — d'où le fait qu'on puisse composer librement sans rouvrir le débat
 * sur chaque texte.
 *
 * ── LE LINT TOURNE ICI, LE MÊME QU'EN CI ─────────────────────────────────────
 *
 * `L024` et `L025` ont besoin des AUTRES artefacts pour trancher : sans eux, elles se
 * taisent. On les leur donne — la bibliothèque de briques est exactement ce référentiel.
 * Le verdict suit donc chaque glissement, et une référence cassée par un réordonnancement
 * se voit à la seconde où elle apparaît, pas au dépôt.
 *
 * ── DEUX CHEMINS, UN SEUL MODÈLE DE DONNÉES ──────────────────────────────────
 *
 * Le glisser-déposer et la dictée produisent la MÊME chose : une liste d'étapes. La
 * dictée n'est qu'une façon plus rapide de la remplir, et ce qu'elle rend est
 * immédiatement modifiable à la main. Deux chemins qui produiraient deux formes
 * divergeraient au premier correctif.
 */
import { requireSession, clear } from '../app/session.js';
import { createForge, toBase64 } from '../app/forge.js';
import { mountShell } from '../app/shell.js';
import { knownScopes, guessScope } from '../app/scopes.js';
import { lint, ERROR } from '../lint/index.js';
import { makeValidator } from '../lib/schema.js';
import { toYaml } from '../studio/to-yaml.js';
import { entete } from '../lib/provenance.js';
import { prochainId, etapePour, variablesDeduites, criteresHerites,
         narrer, renvoisImpossibles } from '../lib/chaine.js';
import { chemin as cheminMien, dossier as dossierMien, forker, etat as etatChaine,
         ETATS } from '../lib/mien.js';
import { aplatir, confronter, familles as famillesDe, filtrer } from '../lib/inventaire.js';
import { morceauDepuisInventaire, morceauDepuisArtefact, consigneAssemblee,
         assembler, cequilManque } from '../lib/assemblage.js';
import yaml from '../lib/yaml.js';

const session = requireSession('../app/login.html');
if (!session) await new Promise(() => {});

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

mountShell({ active: 'composer', session, base: '../',
             onLogout: () => { clear(); location.href = '../app/login.html'; } });

const FRAIS = { cache: 'no-cache' };
const forge = createForge(session);
const repoRegistre = () => localStorage.getItem('salsi_ia_registry_repo') || '';

/* ── L'état ───────────────────────────────────────────────────────────────── */

let BRIQUES = [];                 // les artefacts validés, complets
let PAR_ID = new Map();
let ctx = null;                   // registres + validateur, pour le lint
let etapes = [];                  // la chaîne en construction
let identite = { titre: '', purpose: '', notFor: '' };
let idFige = '';                  // l'identifiant quand on reprend une chaîne existante
let CHAINES = [];                 // les miennes + celles du registre

/*
 * Le mode. Deux choses différentes, sur le même établi.
 *
 *   `agent`   prompt + prompt = UNE consigne, UN appel. Du texte NEUF, qui n'hérite de
 *             rien et part en validation.
 *   `chaine`  agent + agent = N appels. Aucun texte neuf, donc sauvable chez soi.
 *
 * `agent` est le mode par défaut, et c'est un choix : c'est celui dont la matière est
 * complète dès le premier jour — les 130 besoins de la plateforme. Le mode chaîne, lui,
 * ne vaut que quand le registre porte déjà des agents validés à enchaîner.
 */
let MODE = 'agent';
let INVENTAIRE = [];              // les besoins de la plateforme, confrontés au registre
let MORCEAUX = [];                // les prompts posés dans la consigne
let MIENS = [];                   // mes agents composés, sauvés chez moi
let famille = '';                 // le filtre de famille, en mode agent

const enAgent = () => MODE === 'agent';

/* ── Chargement ───────────────────────────────────────────────────────────── */

async function charger() {
  const [tools, targets, entrees, schema, inventaire] = await Promise.all([
    fetch('../registries/tools.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t).tools),
    fetch('../registries/targets.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t).targets),
    fetch('../entrees/index.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t)),
    fetch('../schema/artifact.schema.json', FRAIS).then((r) => r.json()),
    // Les besoins de la plateforme. C'est LA matière du mode agent : un établi qui
    // n'offrirait que les artefacts déjà validés serait vide le premier jour, et donc
    // inutile le jour où il sert le plus.
    fetch('../inventaire/hub-devops.yaml', FRAIS).then((r) => r.text()).then((t) => yaml.parse(t))
  ]);
  ctx = { tools, targets, entrees, validateArtifact: makeValidator(schema) };

  /*
   * Les briques viennent de la FORGE, comme le catalogue : ce sont les artefacts validés
   * du dépôt de registre choisi à l'accueil. `artifacts/` seulement — ce qui attend en
   * revue n'est pas une brique, et composer avec lui ferait hériter d'une validation qui
   * n'a pas eu lieu.
   */
  const repo = repoRegistre();
  if (!repo) throw new Error('Aucun dépôt de registre choisi — retourne à l\'accueil.');

  const fichiers = (await forge.listFiles(repo, 'artifacts'))
    .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));

  const publies = (await Promise.all(fichiers.map(async (f) => {
    try { return yaml.parse((await forge.getFile(repo, f.path)).content); }
    catch { return null; }
  }))).filter((a) => a && a.id);

  /*
   * Une chaîne n'est pas une brique. On PEUT en imbriquer une (L024 le permet en
   * avertissant), mais la proposer dans la bibliothèque en ferait le cas ordinaire — et
   * une chaîne de chaînes devient illisible en revue et imprévisible en coût.
   */
  BRIQUES = publies.filter((a) => a.kind !== 'chain');
  PAR_ID = new Map(BRIQUES.map((a) => [a.id, a]));

  CHAINES = publies.filter((a) => a.kind === 'chain')
    .map((a) => ({ artefact: a, proprietaire: a.owner?.person || '', publiee: true }));

  // L'état d'un besoin — « au registre » ou « à créer » — n'est écrit nulle part : il se
  // confronte. Un inventaire qui mentirait sur ce qui existe ferait recomposer ce qui est
  // déjà là.
  INVENTAIRE = confronter(aplatir(inventaire), publies.map((a) => a.id));

  basculer(MODE);
  await chargerMiennes(repo);
}

/* ── Le mode ──────────────────────────────────────────────────────────────── */

/*
 * Ce qui change entre les deux modes n'est pas cosmétique, et l'écran doit le dire au
 * lieu de le laisser deviner : la matière, ce qu'on produit, et surtout ce qui est permis
 * au bout. « Sauver chez moi » n'existe qu'en mode chaîne — un agent composé est du texte
 * neuf, et il n'y a pas de raccourci pour du texte que personne n'a lu.
 */
function basculer(mode) {
  MODE = mode === 'chaine' ? 'chaine' : 'agent';

  for (const b of document.querySelectorAll('.mode')) {
    b.classList.toggle('on', b.dataset.mode === MODE);
  }

  $('chapo').textContent = enAgent()
    ? 'Prends des morceaux à gauche, pose-les à droite : ils forment les instructions d\'un '
      + 'seul agent. Garde-le pour toi, ou propose-le aux autres — dans ce cas quelqu\'un '
      + 'le relira, comme pour tout agent écrit à la main.'
    : 'Mets bout à bout des agents déjà relus : le résultat de l\'un nourrit le suivant. '
      + 'Tu n\'écris aucune instruction ici, tu choisis l\'ordre — et chaque étape est '
      + 'contrôlée avant de passer à la suivante.';

  $('titreMatiere').firstChild.textContent = enAgent() ? 'Les morceaux ' : 'Agents disponibles ';
  $('titreToile').firstChild.textContent = enAgent() ? 'Ton agent ' : 'La suite ';
  $('recherche').placeholder = enAgent() ? 'chercher un morceau…' : 'chercher un agent…';

  // Les filtres ne survivent pas au changement de mode : ils portaient sur une autre
  // matière. Garder « incident » en passant aux briques afficherait un établi presque
  // vide, qu'on prendrait pour un registre presque vide.
  $('recherche').value = '';
  famille = '';

  // La dictée compose une CHAÎNE — elle choisit des briques et les branche, elle
  // n'écrit aucune consigne. La laisser en mode agent promettrait le contraire de ce
  // qu'elle fait.
  $('dictee').hidden = enAgent();

  $('identite').hidden = !enAgent();
  $('familles').hidden = !enAgent();
  $('blocChaines').hidden = enAgent();
  $('blocMiens').hidden = !enAgent();

  /*
   * « Sauver chez moi » vaut pour LES DEUX, et c'est une correction.
   *
   * J'avais justifié la validation d'un assemblage par « c'est du texte neuf ». Mauvais
   * critère : sinon écrire un prompt dans un carnet demanderait une validation. Ce qui la
   * déclenche, c'est d'ENGAGER LES AUTRES — et sauver chez soi n'engage personne.
   *
   * Ce qui rend le privé tenable ici : un agent assemblé ne déclare AUCUN outil, la porte
   * a déjà été franchie avant que le bouton s'active, le pré-vol tourne quand même à
   * chaque lancement, et rien de tout ça n'apparaît au catalogue.
   */
  $('sauver').hidden = false;
  $('envoyer').textContent = '📮 Partager — envoyer en validation';

  rendreMatiere();
  rendreToile();
}

for (const b of document.querySelectorAll('.mode')) {
  b.onclick = () => basculer(b.dataset.mode);
}

/* Les deux entrées de rendu, qui aiguillent. Le reste du fichier ne connaît qu'elles. */
const rendreMatiere = () => (enAgent() ? rendrePrompts() : rendreBriques());
const rendreToile = () => (enAgent() ? rendreAssemblage() : rendreChaine());

/*
 * Les chaînes personnelles, lues dans `mes-chaines/<moi>/`.
 *
 * Le dossier n'existe pas tant qu'on n'a rien sauvé : `listFiles` rend alors une liste
 * vide, pas une erreur. C'est le comportement voulu — un établi neuf n'est pas cassé.
 */
async function chargerMiennes(repo) {
  CHAINES = CHAINES.filter((c) => c.publiee);      // on ne garde que celles du registre
  MIENS = [];

  // Les deux dossiers, en parallèle. Un type par racine : ils ne se gouvernent pas
  // pareil, et les ranger ensemble ferait perdre la distinction au premier listing.
  await Promise.all([['chain', CHAINES], ['prompt', null]].map(async ([kind]) => {
    try {
      const dossier = dossierMien(session.username, kind);
      const fichiers = (await forge.listFiles(repo, dossier))
        .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));

      const lus = (await Promise.all(fichiers.map(async (f) => {
        try {
          const a = yaml.parse((await forge.getFile(repo, f.path)).content);
          if (!a?.id) return null;
          // Le dossier annonce un type ; si le fichier en porte un autre, on ne devine
          // pas — on l'écarte plutôt que de l'ouvrir dans le mauvais établi.
          const attendu = kind === 'chain' ? 'chain' : 'prompt';
          if ((a.kind || 'prompt') !== attendu) return null;
          return { artefact: a, proprietaire: session.username, publiee: false, chemin: f.path };
        } catch { return null; }
      }))).filter(Boolean);

      if (kind === 'chain') CHAINES = [...lus, ...CHAINES];
      else MIENS = lus;
    } catch { /* dossier absent : rien à afficher, et c'est normal */ }
  }));

  rendreChaines();
  rendreMiens();
}

/* ── Mes agents ───────────────────────────────────────────────────────────── */

/*
 * Les agents composés que j'ai sauvés chez moi.
 *
 * Ils ne sont PAS au catalogue et ne peuvent pas servir de brique : `L024` exige qu'une
 * étape de chaîne existe au registre, et `mes-agents/` n'y est pas. C'est ce qui empêche
 * la blanchisserie — composer en privé, faire enchaîner par quelqu'un d'autre, et laisser
 * la chaîne « hériter » d'une validation qui n'a jamais eu lieu.
 */
function rendreMiens() {
  const zone = $('miens');
  if (!zone) return;
  zone.textContent = '';
  $('nmiens').textContent = String(MIENS.length);

  if (MIENS.length === 0) {
    zone.append(el('div', { className: 'vide-toile', style: 'padding:16px 8px',
      textContent: 'Rien encore. Monte un agent et garde-le : il apparaîtra ici, pour toi '
                 + 'seul, et se lancera depuis « Les agents ».' }));
    return;
  }

  for (const m of MIENS) {
    const n = el('button', { className: 'chaine', type: 'button',
      title: ETATS.privee.aide },
      el('span', {}, el('b', { textContent: m.artefact.title || m.artefact.id }),
                     el('small', { textContent: m.artefact.intent?.purpose || '' })),
      el('span', { className: 'sp' }),
      el('span', { className: 'et privee', textContent: ETATS.privee.label }));
    n.onclick = () => ouvrirMien(m.artefact);
    zone.append(n);
  }
}

/*
 * Rouvrir un agent à moi.
 *
 * On ne sait PAS reconstituer les morceaux : le fichier ne porte que la consigne finale,
 * pas la liste de ce qui l'a produite. La rouvrir comme un morceau unique est honnête —
 * c'est exactement ce qu'elle est devenue, et l'auteur peut la retravailler telle quelle.
 */
function ouvrirMien(artefact) {
  MORCEAUX = [{ ref: artefact.id, origine: 'registre',
                titre: artefact.title || artefact.id,
                consigne: String(artefact.spec || '').trim(),
                entrees: (artefact.variables || []).map((v) => v.name),
                sortie: 'texte' }];
  identite = { titre: artefact.title || '',
               purpose: artefact.intent?.purpose || '',
               notFor: artefact.intent?.not_for || '' };
  idFige = artefact.id || '';
  dejaSauvee = true;
  $('msg').className = '';
  $('msg').textContent = '';
  basculer('agent');
  for (const [id, cle] of [['idTitre', 'titre'], ['idPurpose', 'purpose'], ['idNotFor', 'notFor']]) {
    $(id).value = identite[cle];
  }
  majVerdict();
}

/* ── Mes chaînes, et celles des autres ────────────────────────────────────── */

function rendreChaines() {
  const zone = $('chaines');
  zone.textContent = '';
  $('nchaines').textContent = String(CHAINES.length);

  if (CHAINES.length === 0) {
    zone.append(el('div', { className: 'vide-toile', style: 'padding:16px 8px',
      textContent: 'Rien encore. Monte une suite et garde-la : elle apparaîtra ici, pour toi '
                 + 'seul, jusqu\'à ce que tu la proposes aux autres.' }));
    return;
  }

  for (const c of CHAINES) {
    const e = etatChaine(c, session.username);
    const mienne = e === 'privee' || e === 'partagee';

    const n = el('button', { className: 'chaine', type: 'button',
                             title: ETATS[e]?.aide || '' },
      el('span', {}, el('b', { textContent: c.artefact.title || c.artefact.id }),
                     el('small', { textContent: `${(c.artefact.steps || []).length} étape(s)`
                                    + (mienne ? '' : ` · ${c.proprietaire || 'inconnu'}`) })),
      el('span', { className: 'sp' }),
      el('span', { className: `et ${e}`, textContent: ETATS[e]?.label || e }));

    /*
     * Ouvrir la mienne, FORKER celle d'un autre. Le fork ne dépose rien : il charge une
     * copie à mon nom dans l'établi, et c'est moi qui sauve. Un fork qui écrirait tout
     * seul dans le dépôt ferait grossir le registre à chaque clic de curiosité.
     */
    n.onclick = () => {
      ouvrirChaine(c.artefact);
      if (!mienne) forkerDepuis(c.artefact);
      else dejaSauvee = true;
    };
    zone.append(n);
  }
}

function ouvrirChaine(artefact) {
  etapes = structuredClone(artefact.steps || []);
  identite = { titre: artefact.title || '', purpose: artefact.intent?.purpose || '',
               notFor: artefact.intent?.not_for || '' };
  // On garde SON identifiant : rouvrir « ma chaîne » et la sauver doit écraser la même,
  // pas en créer une seconde à chaque ouverture. `dejaSauvee` est à part — un fork a un
  // identifiant figé et n'existe encore nulle part, et le message de commit doit le dire.
  idFige = artefact.id || '';
  dejaSauvee = false;
  $('msg').className = '';
  $('msg').textContent = '';
  // Ouvrir une chaîne bascule l'établi : on ne la relit pas dans un écran qui parle
  // d'assemblage de prompts.
  basculer('chaine');
}

function forkerDepuis(artefact) {
  const copie = forker(artefact, { qui: session.username, suffixe: session.username });
  if (!copie) return;
  ouvrirChaine(copie);
  idFige = copie.id;
  dejaSauvee = false;
  origineFork = artefact.id;
  $('msg').className = 'ok';
  $('msg').textContent = `⑂ Forkée depuis « ${artefact.title || artefact.id} » — elle est à `
    + 'toi, à ton nom. Modifie-la, puis sauve-la : rien n\'est encore écrit.';
}

let origineFork = '';
let dejaSauvee = false;   // l'identifiant est figé DÈS le fork, l'existence non

/* ── La bibliothèque ──────────────────────────────────────────────────────── */

const plier = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function rendreBriques() {
  const zone = $('briques');
  zone.textContent = '';
  const q = plier($('recherche').value).split(/\s+/).filter(Boolean);

  const vues = BRIQUES.filter((a) => {
    const foin = plier(`${a.title} ${a.intent?.purpose} ${a.id}`);
    return q.every((m) => foin.includes(m));
  });

  $('nbriques').textContent = `${vues.length}${vues.length !== BRIQUES.length ? ` / ${BRIQUES.length}` : ''}`;

  if (vues.length === 0) {
    zone.append(el('div', { className: 'vide-toile', textContent: 'Aucun agent ne correspond.' }));
    return;
  }

  for (const a of vues) {
    const n = el('div', { className: 'brique', draggable: true },
      el('span', { className: 'poignee', textContent: '⠿' }),
      el('span', {}, el('b', { textContent: a.title || a.id }),
                     el('small', { textContent: a.intent?.purpose || '' })),
      el('span', { className: 'sp' }),
      el('span', { className: 'plus', textContent: '＋', title: 'ajouter à la chaîne' }));

    n.ondragstart = (e) => {
      n.classList.add('tire');
      e.dataTransfer.setData('text/plain', `brique:${a.id}`);
      e.dataTransfer.effectAllowed = 'copy';
    };
    n.ondragend = () => n.classList.remove('tire');
    // Le clic fait la même chose que le glisser : sur un écran tactile, et pour qui va
    // plus vite au clavier, un établi qui n'accepte QUE le glisser est inutilisable.
    n.onclick = () => ajouter(a.id);
    zone.append(n);
  }
}

/* ── La matière du mode agent ─────────────────────────────────────────────── */

/*
 * Deux gisements, et le premier est celui qui rend l'écran utile dès le départ :
 *
 *   les BESOINS de la plateforme   130 lignes, disponibles sans qu'aucun agent existe
 *   les CONSIGNES déjà validées    le texte d'un artefact du registre, relu par un humain
 *
 * Le second est la meilleure matière, le premier est la seule qu'on ait en quantité. Les
 * mélanger dans une seule liste, en disant d'où vient chacun, vaut mieux que deux
 * colonnes dont l'une reste vide six mois.
 */
function sourcesPrompts() {
  const depuisRegistre = BRIQUES
    .map((a) => morceauDepuisArtefact(a))
    .filter((m) => m && m.consigne);

  // Un besoin déjà réalisé au registre est écarté : sa version validée est juste
  // au-dessus, et proposer les deux ferait choisir le brouillon.
  const dejaFaits = new Set(depuisRegistre.map((m) => m.ref));
  const depuisInventaire = INVENTAIRE
    .filter((p) => !dejaFaits.has(p.id))
    .map((p) => ({ ...morceauDepuisInventaire(p), famille: p.famille, module: p.module }));

  return [...depuisRegistre, ...depuisInventaire];
}

function rendrePrompts() {
  const zone = $('briques');
  zone.textContent = '';

  const tous = sourcesPrompts();
  const q = $('recherche').value;

  /*
   * Les familles de l'inventaire. `familles()` rend des OBJETS — clé, titre, icône et
   * comptes — et pas des chaînes : le bouton affiche le titre lisible, le filtre compare
   * la clé.
   */
  const boite = $('familles');
  boite.textContent = '';
  const tout = el('button', { textContent: 'toutes', className: famille ? '' : 'on' });
  tout.onclick = () => { famille = ''; rendrePrompts(); };
  boite.append(tout);

  for (const f of famillesDe(INVENTAIRE)) {
    const b = el('button', { textContent: `${f.icone || ''} ${f.titre || f.cle}`.trim(),
                             className: famille === f.cle ? 'on' : '',
                             title: `${f.total} capacité(s)` });
    b.onclick = () => { famille = f.cle; rendrePrompts(); };
    boite.append(b);
  }

  const vus = tous.filter((m) => {
    if (famille && m.famille !== famille) return false;
    if (!q.trim()) return true;
    return filtrer([{ titre: m.titre, besoin: m.consigne, module: m.module || '',
                      entrees: m.entrees }], { q }).length > 0;
  });

  $('nbriques').textContent = `${vus.length}${vus.length !== tous.length ? ` / ${tous.length}` : ''}`;

  if (vus.length === 0) {
    zone.append(el('div', { className: 'vide-toile', textContent: 'Aucun morceau ne correspond.' }));
    return;
  }

  for (const m of vus) {
    const n = el('div', { className: 'brique', draggable: true },
      el('span', { className: 'poignee', textContent: '⠿' }),
      el('span', {}, el('b', { textContent: m.titre }),
                     el('small', { textContent: m.consigne })),
      el('span', { className: 'sp' }),
      el('span', { className: `src ${m.origine === 'registre' ? 'registre' : ''}`,
                   textContent: m.origine === 'registre' ? 'validé' : (m.module || 'plateforme'),
                   title: m.origine === 'registre'
                     ? 'La consigne d\'un agent validé. Elle a été relue — mais l\'assemblage, lui, ne l\'a pas été.'
                     : 'Un besoin de la plateforme. Personne ne l\'a encore écrit ni relu.' }));

    n.ondragstart = (e) => {
      n.classList.add('tire');
      e.dataTransfer.setData('text/plain', `prompt:${m.ref}`);
      e.dataTransfer.effectAllowed = 'copy';
    };
    n.ondragend = () => n.classList.remove('tire');
    n.onclick = () => poser(m.ref);
    zone.append(n);
  }
}

/** Poser un prompt dans la consigne. Le même deux fois est permis — parfois c'est voulu. */
function poser(ref, position = MORCEAUX.length) {
  const m = sourcesPrompts().find((x) => x.ref === ref);
  if (!m) return;
  MORCEAUX.splice(position, 0, structuredClone(m));
  if (!identite.titre && MORCEAUX.length === 1) $('idTitre').value = '';
  rendreToile();
}

/* ── La consigne assemblée ────────────────────────────────────────────────── */

function agentCourant() {
  return assembler(MORCEAUX, {
    titre: identite.titre,
    purpose: identite.purpose,
    notFor: identite.notFor,
    auteur: session.username,
    scope: perimetre()
  });
}

function rendreAssemblage() {
  const toile = $('toile');
  toile.textContent = '';
  $('netapes').textContent = `${MORCEAUX.length} prompt${MORCEAUX.length > 1 ? 's' : ''}`;

  if (MORCEAUX.length === 0) {
    toile.append(el('div', { className: 'vide-toile' },
      el('b', { textContent: 'Dépose un morceau ici' }),
      'ou clique-le dans la liste. Ils formeront les instructions d\'un seul agent.'));
  }

  MORCEAUX.forEach((m, i) => {
    const carte = el('div', { className: 'morceau', draggable: true });

    const monter = el('button', { textContent: '↑', title: 'monter', disabled: i === 0 });
    const descendre = el('button', { textContent: '↓', title: 'descendre',
                                     disabled: i === MORCEAUX.length - 1 });
    const retirer = el('button', { textContent: '✕', title: 'retirer' });
    monter.onclick = () => deplacerMorceau(i, i - 1);
    descendre.onclick = () => deplacerMorceau(i, i + 1);
    retirer.onclick = () => { MORCEAUX.splice(i, 1); rendreToile(); };

    carte.append(el('div', { className: 'morceau-tete' },
      el('span', { className: 'poignee', textContent: '⠿' }),
      el('span', { className: 'rang', textContent: String(i + 1) }),
      el('b', { textContent: m.titre }),
      el('span', { className: 'sp' }), monter, descendre, retirer));

    /*
     * La consigne de chaque morceau est ÉDITABLE, et c'est assumé.
     *
     * Un besoin de l'inventaire est une phrase de catalogue, pas une instruction ciselée.
     * La figer produirait des agents tous approximatifs de la même façon. Comme le tout
     * repasse de toute manière par la porte et par un relecteur, laisser l'auteur écrire
     * ne coûte aucune garantie — c'est déjà le régime de tout prompt neuf.
     */
    const zone = el('textarea', { value: m.consigne });
    zone.oninput = () => { m.consigne = zone.value; majVerdict(); };
    carte.append(zone);

    if (m.entrees.length) {
      carte.append(el('div', { className: 'ent' },
        ...m.entrees.map((e) => el('code', { textContent: `{{${e}}}` }))));
    }

    carte.ondragstart = (e) => {
      carte.classList.add('tire');
      e.dataTransfer.setData('text/plain', `morceau:${i}`);
      e.dataTransfer.effectAllowed = 'move';
    };
    carte.ondragend = () => carte.classList.remove('tire');
    toile.append(carte);
  });

  majVerdict();
}

function deplacerMorceau(de, vers) {
  if (vers < 0 || vers >= MORCEAUX.length) return;
  const [m] = MORCEAUX.splice(de, 1);
  MORCEAUX.splice(vers, 0, m);
  rendreToile();
}

for (const [id, cle] of [['idTitre', 'titre'], ['idPurpose', 'purpose'], ['idNotFor', 'notFor']]) {
  $(id).oninput = () => { identite[cle] = $(id).value; majVerdict(); };
}

/* ── La chaîne ────────────────────────────────────────────────────────────── */

function ajouter(id, position = etapes.length) {
  const cible = PAR_ID.get(id);
  if (!cible) return;
  const etape = etapePour(cible, etapes);
  etapes.splice(position, 0, etape);
  if (!identite.titre) identite.titre = `Chaîne — ${cible.title || cible.id}`;
  rendreChaine();
}

function deplacer(de, vers) {
  if (de === vers || vers < 0 || vers >= etapes.length) return;
  const [e] = etapes.splice(de, 1);
  etapes.splice(vers, 0, e);
  rendreChaine();
}

/** L'artefact complet, tel qu'il serait déposé. Une seule source de vérité. */
function chaineCourante() {
  const brut = {
    id: idFige || identifiantDepuis(identite.titre),
    kind: 'chain',
    title: identite.titre || 'Chaîne sans nom',
    owner: { person: session.username, scope: perimetre() },
    intent: {
      purpose: identite.purpose || `Enchaîner ${etapes.length} artefact(s) du registre.`,
      not_for: identite.notFor
        || 'Ne pas utiliser sans avoir relu ce que chaque étape produit : une chaîne '
         + 'enchaîne des sorties de modèle.'
    },
    steps: structuredClone(etapes),
    target_level: 'experimental'
  };
  brut.variables = variablesDeduites(brut, PAR_ID);
  brut.criteria = criteresHerites(brut, PAR_ID);
  brut.spec = narrer(brut, PAR_ID);
  return brut;
}

const identifiantDepuis = (titre) => (String(titre || 'chaine')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')
  || 'chaine');

function perimetre() {
  const scopes = knownScopes(ctx?.tools || []);
  return guessScope(localStorage.getItem('salsi_ia_project_path') || '', scopes)
      || scopes[0] || '';
}

function rendreChaine() {
  const toile = $('toile');
  toile.textContent = '';
  $('netapes').textContent = `${etapes.length} étape${etapes.length > 1 ? 's' : ''}`;

  if (etapes.length === 0) {
    toile.append(el('div', { className: 'vide-toile' },
      el('b', { textContent: 'Dépose un agent ici' }),
      'ou clique-le dans la liste. Deux agents bien reliés valent mieux que cinq qui se '
      + 'repassent le même texte.'));
    $('envoyer').disabled = true;
    $('sauver').disabled = true;
    $('verdict').textContent = '';
    $('narration').hidden = true;
    $('note').textContent = '';
    return;
  }

  const artefact = chaineCourante();

  etapes.forEach((e, i) => {
    const cible = PAR_ID.get(e.artefact);
    const casses = renvoisImpossibles(artefact, i);

    const carte = el('div', { className: `etape${casses.length ? ' ko' : ''}`, draggable: true });

    const monter = el('button', { textContent: '↑', title: 'monter', disabled: i === 0 });
    const descendre = el('button', { textContent: '↓', title: 'descendre', disabled: i === etapes.length - 1 });
    const retirer = el('button', { textContent: '✕', title: 'retirer' });
    monter.onclick = () => deplacer(i, i - 1);
    descendre.onclick = () => deplacer(i, i + 1);
    retirer.onclick = () => { etapes.splice(i, 1); rendreChaine(); };

    carte.append(el('div', { className: 'etape-tete' },
      el('span', { className: 'poignee', textContent: '⠿' }),
      el('span', { className: 'rang', textContent: `${i + 1} · ${e.id}` }),
      el('b', { textContent: cible?.title || e.artefact }),
      el('span', { className: 'sp' }), monter, descendre, retirer));

    if (cible?.intent?.purpose) {
      carte.append(el('p', { className: 'purpose', textContent: cible.intent.purpose }));
    }

    /*
     * Le câblage, éditable. C'est le seul endroit de l'écran où l'on tape — et on n'y
     * tape jamais de prompt, seulement d'où vient une entrée. `{{e1.sortie}}` pour la
     * sortie d'une étape antérieure, `{{nom}}` pour une entrée de la chaîne.
     */
    const cablage = el('div', { className: 'cablage' });
    for (const v of cible?.variables || []) {
      const champ = el('input', { value: e.entrees?.[v.name] ?? '',
                                  placeholder: `{{${v.name}}} ou {{e1.sortie}}` });
      champ.oninput = () => {
        e.entrees = { ...e.entrees, [v.name]: champ.value };
        majVerdict();
      };
      cablage.append(el('div', { className: 'fil' },
        el('label', { textContent: v.name }), el('span', { className: 'flx', textContent: '←' }), champ));
    }
    carte.append(cablage);

    for (const c of casses) {
      carte.append(el('p', { className: 'purpose', style: 'color:#fca5a5;margin:8px 0 0',
                             textContent: `${c.cible} : ${c.renvoi} — ${c.raison}` }));
    }

    carte.ondragstart = (ev) => {
      carte.classList.add('tire');
      ev.dataTransfer.setData('text/plain', `etape:${i}`);
      ev.dataTransfer.effectAllowed = 'move';
    };
    carte.ondragend = () => carte.classList.remove('tire');
    carte.ondragover = (ev) => ev.preventDefault();
    carte.ondrop = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const charge = ev.dataTransfer.getData('text/plain');
      if (charge.startsWith('etape:')) deplacer(Number(charge.slice(6)), i);
      else if (charge.startsWith('brique:')) ajouter(charge.slice(7), i);
    };

    toile.append(carte);
    if (i < etapes.length - 1) toile.append(el('div', { className: 'liaison', textContent: '↓' }));
  });

  majVerdict();
}

/* ── Le verdict, à chaque geste ───────────────────────────────────────────── */

function majVerdict() {
  /*
   * Ce qui manque, dit AVANT les règles et dans les mots de l'auteur.
   *
   * `L008 : criteria non vide` n'aide personne qui n'a pas encore compris ce qu'est un
   * critère. Les deux messages coexistent : celui-ci guide, celui des règles fait foi.
   */
  const boite = $('manque');
  boite.textContent = '';
  const manques = enAgent() ? cequilManque(MORCEAUX, { ...identite, scope: perimetre() }) : [];
  if (manques.length) {
    boite.append(el('div', { className: 'manque' },
      el('b', { textContent: 'Il manque encore :' }),
      el('ul', {}, ...manques.map((m) => el('li', { textContent: m })))));
  }

  const artefact = enAgent() ? agentCourant() : chaineCourante();
  // `artifacts: BRIQUES` — sans elles, L024 et L025 se taisent et une chaîne cassée
  // passerait pour conforme. C'est le même linter qu'en CI, avec son référentiel.
  const report = lint(artefact, { ...ctx, artifacts: BRIQUES });

  const zone = $('verdict');
  zone.textContent = '';
  const erreurs = report.findings.filter((f) => f.severity === ERROR);

  /*
   * Tant que l'essentiel manque, les règles se taisent.
   *
   * Un établi vide produit six `L001` — « au moins 3 caractères (0 fourni) » — qui sont
   * tous vrais et tous inutiles : l'encadré au-dessus vient de dire la même chose en
   * français. Crier du L0xx à quelqu'un qui n'a encore rien posé apprend à ne plus lire
   * les constats, et c'est le seul endroit du produit où ils doivent être lus.
   *
   * Dès que les bases sont là, les règles reprennent la parole et font foi.
   */
  if (manques.length) {
    $('envoyer').disabled = true;
    $('sauver').disabled = true;
    $('narration').hidden = true;
    $('note').textContent = '';
    return;
  }

  const bloc = el('div', { className: `verdict ${report.blocked ? 'ko' : 'ok'}` },
    el('span', { textContent: report.blocked ? '✕' : '✔' }),
    el('span', {},
      el('b', { textContent: report.blocked
        ? `${erreurs.length} chose(s) à corriger`
        : 'Tout est en ordre' }),
      report.blocked
        ? el('ul', {}, ...erreurs.map((f) => el('li', {},
            el('code', { textContent: f.code }), ' ', f.message)))
        : el('div', { style: 'color:var(--tm);font-size:12px;margin-top:4px' },
            `${artefact.variables.length} entrée(s) · ${artefact.criteria.length} critère(s) `
            + (enAgent()
              // Le mot compte : « proposés » et non « hérités ». Un assemblage n'hérite
              // d'aucun contrat — ceux-ci se déduisent de ce que les morceaux déclarent
              // produire, et le relecteur devra dire s'ils suffisent.
              ? 'à vérifier sur sa réponse — à toi de dire s\'ils suffisent'
              : 'repris de la dernière étape'))));

  zone.append(bloc);
  $('envoyer').disabled = report.blocked;
  $('sauver').disabled = report.blocked;
  $('narration').hidden = false;
  $('yaml').textContent = toYaml(artefact);
  $('note').textContent = report.blocked ? '' : `${artefact.id}.yaml`;
}

/* ── La dictée ────────────────────────────────────────────────────────────── */

$('composer').onclick = async () => {
  const phrase = $('phrase').value.trim();
  const msg = $('msg');
  msg.className = '';
  msg.textContent = '';

  if (phrase.length < 10) { $('phrase').focus(); return; }

  const bouton = $('composer');
  bouton.disabled = true;
  const libelle = bouton.textContent;
  bouton.textContent = 'Composition…';

  try {
    const r = await fetch('../api/composer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phrase, auteur: session.username, scope: perimetre() })
    });
    const corps = await r.json();
    if (!r.ok) throw new Error(corps.erreur || `Le serveur a répondu ${r.status}.`);

    if (corps.forfait) {
      msg.className = 'err';
      msg.textContent = 'Aucune combinaison de briques ne répond à ce besoin. Ce n\'est pas '
        + 'un échec : le registre n\'a pas encore la matière. Demande un agent neuf à '
        + 'l\'écran « Demander », valide-le, et il deviendra une brique.';
      return;
    }
    if (!corps.artefact) {
      msg.className = 'err';
      msg.textContent = 'Rien d\'exploitable n\'est sorti. Reformule.';
      return;
    }

    /*
     * Ce que la dictée rend atterrit dans l'ÉTABLI, pas dans la file. On peut réordonner,
     * recâbler, retirer une étape avant d'envoyer — c'est le même « c'est toi qui
     * choisis » que pour la matière : la machine propose, elle ne dépose pas.
     */
    etapes = corps.artefact.steps || [];
    identite = {
      titre: corps.artefact.title || '',
      purpose: corps.artefact.intent?.purpose || '',
      notFor: corps.artefact.intent?.not_for || ''
    };
    // La dictée compose une CHAÎNE : elle choisit des briques et les branche. Rendre son
    // résultat dans l'établi d'assemblage afficherait une consigne vide.
    basculer('chaine');

    const tours = corps.tours.length;
    msg.className = 'ok';
    msg.textContent = `✔ ${etapes.length} étape(s) proposée(s) en ${tours} tour(s) `
      + `· ${corps.modele} via ${corps.fournisseur}. Relis, réordonne, puis envoie.`;
  } catch (error) {
    msg.className = 'err';
    msg.textContent = `✕ ${error.message}`;
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
};

/* ── La toile accepte ce qu'on lui jette ──────────────────────────────────── */

const toile = $('toile');
toile.ondragover = (e) => { e.preventDefault(); toile.classList.add('survol'); };
toile.ondragleave = () => toile.classList.remove('survol');
toile.ondrop = (e) => {
  e.preventDefault();
  toile.classList.remove('survol');
  const charge = e.dataTransfer.getData('text/plain');
  if (charge.startsWith('brique:')) ajouter(charge.slice(7));
  else if (charge.startsWith('prompt:')) poser(charge.slice(7));
  // Réordonner en tirant : le morceau lâché sur la toile va en fin de consigne.
  else if (charge.startsWith('morceau:')) deplacerMorceau(Number(charge.slice(8)),
                                                          MORCEAUX.length - 1);
};

$('recherche').oninput = () => rendreMatiere();
$('vider').onclick = () => {
  etapes = []; MORCEAUX = [];
  identite = { titre: '', purpose: '', notFor: '' };
  for (const id of ['idTitre', 'idPurpose', 'idNotFor']) $(id).value = '';
  idFige = ''; origineFork = ''; dejaSauvee = false;
  $('msg').textContent = '';
  rendreToile();
};

/* ── Le dépôt ─────────────────────────────────────────────────────────────── */

/*
 * SAUVER — chez moi, tout de suite, sans passer par la validation.
 *
 * C'est la décision de gouvernance de cet écran, et elle mérite d'être dite : une chaîne
 * n'apporte AUCUN texte neuf. Elle ordonne des artefacts qui ont chacun franchi la porte.
 * Ce qu'un relecteur aurait à juger tient dans l'ordre et le câblage — et `L024`/`L025` le
 * vérifient déjà, mécaniquement, à chaque frappe. Il n'y a rien à faire relire.
 *
 * Elle reste invisible au catalogue tant qu'elle n'est pas PARTAGÉE. Partager, lui, veut
 * dire « engager le registre », et ça se valide.
 */
$('sauver').onclick = async () => {
  const artefact = enAgent() ? agentCourant() : chaineCourante();
  const msg = $('msg');
  const bouton = $('sauver');
  bouton.disabled = true;
  const libelle = bouton.textContent;
  bouton.textContent = 'Enregistrement…';

  try {
    const chemin = cheminMien(session.username, artefact.id, artefact.kind);
    const quoi = enAgent()
      ? `assemblage de ${MORCEAUX.length} prompt(s)`
      : `assemblage de ${artefact.steps.length} briques du registre`;

    const tete = entete({
      origine: origineFork ? 'fork' : 'composition',
      phrase: origineFork || quoi,
      auteur: session.username, date: new Date().toISOString().slice(0, 10) });

    /*
     * Le message de commit dit POURQUOI ça ne passe pas par la validation, et les deux
     * raisons ne sont pas les mêmes. Un `git log` doit suffire à comprendre la règle sans
     * rouvrir le produit.
     */
    const pourquoi = enAgent()
      ? 'Agent personnel : il n\'apparait pas au catalogue et ne peut pas servir de brique\n'
        + 'de chaine (L024 exige le registre). Rien n\'engage personne d\'autre, donc rien\n'
        + 'n\'est a valider. Le pre-vol tourne quand meme a chaque lancement.'
      : 'Composee de briques deja validees : rien de neuf n\'est ecrit, rien a valider.';

    await forge.putFile(repoRegistre(), chemin, {
      content: toBase64(tete + toYaml(artefact)),
      message: `${enAgent() ? 'mes agents' : 'mes chaines'} : `
             + `${dejaSauvee ? 'mettre a jour' : 'sauver'} ${artefact.title}\n\n`
             + `${enAgent() ? `Agent personnel de ${session.username}, ${MORCEAUX.length} prompt(s).`
                            : `Chaîne personnelle de ${session.username}, ${artefact.steps.length} étape(s).`}\n`
             + pourquoi,
      branch: 'main'
    });

    idFige = artefact.id;
    dejaSauvee = true;
    msg.className = 'ok';
    msg.textContent = `✔ Sauvé chez toi — ${chemin}. ${enAgent()
      ? 'Il n\'apparaît qu\'ici et au Catalogue, section « les miens » — pour toi seul, '
        + 'tant que tu ne l\'as pas partagé.'
      : 'Elle n\'apparaît qu\'ici, et à toi seul, tant que tu ne l\'as pas partagée.'}`;
    await chargerMiennes(repoRegistre());
  } catch (error) {
    msg.className = 'err';
    msg.textContent = `✕ ${error.message}`;
  } finally {
    bouton.textContent = libelle;
    majVerdict();
  }
};

/*
 * PARTAGER — là, ça passe par la validation.
 *
 * Le mot porte toute la charge : il ne veut pas dire « rendre visible », il veut dire
 * « engager le registre ». Une chaîne partagée devient une promesse faite aux autres, et
 * une promesse se relit. C'est pour ça que celui-ci passe par l'Admin et que « sauver »
 * n'y passe pas.
 */
$('envoyer').onclick = async () => {
  const artefact = enAgent() ? agentCourant() : chaineCourante();
  const msg = $('msg');
  const bouton = $('envoyer');
  bouton.disabled = true;
  const libelle = bouton.textContent;
  bouton.textContent = 'Envoi…';

  try {
    const repo = repoRegistre();
    const chemin = `artifacts/pending/${artefact.id}.yaml`;

    /*
     * La provenance dit d'où vient le fichier, et elle compte plus ici qu'ailleurs : un
     * relecteur doit savoir que cette consigne est un ASSEMBLAGE, et de quels morceaux.
     * Sans ça il relit un prompt neuf sans savoir qu'il peut aller vérifier les sources.
     */
    const tete = enAgent()
      ? entete({ origine: 'composition',
                 phrase: `assemblage de ${MORCEAUX.length} prompt(s) : `
                       + MORCEAUX.map((m) => m.ref).join(', '),
                 auteur: session.username, date: new Date().toISOString().slice(0, 10),
                 tours: 0, modele: '', fournisseur: '' })
      : entete({ origine: origineFork ? 'fork' : 'composition',
                 phrase: origineFork || $('phrase').value.trim()
                   || `assemblage de ${artefact.steps.length} briques du registre`,
                 auteur: session.username, date: new Date().toISOString().slice(0, 10),
                 tours: 0, modele: '', fournisseur: '' });

    const message = enAgent()
      ? `registre : composer l'agent ${artefact.title}\n\n`
        + `Consigne assemblée par ${session.username} à partir de ${MORCEAUX.length} prompt(s) :\n`
        + MORCEAUX.map((m, i) => `  ${i + 1}. ${m.ref} (${m.origine})`).join('\n')
        + '\n\nUn assemblage n\'hérite d\'aucune validation : le tout n\'est pas la somme,\n'
        + 'et personne n\'a lu le tout. En attente de validation humaine.'
      : `registre : composer ${artefact.title}\n\n`
        + `Chaîne de ${artefact.steps.length} artefact(s) déjà validés, assemblée par `
        + `${session.username} :\n`
        + artefact.steps.map((e, i) => `  ${i + 1}. ${e.artefact}`).join('\n')
        + '\nEn attente de validation humaine.';

    await forge.putFile(repo, chemin, {
      content: toBase64(tete + toYaml(artefact)), message, branch: 'main'
    });

    msg.className = 'ok';
    msg.textContent = `✔ Déposé pour validation — ${chemin}. ${enAgent()
      ? 'Un relecteur doit l\'accepter avant que quiconque puisse s\'en servir.'
      : 'Elle apparaîtra au catalogue une fois acceptée dans l\'Admin.'}`;
  } catch (error) {
    msg.className = 'err';
    msg.textContent = `✕ ${error.message}`;
  } finally {
    bouton.textContent = libelle;
    majVerdict();
  }
};

charger().catch((error) => {
  $('briques').append(el('div', { className: 'vide-toile', textContent: error.message }));
  $('nbriques').textContent = '—';
});
