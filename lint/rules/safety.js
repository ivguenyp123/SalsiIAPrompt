/*
 * L007 · L012 — secrets en dur et marqueurs d'injection.
 */
import { finding, ERROR, WARN } from '../core.js';

/** Parcourt toutes les chaînes de l'artefact avec leur chemin. Un secret peut se cacher
 *  ailleurs que dans le spec — un contexte de cas d'or, par exemple. */
function* walkStrings(node, path = '') {
  if (typeof node === 'string') { yield [path, node]; return; }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walkStrings(node[i], `${path}[${i}]`);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* walkStrings(v, path ? `${path}.${k}` : k);
  }
}

const SECRET_PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,                   label: 'clé privée' },
  { re: /\bAKIA[0-9A-Z]{16}\b/,                                  label: 'clé d\'accès AWS' },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/,                              label: 'jeton GitHub' },
  { re: /\bglpat-[A-Za-z0-9_-]{15,}\b/,                          label: 'jeton GitLab' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,         label: 'JWT' },
  { re: /\bBearer\s+[A-Za-z0-9._-]{20,}/i,                       label: 'jeton Bearer' },
  { re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?[^\s"',]{8,}/i, label: 'secret affecté en clair' },
  { re: /\bhttps?:\/\/[^\s"'<>)]+/i,                             label: 'URL en dur' },
  { re: /\bprojects\/[a-z0-9-]{6,}\b/i,                          label: 'identifiant de projet en dur' },
  { re: /\bproject[_-]?id\s*[:=]\s*["']?\d{4,}/i,                label: 'identifiant de projet en dur' }
];

/**
 * L007 — Aucun secret, URL ou identifiant de projet en dur. 🔴
 * L'endpoint et les identifiants appartiennent à la configuration du module qui exécute
 * l'outil, jamais au texte de l'artefact : le spec part vers le modèle.
 */
export function L007(artifact) {
  const out = [];
  const seen = new Set();

  for (const [path, value] of walkStrings(artifact)) {
    for (const { re, label } of SECRET_PATTERNS) {
      if (!re.test(value)) continue;
      const key = `${path}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(finding(
        'L007', ERROR,
        `Valeur sensible en dur détectée (${label}). Elle doit venir de la configuration du ` +
        'module qui exécute l\'outil — le contenu de l\'artefact part vers le modèle.',
        path
      ));
    }
  }
  return out;
}

const INJECTION_PATTERNS = [
  /ignore[sz]?\s+(?:les\s+)?(?:instructions|consignes)\s+pr[ée]c[ée]dentes/i,
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:prior|previous|above)/i,
  /oublie[sz]?\s+(?:tout\s+)?ce\s+qui\s+pr[ée]c[èe]de/i,
  /\btu\s+es\s+d[ée]sormais\b/i,
  /\byou\s+are\s+now\b/i,
  /<\s*\/?\s*system\s*>/i,
  /\bsystem\s*:\s*$/im
];

/**
 * L012 — Marqueurs d'injection dans le spec. 🟡
 *
 * Volontairement NON bloquant, contrairement au jeu de règles d'origine. Un artefact
 * EST légitimement un texte d'instructions : un détecteur de motifs y produit surtout
 * des faux positifs, et une règle bloquante à fort taux de faux positifs se contourne
 * ou se désactive.
 *
 * Surtout, la menace visée est déjà neutralisée par conception : la porte n'emploie
 * aucun juge LLM, donc injecter le spec n'ouvre rien. L'injection qui compte arrive à
 * l'exécution, dans le CONTEXTE récupéré (code, journaux de pipeline) — elle se traite
 * aux moments 4 et 5, pas ici.
 */
export function L012(artifact) {
  const spec = artifact?.spec;
  if (typeof spec !== 'string') return [];

  const hit = INJECTION_PATTERNS.find((re) => re.test(spec));
  if (!hit) return [];

  return [
    finding(
      'L012', WARN,
      'Le spec contient un motif ressemblant à une injection de prompt. À vérifier en revue : ' +
      'légitime dans un artefact qui documente ce cas, suspect sinon.',
      'spec'
    )
  ];
}
