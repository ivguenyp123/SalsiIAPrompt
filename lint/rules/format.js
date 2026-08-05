/*
 * L018 · L019 · L020 — format du spec lui-même.
 *
 * Ces trois règles ne regardent que le texte : elles sont donc évaluables à la frappe
 * dans le Studio, sans rien connaître du dépôt, du modèle ni de l'état dérivé.
 */
import { finding, ERROR, WARN } from '../core.js';

/** Restes de rédaction. Objectifs et sans ambiguïté, donc bloquants. */
const LEFTOVERS = [
  { re: /\bTODO\b/i,            label: 'TODO' },
  { re: /\bFIXME\b/i,           label: 'FIXME' },
  { re: /\bTBD\b/,              label: 'TBD' },
  { re: /\bXXX+\b/,             label: 'XXX' },
  { re: /\blorem ipsum\b/i,     label: 'lorem ipsum' },
  { re: /\[\s*à (?:compléter|remplir|définir)\s*\]/i, label: '[à compléter]' },
  { re: /<\s*à (?:compléter|remplir|définir)\s*>/i,   label: '<à compléter>' },
  { re: /\bbla\s*bla\b/i,       label: 'bla bla' },
  { re: /_{3,}/,                label: 'blanc à remplir (___)' }
];

/**
 * L018 — Aucun reste de rédaction dans le spec. 🔴
 * Un `TODO` dans un artefact publié, c'est un prompt inachevé qui part vers le modèle
 * à chaque exécution — et que personne ne relira jamais.
 */
export function L018(artifact) {
  const spec = artifact?.spec;
  if (typeof spec !== 'string') return [];

  return LEFTOVERS
    .filter(({ re }) => re.test(spec))
    .map(({ label }) => finding(
      'L018', ERROR,
      `Reste de rédaction dans le spec (\`${label}\`) : l'artefact n'est pas terminé.`,
      'spec'
    ));
}

/**
 * Marqueurs de logique. Motifs volontairement étroits : `si` seul est trop courant
 * en français pour servir de signal.
 */
const LOGIC = [
  { re: /\bsi\b[^.!?\n]{3,60}\balors\b/i,     label: 'condition « si … alors »' },
  { re: /\bif\b[^.!?\n]{3,60}\bthen\b/i,      label: 'condition « if … then »' },
  { re: /\bpour chaque\b/i,                   label: 'boucle « pour chaque »' },
  { re: /\btant que\b/i,                      label: 'boucle « tant que »' },
  { re: /\bfor each\b/i,                      label: 'boucle « for each »' },
  { re: /\brépète(?:r|z)?\s+(?:l|c|j)/i,      label: 'répétition explicite' },
  { re: /\bboucle(?:r|z)?\s+(?:sur|tant)/i,   label: 'boucle explicite' }
];

/**
 * L019 — Pas de logique dans le spec. 🟡
 *
 * Le schéma de l'artefact est délibérément non Turing-complet : pas de condition, pas
 * de boucle. Le jour où un auteur en écrit une, c'est que la logique appartient à un
 * module déterministe, pas au prompt — c'est la défense contre le YAML qui pourrit en
 * mauvais langage de programmation.
 *
 * Avertissement et non refus : la frontière est affaire de jugement, et une règle
 * bloquante ici produirait des faux positifs sur de la prose légitime.
 */
export function L019(artifact) {
  const spec = artifact?.spec;
  if (typeof spec !== 'string') return [];

  const hit = LOGIC.find(({ re }) => re.test(spec));
  if (!hit) return [];

  return [finding(
    'L019', WARN,
    `Le spec contient de la logique (${hit.label}). Un artefact décrit une intention ; ` +
    'un enchaînement conditionnel appartient à un module déterministe, où il est ' +
    'testable et ne dépend pas de l\'humeur du modèle.',
    'spec'
  )];
}

/** Bornes hautes. La borne basse est déjà portée par le `minLength` du schéma. */
const SPEC_MIN_WARN = 150;   // en-deçà, ce n'est pas une consigne, c'est une note
const SPEC_WARN = 12000;
const SPEC_MAX = 30000;

/**
 * L020 — Taille du spec dans des bornes exploitables. 🔴 / 🟡
 * Un spec démesuré fait exploser le palier de modèle, dilue les consignes qui comptent,
 * et coûte à chaque exécution.
 */
export function L020(artifact) {
  const size = String(artifact?.spec || '').length;

  if (size > SPEC_MAX) {
    return [finding('L020', ERROR, `Spec de ${size} caractères (maximum ${SPEC_MAX}) : à découper, ou à déporter dans un module.`, 'spec')];
  }
  if (size > 0 && size < SPEC_MIN_WARN) {
    return [finding('L020', WARN, `Spec de ${size} caractères : en-deçà de ${SPEC_MIN_WARN}, on décrit rarement une tâche complète. À vérifier en revue.`, 'spec')];
  }
  if (size > SPEC_WARN) {
    return [finding('L020', WARN, `Spec de ${size} caractères : au-delà de ${SPEC_WARN}, les consignes qui comptent se diluent et le coût par exécution grimpe.`, 'spec')];
  }
  return [];
}
