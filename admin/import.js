/*
 * Importer un pack de compétences — l'écran qui montre ce qui MANQUE.
 *
 * ── CE QUE CET ÉCRAN N'EST PAS ───────────────────────────────────────────────
 *
 * Ce n'est pas un bouton « importer Mantis ». Il LIT un pack, rend le formulaire de
 * `lib/import-pack.js` rempli de ce qui était déclaré — c'est-à-dire, sur un pack réel,
 * presque rien — et laisse quelqu'un DÉCIDER le reste, champ par champ, en répondant de
 * chaque décision.
 *
 * Ce qui en sort part en `artifacts/pending/`, à `experimental`, comme tout le reste. Le
 * bouton s'appelle « Déposer en attente » et pas « Importer » : il n'y a pas d'import en
 * un clic, il y a une soumission à relire.
 *
 * ── POURQUOI LA PREMIÈRE LIGNE EST « 0 MESURÉE » ─────────────────────────────
 *
 * L'écran naturel annonce « 17 capacités découvertes » en gros et vert, et on clique. Ce
 * chiffre-là ne veut rien dire : découvrir un fichier n'est pas comprendre ce qu'il fait.
 * Les deux chiffres qui engagent sont SANS ZONE D'OMBRE (combien pourraient être
 * gouvernées) et MESURÉE (combien ont passé le banc) — et le second vaut zéro par
 * construction à l'import, parce qu'importer n'est pas mesurer.
 *
 * Ils sont donc en tête, dans cet ordre, et « découvertes » vient après.
 *
 * ── LE COMMIT EST ÉPINGLÉ AVANT LA LECTURE ───────────────────────────────────
 *
 * On résout `main` en SHA D'ABORD, puis on lit l'arbre et les fichiers À CE SHA. Lire
 * `main` trois fois pendant qu'il bouge donnerait un pack composé de trois états
 * différents, et une empreinte qui ne correspond à aucun commit.
 */
import { skillsDansArbre, lirePack, CHAMPS, fiable, MAX_CAPACITES } from '../lib/import-pack.js';
import { versArtefact, resteADecider, DOSSIER_IMPORTE,
         NIVEAU_IMPORTE, AUCUN_OUTIL } from '../lib/import-artefact.js';
import { verdict as verdictIsolement, preuvesPlateforme } from '../lib/executeur.js';
import { contexte } from './contexte.js';
import { knownScopes } from '../app/scopes.js';
import { lint, ERROR } from '../lint/index.js';
import { toYaml } from '../studio/to-yaml.js';
import { provenanceDe, verdictAmont,
         IDENTIQUE, MODIFIE, DISPARU, NON_VERIFIABLE } from '../lib/import-suivi.js';
import { STATUTS, DOSSIERS } from './parc.js';
import yaml from '../lib/yaml.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/** Ce qui a été lu, pour ne pas relire à chaque rendu. */
const vue = { pack: null, charge: false, coupes: 0, lus: 0,
              /* Le corps de chaque `SKILL.md` : c'est lui qui sera CITÉ dans le `spec`. */
              corps: new Map(),
              /* Ce que l'importeur a décidé, par capacité. Rien n'y est pré-rempli. */
              decisions: new Map(),
              /*
               * Le chemin d'UNE capacité à afficher seule — venu du scanner (« ouvrir
               * celle-ci ») ou du suivi (« relire le pack » sur un artefact précis).
               * C'est un filtre d'AFFICHAGE, pas de lecture : le pack entier est lu au
               * commit épinglé, parce que voisins et scripts d'une capacité sont des
               * faits de l'arbre entier. `null` : tout montrer.
               */
              cible: null,
              ctx: null, session: null, repo: null, forge: null };

export const chargeImport = () => vue.charge;

/*
 * SHA-256 par le navigateur, et par lui seul.
 *
 * `lireCapacite` appelle `hacher` de façon SYNCHRONE — un module pur ne doit pas être
 * asynchrone pour une raison de plateforme. On calcule donc toutes les sommes AVANT, et
 * on injecte une fonction de consultation. Si un contenu manque à la table, la fonction
 * rend `null` plutôt qu'une valeur de secours : une empreinte fausse est pire qu'absente.
 */
async function sommeDe(texte) {
  const octets = new TextEncoder().encode(texte);
  const digest = await crypto.subtle.digest('SHA-256', octets);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function flash(message, ok = false) {
  const f = $('imflash');
  f.textContent = message;
  f.className = `show ${ok ? 'ok' : 'err'}`;
}
const effacerFlash = () => { $('imflash').className = ''; };

/**
 * Le `owner/repo` d'une saisie, qu'on ait tapé le chemin ou collé l'URL entière.
 *
 * ── POURQUOI CETTE NORMALISATION EXISTE ─────────────────────────────────────
 *
 * Le premier essai réel a échoué sur `https://github.com/google/mantis` collé tel quel :
 * la forge reçoit l'URL entière comme identifiant de dépôt, ne trouve aucun commit, et
 * rend « aucun commit lisible sur main » — un message qui accuse le dépôt là où c'est la
 * saisie qui n'était pas au bon format. Coller l'URL est le geste NATUREL ; refuser de la
 * comprendre est un défaut, pas une exigence.
 *
 * On accepte donc les deux. On retire l'hôte, le `.git` final et l'ancre — mais on GARDE
 * le chemin entier : GitLab a des sous-groupes, `lcl/paiement/registre` est un dépôt réel
 * et non `lcl/paiement` suivi d'un dossier. On ne coupe qu'aux marqueurs qui séparent
 * sans ambiguïté le dépôt de ce qu'on regarde dedans : `/tree/`, `/blob/`, le `/-/` de
 * GitLab.
 */
export function normaliserDepot(saisie = '') {
  let s = String(saisie).trim().split('#')[0];
  // L'URL, http(s) ou ssh, perd son hôte. Ce qui reste commence au chemin.
  s = s.replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/^git@[^:]+:/i, '');
  // Ce qui suit un marqueur de navigation n'est plus le dépôt : on le retire.
  s = s.replace(/\/(?:-\/)?(?:tree|blob|commits?)\/.*$/i, '');
  return s.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
}

/**
 * Lire un dépôt amont, à un commit épinglé — la mécanique seule, sans écran.
 *
 * Extraite de `lireLePack` le jour où le scanner est arrivé : lui et l'import font
 * EXACTEMENT la même lecture (épingler, lister, lire les `SKILL.md`, hacher), et deux
 * copies auraient fini par lire deux choses différentes. `surEtat` reçoit les lignes de
 * progression ; l'appelant décide où elles s'affichent.
 */
export async function lireAmont(forge, depot, ref, surEtat = () => {}) {
  // 1. Épingler. Tout le reste est lu à CE sha.
  const commits = await forge.listCommits(depot, '', { perPage: 1, ref });
  const commit = commits[0]?.sha;
  if (!commit) throw new Error(`aucun commit lisible sur ${ref}`);

  // 2. L'arborescence. Les voisins d'une capacité sont des CHEMINS : leur présence est
  //    un fait, leur contenu n'est pas notre affaire à cette étape.
  const arbre = await forge.listTree(depot, commit);
  const { chemins, total, coupes } = skillsDansArbre(arbre);
  if (!total) throw new Error('aucun `SKILL.md` dans ce dépôt à ce commit');

  // 3. Les SKILL.md, eux seuls.
  surEtat(`${total} capacité(s) trouvée(s), lecture de ${chemins.length}…`);
  const fichiers = [];
  for (const chemin of chemins) {
    const f = await forge.getFile(depot, chemin, commit);
    if (f) fichiers.push({ chemin, contenu: f.content });
  }

  // 4. Les sommes, puis la lecture mécanique.
  const sommes = new Map();
  for (const f of fichiers) sommes.set(f.contenu, await sommeDe(f.contenu));

  /*
   * L'arbre ENTIER entre dans `lirePack` : c'est lui qui porte les voisins d'une
   * capacité, et la présence d'un script à côté d'un `SKILL.md` est un fait qu'on ne
   * veut pas perdre. Seuls les `SKILL.md` réellement lus portent un contenu ; un
   * `SKILL.md` que la forge n'a pas rendu est ÉCARTÉ plutôt que passé vide, sans quoi
   * il se lirait « cette capacité ne déclare rien ».
   */
  const lus = new Map(fichiers.map((f) => [f.chemin, f.contenu]));
  const entrants = arbre
    .filter((chemin) => !/(^|\/)SKILL\.md$/i.test(chemin) || lus.has(chemin))
    .map((chemin) => ({ chemin, contenu: lus.get(chemin) ?? '' }));

  const pack = lirePack({
    fichiers: entrants,
    source: `${depot}@${ref}`,
    commit,
    // Consultation, pas calcul : le module est synchrone, `crypto.subtle` ne l'est pas.
    // Un contenu absent de la table rend `null` — une empreinte fausse est pire qu'absente.
    hacher: (contenu) => sommes.get(contenu) ?? null
  });
  return { pack, fichiers, coupes };
}

/** Lire le pack, à un commit épinglé. `cible` : n'afficher que cette capacité. */
export async function lireLePack(forge, { session, repo, cible = null } = {}) {
  if (session) { vue.session = session; vue.repo = repo; vue.forge = forge; }
  // Se remet à CHAQUE lecture : relire à la main, c'est demander tout le pack.
  vue.cible = cible;
  const depot = normaliserDepot($('imdepot').value);
  const ref = $('imref').value.trim() || 'main';
  if (!depot) return flash('Indique un dépôt, par exemple `google/mantis`.');

  effacerFlash();
  $('imbtn').disabled = true;
  $('imetat').textContent = `Lecture de ${depot}@${ref}…`;
  $('imcorps').replaceChildren();

  try {
    const { pack, fichiers, coupes } =
      await lireAmont(forge, depot, ref, (m) => { $('imetat').textContent = m; });

    vue.pack = pack;
    // Le CORPS de chaque capacité, gardé pour la citation du `spec` (I004). Il ne
    // transite jamais par `lirePack`, qui n'en a pas l'usage.
    vue.corps = new Map(fichiers.map((f) => [f.chemin, decouperCorps(f.contenu)]));
    vue.decisions = new Map();
    vue.coupes = coupes;
    vue.lus = fichiers.length;
    vue.charge = true;
    vue.ctx = await contexte();
    rendre();
  } catch (error) {
    $('imetat').textContent = '';
    flash(`Lecture impossible : ${error.message}`);
  } finally {
    $('imbtn').disabled = false;
  }
}

/* ── Le rendu ──────────────────────────────────────────────────────────────── */

function rendre() {
  const { pack } = vue;
  const r = pack.resume;

  $('imetat').textContent = `${pack.source} · commit ${pack.commit.slice(0, 8)}`
    + (vue.coupes ? ` · ${vue.coupes} capacité(s) non lue(s), au-delà de ${MAX_CAPACITES}` : '');

  const corps = $('imcorps');
  corps.replaceChildren();

  /*
   * Les chiffres, DANS CET ORDRE. Le premier est celui qui refuse de faire cliquer.
   *
   * `mesurees` porte la classe `mauvais` alors qu'il n'y a aucune erreur : ce n'est pas
   * un échec, c'est un état. Le rouge dit « ne t'appuie pas là-dessus », ce qui est
   * exactement le message — un pack fraîchement lu n'a rien prouvé.
   */
  const chiffres = el('div', { className: 'chiffres' });
  const chiffre = (valeur, titre, classe, note) => {
    const c = el('div', { className: `chiffre ${classe || ''}` });
    c.append(el('b', { textContent: String(valeur) }), el('span', { textContent: titre }));
    if (note) c.append(el('small', { textContent: note }));
    chiffres.append(c);
  };
  chiffre(r.mesurees, 'mesurées', 'mauvais',
    'Aucune capacité importée n\'a passé le banc. Ce chiffre vaut zéro à l\'import, toujours.');
  chiffre(r.sansZoneDombre, 'sans zone d\'ombre',
    r.sansZoneDombre ? 'moyen' : 'mauvais',
    'Tous les champs qui portent un droit sont lus ou imposés. Ça ne veut pas dire prête.');
  chiffre(r.decouvertes, 'découvertes', '',
    'Des fichiers trouvés. Trouver n\'est pas comprendre.');
  chiffre(r.isolementNonResolu, 'isolement non résolu', r.isolementNonResolu ? 'moyen' : '',
    'Ce qu\'il faut leur interdire n\'est écrit nulle part en machine.');
  chiffre(r.outilsNonResolus, 'outils non résolus', r.outilsNonResolus ? 'moyen' : '',
    'Aucune correspondance dans notre registre d\'outils.');
  chiffre(r.avecScripts, 'avec des scripts', r.avecScripts ? 'moyen' : '',
    'Elles embarquent du code exécutable : ce ne sont pas des prompts.');
  corps.append(chiffres);

  const cadre = el('div', { className: 'alerte' });
  cadre.innerHTML = 'Rien n\'a été écrit dans le registre. Cet écran <b>lit</b> un pack et '
    + 'montre ce que ses fichiers déclarent — donc ce qu\'il faudra remplir à la main avant '
    + 'que quoi que ce soit puisse être lancé. Un champ tiré de la prose ne rendra jamais '
    + 'une capacité exécutable.';
  corps.append(cadre);

  if (r.illisibles) {
    const a = el('div', { className: 'alerte' });
    a.textContent = `${r.illisibles} fichier(s) ont un en-tête illisible. « Illisible » n'est `
      + 'pas « vide » : on n\'a pas su lire, on ne sait pas si la capacité déclarait quelque chose.';
    corps.append(a);
  }

  corps.append(el('h3', { className: 'sous', textContent: 'Les capacités, et ce qui leur manque' }));

  /*
   * Le ciblage filtre L'AFFICHAGE, jamais la lecture : les chiffres ci-dessus décrivent
   * le pack ENTIER, au commit épinglé, et restent vrais. Une cible qui n'existe plus à
   * ce commit — l'amont a bougé entre le scan et l'ouverture — se DIT au lieu de
   * retomber en silence sur tout le pack : on croirait avoir ouvert ce qu'on a cliqué.
   */
  let montrees = pack.capacites;
  if (vue.cible) {
    montrees = pack.capacites.filter((c) => c.chemin === vue.cible);
    const note = el('div', { className: 'alerte' });
    if (montrees.length) {
      note.append(`Une seule capacité affichée — les chiffres ci-dessus décrivent le pack `
        + `entier (${pack.capacites.length} capacité(s)). `);
      const tout = el('button', { className: 'btn',
        textContent: `Montrer les ${pack.capacites.length}` });
      tout.onclick = () => { vue.cible = null; rendre(); };
      note.append(tout);
    } else {
      note.append(`\`${vue.cible}\` n'est plus dans le pack au commit épinglé `
        + `${pack.commit.slice(0, 8)} — l'amont a bougé depuis le scan. `
        + 'Voici le pack tel qu\'il est aujourd\'hui.');
      montrees = pack.capacites;
    }
    corps.append(note);
  }

  for (const c of montrees) corps.append(carteCapacite(c));
  // Après insertion dans le document : `rendreVerdict` cherche son conteneur par sélecteur.
  for (const c of montrees) rendreVerdict(c);

  const note = el('p', { className: 'note-bas' });
  note.textContent = pack.schema
    ? 'Le pack porte un `schema.json` à la racine. Il normalise les données entre étapes ; '
    + 'on note sa présence, on n\'en tire encore aucun contrat de sortie.'
    : 'Le pack ne porte pas de `schema.json` : rien de machine-readable ne décrit ses sorties.';
  corps.append(note);
}

function carteCapacite(c) {
  const row = el('div', { className: 'row' });

  const titre = el('h3');
  titre.append(document.createTextNode(c.champs.id.valeur || c.chemin));
  titre.append(el('span', {
    className: `pill ${c.gouvernable ? 'ok' : 'ko'}`,
    textContent: c.gouvernable ? 'sans zone d\'ombre' : `${c.manquants.length} champ(s) manquant(s)`
  }));
  if (c.scripts.length) {
    titre.append(el('span', { className: 'pill write',
                              textContent: `${c.scripts.length} script(s)` }));
  }
  if (c.illisible) titre.append(el('span', { className: 'pill ko', textContent: 'en-tête illisible' }));
  row.append(titre);

  row.append(el('p', { className: 'purpose', textContent: c.champs.titre.valeur || '—' }));

  const facts = el('div', { className: 'facts' });
  facts.append(el('span', { textContent: c.chemin }));
  const emp = c.champs.empreinte;
  facts.append(el('span', { textContent: fiable(emp.origine) && emp.valeur?.sha
    ? `sha256 ${emp.valeur.sha.slice(0, 12)}` : 'empreinte manquante' }));
  row.append(facts);

  /*
   * LE FORMULAIRE. Chaque champ manquant devient un contrôle, précédé de son POURQUOI.
   *
   * « isolement : manquant » ne convainc personne de remplir quoi que ce soit ; « le
   * déduire d'une phrase anglaise serait accorder un droit sur une lecture » convainc. La
   * raison n'est pas une aide contextuelle qu'on replie : elle est au-dessus du champ,
   * toujours visible, parce que c'est elle qui fait remplir sérieusement.
   *
   * RIEN N'EST PRÉ-REMPLI. Pas de valeur par défaut sur ce qui porte un droit — un défaut
   * se valide sans être lu, et c'est exactement ce qu'on ne veut pas ici.
   */
  const d = decisionsDe(c);
  const bloc = el('div', { className: 'bloc' });

  /*
   * L'EN-TÊTE PORTE LE BOUTON « PROPOSER » — pas « Remplir automatiquement ».
   *
   * Le modèle lit la prose et propose avec preuves ; `lib/import-proposer.js` vérifie
   * chaque citation mécaniquement ; et la sortie sépare structurellement ce que l'écran
   * a le droit de POSER (les descriptions) de ce qu'il ne peut qu'AFFICHER (les droits).
   * C'est I003 en action : `deduit` ne rend rien lançable — il attend un clic humain.
   */
  const entete = el('div', { className: 'ligne-decider' });
  entete.append(el('h4', { textContent: 'À décider — et c\'est toi qui en réponds' }));
  const proposerBtn = el('button', { className: 'btn ghost',
                                     textContent: '🪄 Proposer depuis le texte' });
  proposerBtn.onclick = () => proposerPour(c, proposerBtn);
  entete.append(proposerBtn);
  bloc.append(entete);

  const hote = el('div');
  hote.dataset.propositions = c.chemin;
  bloc.append(hote);

  for (const def of CHAMPS.filter((x) => x.requis && !fiable(c.champs[x.nom].origine))) {
    bloc.append(controle(c, def, d));
  }
  row.append(bloc);

  /*
   * Les champs FACULTATIFS dont la prose parle quand même.
   *
   * `depend_de` n'est pas requis — une capacité seule est légitime. Mais mantis-review
   * écrit « It depends on mantis-reproduce having completed », et ne montrer que les
   * champs requis ferait disparaître cette phrase de l'écran : on importerait une brique
   * en croyant qu'elle est autonome. Bloc séparé, sans « il faut » : c'est une invitation
   * à regarder, pas une exigence.
   */
  const bavards = CHAMPS.filter((def) => !def.requis
    && !fiable(c.champs[def.nom].origine)
    && (c.champs[def.nom].indices || []).length > 0);
  if (bavards.length) {
    const b = el('div', { className: 'bloc' });
    b.append(el('h4', { textContent: 'Non requis, mais le texte en parle' }));
    const ul = el('ul', { className: 'plain' });
    for (const def of bavards) {
      const li = el('li');
      li.append(el('b', { textContent: def.quoi }));
      const ind = el('div', { className: 'contra' });
      for (const i of c.champs[def.nom].indices) {
        ind.append(el('blockquote', { textContent: `ligne ${i.ligne} · ${i.quoi}\n${i.extrait}` }));
      }
      li.append(ind);
      ul.append(li);
    }
    b.append(ul);
    row.append(b);
  }

  if (c.scripts.length) {
    const s = el('div', { className: 'bloc' });
    s.append(el('h4', { textContent: 'Code exécutable dans son dossier' }));
    const ul = el('ul', { className: 'plain' });
    for (const chemin of c.scripts) {
      const li = el('li');
      li.append(el('code', { textContent: chemin }));
      ul.append(li);
    }
    s.append(ul);
    row.append(s);
  }

  // Le verdict et le bouton vivent dans leur propre conteneur : ils se redessinent à
  // chaque frappe, la carte non.
  const verdict = el('div');
  verdict.dataset.verdict = c.chemin;
  row.append(verdict);

  return row;
}

/* ── Le formulaire ─────────────────────────────────────────────────────────── */

/** Le corps d'un `SKILL.md` : tout ce qui suit le front-matter. */
function decouperCorps(contenu = '') {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(String(contenu));
  return m ? m[1] : String(contenu);
}

/** Les décisions de cette capacité, créées vides à la première visite. */
function decisionsDe(c) {
  if (!vue.decisions.has(c.chemin)) {
    vue.decisions.set(c.chemin, { perimetre: perimetreParDefaut() });
  }
  return vue.decisions.get(c.chemin);
}

/*
 * Le périmètre est le SEUL champ pré-rempli, et il mérite sa justification : il ne vient
 * pas de l'amont et ne décrit pas la capacité — il dit qui, chez nous, en répond. Le
 * pré-remplir avec le premier périmètre connu ferait attribuer une responsabilité par
 * défaut, ce qui est précisément ce qu'on refuse ailleurs. Il reste donc VIDE si le
 * registre en connaît plusieurs, et n'est rempli que s'il n'y a pas de choix à faire.
 */
function perimetreParDefaut() {
  const connus = knownScopes(vue.ctx?.tools || []);
  return connus.length === 1 ? connus[0] : '';
}

/** Un champ du formulaire : son pourquoi, ses indices, son contrôle. */
function controle(c, def, d) {
  const box = el('div', { className: 'champ' });
  box.dataset.champ = def.nom;
  box.append(el('label', { textContent: def.quoi }));
  box.append(el('p', { className: 'pourquoi', textContent: def.pourquoi }));

  const indices = c.champs[def.nom].indices || [];
  if (indices.length) {
    const ind = el('div', { className: 'contra' });
    ind.append(el('div', { className: 'ou',
                           textContent: 'indices dans le texte — à lire, pas à convertir' }));
    for (const i of indices) {
      ind.append(el('blockquote', { textContent: `ligne ${i.ligne} · ${i.quoi}\n${i.extrait}` }));
    }
    box.append(ind);
  }

  box.append(champSaisie(c, def, d));
  return box;
}

function champSaisie(c, def, d) {
  const majAffichage = () => rendreVerdict(c);

  if (def.nom === 'isolement') return selectIsolement(d, majAffichage);
  if (def.nom === 'ecrit') return selectEcrit(d, majAffichage);
  if (def.nom === 'outils') return casesOutils(d, majAffichage);

  const t = el('textarea', { className: 'saisie', rows: 2, value: d[def.nom] || '' });
  t.oninput = () => { d[def.nom] = t.value; majAffichage(); };
  return t;
}

/*
 * L'isolement : une liste FERMÉE, lue du registre — et l'étiquette est CALCULÉE.
 *
 * Ce qui n'est pas tenu est listé quand même, et étiqueté. Le masquer donnerait un menu
 * où tout est possible et laisserait croire que la plateforme sait tout faire respecter —
 * alors qu'elle ne sait tenir aucun des deux qui comptent pour Mantis. Le voir marqué est
 * une information ; ne pas le voir est un mensonge par omission.
 *
 * L'étiquette vient de `lib/executeur.js`, jamais d'un booléen du registre : le jour où
 * une attestation entre dans `attestations/`, ce menu change tout seul.
 */
function selectIsolement(d, maj) {
  const s = el('select', { className: 'stsel large' });
  s.append(el('option', { value: '', textContent: '— à choisir —' }));
  for (const i of vue.ctx.isolements) {
    const v = verdictIsolement(i, { etablies: preuvesPlateforme({ outils: vue.ctx.tools }),
                                    attestations: vue.ctx.attestations });
    s.append(el('option', {
      value: i.id,
      textContent: v.tenable ? i.titre
        : `${i.titre} — ${v.issue === 'non_applicable' ? 'NON TENU' : 'NON VÉRIFIABLE'} aujourd'hui`
    }));
  }
  s.value = d.isolement || '';
  s.onchange = () => { d.isolement = s.value; maj(); };
  return s;
}

function selectEcrit(d, maj) {
  const s = el('select', { className: 'stsel large' });
  s.append(el('option', { value: '', textContent: '— à choisir —' }));
  for (const e of vue.ctx.ecritures) {
    s.append(el('option', { value: e.id,
      textContent: e.confirmation ? `${e.titre} — confirmation humaine à chaque appel` : e.titre }));
  }
  s.value = d.ecrit || '';
  s.onchange = () => { d.ecrit = s.value; maj(); };
  return s;
}

/*
 * Les outils : des cases, et RIEN pour en taper un.
 *
 * I001, rendu par la forme du contrôle. Un champ de saisie libre inviterait à écrire
 * « docker » — ce que Mantis utilise — et l'import serait refusé après coup, ce qui se
 * lirait comme un bug. Des cases disent la vérité tout de suite : ce que la plateforme
 * sait faire est cette liste, et ajouter `docker` est une décision qui se prend ailleurs.
 */
function casesOutils(d, maj) {
  const box = el('div', { className: 'cases' });
  d.outils = d.outils || [];

  /*
   * « AUCUN OUTIL » EST UNE DÉCISION. Défaut trouvé à l'usage : une capacité dont tout
   * arrive par la matière n'a besoin de rien, et le formulaire forçait à cocher une case
   * quand même — c'est-à-dire à accorder un droit pour rien. La case se comporte en
   * exclusive : la cocher décoche le reste, cocher un outil la décoche.
   */
  const aucune = el('label', { className: 'case aucune' });
  const cbAucun = el('input', { type: 'checkbox', checked: d.outils.includes(AUCUN_OUTIL) });
  cbAucun.onchange = () => {
    d.outils = cbAucun.checked ? [AUCUN_OUTIL] : [];
    for (const autre of box.querySelectorAll('input')) {
      if (autre !== cbAucun) autre.checked = false;
    }
    maj();
  };
  aucune.append(cbAucun, el('b', { textContent: 'Aucun outil' }),
    el('span', { textContent: '— tout ce qu\'elle reçoit arrive par la matière collée' }));
  box.append(aucune);

  for (const t of vue.ctx.tools) {
    const lab = el('label', { className: 'case' });
    const cb = el('input', { type: 'checkbox', checked: d.outils.includes(t.id) });
    cb.onchange = () => {
      d.outils = cb.checked ? [...d.outils.filter((x) => x !== AUCUN_OUTIL), t.id]
                            : d.outils.filter((x) => x !== t.id);
      if (cb.checked) cbAucun.checked = false;
      maj();
    };
    lab.append(cb, el('code', { textContent: t.id }),
               el('span', { className: `pill ${t.mode === 'write' ? 'write' : 'read'}`,
                            textContent: t.mode }));
    box.append(lab);
  }
  const note = el('p', { className: 'pourquoi',
    textContent: 'Cette liste est le registre des outils. Il n\'y a pas de champ pour en '
      + 'taper un autre : un outil qui n\'y est pas n\'est pas un droit qu\'un import peut '
      + 'accorder.' });
  box.append(note);
  return box;
}

/* ── Le verdict, et le dépôt ───────────────────────────────────────────────── */

/**
 * Ce qui bloque, ce qui prévient, et le bouton.
 *
 * Recalculé à chaque frappe : découvrir les refus un par un à chaque tentative de dépôt
 * ferait remplir le formulaire au hasard jusqu'à ce que ça passe.
 */
function rendreVerdict(c) {
  const hote = document.querySelector(`[data-verdict="${cssEchappe(c.chemin)}"]`);
  if (!hote) return;
  hote.replaceChildren();

  const d = decisionsDe(c);
  const { artefact, refus: problemes } = fabriquer(c, d);
  const bloquants = problemes.filter((p) => p.bloquant);

  /*
   * Les champs pas encore remplis tiennent sur UNE ligne.
   *
   * Leur raison est déjà écrite au-dessus, sur le champ lui-même. La répéter en bas
   * doublait la hauteur de chaque carte et noyait les vrais problèmes — un outil hors
   * registre, une écriture sans outil pour écrire — sous cinq blocs qui ne disaient rien
   * de neuf. Ce qui se lit deux fois ne se lit pas.
   */
  const vides = problemes.filter((p) => p.genre === 'vide');
  const conflits = problemes.filter((p) => p.genre !== 'vide');

  /*
   * LES MANQUANTS SONT NOMMÉS, CLIQUABLES, ET MARQUÉS SUR PLACE.
   *
   * La première version disait « 1 champ(s) à décider ci-dessus » — sans dire lequel,
   * sur une carte de deux écrans de haut. Vécu à l'usage : tout SEMBLAIT rempli, et
   * l'importeur cherchait à l'œil un select resté sur « — à choisir — ». Un compte sans
   * nom est une chasse au trésor. Maintenant : le nom, un clic qui y mène, et un liseré
   * rouge sur le champ lui-même.
   */
  const manquants = resteADecider(c, d);
  const row = hote.closest('.row');
  for (const champEl of row?.querySelectorAll('.champ') || []) {
    champEl.classList.toggle('manque',
      manquants.some((m) => m.nom === champEl.dataset.champ));
  }

  if (vides.length) {
    const box = el('div', { className: 'coherence flou' });
    box.append(el('b', { textContent: `Reste à décider : `
      + manquants.map((m) => NOMS_CHAMPS[m.nom] || m.nom).join(' · ') }));
    box.append(document.createTextNode('Tant qu\'il en reste un, la capacité n\'est pas '
      + 'gouvernable — et ce qui n\'est pas gouvernable ne se dépose pas. '));
    for (const m of manquants) {
      const lien = el('a', { href: '#', textContent: `→ ${NOMS_CHAMPS[m.nom] || m.nom}` });
      lien.onclick = (e) => {
        e.preventDefault();
        const cible = row?.querySelector(`.champ[data-champ="${m.nom}"]`);
        if (cible) {
          cible.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cible.classList.remove('clignote');
          requestAnimationFrame(() => cible.classList.add('clignote'));
        }
      };
      box.append(lien, document.createTextNode(' '));
    }
    hote.append(box);
  }

  for (const p of conflits) {
    const box = el('div', { className: `coherence ${p.bloquant ? 'flou' : 'ko'}` });
    box.append(el('b', { textContent: p.quoi }), document.createTextNode(p.detail));
    hote.append(box);
  }

  /* Le périmètre : qui, chez nous, en répond. Il n'est pas dans le formulaire des champs
     lus parce qu'il ne vient pas de l'amont — c'est notre organisation, pas la leur. */
  const pied = el('div', { className: 'acts' });
  const per = el('select', { className: 'stsel' });
  per.append(el('option', { value: '', textContent: '— périmètre —' }));
  for (const s of knownScopes(vue.ctx.tools)) per.append(el('option', { value: s, textContent: s }));
  per.value = d.perimetre || '';
  per.onchange = () => { d.perimetre = per.value; rendreVerdict(c); };
  pied.append(per);

  const pal = el('select', { className: 'stsel' });
  for (const t of vue.ctx.paliers) pal.append(el('option', { value: t, textContent: t }));
  /* Le palier le moins cher par défaut. Aucun `SKILL.md` n'en déclare : en attribuer un
     gros « parce que ça raisonne » multiplierait la facture sur une intuition. */
  pal.value = d.modele || vue.ctx.paliers[0];
  d.modele = pal.value;
  pal.onchange = () => { d.modele = pal.value; };
  pied.append(pal);

  pied.append(el('span', { className: 'sp' }));

  const bouton = el('button', { className: 'btn pub',
                                textContent: d._depose ? 'Déposée en attente ✔'
                                  : `Déposer en attente (${NIVEAU_IMPORTE})` });
  bouton.disabled = Boolean(d._depose) || Boolean(bloquants.length) || !d.perimetre || !artefact;
  bouton.onclick = () => deposer(c, bouton);
  pied.append(bouton);
  if (d._depose) {
    pied.append(el('span', { className: 'pourquoi',
      textContent: `${d._depose} — la suite se joue dans « À valider ».` }));
  }

  if (!d.perimetre) {
    pied.append(el('span', { className: 'pourquoi',
                             textContent: 'Choisis un périmètre : c\'est lui qui décide des outils autorisés.' }));
  }
  hote.append(pied);
}

const cssEchappe = (s) => String(s).replace(/["\\]/g, '\\$&');

/** L'artefact, ou les raisons pour lesquelles il n'y en a pas. */
function fabriquer(c, d) {
  return versArtefact({
    capacite: c, decisions: d, corps: vue.corps.get(c.chemin) || '', pack: vue.pack,
    outils: vue.ctx.tools, isolements: vue.ctx.isolements, ecritures: vue.ctx.ecritures,
    attestations: vue.ctx.attestations,
    personne: vue.session?.username || '', perimetre: d.perimetre || ''
  });
}

/**
 * Déposer en attente.
 *
 * Le linter passe AVANT l'écriture, avec les vrais registres. Un artefact qui ne franchit
 * pas la porte n'a rien à faire dans `pending/` : il y attendrait une validation humaine
 * que la machine refuse déjà.
 */
/*
 * ── LE RÉSULTAT S'AFFICHE LÀ OÙ ON A CLIQUÉ ─────────────────────────────────
 *
 * Vécu à l'usage : « quand je clique sur Déposer, ça fait rien ». Il se passait
 * TOUT — le lint tournait, le refus ou le succès s'affichait… dans le bandeau en HAUT
 * de la page, à deux écrans du bouton. Et un artefact refusé sortait par un `return`
 * muet. Trois chemins, trois silences vus du bouton.
 *
 * Règle d'écran, désormais : tout ce que ce bouton provoque se dit À CÔTÉ de lui. Le
 * bandeau du haut reste alimenté — il sert à qui remonte — mais il n'est plus le seul.
 */
async function deposer(c, bouton) {
  const d = decisionsDe(c);
  bouton.disabled = true;
  bouton.textContent = '… dépôt en cours';
  effacerFlash();

  let resultat;
  try {
    const { artefact, entete, refus: problemes } = fabriquer(c, d);
    if (!artefact) {
      resultat = { ok: false, texte: 'Rien n\'est parti : '
        + problemes.filter((p) => p.bloquant).map((p) => p.quoi).join(' · ') };
      return;
    }

    const rapport = lint(artefact, vue.ctx);
    if (rapport.blocked) {
      const erreurs = rapport.findings.filter((f) => f.severity === ERROR)
        .map((f) => `${f.code} ${f.message}`).join(' · ');
      resultat = { ok: false, texte: `La porte est fermée : ${erreurs}` };
      return;
    }
    if (!vue.repo) {
      resultat = { ok: false, texte: 'Aucun dépôt de registre choisi — reviens à l\'accueil '
        + 'pour le sélectionner.' };
      return;
    }

    const chemin = `${DOSSIER_IMPORTE}/${artefact.id}.yaml`;
    await vue.forge.putFile(vue.repo, chemin, {
      content: base64(entete + toYaml(artefact)),
      message: `registre : importer ${artefact.id} depuis ${vue.pack.source}\n\n`
             + `Capacité lue dans ${c.chemin} au commit ${vue.pack.commit}.\n`
             + 'Deux champs viennent de l\'amont — nom et description. Les autres ont été '
             + `décidés par ${vue.session?.username || 'l\'importeur'}.\n`
             + 'Le `spec` contient le document de l\'amont, CITÉ entre délimiteurs : c\'est '
             + 'du markdown écrit par un tiers, et c\'est là qu\'une injection se verrait.\n'
             + `Niveau ${NIVEAU_IMPORTE}, aucune mesure au banc.\n`
             + `Lint : ${rapport.errors} erreur(s), ${rapport.warnings} avertissement(s).`,
      branch: 'main'
    });
    // L'état de la carte change : déposée, elle ne se redépose pas d'un double-clic.
    d._depose = chemin;
    resultat = { ok: true, texte: `✔ Déposée — ${chemin}. Elle attend une validation `
      + 'humaine dans « À valider ».' };
  } catch (error) {
    resultat = { ok: false, texte: `Dépôt impossible : ${error.message}` };
  } finally {
    rendreVerdict(c);
    const hote = document.querySelector(`[data-verdict="${cssEchappe(c.chemin)}"]`);
    if (hote && resultat) {
      const box = el('div', { className: `coherence ${resultat.ok ? 'ok' : 'flou'}` });
      box.append(el('b', { textContent: resultat.ok ? 'Déposée' : 'Pas déposée' }),
        document.createTextNode(resultat.texte));
      hote.prepend(box);
    }
    if (resultat) flash(resultat.texte, resultat.ok);
  }
}

/* `btoa` ne prend que du latin-1 : un `é` dans une description le fait lever. */
function base64(texte) {
  const octets = new TextEncoder().encode(texte);
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin);
}

/* ── Le proposeur ──────────────────────────────────────────────────────────── */

/** Les libellés des champs, pour parler à l'humain — pas en identifiants. */
const NOMS_CHAMPS = { entrees: 'Ce qu\'elle lit', sorties: 'Ce qu\'elle produit',
                      ecrit: 'Ce qu\'elle modifie', outils: 'Les outils',
                      isolement: 'L\'isolement' };

/**
 * Demander des propositions au modèle, puis les poser SELON LEUR CLASSE.
 *
 * Les descriptives remplissent le textarea — marquées, l'humain relit. Les droits
 * s'affichent en face du contrôle avec leur citation et leur ligne : c'est à l'humain
 * de cliquer, et rien dans cette fonction ne touche un select ni une case.
 */
async function proposerPour(c, bouton) {
  const hote = document.querySelector(`[data-propositions="${cssEchappe(c.chemin)}"]`);
  if (!hote) return;
  bouton.disabled = true;
  bouton.textContent = '… le modèle lit';
  hote.replaceChildren();

  let r;
  try {
    const reponse = await fetch('/api/proposer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ corps: vue.corps.get(c.chemin) || '', chemin: c.chemin })
    });
    r = await reponse.json();
    if (!reponse.ok) throw new Error(r.erreur || `statut ${reponse.status}`);
  } catch (error) {
    hote.append(el('div', { className: 'coherence flou',
      textContent: `Le proposeur n'a pas répondu : ${error.message}. Le formulaire se `
        + 'remplit très bien sans lui.' }));
    bouton.disabled = false;
    bouton.textContent = '🪄 Proposer depuis le texte';
    return;
  }

  const d = decisionsDe(c);
  const faits = [];

  if (r.illisible) {
    hote.append(el('div', { className: 'coherence flou',
      textContent: 'Le modèle n\'a rien rendu d\'exploitable — ce qui n\'est pas « rien à '
        + 'proposer ». Réessaie, ou remplis à la main.' }));
  }

  /*
   * L'ALERTE D'ABORD. Si le document contient une phrase qui s'adresse à l'importeur,
   * c'est la première chose que l'humain doit lire — avant toute proposition.
   */
  if (r.alerte) {
    hote.append(el('div', { className: 'coherence ko' },));
    const a = hote.lastChild;
    a.append(el('b', { textContent: 'Le document semble s\'adresser à l\'importeur' }),
      document.createTextNode(`${r.alerte} Un document n'a pas d'ordres à donner à `
        + 'l\'import : lis ce passage avec cette idée en tête.'));
  }

  // Les DESCRIPTIVES : posées dans le champ, et dites.
  for (const p of r.preremplissages || []) {
    d[p.champ] = p.valeur;
    d._proposes = [...new Set([...(d._proposes || []), p.champ])];
    faits.push(`${NOMS_CHAMPS[p.champ]} — pré-rempli depuis la ligne ${p.ligne}`);
  }

  // Les DROITS : affichés, jamais cliqués.
  for (const p of r.suggestions || []) {
    const box = el('div', { className: 'coherence ok suggestion' });
    box.append(el('b', { textContent: `${NOMS_CHAMPS[p.champ]} — le modèle suggère : `
      + `${Array.isArray(p.valeur) ? p.valeur.join(', ') : p.valeur}` }));
    box.append(document.createTextNode(
      `D'après la ligne ${p.ligne} : « ${p.citation} »`
      + `${p.partielle ? ' (fragment vérifié de sa citation)' : ''}. ${p.pourquoi} `));
    box.append(el('i', { textContent: 'À toi de cliquer — une suggestion n\'est pas un droit.' }));
    hote.append(box);
  }

  /*
   * LES JETÉES SE MONTRENT — comme jetées.
   *
   * La première version n'affichait qu'un compte, et le premier essai réel a tout jeté :
   * l'humain voyait « 4 jetées » et des champs vides, sans rien pour comprendre ni pour
   * repartir. Montrer la valeur BARRÉE avec sa raison ne la promeut pas — l'écran dit
   * précisément « sans preuve vérifiable » — mais elle informe : une bonne description
   * mal citée se recopie à la main en dix secondes, et ce choix-là appartient à l'humain.
   */
  if ((r.jetees || []).length) {
    const box = el('div', { className: 'coherence flou jetees' });
    box.append(el('b', { textContent: `${r.jetees.length} proposition(s) jetée(s) au crible `
      + '— sans preuve vérifiable dans le document' }));
    const ul = el('ul', { className: 'plain' });
    for (const j of r.jetees) {
      const li = el('li');
      li.append(el('s', { textContent: `${NOMS_CHAMPS[j.champ] || j.champ} : `
        + `${Array.isArray(j.valeur) ? j.valeur.join(', ') : String(j.valeur ?? '')}` }));
      li.append(document.createTextNode(` — ${j.raison}`));
      ul.append(li);
    }
    box.append(ul, el('i', { textContent: 'Rien de tout ceci n\'est appliqué. Si une valeur '
      + 'te semble juste malgré tout, c\'est TOI qui la tapes — en le sachant.' }));
    hote.append(box);
  }

  if (faits.length) {
    hote.append(el('div', { className: 'coherence flou' }));
    const f = hote.lastChild;
    f.append(el('b', { textContent: 'Proposé par le modèle — relis avant de déposer' }),
      document.createTextNode(`${faits.join(' · ')}. Ces textes sont dans les champs `
        + 'ci-dessous : ils se corrigent comme n\'importe quelle saisie.'));
  }

  bouton.disabled = false;
  bouton.textContent = '🪄 Proposer encore';
  // Re-rendre la carte pour que les textareas montrent les valeurs posées.
  rendreCarte(c);
}

/**
 * Re-rendre les CHAMPS d'une carte sans toucher au bloc de propositions.
 *
 * Les textareas sont recréés par `controle()` : après un pré-remplissage, le plus simple
 * honnête est de les resservir depuis `decisions` — c'est la même source que le dépôt.
 */
function rendreCarte(c) {
  const d = decisionsDe(c);
  const row = document.querySelector(`[data-propositions="${cssEchappe(c.chemin)}"]`)
    ?.closest('.row');
  if (!row) return;
  for (const ta of row.querySelectorAll('.champ textarea')) {
    // L'ordre des textareas suit l'ordre des CHAMPS requis manquants : entrees, sorties.
    const noms = CHAMPS.filter((x) => x.requis && !fiable(c.champs[x.nom].origine))
      .filter((x) => ['entrees', 'sorties'].includes(x.nom)).map((x) => x.nom);
    const idx = [...row.querySelectorAll('.champ textarea')].indexOf(ta);
    if (noms[idx] && d[noms[idx]] !== undefined) ta.value = d[noms[idx]];
  }
  rendreVerdict(c);
}

/* ══ Déjà importés — suivre l'amont ═════════════════════════════════════════
 *
 * Le bouton CONSTATE, il ne met jamais à jour. La provenance de chaque artefact
 * importé (dépôt, référence, commit épinglé, fichier cité, empreinte) vit dans les
 * commentaires de tête que `enteteDe` a écrits — le parseur YAML les jette, le
 * FICHIER les garde, et `provenanceDe` les relit depuis le texte brut. Le verdict
 * compare le fichier CITÉ, pas la tête du dépôt : l'HEAD d'un dépôt actif bouge
 * tous les jours pour des fichiers qui ne nous regardent pas.
 *
 * Le seul geste offert quand l'amont a bougé est « Relire le pack » : il remplit le
 * formulaire d'import et TOUT le circuit se rejoue — proposeur, crible, dépôt en
 * attente, validation. La nouvelle version n'hérite de rien.
 */
const suivi = { entrees: [], charge: false };

const icDe = (kind) => kind === 'prompt'
  ? el('span', { className: 'ic-salsi' })
  : document.createTextNode(kind === 'chain' ? '🔗' : '🤖');

/** Les artefacts à provenance d'import, relus depuis leur texte BRUT, dossier par dossier. */
async function chargerSuivi() {
  const etat = $('imsuivietat');
  const entrees = [];
  const pannes = [];

  for (const [statut, dossier] of DOSSIERS) {
    let fichiers = [];
    try {
      fichiers = (await vue.forge.listFiles(vue.repo, dossier))
        .filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));
    } catch (error) {
      // Un dossier absent est un parc sans retrait, pas une panne. Mais on la note :
      // si TOUS les dossiers échouent, « aucun import » serait un mensonge de réseau.
      pannes.push(`${dossier} : ${error.message}`);
      continue;
    }
    for (const f of fichiers) {
      etat.textContent = `Lecture de ${f.path}…`;
      const brut = await vue.forge.getFile(vue.repo, f.path).catch(() => null);
      const prov = provenanceDe(brut?.content || '');
      if (!prov) continue;                  // écrit à la main : pas d'amont à suivre
      let artefact = null;
      try { artefact = yaml.parse(brut.content); } catch { /* illisible : montré quand même */ }
      entrees.push({ path: f.path, statut, prov, artefact });
    }
  }

  etat.textContent = '';
  if (pannes.length === DOSSIERS.length) {
    throw new Error(`aucun dossier lisible — ${pannes[0]}`);
  }
  suivi.entrees = entrees;
  suivi.charge = true;
}

function rendreSuivi() {
  const host = $('imsuivi');
  host.replaceChildren();

  if (!suivi.entrees.length) {
    host.append(el('p', { className: 'hint',
      textContent: 'Aucun artefact du registre ne porte de provenance d\'import : rien '
        + 'à suivre. Les capacités écrites à la main n\'ont pas d\'amont.' }));
    return;
  }

  for (const e of suivi.entrees) {
    const row = el('div', { className: 'row' });
    e.zone = el('div');

    const h = el('h3');
    h.append(icDe(e.artefact?.kind), ' ',
             e.artefact?.title || e.artefact?.id || e.path.split('/').pop());
    h.append(el('span', { className: 'pill', textContent: STATUTS[e.statut]?.label || e.statut }));
    row.append(h);

    const faits = el('div', { className: 'facts' });
    for (const t of [`${e.prov.depot}@${e.prov.ref}`, `épinglé ${e.prov.commit.slice(0, 8)}`,
                     e.prov.fichier, e.prov.sha256 ? 'empreinte notée' : 'sans empreinte']) {
      faits.append(el('span', { textContent: t }));
    }
    row.append(faits, e.zone);
    host.append(row);
  }
}

/** Relire l'amont d'UNE entrée et poser le verdict dans sa zone. */
async function verifierEntree(e) {
  e.zone.replaceChildren(el('span', { className: 'meta', textContent: 'Relecture de l\'amont…' }));
  let verdict;
  try {
    const commits = await vue.forge.listCommits(e.prov.depot, '', { perPage: 1, ref: e.prov.ref });
    const commitAmont = commits[0]?.sha;
    if (!commitAmont) throw new Error(`aucun commit lisible sur ${e.prov.ref}`);

    let contenuAmont = null;
    let contenuEpingle = null;
    if (commitAmont !== e.prov.commit) {
      const tete = await vue.forge.getFile(e.prov.depot, e.prov.fichier, commitAmont)
        .catch(() => null);
      contenuAmont = tete ? tete.content : null;
      // Sans empreinte notée à l'import, on relit le commit épinglé pour comparer les textes.
      if (!e.prov.sha256 && contenuAmont !== null) {
        const epingle = await vue.forge.getFile(e.prov.depot, e.prov.fichier, e.prov.commit)
          .catch(() => null);
        contenuEpingle = epingle ? epingle.content : null;
      }
    }

    const sommes = new Map();
    if (contenuAmont !== null) sommes.set(contenuAmont, await sommeDe(contenuAmont));
    verdict = verdictAmont({ provenance: e.prov, commitAmont, contenuAmont, contenuEpingle,
                             hacher: (t) => sommes.get(t) ?? null });
  } catch (error) {
    // Injoignable N'EST PAS un verdict sur le contenu : on n'a pas pu regarder.
    e.zone.replaceChildren();
    const a = el('div', { className: 'alerte' });
    a.textContent = `Injoignable : ${error.message}. On n'a pas pu comparer — ce qui `
      + 'ne dit rien du contenu.';
    e.zone.append(a);
    return;
  }

  e.zone.replaceChildren();
  const ligne = el('div', { className: 'acts' });
  const ETIQUETTES = {
    [IDENTIQUE]: ['ok', 'à jour'],
    [MODIFIE]: ['write', 'modifié en amont'],
    [DISPARU]: ['ko', 'disparu de l\'amont'],
    [NON_VERIFIABLE]: ['ko', 'non vérifiable']
  };
  const [classe, label] = ETIQUETTES[verdict.issue];
  ligne.append(el('span', { className: `pill ${classe}`, textContent: label }),
               el('span', { className: 'meta', textContent: verdict.detail }));

  if (verdict.issue === MODIFIE) {
    ligne.append(el('span', { className: 'sp' }));
    const b = el('button', { className: 'btn', textContent: 'Relire le pack →' });
    b.title = 'Remplit le formulaire d\'import : la nouvelle version repasse par TOUT '
      + 'le circuit — proposeur, crible, dépôt en attente, validation. Rien n\'est hérité.';
    b.onclick = () => {
      $('imdepot').value = e.prov.depot;
      $('imref').value = e.prov.ref;
      // Ciblé sur LE fichier suivi : c'est lui qui a bougé, c'est lui qu'on vient relire.
      lireLePack(vue.forge, { session: vue.session, repo: vue.repo, cible: e.prov.fichier });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    ligne.append(b);
  }
  e.zone.append(ligne);
}

async function verifierTout() {
  const btn = $('imsuivibtn');
  btn.disabled = true;
  try {
    // La liste se RELIT à chaque vérification : c'est le moment où la fraîcheur compte.
    await chargerSuivi();
    rendreSuivi();
    if (!suivi.entrees.length) return;
    // En file, pas en rafale : l'amont est l'API publique d'autrui.
    for (const e of suivi.entrees) await verifierEntree(e);
  } catch (error) {
    $('imsuivietat').textContent = `Lecture impossible : ${error.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* ══ Les sources amont — le scanner ═════════════════════════════════════════
 *
 * La liste vient de `registries/sources-amont.yaml` et dit « on sait que ça existe »,
 * jamais « c'est bien ». Le scan fait EXACTEMENT la lecture de l'import (`lireAmont`,
 * partagée) : épingler, lister, lire les `SKILL.md` — et rend les mêmes chiffres
 * honnêtes, mesurées en tête et à zéro. Trois issues, jamais confondues :
 * du lisible, rien de lisible (une information sur l'éditeur), injoignable (on n'a
 * pas pu regarder — « N/A n'est pas zéro »).
 */
const lanceursScan = [];

/*
 * Les trois corpus de la veille, dans l'ordre où on les relit : la spécification
 * d'abord, les maisons ensuite, le terrain sauvage en dernier. Le corpus est une
 * information de RELECTURE, pas un droit — il dit avec quels yeux lire le scan.
 */
const CORPUS = [
  ['conformite', 'Conformité', 'La spécification Agent Skills et ses gardiens — le format lui-même.'],
  ['editeur', 'Éditeurs', 'Ce que les grandes maisons publient sous leur nom.'],
  ['communaute', 'Communauté', 'Le terrain sauvage — raison de plus pour relire ligne à ligne.']
];

async function monterSources() {
  const host = $('imsources');
  let doc;
  try {
    const r = await fetch('../registries/sources-amont.yaml', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    doc = yaml.parse(await r.text());
  } catch (error) {
    host.append(el('div', { className: 'alerte',
      textContent: `Registre des sources illisible : ${error.message}` }));
    return;
  }
  const sources = doc.sources || [];
  const groupes = [...CORPUS, ['', 'Sans corpus', '']];
  for (const [cle, titre, sousTitre] of groupes) {
    const du = sources.filter((s) => (s.corpus || '') === cle);
    if (!du.length) continue;
    const tete = el('div', { style: 'margin:6px 0 2px' });
    tete.append(el('h4', { className: 'sous', style: 'margin:0;font-size:13.5px',
                           textContent: `${titre} · ${du.length}` }));
    if (sousTitre) tete.append(el('p', { className: 'hint', style: 'margin:2px 0 0',
                                         textContent: sousTitre }));
    host.append(tete);
    for (const s of du) host.append(carteSource(s));
  }
  // Le coût se dit AVANT le clic : tout scanner, c'est autant de dépôts en série,
  // et le quota de la forge n'est pas infini.
  $('imscanbtn').textContent = `Tout scanner (${sources.length} dépôts)`;
  $('imscanbtn').title = `${sources.length} dépôts lus en série — plusieurs appels chacun. `
    + 'Ça consomme du quota GitHub : préfère scanner une source à la fois si tu en vises une.';
}

function carteSource(s) {
  const row = el('div', { className: 'row' });
  const refDe = s.ref || 'main';

  const h = el('h3');
  h.append(s.nom || s.id, el('span', { className: 'pill', textContent: `${s.depot}@${refDe}` }));
  row.append(h, el('p', { className: 'purpose', textContent: s.pourquoi || '' }));

  const acts = el('div', { className: 'acts' });
  const btn = el('button', { className: 'btn', textContent: 'Scanner' });
  const etat = el('span', { className: 'meta' });
  const resultat = el('div');
  acts.append(btn, etat);
  row.append(acts, resultat);

  const lancer = async () => {
    btn.disabled = true;
    resultat.replaceChildren();
    etat.textContent = `Lecture de ${s.depot}@${refDe}…`;
    try {
      const { pack, coupes } = await lireAmont(vue.forge, s.depot, refDe,
        (m) => { etat.textContent = m; });
      etat.textContent = `commit ${pack.commit.slice(0, 8)}`
        + (coupes ? ` · ${coupes} non lue(s) au-delà de ${MAX_CAPACITES}` : '');
      rendreScan(s, refDe, pack, resultat);
    } catch (error) {
      etat.textContent = '';
      const a = el('div', { className: 'alerte' });
      a.textContent = /aucun `?SKILL\.md`?/i.test(error.message)
        ? `Rien au format lisible : ${s.depot} ne publie pas de SKILL.md sur ${refDe}. `
          + 'C\'est une information, pas une panne — cet éditeur ne publie pas (encore) '
          + 'ses agents sous une forme qu\'une machine peut relire.'
        : `Injoignable : ${error.message}. On n'a pas pu regarder — ce qui n'est pas `
          + '« rien à voir ».';
      resultat.append(a);
    } finally {
      btn.disabled = false;
    }
  };
  btn.onclick = lancer;
  lanceursScan.push(lancer);
  return row;
}

function rendreScan(s, refDe, pack, host) {
  const r = pack.resume;

  // Les mêmes chiffres que l'import, dans le même ordre : mesurées d'abord, à zéro.
  const faits = el('div', { className: 'facts' });
  const fait = (t) => faits.append(el('span', { textContent: t }));
  fait(`${r.mesurees} mesurée(s) — zéro, toujours, avant le banc`);
  fait(`${r.sansZoneDombre} sans zone d'ombre`);
  fait(`${r.decouvertes} découverte(s)`);
  if (r.avecScripts) fait(`${r.avecScripts} avec scripts — pas des prompts`);
  if (r.illisibles) fait(`${r.illisibles} à l'en-tête illisible`);
  host.append(faits);

  // Le pack entier est toujours lu — voisins et scripts sont des faits de l'arbre
  // entier — mais on peut n'AFFICHER qu'une capacité : c'est `cible`, un filtre d'écran.
  const ouvrir = (cible = null) => {
    $('imdepot').value = s.depot;
    $('imref').value = refDe;
    lireLePack(vue.forge, { session: vue.session, repo: vue.repo, cible });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Le geste AVANT la liste : c'est lui qu'on cherche une fois les chiffres lus.
  const acts = el('div', { className: 'acts', style: 'margin-bottom:12px' });
  const b = el('button', { className: 'btn on', textContent: 'Tout ouvrir dans l\'import →' });
  b.onclick = () => ouvrir();
  acts.append(b);
  host.append(acts);

  /*
   * Une carte par capacité, pas une ligne : le nom seul ne dit rien, et c'est la
   * description — ce que l'amont DÉCLARE — qu'on vient lire ici. Le chemin reste en
   * pied de carte : deux capacités peuvent porter le même nom dans deux dossiers.
   */
  const grille = el('div', { className: 'scaps' });
  for (const c of pack.capacites) {
    const carte = el('div', { className: 'scap' });
    const nom = fiable(c.champs.id.origine) ? c.champs.id.valeur : c.chemin;
    carte.append(el('b', { textContent: nom }));
    carte.append(el('p', {
      textContent: fiable(c.champs.titre.origine)
        ? c.champs.titre.valeur
        : 'Aucune description déclarée — l\'en-tête ne dit pas ce qu\'elle fait.'
    }));
    carte.append(el('small', { textContent: c.chemin }));
    const seule = el('button', { className: 'btn', textContent: 'Ouvrir celle-ci →' });
    seule.onclick = () => ouvrir(c.chemin);
    carte.append(seule);
    grille.append(carte);
  }
  host.append(grille);
}

/**
 * Monter les deux sections, une fois. Appelé quand la vue s'ouvre : la liste des
 * imports se charge pour être VUE, mais aucun amont n'est contacté avant le clic —
 * ouvrir un onglet ne doit pas déclencher des requêtes vers les dépôts d'autrui.
 */
export async function monterImport(forge, { session, repo } = {}) {
  vue.forge = forge; vue.session = session; vue.repo = repo;
  if ($('imsuivibtn').dataset.monte) return;
  $('imsuivibtn').dataset.monte = '1';

  $('imsuivibtn').onclick = verifierTout;
  $('imscanbtn').onclick = async () => {
    $('imscanbtn').disabled = true;
    try { for (const lancer of lanceursScan) await lancer(); }
    finally { $('imscanbtn').disabled = false; }
  };

  await monterSources();
  if (!repo) {
    $('imsuivietat').textContent = 'Aucun dépôt de registre choisi : rien à suivre.';
    return;
  }
  try {
    await chargerSuivi();
    rendreSuivi();
  } catch (error) {
    $('imsuivietat').textContent = `Lecture impossible : ${error.message}`;
  }
}
