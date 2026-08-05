#!/usr/bin/env node
/*
 * Serveur statique minimal, pour ouvrir le Studio.
 *
 *   node studio/serve.js        puis http://localhost:8080
 *
 * Pourquoi un serveur et pas un double-clic : les navigateurs interdisent les modules
 * ES chargés depuis file:// (politique d'origine). Or la page importe les VRAIS modules
 * du linter — c'est tout l'intérêt, une seule implémentation partagée avec la CI. Les
 * inliner dans la page créerait une copie qui divergerait au premier correctif.
 *
 * Aucune dépendance, aucune écriture, lecture seule sous registry/.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);

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
    if (url.pathname === '/') { res.writeHead(302, { Location: '/studio/' }).end(); return; }
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }

    const rel = decodeURIComponent(url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);

    // Confinement : rien au-dessus de registry/, quoi qu'on demande.
    const path = normalize(join(ROOT, rel));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end('403'); return; }

    const info = await stat(path);
    if (info.isDirectory()) { res.writeHead(403).end('403'); return; }

    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, () => {
  console.log(`\n  Studio — lint en direct\n  http://localhost:${PORT}\n\n  Ctrl+C pour arrêter.\n`);
});
