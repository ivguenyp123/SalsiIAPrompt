/*
 * Lancer un artefact pour de vrai — le moment 5, avec un modèle au bout.
 *
 * ── LA CHAÎNE COMPLÈTE, ENFIN ────────────────────────────────────────────────
 *
 *   1. le spec est RENDU : chaque {{variable}} reçoit sa valeur
 *   2. le pré-vol tranche : refus, ou départ sous confirmation
 *   3. Vertex répond
 *   4. le post-vol évalue le contrat sur la sortie RÉELLE
 *
 * Le 4 est le nouveau. `criteria` était déclaré depuis le début et jamais évalué : le
 * registre décrivait des vérifications que personne ne faisait. Maintenant chaque
 * exécution rend un verdict, calculé par du code, sans juge LLM.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ─────────────────────────────────────────────
 *
 * Il n'appelle aucun outil d'ÉCRITURE. Un artefact qui déclare `bump_image_tag` verra
 * son spec parti au modèle et sa sortie évaluée, mais rien ne sera écrit dans un dépôt.
 * L'écriture passe par `runtime/executer.js`, derrière la confirmation humaine que P007
 * rend obligatoire. Mélanger les deux ferait qu'un `lancer()` mal appelé toucherait un
 * dépôt de production.
 */
import { prevol } from '../preflight/index.js';
import { ERROR } from '../lint/index.js';
import { postvol } from './resolveurs.js';
import { cout } from './vertex.js';
import { natureDeCle, entree as entreeBanque } from '../lib/entrees.js';

/** Une variable non résolue dans un spec rendu. Sert à refuser un prompt à trou. */
export const TROU = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * Rend le spec.
 *
 * Les valeurs sont insérées TELLES QUELLES, sans échappement : le spec n'est pas du HTML
 * et le modèle n'est pas un navigateur. Ce qui compte ici est ailleurs — une variable
 * sans valeur ne devient pas la chaîne vide, elle RESTE visible, pour que le contrôle
 * qui suit puisse la voir et refuser.
 */
export function rendre(spec, valeurs = {}) {
  return String(spec || '').replace(TROU, (tout, nom) =>
    (valeurs[nom] === undefined || valeurs[nom] === null || valeurs[nom] === '')
      ? tout : String(valeurs[nom]));
}

/** Les variables restées sans valeur après rendu. */
export const trous = (rendu) => [...new Set([...String(rendu).matchAll(TROU)].map((m) => m[1]))];

/**
 * Résout le contexte d'un cas d'or en valeurs de variables.
 *
 * `diff_fixture: petit-fix` ne se substitue pas à `{{diff_fixture}}` — il n'y a pas de
 * variable de ce nom. Il désigne un FICHIER de la banque, dont le contenu devient la
 * valeur de `{{diff}}`. C'est là que la banque cesse d'être un manifeste pour devenir
 * de la matière qui entre dans un prompt.
 *
 * @param {Function} lireEntree  (entree) => texte — injecté : ce module ne lit rien
 */
export function valeursDepuisContexte(contexte = {}, banque = null, lireEntree = () => '') {
  const out = {};
  for (const [cle, valeur] of Object.entries(contexte)) {
    const nature = natureDeCle(cle);
    if (!nature) { out[cle] = valeur; continue; }
    const e = entreeBanque(banque, nature, String(valeur));
    // Une entrée absente ne devient pas une chaîne vide : L023 l'a déjà refusée au lint,
    // et laisser passer ici transformerait un test cassé en test qui passe sur du vide.
    if (!e) throw new Error(`Entrée \`${valeur}\` de nature \`${nature}\` absente de la banque.`);
    out[nature] = lireEntree(e);
  }
  return out;
}

/**
 * Lance un artefact.
 *
 * @param {object} artifact
 * @param {object} options
 *   @param {object} options.vertex    client créé par createVertex()
 *   @param {object} options.valeurs   valeurs des variables
 *   @param {object} options.contexte  contexte d'exécution du pré-vol (dépôt, criticité…)
 *   @param {object} options.models    registre des modèles, pour le coût
 *   @param {boolean} [options.assume]  l'humain a coché la confirmation du pré-vol
 * @returns {{prevol, prompt, sortie, postvol, cout, modele, jetons}}
 */
export async function lancer(artifact, { vertex, valeurs = {}, contexte = {},
                                         models = [], assume = false } = {}) {
  /*
   * Le pré-vol AVANT le premier jeton dépensé. C'est toute sa raison d'être : refuser
   * après l'appel coûterait le prix de l'appel et aurait laissé le prompt partir.
   */
  const avant = prevol(artifact, { ...contexte, valeurs });
  if (avant.bloque) {
    return { prevol: avant, refuse: true, sortie: null, postvol: null,
             raison: `Pré-vol refusé : ${[...new Set(avant.constats.filter((c) => c.severity === ERROR)
                                                        .map((c) => c.code))].join(', ')}.` };
  }

  /*
   * La confirmation n'est pas un refus, c'est une condition de départ — et une condition
   * qu'un appel automatique ne doit pas pouvoir sauter. C'est ici qu'elle devient
   * mécanique au lieu de dépendre de la discipline de l'appelant.
   */
  if (avant.confirmationRequise && !assume) {
    return { prevol: avant, refuse: true, sortie: null, postvol: null,
             raison: `${avant.raisons.length} point(s) exigent une confirmation humaine : `
                   + `${avant.raisons.map((c) => c.code).join(', ')}. Rien ne part sans elle.` };
  }

  const prompt = rendre(artifact.spec, valeurs);
  const manquantes = trous(prompt);
  if (manquantes.length) {
    // P003 l'a normalement déjà dit ; ce garde-fou attrape le cas où une variable est
    // utilisée dans le spec sans être déclarée — L002 au lint, mais un fichier écrit à
    // la main dans le dépôt ne passe pas par le Studio.
    return { prevol: avant, refuse: true, sortie: null, postvol: null,
             raison: `Le prompt partirait avec ${manquantes.length} trou(s) : ${manquantes.join(', ')}.` };
  }

  const reponse = await vertex.generer({ prompt, tier: artifact.model_tier || 'mid' });
  const apres = postvol(artifact, reponse.texte, { valeurs, artifact });

  return {
    prevol: avant,
    refuse: false,
    prompt,
    sortie: reponse.texte,
    modele: reponse.modele,
    jetons: reponse.jetons,
    motifArret: reponse.motifArret,
    cout: cout(reponse, models),
    postvol: apres
  };
}

export default { lancer, rendre, trous, valeursDepuisContexte, TROU };
