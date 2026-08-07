#!/usr/bin/env node
/*
 * Lint du registre — job de CI (moment 2, couche 1).
 *
 *   node lint/cli.js <fichier|dossier>...     défaut : ../artifacts
 *
 * Sortie 0 si aucun artefact n'est bloqué, 1 sinon. C'est ce code de sortie qui
 * fait de la porte une porte : aucun LLM n'intervient à ce stade.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../lib/yaml.js';

import { lint, format } from './index.js';
import { makeValidator } from '../lib/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const loadYaml = (p) => yaml.load(readFileSync(p, 'utf8'));
const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/*
 * Tous les .yaml/.yml sous un chemin, fichier ou dossier, récursivement.
 *
 * `artifacts/retires/` est écarté. Un artefact retiré n'est plus une promesse : il n'est
 * ni visible au catalogue ni lançable, c'est une archive. Or on retire souvent PARCE QUE
 * quelque chose ne va plus — le linter en refuserait alors la moitié et casserait la CI
 * pour du code que plus personne n'exécute. Le contrôle revient dès qu'on le réactive,
 * et l'écran du parc affiche son verdict entre-temps : il n'est jamais perdu de vue.
 */
const ARCHIVE = /(^|\/)retires$/;

function collect(target) {
  const st = statSync(target);
  if (st.isFile()) return /\.ya?ml$/.test(target) ? [target] : [];
  if (ARCHIVE.test(target)) return [];
  return readdirSync(target).flatMap((name) => collect(join(target, name)));
}

const inputs = process.argv.slice(2);
const paths = (inputs.length ? inputs : [join(ROOT, 'artifacts')]).flatMap((p) => {
  try { return collect(p); } catch { console.error(`  ! chemin illisible : ${p}`); return []; }
});

if (paths.length === 0) {
  console.error('Aucun artefact à vérifier.');
  process.exit(1);
}

const ctx = {
  tools: loadYaml(join(ROOT, 'registries/tools.yaml')).tools,
  targets: loadYaml(join(ROOT, 'registries/targets.yaml')).targets,
  // La banque d'entrées : sans elle L023 se tait, et un cas d'or peut désigner un
  // fichier qui n'existe pas sans que la porte s'en aperçoive.
  entrees: loadYaml(join(ROOT, 'entrees/index.yaml')),
  validateArtifact: makeValidator(loadJson(join(ROOT, 'schema/artifact.schema.json')))
};

// Chargés d'abord dans leur ensemble : L015 compare chaque artefact aux autres.
const artifacts = paths.map((p) => {
  try { return { path: p, doc: loadYaml(p) }; }
  catch (e) { return { path: p, doc: null, parseError: e.message }; }
});
ctx.artifacts = artifacts.map((a) => a.doc).filter(Boolean);

let blocked = 0;
console.log(`\n  Lint du registre — ${artifacts.length} artefact(s)\n  ${'─'.repeat(56)}`);

for (const { path, doc, parseError } of artifacts) {
  const label = path.replace(`${ROOT}/`, '');
  if (parseError) {
    console.log(`\n  ${label}\n    🔴 YAML illisible : ${parseError}`);
    blocked++;
    continue;
  }
  const report = lint(doc, ctx);
  console.log(format(report, label));
  if (report.blocked) blocked++;
}

console.log(`\n  ${'─'.repeat(56)}\n  ${blocked === 0 ? '✔ porte franchie' : `✕ ${blocked} artefact(s) bloqué(s)`}\n`);
process.exit(blocked === 0 ? 0 : 1);
