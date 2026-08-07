#!/usr/bin/env node
/*
 * Le banc d'essai, en ligne de commande.
 *
 *   node runtime/banc-cli.js <id|--tout> [--cas=gc-01] [--runs=1] [--go] [--sans-ecrire]
 *
 *   node runtime/banc-cli.js expliquer-un-code              → le PLAN, sans rien dépenser
 *   node runtime/banc-cli.js expliquer-un-code --go         → le passage, et l'état dérivé
 *   node runtime/banc-cli.js expliquer-un-code --runs=1 --go   → un tour, pour voir
 *
 * ── POURQUOI IL NE PART PAS TOUT SEUL ────────────────────────────────────────
 *
 * C'est la seule commande du dépôt qui dépense de l'argent en boucle : cinq cas d'or à
 * cinq exécutions font vingt-cinq appels pour UN artefact, et `--tout` les multiplie par
 * le catalogue. Sans `--go`, elle imprime le compte d'appels et s'arrête. Découvrir la
 * facture après coup n'est pas une option dans un produit qui se vend sur le FinOps.
 *
 * `--runs=1` réduit chaque cas à une exécution : de quoi vérifier que la chaîne tient
 * pour le prix d'un appel par cas. Le verdict n'est alors plus reproductible — un LLM
 * joué une fois est un tirage — donc l'état dérivé n'est PAS écrit. La commande le dit.
 *
 * Sortie 0 si le passage est complet et sans échec, 1 sinon : c'est ce code qui permettra
 * de brancher une recertification périodique dans un pipeline.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { prevol } from '../preflight/index.js';
import { ERROR } from '../lint/index.js';
import { chemin } from '../lib/entrees.js';
import { cout, VertexError } from './vertex.js';
import { createMoteur } from './moteur.js';
import { rendre, trous, valeursDepuisContexte } from './lancer.js';
import { passer, plan, certifier, casRetenus, depense, runsDe } from './banc.js';
import { CHEMIN, entree, fusionner, serialiser } from './etat-derive.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));
const DOSSIERS = ['artifacts', 'artifacts/pending'];

const args = process.argv.slice(2);
const cible = args.find((a) => !a.startsWith('--'));
const o = Object.fromEntries(args.filter((a) => a.startsWith('--'))
  .map((a) => { const i = a.indexOf('='); return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));

if (!cible && !o.tout) {
  console.error('Usage : node runtime/banc-cli.js <id|--tout> [--cas=…] [--runs=N] [--go]');
  process.exit(1);
}

const cadre = (t) => `\n  ${t}\n  ${'─'.repeat(70)}`;
const forcerRuns = o.runs ? Number(o.runs) : null;
const partiel = Boolean(o.cas || forcerRuns);

/* ── Le référentiel ───────────────────────────────────────────────────────── */

const registres = {
  tools: load('registries/tools.yaml').tools,
  targets: load('registries/targets.yaml').targets,
  entrees: load('entrees/index.yaml'),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const models = load('registries/models.yaml').models;

/*
 * L'état dérivé EXISTANT est relu avant de partir : le passage doit s'y AJOUTER. Écraser
 * le fichier effacerait la mesure des autres artefacts, et un banc ciblé ferait retomber
 * tout le catalogue en « visé ».
 */
let etat = existsSync(join(ROOT, CHEMIN))
  ? JSON.parse(readFileSync(join(ROOT, CHEMIN), 'utf8')) : null;

function fichierDe(id) {
  return DOSSIERS.map((d) => `${d}/${id}.yaml`).find((p) => existsSync(join(ROOT, p)));
}

function artefacts() {
  if (!o.tout) {
    const f = fichierDe(cible);
    if (!f) { console.error(`Artefact \`${cible}\` introuvable.`); process.exit(1); }
    return [load(f)];
  }
  return readdirSync(join(ROOT, 'artifacts'))
    .filter((n) => /\.ya?ml$/.test(n))
    .map((n) => load(`artifacts/${n}`))
    .filter((a) => (a?.golden_cases || []).length > 0);
}

/*
 * Les valeurs d'un cas, lues à la banque. C'est le même chemin que `runtime/cli.js` :
 * `pipeline_log_fixture: echec-infra` devient le CONTENU de `entrees/pipeline_log/echec-infra.txt`.
 * Le banc ne joue donc pas sur des entrées inventées pour lui — il joue sur la matière que
 * la plateforme a récoltée, la même que l'auteur a vue au Studio.
 */
const valeursDe = (cas) => valeursDepuisContexte(cas.context, registres.entrees,
  (e) => readFileSync(join(ROOT, chemin(e)), 'utf8'));

/* ── Départ ───────────────────────────────────────────────────────────────── */

let lot;
try { lot = artefacts(); } catch (error) { console.error(error.message); process.exit(1); }

if (lot.length === 0) {
  console.log('\n  Aucun artefact avec des cas d\'or à jouer.\n');
  process.exit(0);
}

/* Le plan d'abord, TOUJOURS : on annonce avant de dépenser. */

let appelsTotal = 0;
const plans = new Map();

console.log(cadre('Plan de passage'));
for (const a of lot) {
  const retenus = casRetenus(a, o.cas || null);
  if (retenus.length === 0) {
    console.log(`  ${a.id.padEnd(34)} aucun cas${o.cas ? ` nommé \`${o.cas}\`` : ' d\'or'}`);
    continue;
  }
  // Le prompt rendu sert à estimer les jetons d'entrée : c'est la matière de la banque
  // qui pèse, pas le spec. Un journal de 60 lignes change l'ordre de grandeur.
  const longueurs = retenus.map((g) => {
    try { return rendre(a.spec, valeursDe(g)).length; } catch { return String(a.spec || '').length; }
  });
  const moyenne = longueurs.reduce((s, n) => s + n, 0) / longueurs.length;

  const p = plan(a, { cas: o.cas || null, runs: forcerRuns, longueurPrompt: moyenne });
  plans.set(a.id, p);
  appelsTotal += p.appels;

  // `|| 'mid'` comme le moteur : sans palier déclaré, c'est celui qui répondra, et donc
  // celui qu'il faut chiffrer. Sinon l'estimation disparaît sans dire pourquoi.
  const estime = cout({ tier: a.model_tier || 'mid', jetons: p.jetons, fournisseur: 'vertex' }, models);
  console.log(`  ${a.id.padEnd(34)} ${String(p.appels).padStart(3)} appel(s)  ·  `
    + `${p.cas.map((c) => `${c.id}×${c.runs}`).join(' ')}`);
  if (estime !== null) console.log(`  ${' '.repeat(34)} ≈ ${(estime * 100).toFixed(2)} centime(s) chez Vertex, estimation grossière`);
}

console.log(`\n  ${appelsTotal} appel(s) de modèle au total.`);

if (!o.go) {
  console.log('\n  Rien n\'a été dépensé. Relance avec --go pour jouer.\n');
  process.exit(0);
}

/* ── Le moteur ────────────────────────────────────────────────────────────── */

let moteur;
try {
  moteur = createMoteur({ models });
} catch (error) {
  console.error(`\n  ✕ ${error.message}\n`);
  process.exit(1);
}
console.log(`  via ${moteur.fournisseur} · ${moteur.ou}\n`);

/* ── Le passage ───────────────────────────────────────────────────────────── */

const aujourdhui = new Date().toISOString().slice(0, 10);
let sortieCode = 0;

for (const artifact of lot) {
  const p = plans.get(artifact.id);
  if (!p || p.appels === 0) continue;

  console.log(cadre(`${artifact.title || artifact.id}`));

  /*
   * Le pré-vol UNE FOIS PAR CAS, pas à chaque exécution.
   *
   * Par cas et non par artefact, parce que P003 porte sur les VALEURS : c'est le cas d'or
   * qui les fournit, et deux cas n'ont pas les mêmes. Un pré-vol global dirait « variable
   * `pipeline_log` non résolue » pour les trois, alors que chacun désigne son journal à
   * la banque. Par cas et non par exécution, parce que rien ne bouge entre deux tours :
   * le rejouer treize fois n'apprendrait rien et noierait la lecture.
   *
   * Un seul cas refusé arrête le passage ENTIER. Jouer les autres dériverait un niveau
   * sur un sous-ensemble, c'est-à-dire mesurer autre chose que ce qu'on annonce — la
   * raison exacte pour laquelle `--cas` n'écrit pas l'état dérivé.
   *
   * Sans `derive`, volontairement. P005 refuse sur une certification périmée : la lui
   * donner ici interdirait de RECERTIFIER un agent périmé, alors que c'est précisément ce
   * qu'on vient faire. Le banc est l'instrument qui produit la certification ; lui
   * demander s'il est certifié serait circulaire. Il contrôle ce qui doit l'être avant
   * tout appel — périmètre, outils, sensibilité, secrets — pas son propre résultat.
   */
  const prepares = casRetenus(artifact, o.cas || null).map((cas) => {
    let valeurs = {};
    let lecture = '';
    try { valeurs = valeursDe(cas); } catch (error) { lecture = error.message; }
    return { cas, valeurs, lecture, avant: prevol(artifact, {
      registres,
      valeurs,
      depot: { path: 'local/banc', scope: artifact.owner?.scope, sensibilite: 'interne' },
      criticite: 'test',
      modele: moteur.modele(artifact.model_tier)
    }) };
  });

  const refuses = prepares.filter((p) => p.lecture || p.avant.bloque);
  if (refuses.length) {
    console.log('  ✕ Le banc ne passe pas outre le pré-vol.');
    for (const r of refuses) {
      if (r.lecture) { console.log(`    🔴 ${r.cas.id}  ${r.lecture}`); continue; }
      for (const c of r.avant.constats.filter((x) => x.severity === ERROR)) {
        console.log(`    🔴 ${r.cas.id}  ${c.code}  ${c.message}`);
      }
    }
    sortieCode = 1;
    continue;
  }

  /*
   * Les confirmations, elles, ne bloquent pas ici : `--go` EST la confirmation humaine, et
   * elle a été donnée en connaissance du plan. On les affiche quand même — les taire
   * reviendrait à les faire disparaître pour qui lance le banc, et le pré-vol perdrait au
   * banc d'essai le sens qu'il a à l'écran.
   */
  const aAssumer = [...new Set(prepares.flatMap((p) => p.avant.raisons || []).map((c) => c.code))];
  if (aAssumer.length) {
    console.log(`  🟡 Assumé par --go : ${aAssumer.join(', ')}.`);
  }

  const valeursDuCas = new Map(prepares.map((p) => [p.cas.id, p.valeurs]));

  const jouer = async (cas) => {
    // Les valeurs ont déjà été lues à la banque pour le pré-vol : les relire à chaque
    // tour relirait les mêmes fichiers treize fois pour le même résultat.
    const prompt = rendre(artifact.spec, valeursDuCas.get(cas.id) || {});
    const manquantes = trous(prompt);
    if (manquantes.length) return { erreur: `prompt à trou : ${manquantes.join(', ')}` };

    try {
      const r = await moteur.generer({ prompt, tier: artifact.model_tier || 'mid' });
      return { sortie: r.texte, jetons: r.jetons, modele: r.modele, cout: cout(r, models) };
    } catch (error) {
      return { erreur: `${error.message}${error instanceof VertexError && error.status ? ` (HTTP ${error.status})` : ''}` };
    }
  };

  const sur = (e) => {
    if (e.type !== 'run') return;
    const r = e.resultat;
    const icone = r.erreur ? '⚠' : r.reussi ? '✔' : r.echoue ? '✕' : '·';
    const dit = r.erreur ? r.erreur
      : r.reussi ? 'attentes tenues'
        : r.echoue ? r.violes.map((v) => `${v.cible} ${v.op} ${JSON.stringify(v.attendu)} → ${JSON.stringify(v.valeur)}`).join(' · ')
          : r.ouverts.map((v) => `${v.cible} non résolu`).join(' · ');
    console.log(`  ${icone} ${e.cas.padEnd(30)} ${String(e.i + 1).padStart(2)}/${e.total}  ${dit}`);
  };

  const passage = await passer(artifact, { jouer, targets: registres.targets,
                                           cas: o.cas || null, runs: forcerRuns, sur });

  console.log('');
  for (const c of passage.cas) {
    const seuil = `${c.reussites}/${c.runs} (seuil ${c.seuil}${c.seuilImplicite ? ', implicite' : ''})`;
    console.log(`  ${c.passe ? '✔' : '✕'} ${c.id.padEnd(30)} ${seuil}`
      + (c.indecis ? `  · ${c.indecis} non concluant(s)` : ''));
  }

  const n = passage.niveau;
  console.log(`\n  Niveau atteint : ${n.level}${n.level === n.vise ? '' : ` · visait ${n.vise}`}`);
  console.log(`  ${n.pourquoi}`);

  const modele = moteur.modele(artifact.model_tier);
  const { certification, raison } = certifier({ artifact, cas: passage.cas, modele,
                                                fournisseur: moteur.fournisseur, date: aujourdhui });
  console.log(certification
    ? `  Certifié sur \`${modele}\` jusqu'au ${certification.expires_on}.`
    : `  Pas de certification : ${raison}`);

  const d = depense(passage.cas);
  const euros = d.euros === null ? 'tarif inconnu' : `${(d.euros * 100).toFixed(4)} centime(s)`;
  console.log(`  ${d.appels} appel(s) · ${d.jetons.entree} + ${d.jetons.sortie} jetons  →  ${euros}`);

  if (!certification) sortieCode = 1;

  /* ── L'état dérivé ──────────────────────────────────────────────────────── */

  if (partiel) {
    console.log('\n  État dérivé NON écrit : passage partiel (--cas ou --runs). '
      + 'Un niveau se dérive d\'un passage complet, sinon il mesure autre chose que ce qu\'il annonce.');
  } else if (o['sans-ecrire']) {
    console.log('\n  État dérivé non écrit (--sans-ecrire).');
  } else {
    etat = fusionner(etat, artifact.id,
      entree(passage, { certification, raison, modele, fournisseur: moteur.fournisseur,
                        date: aujourdhui, depense: d }),
      aujourdhui);
    mkdirSync(join(ROOT, 'derive'), { recursive: true });
    writeFileSync(join(ROOT, CHEMIN), serialiser(etat));
    console.log(`\n  ${CHEMIN} mis à jour : \`${artifact.id}\` est désormais mesuré, pas déclaré.`);
  }
}

console.log('');
process.exit(sortieCode);
