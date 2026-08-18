/*
 * L'ATELIER — l'état qu'une chaîne accumule entre ses étapes.
 *
 * ── LE MANQUE, TEL QU'IL EST APPARU ──────────────────────────────────────────
 *
 * Notre modèle est « une matière en entrée, un texte en sortie, un contrat évalué
 * dessus ». Les chaînes savent déjà passer la sortie d'une étape à la suivante
 * (`{{e1.sortie}}`). Ce qu'elles ne savent pas, c'est ACCUMULER : trois étapes qui
 * ajoutent chacune leurs constats à une même liste, qu'une quatrième relit entière.
 *
 * C'est exactement ce que Mantis suppose partout — `workspace/findings/*.json`,
 * `learnings.jsonl`, `kb/` — et c'est le morceau qui ne se découpe pas. On peut livrer
 * trois opérations d'import sur treize ; on ne peut pas livrer un demi-atelier.
 *
 * ── CE QUE CE MODULE N'EST PAS, ET C'EST LE PLUS IMPORTANT ──────────────────
 *
 * Ce n'est PAS un système de fichiers. Pas de dossiers, pas de chemins, pas de motifs.
 * Un chemin est une capacité : `../../etc/passwd` et `workspace/../artifacts/x.yaml` sont
 * le même problème, et un espace de noms PLAT n'a pas de traversée à empêcher — il n'a
 * simplement pas de traversée.
 *
 * Un atelier est donc une poignée de CASES NOMMÉES, déclarées d'avance dans la chaîne,
 * chacune avec sa forme et son plafond. Ce qui n'est pas déclaré n'existe pas et ne
 * s'écrit pas. Un état non déclaré serait un endroit où la gouvernance s'arrête.
 *
 * ── UNE ÉTAPE ÉCRIT UNE CASE, ET UNE SEULE ──────────────────────────────────
 *
 * Sa sortie. Pas deux, pas un JSON qu'on découperait en trois. C'est restrictif et c'est
 * délibéré : dès qu'on parse la sortie d'un modèle pour la répartir dans plusieurs cases,
 * l'état de l'atelier dépend de la capacité du modèle à produire du JSON — et le jour où
 * il en produit du bancal, on ne le voit pas, on voit une case vide.
 *
 * Une étape qui doit alimenter deux cases est DEUX étapes. C'est plus long à écrire et
 * ça se relit.
 *
 * ── CE QUE MANTIS FAIT ET QUE ÇA NE FAIT PAS ────────────────────────────────
 *
 * Divergence assumée, écrite ici plutôt que découverte à l'usage : les skills de Mantis
 * écrivent des ÉTATS STRUCTURÉS multi-fichiers, par des scripts Python. Un atelier ne
 * porte que du texte accumulé par des étapes. Une capacité importée qui suppose vraiment
 * `findings/{id}.json` écrit par `append_review.py` n'a pas d'équivalent ici, et
 * l'importer donnera une brique qui parle d'un fichier qu'aucun code n'écrit.
 *
 * Module PUR : ni réseau, ni DOM, ni système de fichiers. L'atelier est une valeur.
 */
import { caviarder } from './signaux-securite.js';

/* ── Le vocabulaire ────────────────────────────────────────────────────────── */

/**
 * La forme d'une case. Fermé, comme tous les vocabulaires de ce dépôt.
 *
 * Elle décide de DEUX choses : comment une écriture s'ajoute à ce qui est déjà là, et
 * comment la case se rend quand une étape la lit. Une case sans forme serait un blob :
 * on ne pourrait ni la vérifier, ni la montrer, ni compter ce qu'elle contient.
 */
export const FORMES = {
  texte: { titre: 'Du texte', joint: '\n\n' },
  lignes: { titre: 'Une ligne par constat', joint: '\n' }
};

/** Ce qu'une écriture fait de ce qui était déjà là. */
export const MODES = ['ajoute', 'remplace'];

/**
 * Les plafonds d'une case.
 *
 * Un état non borné grandit jusqu'à ce que le prompt casse — et la panne ne se présente
 * pas comme « l'atelier est plein », elle se présente comme « le modèle est devenu
 * mauvais ». Le plafond est donc bas, explicite, et son franchissement se DIT.
 */
export const MAX_OCTETS = 60000;
export const MAX_ENTREES = 200;

/** Le nom réservé : une étape ne peut pas s'appeler comme l'espace de noms qui la lit. */
export const RESERVE = 'atelier';

/* ── Ouvrir ────────────────────────────────────────────────────────────────── */

/**
 * Un atelier vide, aux cases déclarées par la chaîne.
 *
 * Il naît VIDE et meurt avec le passage. Pas de persistance, et ce n'est pas une
 * simplification : un atelier partagé entre deux passages rendrait le résultat d'une
 * chaîne dépendant de ce qu'une autre y a laissé la veille — donc irreproductible, donc
 * inauditable. « Qu'est-ce que l'agent a vu ce jour-là ? » est la question à laquelle
 * cette plateforme doit pouvoir répondre.
 *
 * @param {Array<{cle, forme, titre}>} declarations  `chaine.atelier`
 */
export function ouvrir(declarations = []) {
  const cases = new Map();
  for (const d of declarations) {
    if (!d || !d.cle) continue;
    cases.set(d.cle, {
      cle: d.cle,
      forme: FORMES[d.forme] ? d.forme : 'texte',
      titre: d.titre || '',
      morceaux: [],
      octets: 0,
      coupe: null                       // pourquoi on a cessé d'écrire, s'il y a lieu
    });
  }
  return { cases, journal: [] };
}

/** Les cases déclarées, pour un écran ou un contrôle. */
export const clesDe = (atelier) => [...atelier.cases.keys()];

/* ── Écrire ────────────────────────────────────────────────────────────────── */

/**
 * Une étape écrit sa sortie dans une case.
 *
 * MUTE l'atelier et rend le compte rendu de l'écriture. Un module pur peut muter une
 * valeur qu'on lui passe ; ce qu'il ne fait pas, c'est aller chercher ou poser quoi que
 * ce soit ailleurs.
 *
 * @returns {{ecrit: boolean, refus: string, octets: number, coupe: string}}
 */
export function ecrire(atelier, { cle, texte = '', etape = '', mode = 'ajoute' } = {}) {
  const c = atelier.cases.get(cle);
  if (!c) {
    return refuser(atelier, etape, cle,
      `La case \`${cle}\` n'est pas déclarée par la chaîne. Ce qui n'est pas déclaré `
      + 'n\'existe pas : un état non déclaré serait un endroit où la gouvernance s\'arrête.');
  }
  if (!MODES.includes(mode)) {
    return refuser(atelier, etape, cle, `\`${mode}\` n'est pas un mode d'écriture.`);
  }

  /*
   * LE CAVIARDAGE SE FAIT À L'ÉCRITURE, PAS À LA LECTURE.
   *
   * Ce qui entre dans une case en ressortira dans le prompt d'une étape suivante. Le
   * caviarder à la lecture laisserait le secret DANS l'atelier, donc dans le journal du
   * passage et dans tout ce qui l'affiche. On le retire à l'entrée, une fois, et ce qui
   * a été retiré est dit — jamais silencieusement.
   */
  const { texte: propre, trouves } = caviarder(String(texte ?? ''));

  if (mode === 'remplace') { c.morceaux = []; c.octets = 0; c.coupe = null; }

  const octets = taille(propre);
  const avant = c.morceaux.length;

  /*
   * Le plafond REFUSE l'écriture, il ne la tronque pas.
   *
   * Tronquer donnerait une case qui a l'air pleine et qui ment sur ce qu'elle contient —
   * et l'étape suivante conclurait sur une liste amputée sans savoir qu'elle l'est.
   */
  if (c.octets + octets > MAX_OCTETS) {
    c.coupe = `Plafond de ${MAX_OCTETS} octets atteint : cette écriture de ${octets} `
            + 'octets est REFUSÉE, pas tronquée.';
    return refuser(atelier, etape, cle, c.coupe, trouves);
  }
  if (avant + 1 > MAX_ENTREES) {
    c.coupe = `Plafond de ${MAX_ENTREES} écritures atteint.`;
    return refuser(atelier, etape, cle, c.coupe, trouves);
  }

  c.morceaux.push({ etape, texte: propre, octets });
  c.octets += octets;

  const ligne = { etape, cle, mode, octets, entrees: c.morceaux.length,
                  caviarde: trouves, refus: '' };
  atelier.journal.push(ligne);
  return { ecrit: true, refus: '', octets, coupe: c.coupe || '', caviarde: trouves };
}

function refuser(atelier, etape, cle, refus, caviarde = []) {
  atelier.journal.push({ etape, cle, mode: '', octets: 0, entrees: 0, caviarde, refus });
  return { ecrit: false, refus, octets: 0, coupe: '', caviarde };
}

const taille = (s) => (typeof TextEncoder === 'function'
  ? new TextEncoder().encode(s).length : Buffer.byteLength(s, 'utf8'));

/* ── Lire ──────────────────────────────────────────────────────────────────── */

/**
 * Ce qu'une étape reçoit quand elle lit une case.
 *
 * ── « VIDE » N'EST PAS « ABSENT », ET C'EST TOUT L'INTÉRÊT ──────────────────
 *
 * Trois situations, trois textes différents, parce qu'elles n'appellent pas les mêmes
 * conclusions :
 *
 *   la case n'est pas déclarée   une erreur de câblage. On le DIT dans le texte injecté,
 *                                plutôt que d'envoyer une chaîne vide qui se lirait
 *                                « aucun constat ».
 *   déclarée, jamais écrite      aucune étape n'y a rien mis. Ce n'est pas « il n'y a
 *                                rien à trouver », c'est « personne n'a cherché ».
 *   écrite, puis plafonnée       ce qu'on lit est INCOMPLET, et le lecteur doit le savoir
 *                                avant de conclure quoi que ce soit.
 */
export function lire(atelier, cle) {
  const c = atelier?.cases?.get(cle);
  if (!c) {
    return `[case \`${cle}\` NON DÉCLARÉE par cette chaîne — rien n'a pu être lu. `
         + 'Ne conclus rien de cette absence : c\'est un défaut de câblage, pas un constat.]';
  }
  if (!c.morceaux.length) {
    return `[case \`${cle}\` DÉCLARÉE et VIDE : aucune étape n'y a écrit. Ce n'est pas `
         + '« rien à signaler », c\'est « personne n\'a encore rien mis ici ».]';
  }

  const joint = FORMES[c.forme].joint;
  const corps = c.morceaux.map((m) => m.texte).join(joint);
  const tete = `[case \`${cle}\` — ${c.morceaux.length} écriture(s), par : `
             + `${[...new Set(c.morceaux.map((m) => m.etape || '?'))].join(', ')}]`;
  const pied = c.coupe ? `\n[INCOMPLET — ${c.coupe} Ne conclus rien sur ce qui n'y est pas.]` : '';
  return `${tete}\n${corps}${pied}`;
}

/** Ce qu'un écran montre de l'atelier après un passage. */
export function resume(atelier) {
  return [...atelier.cases.values()].map((c) => ({
    cle: c.cle, forme: c.forme, titre: c.titre,
    ecritures: c.morceaux.length, octets: c.octets,
    par: [...new Set(c.morceaux.map((m) => m.etape))],
    coupe: c.coupe || ''
  }));
}

/* ── Les contrôles STATIQUES, avant le premier appel ───────────────────────── */

/** Un renvoi vers une case : `{{atelier.findings}}`. */
export const RENVOI_ATELIER = /\{\{\s*atelier\.([a-z][a-z0-9_]*)\s*\}\}/g;

/** Les cases citées par une expression. */
export const casesCitees = (expression) =>
  [...String(expression ?? '').matchAll(RENVOI_ATELIER)].map((m) => m[1]);

/**
 * Tout ce qui cloche dans l'atelier d'une chaîne, AVANT de dépenser un jeton.
 *
 * C'est ici que l'atelier cesse d'être un système de fichiers pour devenir une chose
 * gouvernée. Un état mutable dont on ne peut rien dire avant de l'exécuter est
 * exactement ce qu'on refuse ailleurs.
 *
 * @returns {Array<{code, message, etape}>}
 */
export function conflits(chaine = {}) {
  const out = [];
  const dit = (message, etape = '') => out.push({ message, etape });

  const declarees = new Map();
  for (const d of chaine.atelier || []) {
    if (!d?.cle) { dit('Une case de l\'atelier n\'a pas de clé.'); continue; }
    if (declarees.has(d.cle)) dit(`La case \`${d.cle}\` est déclarée deux fois.`);
    if (d.forme && !FORMES[d.forme]) {
      dit(`La case \`${d.cle}\` déclare une forme inconnue : \`${d.forme}\`. `
        + `Les formes sont ${Object.keys(FORMES).join(', ')}.`);
    }
    declarees.set(d.cle, d);
  }

  const etapes = chaine.steps || [];
  /** Les cases dans lesquelles une étape antérieure a écrit. */
  const remplies = new Set();
  const remplacants = new Map();

  for (const e of etapes) {
    if (e.id === RESERVE) {
      dit(`Une étape ne peut pas s'appeler \`${RESERVE}\` : c'est le nom de l'espace de `
        + 'noms que les autres citent pour lire une case. Deux choses au même nom, et le '
        + 'câblage devient ambigu.', e.id);
    }

    // Lire une case avant qu'aucune étape n'y ait écrit, c'est lire du vide en croyant
    // lire un constat. La chaîne le dira à l'exécution ; autant le refuser avant.
    for (const expr of Object.values(e.entrees || {})) {
      for (const cle of casesCitees(expr)) {
        if (!declarees.has(cle)) {
          dit(`L'étape lit la case \`${cle}\`, que la chaîne ne déclare pas.`, e.id);
        } else if (!remplies.has(cle)) {
          dit(`L'étape lit la case \`${cle}\` avant qu'aucune étape antérieure n'y ait `
            + 'écrit. Elle ne lirait que du vide.', e.id);
        }
      }
    }

    const ecrit = e.ecrit;
    if (!ecrit) continue;
    if (!ecrit.cle) { dit('Une écriture d\'étape n\'a pas de case.', e.id); continue; }
    if (!declarees.has(ecrit.cle)) {
      dit(`L'étape écrit dans la case \`${ecrit.cle}\`, que la chaîne ne déclare pas.`, e.id);
      continue;
    }
    const mode = ecrit.mode || 'ajoute';
    if (!MODES.includes(mode)) {
      dit(`\`${mode}\` n'est pas un mode d'écriture. Les modes sont ${MODES.join(', ')}.`, e.id);
    }

    /*
     * DEUX ÉTAPES QUI REMPLACENT LA MÊME CASE.
     *
     * Le conflit qui coûte le plus cher à trouver après coup : la seconde efface le
     * travail de la première, la chaîne ne rate rien, et le résultat est simplement
     * incomplet sans que rien ne le dise. C'est précisément ce qu'un état mutable partagé
     * fait de pire, et c'est vérifiable sans exécuter quoi que ce soit.
     */
    if (mode === 'remplace') {
      const deja = remplacants.get(ecrit.cle);
      if (deja) {
        dit(`Les étapes \`${deja}\` et \`${e.id}\` remplacent toutes deux la case `
          + `\`${ecrit.cle}\`. La seconde efface le travail de la première, et rien ne le `
          + 'dirait à l\'exécution.', e.id);
      }
      remplacants.set(ecrit.cle, e.id);
    }
    remplies.add(ecrit.cle);
  }

  /*
   * Une case déclarée que personne n'écrit, ou que personne ne lit.
   *
   * Avertissement et pas refus : une chaîne en construction passe forcément par là. Mais
   * une case que personne ne lit est de l'état accumulé pour rien, et une case que
   * personne n'écrit sera lue vide — deux choses qu'on préfère voir avant.
   */
  const lues = new Set(etapes.flatMap((e) =>
    Object.values(e.entrees || {}).flatMap((x) => casesCitees(x))));
  for (const cle of declarees.keys()) {
    if (!remplies.has(cle)) dit(`La case \`${cle}\` est déclarée et aucune étape n'y écrit.`);
    else if (!lues.has(cle)) dit(`La case \`${cle}\` est écrite et aucune étape ne la lit.`);
  }

  return out;
}

export default { FORMES, MODES, MAX_OCTETS, MAX_ENTREES, RESERVE, ouvrir, ecrire, lire,
                 resume, conflits, casesCitees, clesDe, RENVOI_ATELIER };
