/*
 * Salsi — l'aide aux cas d'or.
 *
 * ── POURQUOI C'EST LE MORCEAU LE PLUS OBSCUR ─────────────────────────────────
 *
 * Un cas d'or demande quatre concepts d'un coup — un contexte, une attente, un nombre
 * d'exécutions, un seuil de succès — dans un vocabulaire que personne n'a jamais vu.
 * Et il en faut 3 pour « équipe », 5 pour « officiel » : le mur n'est pas la difficulté
 * d'un cas, c'est d'en écrire cinq.
 *
 * ── CE QUI REND L'AIDE POSSIBLE ──────────────────────────────────────────────
 *
 * Tout est déjà dans l'artefact, il suffit de ne pas le redemander :
 *
 *   le CONTEXTE   ← les variables déclarées : un cas fournit une valeur à chacune
 *   l'ATTENTE     ← les critères déclarés : ce qu'on vérifie en production est
 *                   exactement ce qu'un test doit vérifier
 *   le k/n        ← le genre de situation, qui dicte l'exigence
 *
 * Réutiliser les critères n'est pas une facilité : c'est ce qui rend le cas COHÉRENT
 * avec l'artefact par construction, donc `L022` satisfaite sans y penser.
 *
 * Et le vocabulaire disparaît : on ne demande pas `expects_violation`, on demande
 * « ce cas doit-il être refusé ? ». La réponse pose le drapeau.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/*
 * Les genres de situation. Le k/n vient de là, et il s'explique.
 *
 * `exige` est le seuil de succès en proportion — un cas nominal doit passer à tous les
 * coups, un cas limite tolère un raté sur cinq parce qu'un LLM n'est pas reproductible.
 */
export const SITUATIONS = [
  { id: 'nominal', icone: '✅', titre: 'Le cas courant',
    sous: 'tout se passe bien — c\'est ce qui doit marcher neuf fois sur dix',
    suffixe: 'nominal', runs: 5, exige: 5, viole: false,
    pourquoi: '5 succès sur 5 : le cas courant ne se rate pas.' },

  { id: 'limite', icone: '⚖️', titre: 'Un cas limite',
    sous: 'gros volume, entrée inhabituelle, situation rare mais légitime',
    suffixe: 'limite', runs: 5, exige: 4, viole: false,
    pourquoi: '4 sur 5 : un LLM n\'est pas reproductible, et un cas rare tolère un raté.' },

  { id: 'refus', icone: '🚫', titre: 'Un cas qui doit être REFUSÉ',
    sous: 'l\'agent doit détecter le problème, pas le laisser passer',
    suffixe: 'refuse', runs: 3, exige: 3, viole: true,
    pourquoi: '3 sur 3, et le cas est marqué comme testant volontairement un refus — sans quoi L022 signalerait une contradiction.' },

  { id: 'vide', icone: '🕳️', titre: 'Une entrée vide ou absente',
    sous: 'le dépôt n\'a pas ce qu\'il faut — l\'agent doit le dire, pas inventer',
    suffixe: 'sans-donnees', runs: 3, exige: 3, viole: true,
    pourquoi: '3 sur 3 : ne rien inventer est un comportement, pas une chance.' }
];

/** Un identifiant de cas conforme au motif du schéma. */
const identifiant = (index, suffixe) => `gc-${String(index + 1).padStart(2, '0')}-${suffixe}`;

/*
 * La valeur d'attente d'un cas de REFUS.
 *
 * Il faut produire une valeur que le critère rejette, sinon le cas ne teste pas un refus
 * — et le déclarer `expects_violation` mentirait. On la dérive de l'opérateur : c'est la
 * seule façon d'être sûr que la contradiction est réelle.
 */
function valeurQuiViole(critere) {
  const v = critere.value;
  switch (critere.op) {
    case 'eq': return typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1 : `${v}-inattendu`;
    case 'neq': return v;
    case 'lte': case 'lt': return Number(v) + 10;
    case 'gte': case 'gt': return Math.max(0, Number(v) - 10);
    case 'matches': return 'ne-correspond-pas';
    case 'contains': return 'absent';
    // `exists` porte sur la présence : un cas de refus n'a pas de valeur à opposer.
    default: return null;
  }
}

/*
 * La valeur d'attente d'un cas qui doit PASSER.
 *
 * `matches` rend `null` — et c'est le seul honnête. Produire une chaîne qui satisfasse
 * une expression régulière quelconque ne se dérive pas ; proposer le MOTIF comme valeur
 * serait faux, puisqu'un motif ne se correspond pas à lui-même. Le critère est donc
 * écarté de l'attente plutôt que d'y entrer avec une valeur que L022 signalerait aussitôt.
 *
 * `contains`, lui, se dérive : une chaîne se contient elle-même.
 */
function valeurQuiPasse(critere) {
  if (critere.op === 'exists') return true;
  if (critere.op === 'matches') return null;
  if (critere.op === 'neq') return typeof critere.value === 'number' ? Number(critere.value) + 1 : 'autre';
  if (critere.op === 'lte' || critere.op === 'lt') return Math.max(0, Number(critere.value) - 1);
  if (critere.op === 'gte' || critere.op === 'gt') return Number(critere.value) + 1;
  if (critere.op === 'contains') return String(critere.value);
  return critere.value;
}

/**
 * Compose les cas d'or à partir de l'artefact lui-même.
 *
 * @param {object} entree
 *   @param {Array}  entree.situations  identifiants choisis, dans l'ordre
 *   @param {Array}  entree.variables   variables déclarées (form)
 *   @param {Array}  entree.criteria    critères déclarés (form : value en chaîne)
 *   @param {Array}  entree.targets     registre des cibles, pour typer
 * @returns {Array} des cas d'or au format du formulaire
 */
export function composerCas({ situations = [], variables = [], criteria = [], targets = [] } = {}) {
  const typeDe = (cible) => (targets.find((t) => t.target === cible) || {}).type;

  // Les critères redeviennent typés : le formulaire les porte en chaînes.
  const criteres = criteria
    .filter((c) => c?.target)
    .map((c) => {
      const type = typeDe(c.target);
      const brut = c.value;
      const value = c.op === 'exists' ? true
        : type === 'boolean' ? (brut === true || brut === 'true')
        : type === 'number' ? Number(brut)
        : String(brut ?? '');
      return { target: c.target, op: c.op || 'eq', value };
    });

  return situations.map((id, i) => {
    const s = SITUATIONS.find((x) => x.id === id) || SITUATIONS[0];

    /*
     * Le contexte reprend les variables déclarées, avec des valeurs qui SE LISENT.
     * Un `repo: "valeur"` générique n'aiderait personne à comprendre ce que le cas
     * décrit ; `repo: "demo-nominal"` dit au moins de quoi on parle.
     */
    const contexte = variables
      .filter((v) => v?.name)
      .map((v) => ({ key: v.name, value: s.viole ? `${v.name}-${s.suffixe}` : `${v.name}-exemple` }));

    /*
     * L'attente vient des critères de l'artefact. Un cas de refus prend une valeur que
     * le critère rejette VRAIMENT — sinon le marquer `expects_violation` serait faux.
     */
    const attentes = criteres
      .map((c) => ({ target: c.target, value: s.viole ? valeurQuiViole(c) : valeurQuiPasse(c) }))
      .filter((a) => a.value !== null)
      .slice(0, s.viole ? 1 : criteres.length)   // un refus se prouve sur UN critère
      .map((a) => ({ target: a.target, value: String(a.value) }));

    return {
      id: identifiant(i, s.suffixe),
      context: contexte,
      expect: attentes,
      runs: String(s.runs),
      passAtLeast: String(s.exige),
      expectsViolation: s.viole && attentes.length > 0,
      // Pour l'écran : dire pourquoi ce k/n, sinon c'est un chiffre magique de plus.
      pourquoi: `${s.icone} ${s.titre} — ${s.pourquoi}`
    };
  });
}

/** Ce que le niveau visé réclame, et une proposition de situations pour y arriver. */
export const PROPOSITIONS = {
  experimental: ['nominal'],
  team: ['nominal', 'limite', 'refus'],
  officiel: ['nominal', 'nominal', 'limite', 'refus', 'vide']
};

export default { SITUATIONS, PROPOSITIONS, composerCas };
