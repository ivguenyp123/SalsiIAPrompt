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
