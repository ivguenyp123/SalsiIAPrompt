#!/usr/bin/env node
/*
 * Lancer un artefact du registre contre Vertex — pour de vrai.
 *
 *   node runtime/cli.js <id> [--var=valeur ...] [--cas=<id>] [--sensibilite=…] [--assume]
 *
 *   node runtime/cli.js expliquer-un-code --cas=gc-01-module-court
 *   node runtime/cli.js optimiser-une-requete-sql --repo=demo-data --requete="SELECT ..."
 *
 * `--cas` rejoue un cas d'or : le contexte du cas fournit les valeurs, et les entrées
 * `*_fixture` sont LUES dans la banque. C'est la première fois que ces fichiers servent
 * à autre chose qu'à être comptés — et c'est la brique dont le banc d'essai a besoin.
 *
 * Sortie 0 si le contrat est satisfait, 1 sinon. Un code de sortie, pas une impression :
 * c'est ce qui permettra de brancher ça dans un pipeline.
 *
 * Le fournisseur vient de l'environnement — Vertex ou DeepSeek — et s'affiche : dans un
 * registre gouverné, savoir QUI a répondu n'est pas un détail. Identifiants : voir
 * runtime/vertex.js et runtime/deepseek.js. Rien n'est lu depuis le dépôt.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { cout, VertexError } from './vertex.js';
import { createMoteur } from './moteur.js';
import { lancer, valeursDepuisContexte } from './lancer.js';
import { chemin } from '../lib/entrees.js';
import { ERROR } from '../lint/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const options = Object.fromEntries(args.filter((a) => a.startsWith('--'))
  .map((a) => { const i = a.indexOf('='); return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));

if (!id) {
  console.error('Usage : node runtime/cli.js <id> [--var=valeur ...] [--cas=<id>]');
  process.exit(1);
}

const fichier = ['artifacts', 'artifacts/pending', 'artifacts/retires']
  .map((d) => `${d}/${id}.yaml`).find((p) => existsSync(join(ROOT, p)));
if (!fichier) {
  console.error(`Artefact \`${id}\` introuvable dans artifacts/.`);
  process.exit(1);
}

const artifact = load(fichier);
const registres = {
  tools: load('registries/tools.yaml').tools,
  targets: load('registries/targets.yaml').targets,
  entrees: load('entrees/index.yaml'),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const registreModeles = load('registries/models.yaml');
const models = registreModeles.models;
const fournisseurs = registreModeles.fournisseurs || {};

/* ── Les valeurs : du cas d'or, ou de la ligne de commande ─────────────────── */

let valeurs = {};
let etiquette = 'valeurs de la ligne de commande';

if (options.cas) {
  const cas = (artifact.golden_cases || []).find((g) => g.id === options.cas);
  if (!cas) {
    console.error(`Cas d'or \`${options.cas}\` inconnu. Disponibles : `
      + (artifact.golden_cases || []).map((g) => g.id).join(', '));
    process.exit(1);
  }
  // C'est ici que la banque cesse d'être un manifeste : le fichier est lu, son contenu
  // devient la valeur de la variable, et il part dans le prompt.
  valeurs = valeursDepuisContexte(cas.context, registres.entrees,
    (e) => readFileSync(join(ROOT, chemin(e)), 'utf8'));
  etiquette = `cas d'or ${cas.id}`;
}

for (const [cle, valeur] of Object.entries(options)) {
  if (['cas', 'depot', 'criticite', 'assume', 'sensibilite'].includes(cle)) continue;
  valeurs[cle] = valeur;
}

/* ── Le contexte d'exécution ───────────────────────────────────────────────── */

/*
 * `--sensibilite` par défaut à `interne`, comme l'écran d'exécution.
 *
 * Sans elle, P002 dirait « je ne sais pas » à CHAQUE lancement et réclamerait `--assume`
 * à chaque fois — une option qu'on finit par taper sans lire, ce qui vide le mécanisme
 * de son sens. Le jour où le référentiel des dépôts existe, elle viendra de lui.
 */
const contexte = {
  registres,
  depot: { path: options.depot || 'local/banc', scope: artifact.owner?.scope,
           sensibilite: options.sensibilite || 'interne' },
  criticite: options.criticite || 'test'
};

/* ── Départ ────────────────────────────────────────────────────────────────── */

const cadre = (t) => `\n  ${t}\n  ${'─'.repeat(64)}`;
console.log(cadre(`${artifact.title || id} — ${etiquette}`));

let moteur;
try {
  moteur = createMoteur({ models });
} catch (error) {
  console.error(`\n  ✕ ${error.message}\n`);
  process.exit(1);
}

console.log(`  modèle    ${moteur.modele(artifact.model_tier)}  ·  palier ${artifact.model_tier || 'mid'}`);
console.log(`  via       ${moteur.fournisseur} · ${moteur.ou}`);

let r;
try {
  r = await lancer(artifact, { vertex: moteur, valeurs, contexte, models, fournisseurs,
                               assume: options.assume === true || options.assume === 'oui' });
} catch (error) {
  const detail = error instanceof VertexError && error.status ? ` (HTTP ${error.status})` : '';
  console.error(`\n  ✕ ${error.message}${detail}\n`);
  process.exit(1);
}

if (r.refuse) {
  console.log(`\n  ✕ ${r.raison}`);
  for (const c of r.prevol.constats) {
    console.log(`    ${c.severity === ERROR ? '🔴' : '🟡'} ${c.code}  ${c.message}`);
  }
  console.log(r.prevol.confirmationRequise && !options.assume
    ? '\n  Relance avec --assume pour prendre ces points à ton compte.\n' : '');
  process.exit(1);
}

console.log(cadre('Sortie'));
console.log(r.sortie.split('\n').map((l) => `  ${l}`).join('\n'));

console.log(cadre('Post-vol — le contrat, évalué sur cette sortie'));
for (const c of r.postvol.constats) {
  const icone = c.verdict === 'satisfait' ? '✔' : c.verdict === 'violé' ? '✕' : '·';
  const valeur = Array.isArray(c.valeur) ? `[${c.valeur.length}]` : JSON.stringify(c.valeur);
  console.log(`  ${icone} ${c.cible} ${c.op} ${JSON.stringify(c.attendu)}  →  ${valeur}`);
  if (c.pourquoi) console.log(`      ${c.pourquoi}`);
}

const euros = r.cout === null ? 'tarif inconnu' : `${(r.cout * 100).toFixed(4)} centime(s)`;
console.log(cadre('Coût'));
console.log(`  ${r.jetons.entree} jeton(s) en entrée · ${r.jetons.sortie} en sortie  →  ${euros}`);

const dit = r.postvol.conforme ? '✔ contrat satisfait' : `✕ ${r.postvol.violes.length} critère(s) violé(s)`;
const reste = r.postvol.nonResolus.length
  ? ` · ${r.postvol.nonResolus.length} non évalué(s) hors banc d'essai` : '';
console.log(`\n  ${dit}${reste}\n`);

process.exit(r.postvol.conforme ? 0 : 1);
