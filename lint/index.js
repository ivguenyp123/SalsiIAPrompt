/*
 * Linter du registre de capacités IA — point d'entrée.
 *
 * Sans dépendance, volontairement : ce module tourne tel quel en CI (moment 2) et dans
 * le Studio (moment 1, lint en direct). La validation de schéma est INJECTÉE via
 * ctx.validateArtifact — voir validator.js pour le câblage Node/ajv. Un appelant qui
 * n'en fournit pas obtient toutes les règles sauf L001.
 *
 *   import { lint } from './lint/index.js'
 *   const report = lint(artifact, { tools, targets, validateArtifact })
 *   if (report.blocked) process.exit(1)
 */
import { ERROR, WARN, isBlocked } from './core.js';
import { L001, L011, L013 } from './rules/structure.js';
import { L002, L003, L021, L027 } from './rules/variables.js';
import { SOURCES_ENTREES } from '../lib/assemblage.js';
import { L004, L005, L006 } from './rules/tools.js';
import { L008, L009, L017, L022, L023, L026 } from './rules/criteria.js';
import { L007, L012 } from './rules/safety.js';
import { L010, L014, L015, L016 } from './rules/lifecycle.js';
import { L024, L025 } from './rules/chaine.js';
import { L018, L019, L020 } from './rules/format.js';

export { ERROR, WARN, isBlocked };

/** Table des règles. L'ordre fixe l'ordre d'exécution, donc l'ordre du rapport. */
export const RULES = [
  { code: 'L001', fn: L001, severity: ERROR, title: 'Schéma valide et complet' },
  { code: 'L002', fn: L002, severity: ERROR, title: 'Toute {{variable}} du spec est déclarée' },
  { code: 'L003', fn: L003, severity: WARN,  title: 'Toute variable déclarée est utilisée' },
  { code: 'L027', fn: L027, severity: WARN,  title: 'Entrée au vocabulaire connu' },
  { code: 'L004', fn: L004, severity: ERROR, title: 'Tout outil existe au registre' },
  { code: 'L005', fn: L005, severity: ERROR, title: 'mode:write ⟹ executor:module' },
  { code: 'L006', fn: L006, severity: ERROR, title: 'Outils autorisés pour le périmètre' },
  { code: 'L007', fn: L007, severity: ERROR, title: 'Aucun secret, URL ou ID de projet en dur' },
  { code: 'L008', fn: L008, severity: ERROR, title: 'criteria non vide' },
  { code: 'L009', fn: L009, severity: ERROR, title: 'Chaque critère est assertable' },
  { code: 'L010', fn: L010, severity: ERROR, title: 'Cas d\'or ≥ seuil du niveau visé' },
  { code: 'L011', fn: L011, severity: WARN,  title: 'intent.not_for renseigné' },
  { code: 'L012', fn: L012, severity: WARN,  title: 'Marqueurs d\'injection dans le spec' },
  { code: 'L013', fn: L013, severity: ERROR, title: 'Owner personne et périmètre' },
  { code: 'L014', fn: L014, severity: WARN,  title: 'Palier de modèle cohérent' },
  { code: 'L015', fn: L015, severity: WARN,  title: 'Similarité avec un artefact existant' },
  { code: 'L016', fn: L016, severity: ERROR, title: 'Certification présente et non périmée' },
  { code: 'L017', fn: L017, severity: ERROR, title: 'Consistance des cas d\'or — attente, contexte, k/n' },
  { code: 'L018', fn: L018, severity: ERROR, title: 'Aucun reste de rédaction dans le spec' },
  { code: 'L019', fn: L019, severity: WARN,  title: 'Pas de logique dans le spec' },
  { code: 'L020', fn: L020, severity: ERROR, title: 'Taille du spec dans les bornes' },
  { code: 'L021', fn: L021, severity: ERROR, title: 'Le spec utilise au moins une variable déclarée' },
  { code: 'L022', fn: L022, severity: WARN,  title: 'Cas d\'or cohérent avec les critères' },
  { code: 'L023', fn: L023, severity: ERROR, title: 'Cas d\'or joué sur une entrée qui existe' },
  { code: 'L024', fn: L024, severity: ERROR, title: 'Une chaîne enchaîne des artefacts qui existent' },
  { code: 'L025', fn: L025, severity: ERROR, title: 'Le câblage d\'une chaîne est résoluble' },
  { code: 'L026', fn: L026, severity: ERROR, title: 'Contrat sans exigences incompatibles' }
];

/**
 * Passe l'artefact au crible.
 *
 * @param {object} artifact  l'artefact déjà parsé (le linter ne lit aucun fichier)
 * @param {object} ctx
 *   @param {Array}  ctx.tools             registre des outils
 *   @param {Array}  ctx.targets           registre des cibles assertables
 *   @param {Array}  [ctx.artifacts]       les autres artefacts, pour L015
 *   @param {object} [ctx.derive]          état dérivé indexé par id, pour L016
 *   @param {Date}   [ctx.now]             injectée pour rendre L016 testable
 *   @param {object} [ctx.entrees]         manifeste de la banque d'entrées, pour L023
 *   @param {Function} [ctx.validateArtifact]  validateur de schéma, pour L001
 * @returns {{findings:Array, blocked:boolean, errors:number, warnings:number}}
 */
export function lint(artifact, ctx = {}) {
  /*
   * Le vocabulaire des entrées est une CONSTANTE du produit, pas un fichier : il ne peut
   * pas être périmé, et le défaut vaut donc mieux que l'absence. Un appelant peut le
   * remplacer — le banc d'essai s'en sert pour éprouver la règle sur un vocabulaire à lui.
   */
  const context = {
    tools: [], targets: [], artifacts: [], derive: null, entrees: null,
    entreesConnues: Object.keys(SOURCES_ENTREES),
    ...ctx
  };
  const findings = [];

  for (const rule of RULES) {
    let produced;
    try {
      produced = rule.fn(artifact, context) || [];
    } catch (err) {
      // Une règle qui casse ne doit jamais faire passer un artefact pour conforme :
      // on la signale comme erreur bloquante plutôt que de l'ignorer.
      produced = [{
        code: rule.code,
        severity: ERROR,
        message: `La règle ${rule.code} a échoué : ${err.message}`,
        path: ''
      }];
    }
    findings.push(...produced);
  }

  const errors = findings.filter((f) => f.severity === ERROR).length;
  return { findings, blocked: errors > 0, errors, warnings: findings.length - errors };
}

/** Rapport lisible en terminal. Les erreurs d'abord : c'est ce qui bloque. */
export function format(report, label = '') {
  const order = { [ERROR]: 0, [WARN]: 1 };
  const lines = [];
  if (label) lines.push(`\n  ${label}`);

  if (report.findings.length === 0) {
    lines.push('    ✔ conforme — aucun constat');
    return lines.join('\n');
  }

  for (const f of [...report.findings].sort((a, b) => order[a.severity] - order[b.severity])) {
    const icon = f.severity === ERROR ? '🔴' : '🟡';
    lines.push(`    ${icon} ${f.code}  ${f.message}${f.path ? `  → ${f.path}` : ''}`);
  }
  lines.push(`    ${report.blocked ? '✕ REFUSÉ' : '✔ accepté'} — ${report.errors} erreur(s), ${report.warnings} avertissement(s)`);
  return lines.join('\n');
}
