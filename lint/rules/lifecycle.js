/*
 * L010 · L014 · L015 · L016 — cycle de vie, coût, doublons, certification.
 */
import { finding, ERROR, WARN, tokens, jaccard } from '../core.js';
import { GOLDEN_THRESHOLDS } from './criteria.js';

/**
 * L010 — Nombre de cas d'or ≥ seuil du niveau visé. 🔴
 * C'est ce qui rend possible la non-régression au changement de modèle : sans cas d'or,
 * une montée de version se constate en production.
 */
export function L010(artifact) {
  const level = artifact?.target_level || 'experimental';
  const need = GOLDEN_THRESHOLDS[level] ?? 0;
  const have = (artifact?.golden_cases || []).length;

  if (have >= need) return [];
  return [
    finding(
      'L010', ERROR,
      `Niveau visé \`${level}\` : ${need} cas d'or requis, ${have} fourni(s).`,
      'golden_cases'
    )
  ];
}

/**
 * L014 — Palier de modèle cohérent avec la taille de contexte. 🟡
 * Dans les deux sens : sous-dimensionné, l'agent échouera ; surdimensionné, il coûte
 * pour rien. Le gaspillage de palier est l'argument budgétaire le plus solide du produit,
 * et il se détecte dès l'écriture.
 */
export function L014(artifact) {
  const tier = artifact?.model_tier;
  if (!tier) return [];

  const size = String(artifact?.spec || '').length;
  const writes = (artifact?.tools || []).some((t) => t.mode === 'write');

  if ((tier === 'nano' || tier === 'small') && size > 1500) {
    return [finding('L014', WARN, `Palier \`${tier}\` pour un spec de ${size} caractères : probablement sous-dimensionné.`, 'model_tier')];
  }
  if (tier === 'large' && size < 400 && !writes) {
    return [finding('L014', WARN, `Palier \`large\` pour un spec court (${size} caractères) sans outil d'écriture : un palier inférieur suffit probablement. À confronter au banc d'essai.`, 'model_tier')];
  }
  return [];
}

/**
 * L015 — Similarité élevée avec un artefact existant. 🟡
 * Non bloquant par construction : la bonne réponse à un doublon est souvent de
 * contribuer à l'existant, pas d'être refusé.
 */
export function L015(artifact, ctx) {
  const others = (ctx.artifacts || []).filter((a) => a && a.id !== artifact?.id);
  if (others.length === 0) return [];

  const mine = tokens(`${artifact?.title} ${artifact?.intent?.purpose} ${artifact?.spec}`);
  const THRESHOLD = 0.6;

  return others
    .map((o) => ({ id: o.id, score: jaccard(mine, tokens(`${o.title} ${o.intent?.purpose} ${o.spec}`)) }))
    .filter((r) => r.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => finding(
      'L015', WARN,
      `Proche de l'artefact existant \`${r.id}\` (similarité ${Math.round(r.score * 100)} %). ` +
      'Envisager de contribuer à l\'existant plutôt que de dupliquer.',
      'spec'
    ));
}

/**
 * L016 — Certification présente et non périmée. 🔴 (contextuelle)
 *
 * La certification est DÉRIVÉE : elle est octroyée par la plateforme après passage du
 * banc d'essai, elle n'est pas écrite par l'auteur. Elle ne figure donc pas dans le
 * fichier et cette règle ne peut rien vérifier au lint de fichier seul.
 *
 * Elle ne s'applique que lorsque l'état dérivé est joignable — en CI branchée, et
 * surtout au pré-vol (moment 4), qui est son vrai point d'application : « agent périmé
 * ou non recertifié sur le modèle courant ». Sans état dérivé, la règle s'abstient
 * plutôt que de produire un faux verdict.
 */
export function L016(artifact, ctx) {
  if (!ctx.derived) return [];

  const cert = ctx.derived[artifact?.id]?.certification;
  if (!cert) {
    return [finding('L016', ERROR, 'Aucune certification enregistrée : l\'artefact n\'a jamais passé le banc d\'essai.', 'id')];
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const expires = new Date(cert.expires_on);

  if (!Number.isNaN(expires.getTime()) && expires < now) {
    return [finding(
      'L016', ERROR,
      `Certification périmée le ${cert.expires_on} (modèle ${cert.model_version}). ` +
      'Un agent se périme : le modèle bouge sous le prompt. Recertification requise.',
      'id'
    )];
  }
  return [];
}
