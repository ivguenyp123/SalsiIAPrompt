/*
 * Le référentiel des dépôts — faire cesser P002 et P004 d'être déclaratifs.
 *
 * ── LE TROU, DIT FRANCHEMENT ─────────────────────────────────────────────────
 *
 * `P002` refuse qu'un agent autorisé sur de l'interne lise un dépôt confidentiel. C'est
 * LE contrôle qui porte le risque de fuite. Et jusqu'ici, la sensibilité qu'il compare
 * était un menu déroulant rempli par celui qui lance.
 *
 * Autrement dit : le contrôle demandait à la personne contrôlée de se déclarer conforme.
 * Il refusait honnêtement ce qu'on lui disait — et on pouvait lui dire n'importe quoi.
 *
 * ── CE QUE CE MODULE CHANGE, ET CE QU'IL NE CHANGE PAS ───────────────────────
 *
 * Il ne touche à AUCUN contrôle. `P002` et `P004` lisent `ctx.depot` comme avant. Ce qui
 * change est d'où `ctx.depot` vient : du référentiel quand il connaît le dépôt, de la
 * saisie sinon.
 *
 * Trois provenances, et l'écran doit les distinguer :
 *
 *   `referentiel`  classé, non modifiable. Le contrôle REFUSE sur cette base.
 *   `declare`      saisi à la main, faute de mieux. Le contrôle DEMANDE confirmation.
 *   `inconnu`      rien du tout. Le contrôle demande aussi.
 *
 * C'est la règle habituelle de la maison : un contrôle refuse ce qu'il SAIT, il demande
 * ce qu'il IGNORE. Le référentiel est simplement ce qui fait passer un dépôt de la
 * seconde colonne à la première.
 *
 * ── POURQUOI IL EST LIVRÉ VIDE ───────────────────────────────────────────────
 *
 * Classer les dépôts de la banque n'est pas une décision de code. Inventer trois entrées
 * plausibles produirait exactement le mal que ce produit combat : une donnée fabriquée
 * qui a l'aplomb d'une donnée vérifiée — et ici elle servirait à autoriser des lectures.
 *
 * `registries/repos.yaml` porte donc le format, des exemples EN COMMENTAIRE, et aucune
 * entrée active. Tant qu'il est vide, rien ne bouge : tout est `declare`, comme
 * aujourd'hui. La première ligne ajoutée resserre le contrôle sur ce dépôt-là, sans
 * qu'une ligne de code change.
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers.
 */

/*
 * La nomenclature vient du pré-vol, elle n'est pas recopiée ici.
 *
 * Deux listes qui doivent rester égales finissent par ne plus l'être, et le jour où ça
 * arrive, le référentiel accepte un mot que `P002` ne sait pas ordonner : il ne compare
 * plus rien, en ayant l'air de comparer.
 */
export { SENSIBILITES } from '../preflight/index.js';
import { SENSIBILITES as ECHELLE } from '../preflight/index.js';

/** D'où vient ce qu'on sait d'un dépôt. */
export const PROVENANCES = {
  referentiel: { label: 'du référentiel', ferme: true,
                 aide: 'Classé au référentiel des dépôts. Non modifiable ici — et le pré-vol refuse sur cette base.' },
  declare: { label: 'déclaré à la main', ferme: false,
             aide: 'Ce dépôt n\'est pas au référentiel. Le pré-vol demandera confirmation au lieu de refuser.' },
  inconnu: { label: 'inconnu', ferme: false,
             aide: 'Rien de connu sur ce dépôt. Le pré-vol demandera confirmation.' }
};

/**
 * Le motif d'une entrée, comparé à un chemin de dépôt.
 *
 * `groupe/*` couvre un groupe entier, `groupe/sous/*` un sous-groupe. C'est le seul
 * joker admis : une expression régulière dans un référentiel de sécurité est une porte
 * dérobée qu'on n'ose plus relire.
 */
export function correspond(motif, chemin) {
  const m = String(motif || '').trim().toLowerCase();
  const c = String(chemin || '').trim().toLowerCase().replace(/\.git$/, '');
  if (!m || !c) return false;
  if (!m.endsWith('/*')) return m === c;
  const prefixe = m.slice(0, -1);          // « groupe/ »
  return c.startsWith(prefixe) && c.length > prefixe.length;
}

/**
 * Ce que le référentiel sait d'un dépôt.
 *
 * L'entrée EXACTE l'emporte sur le joker : classer un groupe en `interne` puis en
 * extraire un dépôt `confidentiel` est le cas normal, et l'ordre du fichier ne doit pas
 * décider à la place de la précision.
 *
 * @param {string} chemin  `groupe/depot`
 * @param {Array}  entrees contenu de `registries/repos.yaml`
 */
export function classer(chemin, entrees = []) {
  const liste = Array.isArray(entrees) ? entrees : [];
  const exact = liste.find((e) => !String(e?.depot || '').endsWith('/*')
                                  && correspond(e?.depot, chemin));
  const joker = liste
    .filter((e) => String(e?.depot || '').endsWith('/*') && correspond(e?.depot, chemin))
    // Le motif le plus long est le plus précis : `a/b/*` l'emporte sur `a/*`.
    .sort((x, y) => String(y.depot).length - String(x.depot).length)[0];

  const e = exact || joker;
  if (!e) return { connu: false, provenance: 'inconnu', scope: null, sensibilite: null,
                   par: null };

  return {
    connu: true,
    provenance: 'referentiel',
    scope: e.scope || null,
    sensibilite: ECHELLE.includes(e.sensibilite) ? e.sensibilite : null,
    par: e.depot
  };
}

/**
 * Le contexte `depot` à passer au pré-vol.
 *
 * Le référentiel a le dernier mot quand il sait. Un utilisateur ne peut pas déclasser un
 * dépôt confidentiel en le disant public — sans quoi le référentiel ne serait qu'un
 * pré-remplissage, et `P002` continuerait de croire sur parole.
 */
export function contexteDepot(chemin, entrees = [], saisie = {}) {
  const su = classer(chemin, entrees);
  if (su.connu) {
    return {
      path: chemin,
      // Le référentiel peut ne renseigner qu'une colonne : ce qu'il tait reste saisissable.
      scope: su.scope || saisie.scope || undefined,
      sensibilite: su.sensibilite || saisie.sensibilite || undefined,
      provenance: su.sensibilite ? 'referentiel' : 'declare',
      par: su.par
    };
  }
  const rien = !saisie.scope && !saisie.sensibilite;
  return {
    path: chemin,
    scope: saisie.scope || undefined,
    sensibilite: saisie.sensibilite || undefined,
    provenance: rien ? 'inconnu' : 'declare',
    par: null
  };
}

/** Le nombre de dépôts couverts — ce que l'écran affiche pour dire l'état du chantier. */
export const couverture = (entrees = []) => ({
  entrees: (Array.isArray(entrees) ? entrees : []).length,
  jokers: (Array.isArray(entrees) ? entrees : [])
    .filter((e) => String(e?.depot || '').endsWith('/*')).length
});

export default { SENSIBILITES: ECHELLE, PROVENANCES, correspond, classer, contexteDepot,
                 couverture };
