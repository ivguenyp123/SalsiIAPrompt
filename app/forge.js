/*
 * Forge — la couche qui parle au dépôt.
 *
 * Deux implémentations derrière une seule interface : GitLab, qui est la cible, et
 * GitHub, où vit le prototype. L'abstraction n'est pas spéculative — elle existe parce
 * qu'il y a deux implémentations réelles, et elle isole le reste de l'application des
 * différences d'API (chemins, en-tête d'authentification, création contre mise à jour).
 *
 * `fetch` est injectable : tout ceci est testable en Node, sans réseau ni forge.
 *
 * Interface :
 *   currentUser()                        → { username, name, avatar, id }
 *   listRepos({ search, perPage })       → [{ id, path, name }]
 *   listFiles(repo, path, ref)           → [{ name, path, type }]  ([] si le dossier n'existe pas)
 *   getFile(repo, path, ref)             → { content, sha } | null
 *   putFile(repo, path, { content, message, branch })  → crée ou met à jour
 *   deleteFile(repo, path, { message, branch })        → supprime
 *   moveFile(repo, from, to, { message, branch })      → déplace (copie puis supprime)
 *   listCommits(repo, path, { perPage, ref })          → [{ sha, message, author, date }]
 */

export class ForgeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ForgeError';
    this.status = status;
  }
}

/** Détecte la forge depuis l'URL saisie à la connexion. */
export function detectKind(url) {
  try { return /(^|\.)github\.com$/i.test(new URL(url).hostname) ? 'github' : 'gitlab'; }
  catch { return 'gitlab'; }
}

/** Base64 d'un texte UTF-8, sans dépendance, identique en Node et navigateur. */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** L'inverse, pour relire un fichier existant. */
export function fromBase64(b64) {
  const binary = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Traduit un code HTTP en phrase actionnable. Un « 403 » n'aide personne. */
function explain(status, { host, scopeHint }) {
  if (status === 401) return 'Jeton refusé : invalide, révoqué ou expiré.';
  if (status === 403) return `Jeton valide mais accès refusé : il manque le droit ${scopeHint}.`;
  if (status === 404) return `Ressource introuvable sur ${host} — dépôt inexistant, ou jeton sans visibilité dessus.`;
  if (status === 409) return 'Conflit : le fichier a changé entre la lecture et l\'écriture. Recharge et réessaie.';
  if (status >= 500) return 'La forge répond une erreur serveur. Réessaie dans un instant.';
  return `La forge a répondu ${status}.`;
}

function makeCaller({ base, headers, host, scopeHint }, fetchImpl) {
  return async function call(path, { params, body, method = 'GET' } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        // Sans ceci, le navigateur peut resservir une liste d'artefacts mise en cache :
        // on publie, et le catalogue continue d'afficher l'état d'avant.
        cache: 'no-store',
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new ForgeError(
        `Impossible de joindre ${host}. Vérifie l'adresse, ton accès réseau (VPN), ` +
        'et que la forge autorise les appels depuis le navigateur (CORS).', 0
      );
    }

    if (response.status === 404) throw new ForgeError(explain(404, { host, scopeHint }), 404);
    if (!response.ok) throw new ForgeError(explain(response.status, { host, scopeHint }), response.status);
    return response.status === 204 ? null : response.json();
  };
}

/* ── GitLab — la cible ─────────────────────────────────────────────────────── */

function gitlab(session, fetchImpl) {
  const host = new URL(session.gitlabUrl).host;
  const call = makeCaller({
    base: `${session.gitlabUrl}/api/v4`,
    headers: { 'PRIVATE-TOKEN': session.token },
    host, scopeHint: 'de portée `api` (ou `read_api` pour la seule consultation)'
  }, fetchImpl);

  const filePath = (repo, path) => `/projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(path)}`;

  // Nommée plutôt qu'inline : putFile en a besoin, et `this` ne désigne rien
  // d'utile dans une fonction fléchée d'objet littéral.
  const getFile = async (repo, path, ref = 'main') => {
    try {
      const f = await call(filePath(repo, path), { params: { ref } });
      return { content: fromBase64(f.content), sha: f.last_commit_id };
    } catch (error) {
      if (error.status === 404) return null;      // absent n'est pas une erreur
      throw error;
    }
  };

  return {
    kind: 'gitlab',
    getFile,

    currentUser: async () => {
      const u = await call('/user');
      return { id: u.id, username: u.username, name: u.name || u.username, avatar: u.avatar_url || '' };
    },

    listRepos: async ({ search = '', perPage = 50 } = {}) => {
      const list = await call('/projects', {
        params: { membership: true, simple: true, order_by: 'last_activity_at', per_page: perPage, search }
      });
      return list.map((p) => ({ id: String(p.id), path: p.path_with_namespace, name: p.name }));
    },

    listFiles: async (repo, path, ref = 'main') => {
      try {
        const list = await call(`/projects/${encodeURIComponent(repo)}/repository/tree`,
          { params: { path, ref, per_page: 100 } });
        return list.map((e) => ({ name: e.name, path: e.path, type: e.type === 'tree' ? 'dir' : 'file' }));
      } catch (error) {
        if (error.status === 404) return [];   // dossier absent = registre encore vide
        throw error;
      }
    },

    putFile: async (repo, path, { content, message, branch = 'main' }) => {
      // GitLab distingue création et mise à jour par le verbe HTTP : il faut donc
      // savoir si le fichier existe avant d'écrire.
      const existing = await getFile(repo, path, branch);
      return call(filePath(repo, path), {
        method: existing ? 'PUT' : 'POST',
        body: { branch, content, commit_message: message }
      });
    },

    deleteFile: (repo, path, { message, branch = 'main' }) =>
      call(filePath(repo, path), { method: 'DELETE', body: { branch, commit_message: message } }),

    listCommits: async (repo, path, { perPage = 50, ref = 'main' } = {}) => {
      try {
        const list = await call(`/projects/${encodeURIComponent(repo)}/repository/commits`,
          { params: { path, ref_name: ref, per_page: perPage } });
        return list.map((c) => ({
          sha: c.id,
          // GitLab sépare titre et corps ; on les recolle pour n'avoir qu'une forme.
          message: c.message || [c.title, c.description].filter(Boolean).join('\n\n'),
          author: c.author_name || c.author_email || '',
          date: c.committed_date || c.created_at
        }));
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
    }
  };
}

/* ── GitHub — où vit le prototype ──────────────────────────────────────────── */

function github(session, fetchImpl) {
  const call = makeCaller({
    base: 'https://api.github.com',
    headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/vnd.github+json' },
    host: 'github.com',
    // GitHub a deux formats de jeton et deux vocabulaires. Nommer les deux évite de
    // chercher une « portée repo » qui n'existe pas sur un jeton fine-grained.
    scopeHint: 'd\'écriture — jeton fine-grained : Repository permissions → Contents → '
             + 'Read and write ; jeton classique : portée `repo`'
  }, fetchImpl);

  return {
    kind: 'github',

    currentUser: async () => {
      const u = await call('/user');
      return { id: u.id, username: u.login, name: u.name || u.login, avatar: u.avatar_url || '' };
    },

    listRepos: async ({ search = '', perPage = 50 } = {}) => {
      const list = await call('/user/repos', { params: { affiliation: 'owner,collaborator', sort: 'pushed', per_page: perPage } });
      return list
        .map((r) => ({ id: r.full_name, path: r.full_name, name: r.name }))
        .filter((r) => !search || r.path.toLowerCase().includes(search.toLowerCase()));
    },

    listFiles: async (repo, path, ref = 'main') => {
      try {
        const list = await call(`/repos/${repo}/contents/${path}`, { params: { ref } });
        // Sur un fichier, GitHub renvoie un objet et non un tableau.
        if (!Array.isArray(list)) return [];
        return list.map((e) => ({ name: e.name, path: e.path, type: e.type === 'dir' ? 'dir' : 'file' }));
      } catch (error) {
        if (error.status === 404) return [];   // dossier absent = registre encore vide
        throw error;
      }
    },

    getFile: async (repo, path, ref = 'main') => {
      try {
        const f = await call(`/repos/${repo}/contents/${path}`, { params: { ref } });
        return { content: fromBase64(f.content), sha: f.sha };
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },

    putFile: async (repo, path, { content, message, branch = 'main' }) => {
      // GitHub exige le `sha` du fichier existant pour écraser : sans lui, l'écriture
      // est refusée. C'est sa protection contre l'écrasement aveugle, on la respecte.
      let sha;
      try {
        const f = await call(`/repos/${repo}/contents/${path}`, { params: { ref: branch } });
        sha = f.sha;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      return call(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: { message, content, branch, ...(sha ? { sha } : {}) }
      });
    },

    deleteFile: async (repo, path, { message, branch = 'main' }) => {
      // Comme pour l'écriture, GitHub exige le sha : on ne supprime pas à l'aveugle.
      const f = await call(`/repos/${repo}/contents/${path}`, { params: { ref: branch } });
      return call(`/repos/${repo}/contents/${path}`, {
        method: 'DELETE', body: { message, sha: f.sha, branch }
      });
    },

    listCommits: async (repo, path, { perPage = 50, ref = 'main' } = {}) => {
      try {
        const list = await call(`/repos/${repo}/commits`, { params: { path, sha: ref, per_page: perPage } });
        return list.map((c) => ({
          sha: c.sha,
          message: c.commit?.message || '',
          // `author` peut être nul (auteur sans compte GitHub) : on retombe sur le nom
          // du commit, qui est toujours là.
          author: c.author?.login || c.commit?.author?.name || '',
          date: c.commit?.author?.date || c.commit?.committer?.date
        }));
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
    }
  };
}

/**
 * Fabrique le client adapté à la session.
 * @param {{gitlabUrl:string, token:string, kind?:string}} session
 */
export function createForge(session, fetchImpl = globalThis.fetch) {
  if (!session?.gitlabUrl || !session?.token) throw new Error('createForge exige une URL et un jeton.');
  const kind = session.kind || detectKind(session.gitlabUrl);
  const forge = kind === 'github' ? github(session, fetchImpl) : gitlab(session, fetchImpl);

  /*
   * Déplacer un artefact, c'est ce que « valider » veut dire ici : le dossier porte
   * l'état. Aucune des deux forges n'a d'opération de déplacement — on copie puis on
   * supprime, dans cet ordre. Si la suppression échoue, le fichier existe en double,
   * ce qui est visible et réparable ; l'inverse le ferait disparaître.
   */
  forge.moveFile = async (repo, from, to, { message, branch = 'main' }) => {
    const found = await forge.getFile(repo, from, branch);
    if (!found) throw new ForgeError(`Introuvable : ${from}`, 404);
    await forge.putFile(repo, to, { content: toBase64(found.content), message, branch });
    await forge.deleteFile(repo, from, { message: `${message} (retrait de la file)`, branch });
  };

  return forge;
}

export default { createForge, detectKind, toBase64, fromBase64, ForgeError };
