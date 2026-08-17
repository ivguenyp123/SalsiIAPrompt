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
import { execFileSync } from 'node:child_process';
import { join, extname, resolve, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from './lib/yaml.js';
import { makeValidator } from './lib/schema.js';
import { createMoteur } from './runtime/moteur.js';
import { executer, etat, rediger, composer, coherence, DOSSIERS } from './runtime/api.js';
import { lint } from './lint/index.js';
import { chemin } from './lib/entrees.js';
import { CHEMIN, carte } from './runtime/etat-derive.js';
import { createForge } from './app/forge.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ── Lire le registre, et pas seulement la copie qui traîne ───────────────── */

/*
 * LE DÉFAUT QUE CECI CORRIGE, ET POURQUOI IL ÉTAIT INVISIBLE.
 *
 * Le catalogue lit les agents CHEZ LA FORGE, avec le jeton du navigateur. L'exécution,
 * elle, les lisait sur le DISQUE du serveur. Deux sources pour la même chose — et rien ne
 * le disait.
 *
 * Conséquence : tout agent créé depuis l'écran partait chez la forge, s'affichait au
 * catalogue, et se faisait répondre « introuvable au registre » au moment de le lancer.
 * Chaque agent créé, sans exception. Le message était exact et incompréhensible.
 *
 * ── POURQUOI PAS LAISSER LE NAVIGATEUR ENVOYER LE FICHIER ────────────────────
 *
 * Ce serait plus simple, et ce serait la fin de la gouvernance : `artifacts/` veut dire
 * « quelqu'un l'a relu ». Un contenu fourni par l'appelant n'a plus cette preuve, et
 * n'importe quelle page ouverte pourrait faire exécuter n'importe quelle consigne avec la
 * clé du serveur.
 *
 * On lit donc le registre À LA SOURCE. Ce qui s'exécute reste ce qui est commité — donc
 * ce qu'un humain a validé. Reste à savoir COMMENT on l'atteint, et la réponse n'est pas
 * la même en développement et en production.
 */
/*
 * ── DEUX FAÇONS DE LIRE LE REGISTRE, ET UNE SEULE EST CELLE DE LA PRODUCTION ─
 *
 * En PRODUCTION, le back n'est pas un clone git : il lit le registre CHEZ LA FORGE, avec
 * sa propre identité en lecture seule. C'est la seule façon dont un service lit un dépôt
 * qu'il ne possède pas, et c'est ce que `SALSI_REGISTRE_REPO` active.
 *
 *   SALSI_REGISTRE_REPO    `groupe/depot` du registre
 *   SALSI_REGISTRE_TOKEN   un jeton LECTURE SEULE sur ce seul dépôt
 *   SALSI_REGISTRE_FORGE   l'URL de la forge (défaut https://github.com)
 *
 * Configuré, il fait AUTORITÉ : le disque est ignoré. Une image de production construite
 * depuis le dépôt embarquerait des artefacts figés au jour du build, et exécuterait donc
 * une version périmée de ce qu'un humain a validé depuis. Le registre décide, pas la copie
 * qui a voyagé avec le binaire.
 *
 * Non configuré, on est en DÉVELOPPEMENT : le disque d'abord (c'est ce qu'on édite), puis
 * le clone git (c'est ce qui vient d'être validé depuis l'écran).
 */
const REGISTRE = {
  repo: process.env.SALSI_REGISTRE_REPO || '',
  token: process.env.SALSI_REGISTRE_TOKEN || '',
  forge: process.env.SALSI_REGISTRE_FORGE || 'https://github.com'
};

const BRANCHE = process.env.SALSI_BRANCHE || 'main';
const FETCH_MIN_MS = 15_000;      // ne pas interroger la forge à chaque requête
let dernierFetch = 0;

/** Le client de forge du SERVEUR — jamais celui de l'utilisateur. */
let clientRegistre = null;
function forgeDuRegistre() {
  if (!REGISTRE.repo || !REGISTRE.token) return null;
  clientRegistre ||= createForge({ gitlabUrl: REGISTRE.forge, token: REGISTRE.token });
  return clientRegistre;
}

/** Le registre, lu chez la forge. Rend le texte du fichier, ou `null`. */
async function depuisLaForge(id, dossiers) {
  const forge = forgeDuRegistre();
  if (!forge) return null;

  for (const d of dossiers) {
    try {
      const f = await forge.getFile(REGISTRE.repo, `${d}/${id}.yaml`, BRANCHE);
      if (f?.content) return f.content;
    } catch { /* ce dossier ne l'a pas, ou la forge refuse : on essaie le suivant */ }
  }
  return null;
}

function depuisLeClone(id, dossiers) {
  // L'identifiant est déjà validé en amont ; on le revérifie parce qu'il entre ici dans
  // une commande.
  if (!/^[a-z][a-z0-9-]*$/.test(String(id || ''))) return null;

  try {
    if (Date.now() - dernierFetch > FETCH_MIN_MS) {
      execFileSync('git', ['fetch', '--quiet', 'origin', BRANCHE],
                   { cwd: ROOT, stdio: 'ignore', timeout: 10_000 });
      dernierFetch = Date.now();
    }
  } catch {
    // Pas de réseau, pas de dépôt distant : on continue avec ce qu'on a déjà cherché.
  }

  for (const d of dossiers) {
    try {
      return execFileSync('git', ['show', `origin/${BRANCHE}:${d}/${id}.yaml`],
                          { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
    } catch {
      // Ce dossier ne l'a pas — on essaie le suivant.
    }
  }
  return null;
}

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
    charger: async (id, dossiers) => {
      // Le registre configuré fait autorité, et le disque n'est même pas consulté :
      // deux sources pour la même chose, c'est le défaut qu'on vient de corriger.
      if (forgeDuRegistre()) {
        const texte = await depuisLaForge(id, dossiers);
        return texte ? yaml.parse(texte) : null;
      }

      const rel = dossiers.map((d) => `${d}/${id}.yaml`).find((r) => existsSync(join(ROOT, r)));
      if (rel) return lire(rel);

      // Absent du disque : peut-être vient-il d'être validé depuis l'écran. On regarde
      // le clone avant de dire qu'il n'existe pas.
      const distant = depuisLeClone(id, dossiers);
      return distant ? yaml.parse(distant) : null;
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
  // Le guide va chercher `docs/*.md` en clair et le met en forme lui-même. Sans ce type,
  // le fichier descend en `application/octet-stream` et le navigateur propose de le
  // télécharger au lieu de l'afficher.
  '.md': 'text/markdown; charset=utf-8',
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

    if (url.pathname === '/api/coherence') {
      if (req.method !== 'POST') { json(res, 405, { erreur: 'POST attendu.' }); return; }
      let requete;
      try { requete = await corps(req); }
      catch (error) { json(res, 400, { erreur: error.message }); return; }
      const { status, corps: sortie } = await coherence(requete, dependances());
      json(res, status, sortie);
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

    /*
     * ── LE RELAIS DE FORGE ────────────────────────────────────────────────────
     *
     * Le navigateur appelle la forge en direct, et c'est le bon choix : sur le GitLab
     * cible, l'appel part du poste et personne n'a de serveur à installer. Mais ce choix
     * rend l'écran otage du CORS d'un service qu'on ne contrôle pas — et le jour où
     * `api.github.com` a répondu `Access-Control-Allow-Origin: *;`, un en-tête invalide,
     * plus personne n'a pu se connecter. Aucune ligne de notre code n'y pouvait rien.
     *
     * Ce relais est la sortie de secours : Node n'a pas de politique d'origine, donc il
     * appelle la forge quels que soient les en-têtes qu'elle renvoie. L'écran ne s'en sert
     * QUE lorsqu'un appel direct a échoué — le direct reste la voie normale, et là où
     * aucun serveur ne tourne, rien ne change.
     *
     * ── CE QU'IL NE FAIT PAS ──────────────────────────────────────────────────
     *
     * Il ne garde RIEN : ni le jeton, ni la réponse, ni une trace. Il transporte et il
     * oublie. Le jeton traverse ce processus le temps de l'appel — c'est le prix de la
     * sortie de secours, et il n'est acceptable que parce que ce serveur tourne sur la même
     * machine que le navigateur qui l'appelle.
     *
     * Il refuse tout ce qui n'est pas une URL http(s) : sans ce garde, une page ouverte
     * dans ce navigateur disposerait d'un relais universel vers le réseau local.
     */
    if (url.pathname === '/api/forge') {
      if (req.method !== 'POST') { json(res, 405, { erreur: 'POST attendu.' }); return; }
      let requete;
      try { requete = await corps(req); }
      catch (error) { json(res, 400, { erreur: error.message }); return; }

      let cible;
      try {
        cible = new URL(requete.url);
        if (cible.protocol !== 'https:' && cible.protocol !== 'http:') throw new Error('protocole');
      } catch {
        json(res, 400, { erreur: 'URL de forge invalide.' });
        return;
      }

      try {
        const amont = await fetch(cible.toString(), {
          method: requete.methode || 'GET',
          headers: requete.entetes || {},
          ...(requete.corps ? { body: JSON.stringify(requete.corps) } : {})
        });
        /*
         * On rend le STATUT de la forge tel quel, et son corps en texte.
         *
         * Le client rejoue exactement sa logique d'erreur dessus : un 401 doit rester un
         * 401, un 404 un 404. Traduire ici ferait deux vocabulaires d'erreur à maintenir,
         * et le message « jeton refusé » finirait par diverger selon le chemin emprunté.
         */
        json(res, 200, { statut: amont.status, corps: await amont.text() });
      } catch (error) {
        json(res, 502, { erreur: `Le relais n'a pas joint la forge : ${error.message}` });
      }
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

    /*
     * `no-store`, et ce n'est pas un détail de confort.
     *
     * Ce serveur ne renvoyait NI `Cache-Control`, NI `ETag`, NI `Last-Modified`. Sans
     * aucune de ces indications, un navigateur applique un cache HEURISTIQUE : il garde
     * le fichier le temps qu'il juge raisonnable, sans jamais redemander. Derrière le
     * proxy HTTPS d'un Codespace, c'est encore plus franc.
     *
     * Conséquence vécue : on tire les changements, on relance le serveur, on recharge —
     * et l'écran est identique. On cherche alors le défaut dans le code qu'on vient
     * d'écrire, qui n'a jamais été servi. Les écrans se protégeaient déjà pour les
     * référentiels YAML (`cache: 'no-cache'`), mais un `import` de module ES ne prend pas
     * d'options : `shell.js` et `admin.js` n'avaient aucune parade.
     *
     * Un serveur de développement doit rendre CE QU'IL Y A SUR LE DISQUE. Il écoute sur
     * 127.0.0.1 et sert un dépôt de travail — il n'y a rien à économiser ici.
     */
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate'
    });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  SalsiIAPrompt\n  http://localhost:${PORT}\n\n  Ctrl+C pour arrêter.\n`);
});
