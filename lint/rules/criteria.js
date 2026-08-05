/*
 * L008 · L009 · L017 — le contrat de runtime et les cas d'or.
 *
 * Rappel de la distinction, souvent confondue :
 *   criteria     → contrat de RUNTIME, évalué au moment 5 sur chaque exécution en
 *                  production. Déclaratif par nécessité : la plateforme l'applique
 *                  et le relecteur l'inspecte. D'où le registre des cibles.
 *   golden_cases → TESTS de développement, joués au banc d'essai.
 */
import { finding, ERROR, WARN, indexBy, jsonType } from '../core.js';

/** Seuils de cas d'or par niveau visé (L010, appliqué dans lifecycle.js). */
export const GOLDEN_THRESHOLDS = { experimental: 0, team: 3, officiel: 5 };

/**
 * L008 — `criteria` non vide. 🔴
 * Sans critère, rien n'est vérifiable au post-vol : on retombe sur du jugement.
 */
export function L008(artifact) {
  if (Array.isArray(artifact?.criteria) && artifact.criteria.length > 0) return [];
  return [
    finding(
      'L008', ERROR,
      'Aucun critère : l\'artefact n\'est pas vérifiable au post-vol. Un agent de lecture ' +
      'peut assertir sur la FORME de sa sortie (cibles de classe `form` : patch applicable, ' +
      'JSON valide, sections présentes, absence de secret).',
      'criteria'
    )
  ];
}

/**
 * L009 — Chaque critère est assertable. 🔴
 * Assertable = la cible existe au registre, l'opérateur y est autorisé, et la valeur
 * est du bon type. Sans le registre des cibles, rien ne distingue `pipeline.status`
 * de `foo.bar` et la règle serait un vœu.
 */
export function L009(artifact, ctx) {
  const known = indexBy(ctx.targets, 'target');
  const out = [];

  (artifact?.criteria || []).forEach((c, i) => {
    const ref = known.get(c.target);

    if (!ref) {
      out.push(finding(
        'L009', ERROR,
        `Cible non assertable : \`${c.target}\` n'existe pas au registre des cibles. ` +
        'Un critère que la plateforme ne sait pas résoudre ne peut pas trancher.',
        `criteria[${i}].target`
      ));
      return;
    }

    if (!ref.ops.includes(c.op)) {
      out.push(finding(
        'L009', ERROR,
        `L'opérateur \`${c.op}\` n'est pas autorisé sur \`${c.target}\` ` +
        `(autorisés : ${ref.ops.join(', ')}).`,
        `criteria[${i}].op`
      ));
    }

    const got = jsonType(c.value);
    const expected = c.op === 'exists' ? 'boolean' : ref.type;
    // `matches` compare une représentation textuelle : la valeur est un motif.
    const ok = c.op === 'matches' ? got === 'string' : got === expected;

    if (!ok) {
      out.push(finding(
        'L009', ERROR,
        `Type de valeur incohérent pour \`${c.target}\` : attendu \`${expected}\`, reçu \`${got}\`.`,
        `criteria[${i}].value`
      ));
    }
  });

  return out;
}

/**
 * L017 — Cohérence statistique des cas d'or. 🔴 / 🟡
 *
 * Ajout au jeu de règles d'origine. Un LLM n'est pas reproductible : un cas d'or joué
 * une seule fois est un tirage, pas une porte. Sans définition k/n explicite, le banc
 * d'essai rend un verdict différent à chaque passage — exactement le défaut reproché
 * au juge LLM, déplacé d'un cran.
 */
export function L017(artifact) {
  const out = [];

  (artifact?.golden_cases || []).forEach((g, i) => {
    const runs = g.runs ?? 3;
    const pass = g.pass_at_least;

    if (pass === undefined) {
      out.push(finding(
        'L017', WARN,
        `Cas d'or \`${g.id}\` sans \`pass_at_least\` : le seuil de succès sur ${runs} exécutions ` +
        'est implicite. L\'expliciter rend le verdict du banc d\'essai reproductible.',
        `golden_cases[${i}].pass_at_least`
      ));
      return;
    }

    if (pass > runs) {
      out.push(finding(
        'L017', ERROR,
        `Cas d'or \`${g.id}\` : \`pass_at_least\` (${pass}) dépasse \`runs\` (${runs}) — ` +
        'le cas ne peut jamais passer.',
        `golden_cases[${i}].pass_at_least`
      ));
    }
  });

  return out;
}
