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
         NIVEAU_IMPORTE } from '../lib/import-artefact.js';
import { contexte } from './contexte.js';
import { knownScopes } from '../app/scopes.js';
import { lint, ERROR } from '../lint/index.js';
import { toYaml } from '../studio/to-yaml.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/** Ce qui a été lu, pour ne pas relire à chaque rendu. */
const vue = { pack: null, charge: false, coupes: 0, lus: 0,
              /* Le corps de chaque `SKILL.md` : c'est lui qui sera CITÉ dans le `spec`. */
              corps: new Map(),
              /* Ce que l'importeur a décidé, par capacité. Rien n'y est pré-rempli. */
              decisions: new Map(),
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

/** Lire le pack, à un commit épinglé. */
export async function lireLePack(forge, { session, repo } = {}) {
  if (session) { vue.session = session; vue.repo = repo; vue.forge = forge; }
  const depot = $('imdepot').value.trim();
  const ref = $('imref').value.trim() || 'main';
  if (!depot) return flash('Indique un dépôt, par exemple `google/mantis`.');

  effacerFlash();
  $('imbtn').disabled = true;
  $('imetat').textContent = `Lecture de ${depot}@${ref}…`;
  $('imcorps').replaceChildren();

  try {
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
    $('imetat').textContent = `${total} capacité(s) trouvée(s), lecture de ${chemins.length}…`;
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

    vue.pack = lirePack({
      fichiers: entrants,
      source: `${depot}@${ref}`,
      commit,
      // Consultation, pas calcul : le module est synchrone, `crypto.subtle` ne l'est pas.
      // Un contenu absent de la table rend `null` — une empreinte fausse est pire qu'absente.
      hacher: (contenu) => sommes.get(contenu) ?? null
    });
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
  for (const c of pack.capacites) corps.append(carteCapacite(c));
  // Après insertion dans le document : `rendreVerdict` cherche son conteneur par sélecteur.
  for (const c of pack.capacites) rendreVerdict(c);

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
  bloc.append(el('h4', { textContent: 'À décider — et c\'est toi qui en réponds' }));
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
 * L'isolement : une liste FERMÉE, lue du registre.
 *
 * Ce qui n'est pas applicable est listé quand même, et étiqueté. Le masquer donnerait un
 * menu où tout est possible et laisserait croire que la plateforme sait tout faire
 * respecter — alors qu'elle ne sait en faire respecter aucun des deux qui comptent pour
 * Mantis. Le voir barré est une information ; ne pas le voir est un mensonge par omission.
 */
function selectIsolement(d, maj) {
  const s = el('select', { className: 'stsel large' });
  s.append(el('option', { value: '', textContent: '— à choisir —' }));
  for (const i of vue.ctx.isolements) {
    s.append(el('option', {
      value: i.id,
      textContent: i.applicable ? i.titre : `${i.titre} — NON APPLICABLE aujourd'hui`
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
  for (const t of vue.ctx.tools) {
    const lab = el('label', { className: 'case' });
    const cb = el('input', { type: 'checkbox', checked: d.outils.includes(t.id) });
    cb.onchange = () => {
      d.outils = cb.checked ? [...d.outils, t.id] : d.outils.filter((x) => x !== t.id);
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

  if (vides.length) {
    const box = el('div', { className: 'coherence flou' });
    box.append(el('b', { textContent: `${vides.length} champ(s) à décider ci-dessus` }),
      document.createTextNode('Tant qu\'il en reste un, la capacité n\'est pas gouvernable — '
        + 'et ce qui n\'est pas gouvernable ne se dépose pas.'));
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
                                textContent: `Déposer en attente (${NIVEAU_IMPORTE})` });
  bouton.disabled = Boolean(bloquants.length) || !d.perimetre || !artefact;
  bouton.onclick = () => deposer(c, bouton);
  pied.append(bouton);

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
async function deposer(c, bouton) {
  const d = decisionsDe(c);
  const { artefact, entete } = fabriquer(c, d);
  if (!artefact) return;

  bouton.disabled = true;
  effacerFlash();
  try {
    const rapport = lint(artefact, vue.ctx);
    if (rapport.blocked) {
      const erreurs = rapport.findings.filter((f) => f.severity === ERROR)
        .map((f) => `${f.code} ${f.message}`).join(' · ');
      return flash(`La porte est fermée : ${erreurs}`);
    }

    if (!vue.repo) return flash('Aucun dépôt de registre choisi.');

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
    flash(`✔ Déposé — ${chemin}. Il attend une validation humaine dans « À valider ».`, true);
  } catch (error) {
    flash(`Dépôt impossible : ${error.message}`);
  } finally {
    rendreVerdict(c);
  }
}

/* `btoa` ne prend que du latin-1 : un `é` dans une description le fait lever. */
function base64(texte) {
  const octets = new TextEncoder().encode(texte);
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin);
}
