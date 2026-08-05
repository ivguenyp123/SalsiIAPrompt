/*
 * Noyau du linter — helpers partagés par toutes les règles.
 *
 * Aucune dépendance : ce fichier et les règles tournent à l'identique dans Node
 * (job de CI, moment 2) et dans le navigateur (lint en direct du Studio, moment 1).
 * Une seule implémentation, donc aucune dérive possible entre les deux.
 *
 * Une règle est une fonction pure (artifact, ctx) -> Finding[].
 * Elle ne lit pas de fichier, ne fait pas de réseau, ne lève pas d'exception.
 */

/** @typedef {{code:string, severity:'error'|'warn', message:string, path:string}} Finding */

export const ERROR = 'error'; // 🔴 bloquant
export const WARN = 'warn';   // 🟡 avertissement, n'empêche pas la soumission

/** Construit un constat. `path` pointe l'endroit fautif dans l'artefact. */
export function finding(code, severity, message, path = '') {
  return { code, severity, message, path };
}

/** Extrait les {{variables}} d'un texte, dédoublonnées, dans l'ordre d'apparition. */
export function interpolations(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Indexe une liste d'objets par une clé, pour des lookups O(1) dans les règles. */
export function indexBy(list, key) {
  const map = new Map();
  for (const item of list || []) map.set(item[key], item);
  return map;
}

/** Le périmètre `scope` a-t-il le droit d'invoquer cet outil ? '*' ouvre à tous. */
export function scopeAllows(tool, scope) {
  const scopes = tool.scopes || [];
  return scopes.includes('*') || scopes.includes(scope);
}

/** Type JSON d'une valeur, aligné sur le vocabulaire des schémas. */
export function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string | number | boolean | object | undefined
}

/** Sac de mots minuscules, pour la similarité approchée de L015. */
export function tokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-zà-ÿ0-9_]+/)
      .filter((t) => t.length > 3)
  );
}

/** Indice de Jaccard entre deux ensembles — 0 (disjoints) à 1 (identiques). */
export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Un artefact est-il bloqué ? Seules les erreurs bloquent — jamais les avertissements. */
export function isBlocked(findings) {
  return findings.some((f) => f.severity === ERROR);
}
