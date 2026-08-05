/*
 * L001 · L011 · L013 — structure, propriété, intention.
 */
import { finding, ERROR, WARN } from '../core.js';

/** Valeurs de remplissage qui passent le schéma mais ne désignent personne. */
const PLACEHOLDERS = new Set(['—', '-', '', 'todo', 'tbd', 'n/a', 'na', 'none', 'aucun', '?', 'xxx']);

const isPlaceholder = (v) => PLACEHOLDERS.has(String(v || '').trim().toLowerCase());

/**
 * L001 — Schéma valide et complet. 🔴
 * Délègue au validateur injecté par ctx : la règle reste pure et sans dépendance,
 * le câblage JSON Schema vit dans lint/index.js.
 */
export function L001(artifact, ctx) {
  // Le dérivé n'a jamais le droit de figurer dans le fichier. Message dédié : sinon
  // additionalProperties renvoie « propriété non autorisée », qui n'apprend rien.
  if (artifact && typeof artifact === 'object' && 'derived' in artifact) {
    return [
      finding(
        'L001', ERROR,
        'Le bloc `derived` est calculé par la plateforme (statut, usages, taux de réussite, ' +
        'certification) et ne peut pas figurer dans l\'artefact. Personne ne s\'auto-attribue ' +
        'un taux de réussite.',
        'derived'
      )
    ];
  }

  if (typeof ctx.validateArtifact !== 'function') return [];
  const { valid, errors } = ctx.validateArtifact(artifact);
  if (valid) return [];

  return errors.map((e) => finding('L001', ERROR, e.message, e.path));
}

/**
 * L011 — `intent.not_for` renseigné. 🟡
 * Une ligne qui évite la moitié des mauvais usages.
 */
export function L011(artifact) {
  const notFor = artifact?.intent?.not_for;
  if (notFor && !isPlaceholder(notFor)) return [];
  return [
    finding(
      'L011', WARN,
      'Préciser `intent.not_for` : dans quels cas cet artefact NE doit PAS être utilisé.',
      'intent.not_for'
    )
  ];
}

/**
 * L013 — Owner personne ET périmètre, réellement renseignés. 🔴
 * Le schéma exige la présence des champs ; la règle exige qu'ils désignent quelqu'un.
 * Le périmètre n'est pas décoratif : il détermine les outils autorisés (L006).
 */
export function L013(artifact) {
  const out = [];
  const owner = artifact?.owner || {};

  if (isPlaceholder(owner.person)) {
    out.push(finding('L013', ERROR, 'Owner sans personne identifiée : un artefact orphelin ne peut pas être publié.', 'owner.person'));
  }
  if (isPlaceholder(owner.scope)) {
    out.push(finding('L013', ERROR, 'Owner sans périmètre : le périmètre conditionne les outils autorisés (L006).', 'owner.scope'));
  }
  return out;
}
