/*
 * L002 · L003 — cohérence entre le spec et les variables déclarées.
 */
import { finding, ERROR, WARN, interpolations } from '../core.js';

/**
 * L002 — Toute {{variable}} du spec est déclarée. 🔴
 * Une variable non déclarée n'a pas de source : la plateforme ne saurait pas quoi
 * injecter à l'exécution, et l'utilisateur verrait un {{trou}} partir vers le modèle.
 */
export function L002(artifact) {
  const used = interpolations(artifact?.spec);
  const declared = new Set((artifact?.variables || []).map((v) => v.name));

  return used
    .filter((name) => !declared.has(name))
    .map((name) =>
      finding(
        'L002', ERROR,
        `La variable {{${name}}} est utilisée dans le spec mais n'est pas déclarée. ` +
        'Ajouter une entrée dans `variables` avec sa source (user, signal ou repo).',
        'spec'
      )
    );
}

/**
 * L003 — Toute variable déclarée est utilisée. 🟡
 * Non bloquant : une variable morte est du bruit, pas un risque.
 */
export function L003(artifact) {
  const used = new Set(interpolations(artifact?.spec));

  return (artifact?.variables || [])
    .filter((v) => !used.has(v.name))
    .map((v, i) =>
      finding(
        'L003', WARN,
        `La variable \`${v.name}\` est déclarée mais n'apparaît jamais dans le spec.`,
        `variables[${i}].name`
      )
    );
}

/**
 * L021 — Un spec qui déclare des entrées doit en utiliser au moins une. 🔴
 *
 * Règle de COHÉRENCE STRUCTURELLE, pas de jugement : un artefact qui déclare recevoir
 * le dépôt et la stack, puis n'interpole rien, ne peut pas faire le travail qu'il
 * annonce. Le spec et les variables décrivent alors deux choses différentes.
 *
 * C'est la seule prise déterministe sérieuse sur le prompt vide de sens : « prout prout
 * prout » passe la longueur, le schéma et les critères, mais n'utilise aucune de ses
 * entrées. Le sens, lui, reste hors de portée du lint — c'est le banc d'essai qui
 * tranche, en jouant les cas d'or.
 *
 * L003 signale la même incohérence variable par variable, mais en avertissement : une
 * variable morte est du bruit. Zéro variable vivante, c'est un artefact cassé.
 */
export function L021(artifact) {
  const declared = artifact?.variables || [];
  if (declared.length === 0) return [];

  const used = new Set(interpolations(artifact?.spec));
  if (declared.some((v) => used.has(v.name))) return [];

  return [
    finding(
      'L021', ERROR,
      `Le spec déclare ${declared.length} variable(s) (${declared.map((v) => v.name).join(', ')}) ` +
      'et n\'en interpole aucune : il ne peut pas faire ce qu\'il annonce. ' +
      'Utiliser {{' + declared[0].name + '}} dans le spec, ou retirer la déclaration.',
      'spec'
    )
  ];
}
