/*
 * LE FORMULAIRE — ce qu'une capacité doit déclarer avant de pouvoir être gouvernée.
 *
 * ── POURQUOI UN FORMULAIRE ET PAS UN TRADUCTEUR ──────────────────────────────
 *
 * L'envie naturelle est d'écrire un traducteur : il lit `google/mantis`, comprend ses
 * dix-sept compétences et en fait des artefacts. Puis un pour Terraform. Puis un pour
 * Kubernetes. Puis un pour la suite FinOps. C'est un tapis roulant : il y en aura
 * toujours un de plus, et chacun vieillit avec l'amont qu'il traduit.
 *
 * Ce qui se réutilise n'est pas le traducteur, c'est LA LISTE DES QUESTIONS. Ce qu'une
 * capacité lit, ce qu'elle écrit, ce qu'elle exécute, l'isolement qu'elle exige, ce
 * qu'elle promet en sortie — ces questions ne dépendent pas de l'écosystème. Le
 * remplisseur, lui, est jetable et spécifique.
 *
 * Et ça change la position : un adaptateur court après le format des autres ; un
 * formulaire que les autres finissent par remplir eux-mêmes devient le standard.
 *
 * ── CE QU'ON A VÉRIFIÉ AVANT D'ÉCRIRE CE FICHIER ─────────────────────────────
 *
 * Un `SKILL.md` de Mantis déclare DEUX clés — relevé le 2026-08-18 sur le dépôt :
 *
 *     ---
 *     name: mantis-reproduce
 *     description: >-
 *       Generates and runs crash reproducers to verify security flaws...
 *     ---
 *
 * Tout le reste — « toutes les exécutions doivent être isolées », « l'exécution sur
 * l'hôte est strictement interdite », les fichiers lus et écrits, les dépendances entre
 * étapes — vit dans la PROSE ANGLAISE. Et `schema.json`, qui normalise pourtant les
 * données entre étapes, dit lui-même qu'il « n'explicite pas qui lit ou écrit quoi ».
 *
 * Ce module ne lit donc QUE ce qui est déclaré. Il ne déduit rien. Sur Mantis, il
 * remplira deux champs sur onze et rendra neuf `manquant` — et c'est le résultat exact
 * qu'on veut afficher, plutôt qu'un import en un clic qui aurait l'air de marcher.
 *
 * ── LES INDICES NE SONT PAS DES DÉDUCTIONS ───────────────────────────────────
 *
 * Un champ `manquant` peut porter des INDICES : les passages du texte qui parlent du
 * sujet, avec leur ligne. « Le mot `--network none` apparaît ligne 47 » est un fait
 * vérifiable sur le texte ; « cette compétence exige un bac à sable » est une conclusion.
 * On donne le premier à l'humain qui remplit, jamais le second.
 *
 * Module PUR : ni réseau, ni fichier. Le hachage est INJECTÉ — un module pur ne choisit
 * pas son algorithme de cryptographie, et l'appelant doit pouvoir déclarer le sien.
 */
import yaml from './yaml.js';

/* ── Les origines d'une valeur ─────────────────────────────────────────────── */

/**
 * D'où vient un champ. C'est le type qui porte la contrainte I003.
 *
 *   lu        déclaré par la capacité, lisible par du code. Vérifiable, rejouable.
 *   impose    posé par Salsi, pas par l'amont — le niveau, le dossier d'atterrissage.
 *   deduit    tiré de la prose par un modèle. Porte sa preuve. NE REND RIEN LANÇABLE.
 *   manquant  personne ne l'a rempli. Bloque.
 *
 * `deduit` n'existe pas encore dans le code : l'étape 1 ne fait aucune inférence. Il est
 * déclaré ici parce que les consommateurs — écran, contrôles — doivent le traiter dès
 * maintenant comme non lançable, plutôt que de l'apprendre le jour où il apparaîtra.
 */
export const ORIGINES = ['lu', 'impose', 'deduit', 'manquant'];

/** Un champ dans cet état rend-il la capacité lançable ? */
export const fiable = (origine) => origine === 'lu' || origine === 'impose';

/* ── Le formulaire ─────────────────────────────────────────────────────────── */

/**
 * Les questions, et pourquoi chacune.
 *
 * `requis` ne veut pas dire « obligatoire pour importer » — on importe toujours, en
 * attente. Il veut dire : sans lui, la capacité n'est pas GOUVERNABLE, donc pas lançable.
 */
export const CHAMPS = [
  { nom: 'id', requis: true,
    quoi: 'L\'identifiant de la capacité.',
    pourquoi: 'Sans lui, rien ne peut la désigner — ni un journal, ni un plafond, ni un refus.' },

  { nom: 'titre', requis: true,
    quoi: 'Ce qu\'elle fait, en une ligne.',
    pourquoi: 'Un catalogue de seize lignes identiques ne se lit pas.' },

  { nom: 'quand', requis: false,
    quoi: 'Quand l\'employer, et quand ne pas l\'employer.',
    pourquoi: 'C\'est le `not_for` de nos artefacts : la moitié des mauvais usages vient de là.' },

  { nom: 'entrees', requis: true,
    quoi: 'Ce que la capacité LIT — fichiers, état, matière.',
    pourquoi: 'Sans elle, la plateforme ne sait pas quoi lui donner, et l\'agent recevra du vide.' },

  { nom: 'sorties', requis: true,
    quoi: 'Ce qu\'elle PRODUIT, et sous quelle forme.',
    pourquoi: 'C\'est ce sur quoi un contrat porte. Sans elle, aucun critère n\'est vérifiable.' },

  { nom: 'ecrit', requis: true,
    quoi: 'Ce qu\'elle MODIFIE — un dépôt, un état partagé, rien.',
    pourquoi: 'Décide si P007 exige une confirmation humaine. Un défaut permissif ici ferait '
            + 'écrire dans un dépôt sans que personne ait rien coché.' },

  { nom: 'outils', requis: true,
    quoi: 'Les outils qu\'elle appelle, et leur correspondance dans notre registre.',
    pourquoi: 'I001 : la correspondance PRÉEXISTE ou le champ est manquant. Un outil résolu '
            + 'par lecture d\'un texte tiers n\'est pas un droit, c\'est une suggestion.' },

  { nom: 'isolement', requis: true,
    quoi: 'Réseau, shell, conteneur : ce qu\'il faut lui interdire.',
    pourquoi: 'Mantis écrit « USE THIS ONLY IN ISOLATED, RESTRICTED ENVIRONMENTS ». En prose. '
            + 'Le déduire d\'une phrase anglaise serait accorder un droit sur une lecture.' },

  { nom: 'depend_de', requis: false,
    quoi: 'Les autres capacités dont elle a besoin, et dans quel ordre.',
    pourquoi: 'Une chaîne se compose de briques ordonnées. Sans l\'ordre, on a un sac.' },

  { nom: 'modele', requis: false,
    quoi: 'Le palier de modèle attendu.',
    pourquoi: 'Aucun skill Mantis n\'en déclare : on n\'en TRADUIT donc pas, on en ATTRIBUE un. '
            + 'Le défaut est le palier le moins cher — attribuer `large` « parce que ça '
            + 'raisonne » multiplierait la facture par dix sur une intuition.' },

  { nom: 'empreinte', requis: true,
    quoi: 'Le hachage du fichier source, et le commit d\'origine.',
    pourquoi: 'C\'est ce qui rend un ré-import visible. Sans lui, l\'amont change sous nos '
            + 'pieds et le catalogue continue d\'afficher ce qu\'il croyait avoir lu.' }
];

const REQUIS = CHAMPS.filter((c) => c.requis).map((c) => c.nom);

/* ── Les indices ───────────────────────────────────────────────────────────── */

/**
 * Ce qu'on cherche dans la prose, pour AIDER celui qui remplit — jamais pour conclure.
 *
 * Chaque motif est une chaîne exacte, pas une interprétation. Trouver `--network none`
 * ligne 47 est un fait sur le texte ; en conclure « exige un bac à sable » est une
 * décision, et elle appartient à un humain (I001).
 */
export const MOTIFS_INDICE = [
  { champ: 'isolement', re: /--network[= ]none|network[_ ]disabled/i, quoi: 'réseau coupé' },
  { champ: 'isolement', re: /\b(sandbox|gvisor|isolated environment|containeri[sz]ed)\b/i, quoi: 'isolement' },
  { champ: 'isolement', re: /host (command )?execution is strictly prohibited|never run .* on a machine/i,
    quoi: 'interdiction d\'exécuter sur l\'hôte' },
  { champ: 'ecrit', re: /\b(writes? to|updates?|appends? to)\b.*\b(findings|workspace|state|\.json)\b/i,
    quoi: 'écriture d\'état' },
  { champ: 'entrees', re: /\b(reads? from|consumes?)\b/i, quoi: 'lecture' },
  { champ: 'outils', re: /\b(docker|qemu|python3?|bash|curl|git)\b/i, quoi: 'outil externe cité' },
  { champ: 'depend_de', re: /\bmantis-[a-z-]+\b/i, quoi: 'autre capacité citée' },
  { champ: 'sorties', re: /\bschema\.json\b|\bstatus\b.*\bVALID\b/i, quoi: 'schéma de sortie' }
];

/** Au-delà, on ne lit plus les indices, on les subit. */
export const MAX_INDICES = 4;

/** Les passages qui parlent d'un champ, avec leur ligne. Des faits, pas des conclusions. */
export function indicesDe(champ, texte = '') {
  const motifs = MOTIFS_INDICE.filter((m) => m.champ === champ);
  if (!motifs.length) return [];

  const out = [];
  const lignes = String(texte).split('\n');
  for (let i = 0; i < lignes.length && out.length < MAX_INDICES; i++) {
    const l = lignes[i];
    if (!l.trim()) continue;
    const m = motifs.find((x) => x.re.test(l));
    if (!m) continue;
    out.push({ ligne: i + 1, quoi: m.quoi, extrait: court(l.trim()) });
  }
  return out;
}

const court = (s) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);

/* ── La lecture ────────────────────────────────────────────────────────────── */

/** Le front-matter YAML d'un fichier Markdown, et le corps qui suit. */
export function decouper(contenu = '') {
  const src = String(contenu);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { entete: null, corps: src };
  try {
    return { entete: yaml.parse(m[1]) || {}, corps: m[2] || '' };
  } catch {
    // Un front-matter illisible n'est pas un front-matter vide : le dire permet à l'écran
    // de distinguer « la capacité ne déclare rien » de « on n'a pas su lire ».
    return { entete: null, corps: m[2] || '', illisible: true };
  }
}

const champ = (valeur, origine, extra = {}) => ({ valeur, origine, ...extra });

/**
 * Une capacité, lue mécaniquement. AUCUNE déduction.
 *
 * @param {object} e
 *   @param {string} e.chemin   son `SKILL.md` dans le pack
 *   @param {string} e.contenu
 *   @param {string} e.commit   le commit épinglé du pack
 *   @param {Array<string>} e.voisins  les autres fichiers de son dossier
 *   @param {Function} e.hacher (texte) => string — injecté, l'algorithme est à l'appelant
 */
export function lireCapacite({ chemin = '', contenu = '', commit = '',
                               voisins = [], hacher = null } = {}) {
  const { entete, corps, illisible } = decouper(contenu);
  const e = entete || {};

  const champs = {};
  for (const c of CHAMPS) champs[c.nom] = champ(null, 'manquant', { indices: indicesDe(c.nom, corps) });

  if (e.name) champs.id = champ(String(e.name), 'lu');
  if (e.description) champs.titre = champ(String(e.description).trim(), 'lu');

  /*
   * L'empreinte est `lu` quand on a de quoi la calculer, et `manquant` sinon — jamais
   * inventée. Sans hacheur injecté, l'appelant n'a pas déclaré son algorithme, et un
   * hachage choisi par ce module serait un choix de sécurité pris par le mauvais fichier.
   */
  if (typeof hacher === 'function') {
    champs.empreinte = champ({ fichier: chemin, sha: hacher(contenu), commit }, 'lu');
  }

  return {
    chemin,
    illisible: Boolean(illisible),
    /*
     * Les scripts d'aide sont un FAIT du dossier, pas une lecture de prose : leur présence
     * se voit à l'arborescence. Mantis en a — `workspace/helpers/append_review.py`, avec
     * un numéro de version dans un commentaire — et ils changent tout : une capacité qui
     * en dépend n'est pas un prompt, c'est un programme.
     */
    scripts: voisins.filter((v) => /\.(py|sh|js|rb)$/i.test(v)),
    champs,
    manquants: REQUIS.filter((n) => !fiable(champs[n].origine)),
    gouvernable: REQUIS.every((n) => fiable(champs[n].origine))
  };
}

/** Au-delà, on ne lit plus le pack : on le télécharge. Un pack de cette taille se choisit. */
export const MAX_CAPACITES = 40;

/**
 * Les `SKILL.md` d'une arborescence, et ce qu'on a décidé de ne pas aller lire.
 *
 * La coupe est RENDUE, jamais silencieuse : un écran qui annonce « 40 capacités
 * découvertes » sur un pack qui en porte 96 ment sur la taille de ce qu'on adopte.
 */
export function skillsDansArbre(chemins = [], max = MAX_CAPACITES) {
  const tous = chemins.filter((c) => /(^|\/)SKILL\.md$/i.test(c)).sort();
  return { chemins: tous.slice(0, max), total: tous.length, coupes: Math.max(0, tous.length - max) };
}

/**
 * Un pack entier.
 *
 * @param {object} e
 *   @param {Array<{chemin, contenu}>} e.fichiers  tout le pack, déjà lu
 *   @param {string} e.source   d'où il vient — l'URL du dépôt
 *   @param {string} e.commit   le commit épinglé
 *   @param {Function} e.hacher
 */
export function lirePack({ fichiers = [], source = '', commit = '', hacher = null } = {}) {
  const skills = fichiers.filter((f) => /(^|\/)SKILL\.md$/i.test(f.chemin));

  const capacites = skills.map((f) => {
    const dossier = f.chemin.replace(/SKILL\.md$/i, '');
    const voisins = fichiers
      .filter((x) => x.chemin !== f.chemin && x.chemin.startsWith(dossier))
      .map((x) => x.chemin);
    return lireCapacite({ chemin: f.chemin, contenu: f.contenu, commit, voisins, hacher });
  });

  return {
    source,
    commit,
    /*
     * `schema.json` à la racine n'est PAS un détail : c'est la seule chose vraiment
     * machine-readable d'un pack comme Mantis, et c'est ce qui permettra un jour d'en
     * tirer des contrats de sortie. On note sa présence, on n'en tire encore rien.
     */
    schema: fichiers.some((f) => /(^|\/)schema\.json$/i.test(f.chemin)),
    capacites,
    resume: resumePack(capacites),
    le: null
  };
}

/**
 * Ce que l'Admin lit en tête d'écran.
 *
 * ── LA LIGNE QUI COMPTE EST « 0 MESURÉE » ───────────────────────────────────
 *
 * Un écran qui annonce « 9 importables automatiquement » fait cliquer sans lire. Aucune
 * capacité n'est importable automatiquement : au mieux elle est SANS ZONE D'OMBRE, et il
 * reste à quelqu'un à en accepter le niveau.
 *
 * Et `mesurees` vaut zéro à l'import, toujours : aucune capacité importée n'a passé le
 * banc. Sans cette ligne, on affiche seize promesses avec de jolies pastilles.
 */
export function resumePack(capacites = []) {
  const compte = (champ) => capacites.filter((c) => c.manquants.includes(champ)).length;
  return {
    decouvertes: capacites.length,
    sansZoneDombre: capacites.filter((c) => c.gouvernable).length,
    isolementNonResolu: compte('isolement'),
    outilsNonResolus: compte('outils'),
    contratIncomplet: compte('sorties'),
    avecScripts: capacites.filter((c) => c.scripts.length > 0).length,
    illisibles: capacites.filter((c) => c.illisible).length,
    // Aucune ne l'est jamais à l'import. Le champ existe pour que l'écran ne puisse pas
    // l'oublier — pas parce qu'il pourrait valoir autre chose un jour d'import.
    mesurees: 0
  };
}

export default { CHAMPS, ORIGINES, fiable, decouper, indicesDe, lireCapacite, lirePack,
                 resumePack, skillsDansArbre, MOTIFS_INDICE, MAX_INDICES, MAX_CAPACITES };
