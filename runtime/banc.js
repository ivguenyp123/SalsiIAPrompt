/*
 * Le banc d'essai — l'endroit où un niveau cesse d'être une intention.
 *
 * ── CE QUI MANQUAIT ──────────────────────────────────────────────────────────
 *
 * `target_level: officiel` est une ligne que l'auteur écrit. Le catalogue l'affiche
 * « officiel — visé », en pointillés, parce que rien ne l'a mesuré. Les cas d'or étaient
 * dans la même situation : L010 les COMPTE, L017 vérifie qu'ils assertent quelque chose,
 * L023 qu'ils jouent sur une entrée qui existe — et personne ne les jouait jamais.
 *
 * Trois règles pour garder des tests que rien n'exécute. C'est le défaut classique de la
 * gouvernance de papier, reproduit à l'intérieur d'un outil censé la remplacer.
 *
 * Ce module les joue. Il en tire deux choses, et seulement deux :
 *
 *   level          le niveau ATTEINT, dérivé du nombre de cas qui passent VRAIMENT
 *   certification  la preuve datée, attachée au modèle qui a répondu
 *
 * C'est exactement ce que `lib/niveau.js`, P005 et P006 attendent depuis le début. Le
 * jour où ce fichier écrit `derive/etat.json`, « officiel — visé » devient « officiel »
 * tout court, et le pré-vol se resserre tout seul : P006 refuse sur une mesure au lieu
 * de demander sur une déclaration. Aucune ligne à changer ailleurs pour ça.
 *
 * ── UN LLM N'EST PAS REPRODUCTIBLE ───────────────────────────────────────────
 *
 * D'où `runs` / `pass_at_least`, imposés par L017 : un cas joué une fois est un tirage,
 * pas une porte. Le banc joue k fois et compare le compte au seuil DÉCLARÉ par l'auteur.
 * Il ne choisit pas le seuil — il l'applique. La différence est tout le produit.
 *
 * ── MODULE PUR ───────────────────────────────────────────────────────────────
 *
 * Ni réseau, ni système de fichiers, ni horloge. `jouer()` est injecté : le banc ne sait
 * pas s'il parle à Vertex, à DeepSeek ou à un tableau de sorties enregistrées. C'est ce
 * qui permet de le tester sans dépenser un jeton — et de rejouer un jour des sorties
 * archivées pour comparer deux modèles sans les rappeler.
 */
import { resoudre, satisfait } from './resolveurs.js';
import { GOLDEN_THRESHOLDS } from '../lint/rules/criteria.js';
import { NIVEAUX } from '../lib/niveau.js';

/** Défaut de `runs` quand l'auteur n'en déclare pas — celui du schéma. */
export const RUNS_DEFAUT = 3;

/**
 * Durée de validité d'une certification.
 *
 * Un agent se périme sans qu'on y touche : le modèle bouge sous le prompt. Quatre-vingt-
 * dix jours n'est pas une mesure, c'est une convention — assumée comme telle, et elle
 * porte la seule propriété qui compte : une certification a une FIN. Sans date de
 * péremption, L016 et P005 n'auraient jamais rien à refuser.
 */
export const JOURS_DE_VALIDITE = 90;

/* ── L'attente d'un cas d'or ──────────────────────────────────────────────── */

/*
 * `expect: { output.length: 900 }` porte une valeur et pas d'opérateur. Il a donc fallu
 * décider ce que « 900 » veut dire — et surtout ne pas l'inventer ici.
 *
 * L'opérateur implicite est LE PREMIER que le registre des cibles déclare pour cette
 * cible. Ce n'est pas une convention de ce fichier : c'est une lecture du référentiel,
 * que le registre contrôle en ordonnant sa liste `ops`. Sur `output.length`, `ops` commence
 * par `lte` — « la sortie tient en 900 caractères », ce que voulaient dire tous les cas
 * d'or écrits jusqu'ici. Sur `output.contains_secret`, `ops: [eq]` — égalité stricte.
 *
 * Un auteur qui veut autre chose l'écrit : `output.length: { op: gte, value: 300 }`. Et
 * le banc affiche toujours l'opérateur retenu, en signalant s'il était implicite. Une
 * règle tacite qui décide d'un verdict doit au moins être lisible dans le verdict.
 */

/** La cible au registre, ou `undefined`. */
const cibleRef = (cible, targets) => (targets || []).find((t) => t.target === cible);

/** L'attente normalisée d'une entrée de `expect`. */
export function attente(cible, brut, targets = []) {
  const ref = cibleRef(cible, targets);
  const defaut = (ref?.ops || [])[0] || 'eq';

  const explicite = brut && typeof brut === 'object' && !Array.isArray(brut) && 'value' in brut;
  return {
    cible,
    op: explicite && brut.op ? brut.op : defaut,
    attendu: explicite ? brut.value : brut,
    implicite: !(explicite && brut.op)
  };
}

/* ── Le jugement d'une exécution ──────────────────────────────────────────── */

/**
 * Une exécution, confrontée aux attentes du cas.
 *
 * Trois verdicts par attente, et le troisième est le plus important :
 *   satisfait / violé  → l'attente a été ÉVALUÉE
 *   non résolu         → elle ne l'a pas été, et il faut que ça se voie
 *
 * Une cible de classe `state` porte sur l'état du monde après exécution : elle exige un
 * dépôt jetable et une CI isolée, pas une chaîne de caractères. La compter comme
 * satisfaite ferait certifier un agent sur des vérifications qui n'ont pas eu lieu — la
 * faute exacte que ce dépôt existe pour empêcher.
 *
 * @param {object} cas     le cas d'or
 * @param {string} sortie  le texte rendu par le modèle
 * @returns {{constats, reussi, echoue, jugeable}}
 */
export function jugerRun(cas, sortie, { targets = [], ctx = {} } = {}) {
  const constats = Object.entries(cas?.expect || {}).map(([cible, brut]) => {
    const a = attente(cible, brut, targets);
    const ref = cibleRef(cible, targets);

    if (!ref) {
      return { ...a, valeur: null, verdict: 'non résolu',
               pourquoi: `Cible \`${cible}\` absente du registre des cibles : le banc ne sait `
                       + 'pas ce qu\'elle désigne. Vérifie l\'orthographe, ou déclare-la.' };
    }

    if (ref.class === 'state') {
      return { ...a, valeur: null, verdict: 'non résolu',
               pourquoi: `Cible de classe \`state\` : elle porte sur l'état du monde après `
                       + 'exécution. Il faut un dépôt jetable et une CI isolée — le banc de '
                       + 'sortie ne peut pas la résoudre.' };
    }

    const valeur = resoudre(cible, sortie, ctx);
    if (valeur === undefined) {
      return { ...a, valeur: null, verdict: 'non résolu',
               pourquoi: `Aucun résolveur pour \`${cible}\` : la cible est déclarée \`form\` au `
                       + 'registre mais rien ne sait la calculer.' };
    }

    return { ...a, valeur, verdict: satisfait(valeur, a.op, a.attendu) ? 'satisfait' : 'violé' };
  });

  const violes = constats.filter((c) => c.verdict === 'violé');
  const ouverts = constats.filter((c) => c.verdict === 'non résolu');

  return {
    constats, violes, ouverts,
    jugeable: ouverts.length === 0,
    // Une attente violée suffit à faire échouer, même si une autre reste ouverte : ce
    // qu'on a vu est un fait, et il est mauvais.
    echoue: violes.length > 0,
    reussi: violes.length === 0 && ouverts.length === 0
  };
}

/* ── L'agrégation d'un cas ────────────────────────────────────────────────── */

/** Le nombre d'exécutions d'un cas, avec l'éventuelle réduction en ligne de commande. */
export const runsDe = (cas, force = null) => Math.max(1, force ?? cas?.runs ?? RUNS_DEFAUT);

/**
 * k/n, comparé au seuil de l'auteur.
 *
 * Sans `pass_at_least`, le seuil implicite est `runs` — TOUTES. C'est le plus strict, et
 * c'est volontaire : L017 avertit déjà qu'un seuil implicite rend le verdict flou, et
 * choisir ici le plus permissif transformerait un oubli en cadeau.
 */
export function agregerCas(cas, resultats, { force = null } = {}) {
  const attendus = runsDe(cas, force);
  const reussites = resultats.filter((r) => r.reussi).length;
  const echecs = resultats.filter((r) => r.echoue).length;
  const erreurs = resultats.filter((r) => r.erreur).length;
  const seuil = cas?.pass_at_least ?? attendus;

  return {
    id: cas?.id,
    runs: resultats.length,
    attendus,
    reussites,
    echecs,
    erreurs,
    // Ni réussi ni échoué : attente non résolue, ou l'appel n'a pas abouti.
    indecis: resultats.length - reussites - echecs,
    seuil,
    seuilImplicite: cas?.pass_at_least === undefined,
    passe: resultats.length > 0 && reussites >= seuil,
    resultats
  };
}

/* ── La dérivation du niveau ──────────────────────────────────────────────── */

const ordre = (cle) => NIVEAUX[cle]?.ordre ?? 0;

/**
 * Le niveau ATTEINT.
 *
 * Deux règles, et rien d'autre :
 *
 *   1. il se dérive du nombre de cas qui PASSENT, contre les seuils de L010. L010 compte
 *      les cas DÉCLARÉS pour autoriser une ambition ; le banc compte ceux qui tiennent.
 *      C'est le même barème, appliqué à la preuve au lieu de l'intention.
 *   2. il est plafonné au niveau VISÉ. Un artefact qui vise `équipe` et réussit six cas
 *      n'est pas promu `officiel` dans son dos : le niveau engage son auteur, il ne
 *      s'attribue pas tout seul.
 *
 * Et une exception, assumée : un seul cas en échec plafonne à `équipe`. `officiel` est le
 * niveau qui ouvre la production — le décerner en sachant qu'un scénario déclaré casse
 * serait précisément le mensonge que la pastille « visé » avait été inventée pour éviter.
 * En dessous, l'échec est une information, pas un disqualifiant : `équipe` dit « trois
 * scénarios tiennent », ce qui reste vrai.
 */
export function deriverNiveau(artifact, cas = []) {
  const vise = NIVEAUX[artifact?.target_level] ? artifact.target_level : 'experimental';
  const passants = cas.filter((c) => c.passe).length;
  const rates = cas.filter((c) => !c.passe);

  let atteint = 'experimental';
  for (const [cle, seuil] of Object.entries(GOLDEN_THRESHOLDS)) {
    if (passants >= seuil && ordre(cle) > ordre(atteint)) atteint = cle;
  }

  const plafonne = ordre(atteint) > ordre(vise);
  if (plafonne) atteint = vise;

  const freine = rates.length > 0 && atteint === 'officiel';
  if (freine) atteint = 'team';

  return {
    level: atteint,
    vise,
    passants,
    total: cas.length,
    rates: rates.map((c) => c.id),
    plafonne,
    freine,
    pourquoi: freine
      ? `${passants} cas sur ${cas.length} passent, mais ${rates.length} échoue(nt) : `
        + '`officiel` ouvre la production, il ne se décerne pas avec un scénario cassé.'
      : plafonne
        ? `${passants} cas passent — de quoi viser plus haut, mais l'artefact vise \`${vise}\`.`
        : `${passants} cas sur ${cas.length} ${passants > 1 ? 'passent' : 'passe'} `
          + `(seuil \`${atteint}\` : ${GOLDEN_THRESHOLDS[atteint]}).`
  };
}

/* ── La certification ─────────────────────────────────────────────────────── */

const jour = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * La preuve datée, ou `null`.
 *
 * Elle n'est décernée qu'à un passage COMPLET et sans échec. Trois raisons de dire non,
 * et chacune est renvoyée en clair plutôt que sous un `null` muet :
 *
 *   — aucun cas joué : certifier sur zéro test serait certifier sur rien
 *   — un cas en échec : c'est la définition du mot
 *   — un cas non concluant : une attente non résolue, ou un appel qui n'a pas abouti.
 *     Ce n'est pas un échec de l'agent, et c'est quand même un « on ne sait pas » — donc
 *     pas une preuve.
 *
 * `model_version` porte le modèle RÉEL, pas le palier : c'est la clé que P005 compare à
 * l'exécution en cours pour dire « certifié sur un autre modèle ». Un palier ne bouge
 * jamais, un modèle si — c'est tout l'intérêt.
 */
export function certifier({ artifact, cas = [], modele, fournisseur, date,
                            jours = JOURS_DE_VALIDITE } = {}) {
  const refus = (raison) => ({ certification: null, raison });

  if (cas.length === 0) return refus('Aucun cas d\'or joué : il n\'y a rien à certifier.');

  const rates = cas.filter((c) => !c.passe);
  if (rates.length) {
    return refus(`${rates.length} cas d'or en échec (${rates.map((c) => c.id).join(', ')}).`);
  }

  const flous = cas.filter((c) => c.indecis > 0 || c.erreurs > 0);
  if (flous.length) {
    return refus(`${flous.length} cas non concluant(s) (${flous.map((c) => c.id).join(', ')}) — `
               + 'attente non résolue, ou appel sans réponse. Une certification se décerne sur '
               + 'une mesure, pas sur un doute.');
  }

  const debut = new Date(date);
  const fin = new Date(debut.getTime() + jours * 86_400_000);

  return {
    certification: {
      model_version: modele,
      fournisseur,
      certified_on: jour(debut),
      expires_on: jour(fin),
      cas: `${cas.length}/${cas.length}`,
      executions: cas.reduce((n, c) => n + c.runs, 0),
      artefact_version: artifact?.version || null
    },
    raison: ''
  };
}

/* ── Le plan, avant de dépenser ───────────────────────────────────────────── */

/** Les cas retenus : tous, ou celui qu'on a nommé. */
export function casRetenus(artifact, filtre = null) {
  const tous = artifact?.golden_cases || [];
  return filtre ? tous.filter((g) => g.id === filtre) : tous;
}

/**
 * Ce que le passage va coûter, AVANT de le lancer.
 *
 * Un banc d'essai est la seule partie de ce produit qui dépense de l'argent en boucle :
 * cinq cas à cinq exécutions font vingt-cinq appels pour un seul artefact. Annoncer le
 * compte avant de partir n'est pas une politesse, c'est ce qui empêche de découvrir la
 * facture après.
 *
 * L'estimation de jetons est GROSSIÈRE et le dit : quatre caractères par jeton, et le
 * plafond de `output.length` comme majorant de la sortie. On préfère une fourchette
 * annoncée comme telle à un silence.
 */
export function plan(artifact, { cas: filtre = null, runs: force = null, longueurPrompt = 0 } = {}) {
  const liste = casRetenus(artifact, filtre).map((g) => ({ id: g.id, runs: runsDe(g, force) }));
  const appels = liste.reduce((n, c) => n + c.runs, 0);

  const plafond = (artifact?.criteria || [])
    .filter((c) => c.target === 'output.length' && ['lte', 'lt'].includes(c.op))
    .map((c) => Number(c.value))
    .sort((a, b) => a - b)[0] || 2000;

  return {
    cas: liste,
    appels,
    jetons: {
      entree: Math.ceil(longueurPrompt / 4) * appels,
      sortie: Math.ceil(plafond / 4) * appels
    }
  };
}

/* ── Le passage ───────────────────────────────────────────────────────────── */

/**
 * Joue les cas d'or d'un artefact.
 *
 * @param {object} artifact
 * @param {object} options
 *   @param {Function} options.jouer   async (cas, i) => { sortie } | { erreur } — injecté
 *   @param {Array}  [options.targets] registre des cibles, pour l'opérateur implicite
 *   @param {string} [options.cas]     ne jouer qu'un cas
 *   @param {number} [options.runs]    forcer le nombre d'exécutions (essai à moindre coût)
 *   @param {Function} [options.sur]   (evenement) => void — pour l'affichage en direct
 * @returns {{cas, niveau, artifact}}
 */
export async function passer(artifact, { jouer, targets = [], cas: filtre = null,
                                         runs: force = null, sur = () => {} } = {}) {
  const retenus = casRetenus(artifact, filtre);
  const resultatsParCas = [];

  for (const cas of retenus) {
    const n = runsDe(cas, force);
    const resultats = [];

    for (let i = 0; i < n; i++) {
      let brut;
      try {
        brut = await jouer(cas, i);
      } catch (error) {
        brut = { erreur: error?.message || String(error) };
      }

      if (brut?.erreur) {
        // Un appel qui n'aboutit pas n'est pas un échec de l'agent : c'est une mesure
        // qui n'a pas eu lieu. Le confondre avec un échec ferait chuter un niveau sur
        // une coupure réseau.
        resultats.push({ run: i, erreur: brut.erreur, reussi: false, echoue: false,
                         jugeable: false, constats: [], violes: [], ouverts: [] });
      } else {
        resultats.push({ run: i, sortie: brut?.sortie ?? '', jetons: brut?.jetons || null,
                         cout: brut?.cout ?? null, modele: brut?.modele || '',
                         ...jugerRun(cas, brut?.sortie ?? '', { targets, ctx: { artifact } }) });
      }
      sur({ type: 'run', cas: cas.id, i, total: n, resultat: resultats[i] });
    }

    const agrege = agregerCas(cas, resultats, { force });
    resultatsParCas.push(agrege);
    sur({ type: 'cas', resultat: agrege });
  }

  return { artifact: artifact?.id, cas: resultatsParCas, niveau: deriverNiveau(artifact, resultatsParCas) };
}

/** Le coût réellement dépensé par un passage — la somme de ce que les appels ont coûté. */
export function depense(cas = []) {
  let euros = 0; let connu = false; let entree = 0; let sortie = 0; let appels = 0;
  for (const c of cas) {
    for (const r of c.resultats || []) {
      if (r.erreur) continue;
      appels++;
      entree += r.jetons?.entree || 0;
      sortie += r.jetons?.sortie || 0;
      if (typeof r.cout === 'number') { euros += r.cout; connu = true; }
    }
  }
  // `null` et pas `0` : sans tarif déclaré, le coût est INCONNU. Zéro serait une mesure.
  return { appels, jetons: { entree, sortie }, euros: connu ? euros : null };
}

export default { passer, plan, jugerRun, agregerCas, deriverNiveau, certifier, attente,
                 casRetenus, depense, runsDe, RUNS_DEFAUT, JOURS_DE_VALIDITE };
