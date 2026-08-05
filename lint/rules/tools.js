/*
 * L004 · L005 · L006 — outils : existence, invariant d'écriture, périmètre.
 * C'est le groupe de règles porteur de la sécurité du registre.
 */
import { finding, ERROR, indexBy, scopeAllows } from '../core.js';

/**
 * L004 — Tout outil existe au registre, et l'artefact le décrit conformément. 🔴
 *
 * Le contrôle de conformité n'est pas cosmétique : sans lui, un auteur déclarerait
 * `mode: read` sur un outil que le registre sait être en écriture, et passerait L005
 * sans jamais l'avoir violé en apparence. Le registre fait autorité.
 */
export function L004(artifact, ctx) {
  const known = indexBy(ctx.tools, 'id');
  const out = [];

  (artifact?.tools || []).forEach((t, i) => {
    const ref = known.get(t.id);

    if (!ref) {
      out.push(finding('L004', ERROR, `Outil inconnu : \`${t.id}\` n'existe pas au registre des outils.`, `tools[${i}].id`));
      return;
    }
    if (t.mode !== ref.mode) {
      out.push(finding(
        'L004', ERROR,
        `\`${t.id}\` est déclaré en \`${t.mode}\` alors que le registre le définit en \`${ref.mode}\`. Le registre fait autorité.`,
        `tools[${i}].mode`
      ));
    }
    if (t.executor !== ref.executor) {
      out.push(finding(
        'L004', ERROR,
        `\`${t.id}\` est déclaré en \`executor: ${t.executor}\` alors que le registre impose \`${ref.executor}\`.`,
        `tools[${i}].executor`
      ));
    }
  });

  return out;
}

/**
 * L005 — INVARIANT : mode:write ⟹ executor:module. 🔴
 *
 * La règle centrale de la plateforme. Elle transforme une consigne en langage naturel
 * (« Tu N'EXÉCUTES PAS les écritures »), contournable par injection, en contrainte de
 * schéma vérifiable et non contournable : le chemin qui parle au LLM ne détient
 * matériellement pas le droit d'écrire.
 *
 * Le mode retenu est celui du REGISTRE quand l'outil y est connu — sinon un artefact
 * mal déclaré s'auto-exonérerait de l'invariant.
 */
export function L005(artifact, ctx) {
  const known = indexBy(ctx.tools, 'id');

  return (artifact?.tools || [])
    .map((t, i) => {
      const ref = known.get(t.id);
      const mode = ref ? ref.mode : t.mode;
      if (mode !== 'write' || t.executor === 'module') return null;

      return finding(
        'L005', ERROR,
        `\`${t.id}\` est un outil d'écriture : il doit être exécuté par un module déterministe ` +
        '(`executor: module`), jamais par le LLM. Un outil d\'écriture confié au modèle rend ' +
        'l\'invariant contournable par injection de prompt.',
        `tools[${i}].executor`
      );
    })
    .filter(Boolean);
}

/**
 * L006 — L'outil est autorisé pour le périmètre de l'owner. 🔴
 * L'équipe Data ne peut pas invoquer un outil de livraison.
 */
export function L006(artifact, ctx) {
  const known = indexBy(ctx.tools, 'id');
  const scope = artifact?.owner?.scope;
  if (!scope) return []; // déjà signalé par L013

  return (artifact?.tools || [])
    .map((t, i) => {
      const ref = known.get(t.id);
      if (!ref || scopeAllows(ref, scope)) return null;

      return finding(
        'L006', ERROR,
        `Le périmètre \`${scope}\` n'est pas autorisé à invoquer \`${t.id}\` ` +
        `(périmètres autorisés : ${ref.scopes.join(', ')}).`,
        `tools[${i}].id`
      );
    })
    .filter(Boolean);
}
