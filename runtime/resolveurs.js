/*
 * Les résolveurs de cibles — ce qui transforme une sortie de modèle en valeur assertable.
 *
 * ── CE QU'ILS DÉBLOQUENT ─────────────────────────────────────────────────────
 *
 * `criteria` était jusqu'ici un contrat DÉCLARÉ : le linter vérifiait qu'une cible
 * existe au registre et que son opérateur est autorisé, mais rien ne l'ÉVALUAIT jamais.
 * Le registre décrivait donc des vérifications que personne ne faisait — exactement le
 * genre de gouvernance de papier qu'il est censé remplacer.
 *
 * Un résolveur par cible de classe `form`, et le contrat devient exécutable : après
 * chaque appel, le post-vol calcule la valeur et tranche. Sans LLM juge, sans jugement
 * du tout — du code.
 *
 * ── POURQUOI LES CIBLES `state` N'EN ONT PAS ICI ─────────────────────────────
 *
 * `pipeline.status`, `branch.mergeable`, `tests.passed` portent sur l'état du MONDE
 * après exécution. Les résoudre demande un dépôt jetable, une CI isolée, un reset entre
 * deux passages — le banc d'essai, pas une fonction. Elles rendent donc `undefined`, et
 * l'appelant le dit au lieu de conclure. Une cible non résolue n'est ni satisfaite ni
 * violée : c'est une vérification qui n'a pas eu lieu, et il faut que ça se voie.
 *
 * Module PUR : ni réseau, ni système de fichiers.
 */
import { SECRET_PATTERNS } from '../lint/rules/safety.js';

/** Conventional Commits, en tête de message. Le corps est libre. */
const CONVENTION = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?!?: .{1,}$/;

/** Les en-têtes d'une sortie structurée — Markdown ou soulignés. */
function sections(texte) {
  const out = [];
  for (const ligne of String(texte).split('\n')) {
    const titre = /^#{1,6}\s+(.+?)\s*#*$/.exec(ligne) || /^\*\*(.+?)\*\*\s*:?\s*$/.exec(ligne);
    if (titre) out.push(titre[1].trim());
  }
  return out;
}

/** Les fichiers touchés par un patch unifié. Un rename compte pour un. */
function fichiersTouches(texte) {
  const vus = new Set();
  for (const m of String(texte).matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) vus.add(m[2]);
  // Un patch peut n'avoir que des `+++` (format `diff -u` sans en-tête git).
  if (vus.size === 0) {
    for (const m of String(texte).matchAll(/^\+\+\+ b?\/?(\S+)$/gm)) {
      if (m[1] !== '/dev/null') vus.add(m[1]);
    }
  }
  return vus.size;
}

/**
 * Un patch a-t-il une chance de s'appliquer ?
 *
 * On ne l'applique pas — il faudrait l'arbre de travail. On vérifie ce qui se vérifie
 * sans lui : les en-têtes de bloc existent, et les comptes annoncés par `@@` collent aux
 * lignes qui suivent. C'est faible, et c'est dit : ça attrape le patch tronqué ou
 * halluciné, pas le patch qui vise la mauvaise ligne. Le banc d'essai, lui, l'appliquera.
 */
function patchPlausible(texte) {
  const src = String(texte);
  const blocs = [...src.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
  if (blocs.length === 0) return false;
  if (!/^(diff --git |--- |\+\+\+ )/m.test(src)) return false;

  const lignes = src.split('\n');
  for (const bloc of blocs) {
    const attenduAvant = bloc[2] === undefined ? 1 : Number(bloc[2]);
    const attenduApres = bloc[4] === undefined ? 1 : Number(bloc[4]);
    let i = lignes.indexOf(bloc[0]) + 1;
    let avant = 0; let apres = 0;
    for (; i < lignes.length; i++) {
      const l = lignes[i];
      if (/^@@ |^diff --git /.test(l)) break;
      // La dernière ligne vide vient du saut final du fichier, pas du patch : la compter
      // comme une ligne de contexte faisait échouer TOUT patch bien formé.
      if (l === '' && i === lignes.length - 1) break;
      if (l.startsWith('-')) avant++;
      else if (l.startsWith('+')) apres++;
      else if (l.startsWith(' ') || l === '') { avant++; apres++; }
      else break;
    }
    if (avant !== attenduAvant || apres !== attenduApres) return false;
  }
  return true;
}

/**
 * Les résolveurs, par cible. Chacun rend la valeur du type déclaré au registre.
 *
 * @param {string} sortie  le texte rendu par le modèle
 * @param {object} ctx     { valeurs, artifact } — pour les cibles qui en ont besoin
 */
export const RESOLVEURS = {
  'output.length': (sortie) => String(sortie).length,

  'output.contains_secret': (sortie) =>
    SECRET_PATTERNS.some(({ re }) => re.test(String(sortie))),

  'output.is_valid_json': (sortie) => {
    // Un modèle encadre volontiers son JSON de ```json … ``` : le refuser pour ça
    // ferait échouer un cas d'or sur la mise en forme au lieu du fond.
    const nu = String(sortie).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { JSON.parse(nu); return true; } catch { return false; }
  },

  'output.sections': (sortie) => sections(sortie),

  /*
   * Les CLÉS d'une sortie JSON — la cible qui manquait.
   *
   * Un agent qui rend du JSON veut garantir que certaines clés y sont. Il n'avait pour
   * ça que `output.sections`, qui extrait des titres MARKDOWN : sur du JSON elle rend
   * toujours une liste vide, et le contrat échouait quoi que le modèle réponde.
   *
   * Trouvé à l'usage, sur un agent d'export de rapport DORA : il exigeait
   * `output.is_valid_json` ET quatre `output.sections` — deux exigences qu'aucune réponse
   * ne peut satisfaire ensemble.
   *
   * Les clés du PREMIER niveau seulement. Descendre récursivement mêlerait `metriques` et
   * `valeur`, et un contrat ne saurait plus de quoi il parle.
   */
  'output.json_keys': (sortie) => {
    const nu = String(sortie).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      const v = JSON.parse(nu);
      if (Array.isArray(v)) return [];          // un tableau n'a pas de clés nommées
      return v && typeof v === 'object' ? Object.keys(v) : [];
    } catch {
      return [];
    }
  },

  'output.matches_convention': (sortie) => {
    const premiere = String(sortie).trim().split('\n')[0] || '';
    return CONVENTION.test(premiere.trim());
  },

  'output.files_touched': (sortie) => fichiersTouches(sortie),

  'output.patch_applies': (sortie) => patchPlausible(sortie)
};

/** Ce qu'on sait résoudre, pour que l'appelant n'ait pas à le deviner. */
export const RESOLVABLES = Object.keys(RESOLVEURS);

/** La valeur d'une cible, ou `undefined` si elle n'est pas résolvable sans le monde. */
export function resoudre(cible, sortie, ctx = {}) {
  const fn = RESOLVEURS[cible];
  return fn ? fn(sortie, ctx) : undefined;
}

/** L'opérateur d'un critère, appliqué à une valeur résolue. */
export function satisfait(valeur, op, attendu) {
  switch (op) {
    case 'eq': return valeur === attendu;
    case 'neq': return valeur !== attendu;
    case 'lt': return Number(valeur) < Number(attendu);
    case 'lte': return Number(valeur) <= Number(attendu);
    case 'gt': return Number(valeur) > Number(attendu);
    case 'gte': return Number(valeur) >= Number(attendu);
    /*
     * `contains` avec une LISTE attendue veut dire « tous », pas « la chaîne
     * "a,b,c" quelque part ».
     *
     * Sans ce traitement, `String(['df','lt'])` donnait `"df,lt"` et on cherchait cette
     * chaîne-là dans les clés : un critère à un seul élément passait par accident, un
     * critère à cinq échouait TOUJOURS. Les contrats extraits en produisent cinq — leurs
     * agents étaient donc déclarés non conformes en rendant exactement les bonnes clés.
     *
     * Un contrôle qui refuse à tort coûte aussi cher qu'un contrôle qui accepte à tort :
     * dans les deux cas on cesse de le croire.
     */
    case 'contains': {
      const contient = (cible) => (Array.isArray(valeur)
        ? valeur.some((v) => String(v).toLowerCase().includes(String(cible).toLowerCase()))
        : String(valeur).includes(String(cible)));
      return Array.isArray(attendu) ? attendu.every(contient) : contient(attendu);
    }
    case 'matches':
      try { return new RegExp(attendu).test(String(valeur)); } catch { return false; }
    case 'exists': return (valeur !== undefined && valeur !== null
      && !(Array.isArray(valeur) && valeur.length === 0)) === (attendu === true || attendu === 'true');
    default: return false;
  }
}

/**
 * Le post-vol : le contrat de l'artefact, évalué sur une sortie réelle.
 *
 * @returns {{constats, conforme, nonResolus}}
 *   `conforme` ne vaut `true` que si tout ce qui A PU être évalué passe. Ce qui n'a pas
 *   pu l'être est compté à part — le confondre avec un succès ferait passer un agent
 *   dont on n'a vérifié que la longueur pour un agent conforme.
 */
export function postvol(artifact, sortie, ctx = {}) {
  const constats = [];

  for (const c of artifact?.criteria || []) {
    const valeur = resoudre(c.target, sortie, ctx);
    if (valeur === undefined) {
      constats.push({ cible: c.target, op: c.op, attendu: c.value, valeur: null,
                      verdict: 'non résolu',
                      pourquoi: 'Cible de classe `state` : elle porte sur l\'état du monde '
                              + 'après exécution, et se résout au banc d\'essai, pas ici.' });
      continue;
    }
    const ok = satisfait(valeur, c.op, c.value);
    constats.push({ cible: c.target, op: c.op, attendu: c.value, valeur,
                    verdict: ok ? 'satisfait' : 'violé' });
  }

  const violes = constats.filter((x) => x.verdict === 'violé');
  const nonResolus = constats.filter((x) => x.verdict === 'non résolu');
  return { constats, conforme: violes.length === 0, violes, nonResolus };
}

export default { RESOLVEURS, RESOLVABLES, resoudre, satisfait, postvol };
