#!/usr/bin/env node
/*
 * Serveur statique minimal, pour ouvrir le Studio.
 *
 *   node serve.js        puis http://localhost:8080
 *
 * Pourquoi un serveur et pas un double-clic : les navigateurs interdisent les modules
 * ES chargés depuis file:// (politique d'origine). Or la page importe les VRAIS modules
 * du linter — c'est tout l'intérêt, une seule implémentation partagée avec la CI. Les
 * inliner dans la page créerait une copie qui divergerait au premier correctif.
 *
 * Aucune dépendance, aucune écriture, lecture seule sous le dépôt.
 *
 * ── SAUF UNE ROUTE, ET ELLE EST LE SEUL SERVEUR DU PRODUIT ───────────────────
 *
 * `POST /api/lancer` exécute un artefact contre Vertex. Elle existe parce que la clé de
 * compte de service ne peut PAS vivre dans l'onglet : c'est une clé privée RSA qui ouvre
 * le projet GCP entier. Ici elle reste côté serveur, et la page ne reçoit qu'une sortie
 * et un verdict.
 *
 * Ce serveur est un serveur de DÉVELOPPEMENT. À LCL, cette route vivra dans un vrai
 * back — et le code qu'elle appelle ne bougera pas d'une ligne : `runtime/api.js` est
 * pur et injecté de bout en bout. C'est tout l'intérêt de l'avoir écrit comme ça.
 *
 * Il écoute sur la boucle locale et rien d'autre.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from './lib/yaml.js';
import { makeValidator } from './lib/schema.js';
import { createMoteur } from './runtime/moteur.js';
import { executer, etat, rediger, composer, DOSSIERS } from './runtime/api.js';
import { lint } from './lint/index.js';
import { chemin } from './lib/entrees.js';
import { CHEMIN, carte } from './runtime/etat-derive.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);

/* ── Ce que la route d'exécution a besoin de connaître ────────────────────────
 *
 * Chargé à la demande et jamais mis en cache : le registre change sous le serveur
 * pendant qu'on travaille, et une exécution doit porter sur le fichier tel qu'il est,
 * pas tel qu'il était au démarrage.
 */
const lire = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

function dependances() {
  const registres = {
    tools: lire('registries/tools.yaml').tools,
    targets: lire('registries/targets.yaml').targets,
    entrees: lire('entrees/index.yaml'),
    validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
  };
  const models = lire('registries/models.yaml').models;
  return {
    registres, models,
    banque: registres.entrees,
    // L'identifiant vient de la requête : il ne sert qu'à choisir un fichier dans une
    // liste de dossiers connus, jamais à composer un chemin.
    charger: (id, dossiers) => {
      const rel = dossiers.map((d) => `${d}/${id}.yaml`).find((r) => existsSync(join(ROOT, r)));
      return rel ? lire(rel) : null;
    },
    lireEntree: (e) => readFileSync(join(ROOT, chemin(e)), 'utf8'),
    // Le linter et le lecteur YAML, injectés : c'est par eux que la dictée fait juger
    // son brouillon. LE MÊME linter que la CI et que le Studio — un rédacteur qui
    // s'auto-évaluerait avec une copie assouplie ne prouverait rien.
    lint,
    parse: (texte) => yaml.parse(texte),
    /*
     * Les briques de composition : les artefacts VALIDÉS, lus sur le disque.
     *
     * `artifacts/` seulement — ce qui attend en revue n'est pas une brique. Composer avec
     * un artefact non validé ferait hériter d'une validation qui n'a pas eu lieu, et
     * c'est précisément l'héritage qui justifie qu'une chaîne se compose sans repasser
     * par la file.
     */
    briques: readdirSync(join(ROOT, 'artifacts'))
      .filter((n) => /\.ya?ml$/.test(n))
      .map((n) => { try { return lire(`artifacts/${n}`); } catch { return null; } })
      .filter(Boolean),
    // Ce que le banc d'essai a mesuré, s'il a tourné. Relu à chaque requête, comme les
    // registres : un passage qui vient de se terminer doit compter pour l'exécution
    // suivante, pas au prochain redémarrage.
    derive: existsSync(join(ROOT, CHEMIN))
      ? carte(JSON.parse(readFileSync(join(ROOT, CHEMIN), 'utf8'))) : null,
    creerVertex: () => createMoteur({ models })
  };
}

const json = (res, status, corps) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corps));
};

/** Le corps d'une requête, borné : une page ne doit pas pouvoir remplir la mémoire. */
const LIMITE = 2_000_000;
function corps(req) {
  return new Promise((ok, ko) => {
    let brut = ''; let taille = 0;
    req.on('data', (c) => {
      taille += c.length;
      if (taille > LIMITE) { ko(new Error('Corps de requête trop grand.')); req.destroy(); return; }
      brut += c;
    });
    req.on('end', () => { try { ok(JSON.parse(brut || '{}')); } catch { ko(new Error('JSON invalide.')); } });
    req.on('error', ko);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Rediriger plutôt que servir la page à la racine : sinon l'URL du document reste
    // `/` et toutes les URL relatives de la page (./studio.js, ../registries/…) se
    // résolvent au mauvais endroit.
    if (url.pathname === '/') { res.writeHead(302, { Location: '/app/' }).end(); return; }
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }

    /* ── La route d'exécution ────────────────────────────────────────────── */

    if (url.pathname === '/api/etat') {
      const d = dependances();
      json(res, 200, etat({ creerVertex: d.creerVertex, models: d.models }));
      return;
    }

    if (url.pathname === '/api/briques') {
      const d = dependances();
      // Ce que l'écran de composition a besoin de savoir de chaque brique — et rien de
      // plus. Le `spec` reste au serveur : la page n'a pas à afficher les prompts.
      json(res, 200, d.briques.map((a) => ({
        id: a.id, kind: a.kind, title: a.title, purpose: a.intent?.purpose || '',
        variables: (a.variables || []).map((v) => ({ name: v.name, source: v.source,
                                                     required: v.required !== false })),
        criteres: (a.criteria || []).length, scope: a.owner?.scope || ''
      })));
      return;
    }

    if (url.pathname === '/api/composer') {
      if (req.method !== 'POST') { json(res, 405, { erreur: 'POST attendu.' }); return; }
      let requete;
      try { requete = await corps(req); }
      catch (error) { json(res, 400, { erreur: error.message }); return; }
      const { status, corps: sortie } = await composer(requete, dependances());
      json(res, status, sortie);
      return;
    }

    if (url.pathname === '/api/rediger') {
      if (req.method !== 'POST') { json(res, 405, { erreur: 'POST attendu.' }); return; }
      let requete;
      try { requete = await corps(req); }
      catch (error) { json(res, 400, { erreur: error.message }); return; }
      const { status, corps: sortie } = await rediger(requete, dependances());
      json(res, status, sortie);
      return;
    }

    if (url.pathname === '/api/lancer') {
      if (req.method !== 'POST') { json(res, 405, { erreur: 'POST attendu.' }); return; }
      let requete;
      try { requete = await corps(req); }
      catch (error) { json(res, 400, { erreur: error.message }); return; }
      const { status, corps: sortie } = await executer(requete, dependances());
      json(res, status, sortie);
      return;
    }

    const rel = decodeURIComponent(url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);

    // Confinement : rien au-dessus de la racine du dépôt, quoi qu'on demande.
    const path = normalize(join(ROOT, rel));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }

    const info = await stat(path);
    if (info.isDirectory()) { res.writeHead(403).end('403'); return; }

    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  SalsiIAPrompt\n  http://localhost:${PORT}\n\n  Ctrl+C pour arrêter.\n`);
});
