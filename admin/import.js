/*
 * Importer un pack de compétences — l'écran qui montre ce qui MANQUE.
 *
 * ── CE QUE CET ÉCRAN N'EST PAS ───────────────────────────────────────────────
 *
 * Ce n'est pas un bouton « importer Mantis ». Il ne crée aucun artefact, n'écrit rien
 * dans le registre, ne rend rien lançable. Il LIT un pack et rend le formulaire de
 * `lib/import-pack.js` rempli de ce qui était déclaré — c'est-à-dire, sur un pack réel,
 * presque rien.
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

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/** Ce qui a été lu, pour ne pas relire à chaque rendu. */
const vue = { pack: null, charge: false, coupes: 0, lus: 0 };

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
export async function lireLePack(forge) {
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
    vue.coupes = coupes;
    vue.lus = fichiers.length;
    vue.charge = true;
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
   * Les champs manquants, avec leur POURQUOI. C'est là que le formulaire fait son travail :
   * « isolement : manquant » ne convainc personne de remplir quoi que ce soit ; « le déduire
   * d'une phrase anglaise serait accorder un droit sur une lecture » convainc.
   */
  const bloc = el('div', { className: 'bloc' });
  bloc.append(el('h4', { textContent: 'Ce qu\'il faut décider avant de la lancer' }));
  const liste = el('ul', { className: 'plain' });
  for (const nom of c.manquants) {
    const def = CHAMPS.find((x) => x.nom === nom);
    const li = el('li');
    li.append(el('b', { textContent: def.quoi }), document.createTextNode(` ${def.pourquoi}`));
    const indices = c.champs[nom].indices || [];
    if (indices.length) {
      const ind = el('div', { className: 'contra' });
      ind.append(el('div', { className: 'ou', textContent: 'indices dans le texte — à lire, pas à convertir' }));
      for (const i of indices) {
        ind.append(el('blockquote', { textContent: `ligne ${i.ligne} · ${i.quoi}\n${i.extrait}` }));
      }
      li.append(ind);
    }
    liste.append(li);
  }
  if (!c.manquants.length) {
    liste.append(el('li', { textContent: 'Rien. Tous les champs qui portent un droit sont lus.' }));
  }
  bloc.append(liste);
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

  return row;
}
