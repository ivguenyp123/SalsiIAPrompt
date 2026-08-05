/*
 * Client GitLab minimal — uniquement ce dont le registre a besoin, rien de plus.
 *
 * `fetch` est injectable : le client est donc testable en Node sans réseau, et la
 * couche qui parlera à GitLab depuis un back pourra réutiliser le même code.
 */

export class GitlabError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitlabError';
    this.status = status;
  }
}

/** Traduit un code HTTP en phrase actionnable. Un « 401 » n'aide personne. */
function explain(status, gitlabUrl) {
  if (status === 401) return 'Jeton refusé : il est invalide, révoqué, ou expiré.';
  if (status === 403) return 'Jeton valide mais accès refusé : il manque la portée `api` (ou `read_api`).';
  if (status === 404) return `Aucune API GitLab à cette adresse. Vérifie ${gitlabUrl}.`;
  if (status >= 500) return 'GitLab répond une erreur serveur. Réessaie dans un instant.';
  return `GitLab a répondu ${status}.`;
}

export function createClient({ gitlabUrl, token }, fetchImpl = globalThis.fetch) {
  if (!gitlabUrl || !token) throw new Error('createClient exige gitlabUrl et token.');

  async function call(path, { params, ...options } = {}) {
    const url = new URL(`${gitlabUrl}/api/v4${path}`);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        ...options,
        headers: { 'PRIVATE-TOKEN': token, ...(options.headers || {}) }
      });
    } catch (cause) {
      // Échec réseau : CORS, DNS, VPN, instance injoignable. Le message du navigateur
      // est inexploitable, on dit ce qu'il faut vérifier.
      throw new GitlabError(
        `Impossible de joindre ${gitlabUrl}. Vérifie l'adresse, ton accès réseau (VPN), ` +
        'et que l\'instance autorise les appels depuis le navigateur (CORS).', 0
      );
    }

    if (!response.ok) throw new GitlabError(explain(response.status, gitlabUrl), response.status);
    return response.status === 204 ? null : response.json();
  }

  return {
    /** Valide le jeton et renvoie l'utilisateur. C'est l'appel de connexion. */
    currentUser: () => call('/user'),

    /** Projets accessibles à l'utilisateur, les plus récents d'abord. */
    listProjects: ({ search = '', perPage = 20 } = {}) =>
      call('/projects', { params: { membership: true, simple: true, order_by: 'last_activity_at', per_page: perPage, search } }),

    project: (id) => call(`/projects/${encodeURIComponent(id)}`),

    call
  };
}

export default { createClient, GitlabError };
