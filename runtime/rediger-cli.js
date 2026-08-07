#!/usr/bin/env node
/*
 * La dictée, en ligne de commande.
 *
 *   npm run rediger -- "je veux un agent qui relit une requête SQL et propose un index"
 *   npm run rediger -- "…" --scope=Data --auteur=ivguenyp123 --ecrire
 *
 * Une phrase entre, un artefact linté sort. Entre les deux, une boucle : le modèle écrit,
 * les 23 règles jugent, et ce qu'elles refusent repart au modèle comme travail à faire.
 * C'est la phrase du dépôt appliquée au dépôt — « l'IA traduit l'intention, le noyau
 * gouverne, l'humain valide ».
 *
 * `--ecrire` dépose dans `artifacts/pending/`, la file de validation. Il reste explicite
 * ici pour une raison de commande, pas de gouvernance : cette commande écrit dans TON
 * arbre de travail, et une commande qui crée un fichier sans qu'on l'ait demandé est une
 * mauvaise commande. Au Studio, où le dépôt passe par la forge, l'envoi est direct — le
 * relecteur de l'Admin est mieux placé que l'auteur pour trancher, c'est son rôle.
 *
 * Trois appels au maximum, c'est-à-dire le prix d'un cas d'or joué trois fois. Le
 * rédacteur est la partie la moins chère du produit ; c'est le banc d'essai qui coûte.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint, ERROR } from '../lint/index.js';
import { knownScopes } from '../app/scopes.js';
import { createMoteur } from './moteur.js';
import { cout, VertexError } from './vertex.js';
import { rediger } from './redacteur.js';
import { toYaml } from '../studio/to-yaml.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

const args = process.argv.slice(2);
const phrase = args.filter((a) => !a.startsWith('--')).join(' ').trim();
const o = Object.fromEntries(args.filter((a) => a.startsWith('--'))
  .map((a) => { const i = a.indexOf('='); return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));

if (!phrase) {
  console.error('Usage : npm run rediger -- "ton besoin en une phrase" [--scope=…] [--ecrire]');
  process.exit(1);
}

const registres = {
  tools: load('registries/tools.yaml').tools,
  targets: load('registries/targets.yaml').targets,
  entrees: load('entrees/index.yaml'),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const models = load('registries/models.yaml').models;
const scopes = knownScopes(registres.tools);

const cadre = (t) => `\n  ${t}\n  ${'─'.repeat(70)}`;

let moteur;
try { moteur = createMoteur({ models }); }
catch (error) { console.error(`\n  ✕ ${error.message}\n`); process.exit(1); }

console.log(cadre('Besoin'));
console.log(`  « ${phrase} »`);
console.log(`\n  via ${moteur.fournisseur} · ${moteur.ou} · au plus ${o.tours || 3} tour(s)`);
console.log(cadre('Traduction — le modèle écrit, le linter juge'));

let r;
try {
  r = await rediger(
    { phrase, auteur: o.auteur || '', scope: scopes.includes(o.scope) ? o.scope : '' },
    { moteur, registres, lint, parse: (t) => yaml.parse(t), scopes,
      tours: o.tours ? Number(o.tours) : undefined, cout, models, serialiser: toYaml });
} catch (error) {
  const detail = error instanceof VertexError && error.status ? ` (HTTP ${error.status})` : '';
  console.error(`\n  ✕ ${error.message}${detail}\n`);
  process.exit(1);
}

for (const t of r.tours) {
  if (t.illisible) { console.log(`  ⚠ tour ${t.tour}  YAML illisible : ${t.illisible}`); continue; }
  const verdict = t.report.blocked
    ? `${t.report.errors} refus, ${t.report.warnings} avertissement(s)`
    : `conforme${t.report.warnings ? ` · ${t.report.warnings} avertissement(s)` : ''}`;
  console.log(`  ${t.report.blocked ? '✕' : '✔'} tour ${t.tour}  ${verdict}`);
  for (const f of t.report.findings) {
    console.log(`      ${f.severity === ERROR ? '🔴' : '🟡'} ${f.code}  ${f.message}`);
  }
}

if (!r.artefact) {
  console.error('\n  ✕ Aucun artefact lisible n\'est sorti de la boucle.\n');
  process.exit(1);
}

console.log(cadre(`${r.artefact.title || r.artefact.id}`));
console.log(r.rendu.split('\n').map((l) => `  ${l}`).join('\n'));

const euros = r.cout === null ? 'tarif inconnu' : `${(r.cout * 100).toFixed(4)} centime(s)`;
console.log(cadre('Coût'));
console.log(`  ${r.tours.length} appel(s) · ${r.jetons.entree} + ${r.jetons.sortie} jetons  →  ${euros}`);

/* ── La file de validation ────────────────────────────────────────────────── */

if (r.abandon) {
  console.log('\n  ✕ Le brouillon ne franchit pas la porte. Rien n\'est déposé — reprends-le '
    + 'au Studio, la charpente est là.\n');
  process.exit(1);
}

if (!o.ecrire) {
  console.log('\n  ✔ Brouillon conforme. Rien n\'a été déposé : relance avec --ecrire pour '
    + `le poser dans artifacts/pending/${r.artefact.id}.yaml.\n`);
  process.exit(0);
}

/*
 * `artifacts/pending/` EST la file de validation : le dossier porte l'état, et l'écran
 * d'Admin lit ce dossier. Déposer ici n'est donc pas « enregistrer », c'est demander une
 * décision humaine — et un fichier déjà présent ne se remplace pas en silence.
 */
const cible = join(ROOT, 'artifacts/pending', `${r.artefact.id}.yaml`);
if (existsSync(cible)) {
  console.error(`\n  ✕ artifacts/pending/${r.artefact.id}.yaml existe déjà. `
    + 'Un artefact en attente de décision ne s\'écrase pas : renomme, ou traite celui-là.\n');
  process.exit(1);
}

const entete = `# Rédigé par la dictée à partir d'une phrase, relu par un humain avant dépôt.\n`
             + `# Besoin d'origine : « ${phrase.replace(/\n/g, ' ')} »\n`
             + `# Le linter l'a jugé conforme ; ce qu'il fait VRAIMENT reste à mesurer au banc d'essai.\n\n`;

mkdirSync(dirname(cible), { recursive: true });
writeFileSync(cible, entete + r.rendu.trimEnd() + '\n');

console.log(`\n  ✔ artifacts/pending/${r.artefact.id}.yaml déposé.`);
console.log('    Il attend une décision humaine à l\'écran d\'Admin. Commite-le pour qu\'il y arrive.\n');
