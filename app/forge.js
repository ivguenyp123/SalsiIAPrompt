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
 *
 * Matière (moment 5) — aller chercher ce qu'un agent doit LIRE, dans le dépôt de
 * l'utilisateur, avec son jeton, depuis son navigateur :
 *   listPullRequests(repo)                             → [{ numero, titre, branche, cible, auteur }]
 *   pullRequestChanges(repo, numero)                   → [{ fichier, ancien, patch, binaire }]
 *
 * Les deux forges rendent un patch PAR FICHIER : `lib/matiere.js` les recolle en diff
 * unifié. La forge transporte, elle ne met pas en forme.
 *
 * Livraison (moment 5) — implémentée sur GitLab, la cible. Sur GitHub, `commitFiles` et
 * `createMergeRequest` lèvent une erreur explicite plutôt que d'exister à moitié :
 *   projectInfo(repo)                                  → { defaultBranch, path, visibility }
 *   listBranches(repo)                                 → [{ name, protectee, default }]
 *   listTree(repo, ref)                                → [chemins]
 *   commitFiles(repo, { branch, message, files })      → { sha, url }   commit ATOMIQUE
 *   createMergeRequest(repo, { source, target, title })→ { number, url }
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
/*
 * Le statut d'une exécution CI, réduit à ce dont on a besoin.
 *
 * GitLab et GitHub emploient des vocabulaires différents pour la même chose — `failed` /
 * `failure`, `running` / `in_progress`. Tout ce qui n'est ni un échec ni un succès franc
 * est rangé dans `en-cours` : un signal ambigu ne doit pas se faire passer pour un fait.
 */
const ECHECS = new Set(['failed', 'failure', 'canceled', 'cancelled', 'timed_out']);
const SUCCES = new Set(['success', 'passed']);

export function statutCI(brut) {
  const s = String(brut || '').toLowerCase();
  if (ECHECS.has(s)) return 'echec';
  if (SUCCES.has(s)) return 'succes';
  return 'en-cours';
}

/*
 * `dit` porte CE QUE LA FORGE A RÉPONDU, quand on a pu le lire.
 *
 * « La forge répond une erreur serveur » est vrai et inutilisable : ça ne dit ni quelle
 * forge, ni quel appel, ni ce qu'elle a dit. On a passé une soirée à deviner faute de
 * cette ligne. Quand la réponse porte un message — et les deux forges en mettent un —
 * il part à l'écran tel quel, tronqué mais jamais réécrit.
 */
function explain(status, { host, scopeHint, dit = '' }) {
  const suite = dit ? ` La forge dit : « ${String(dit).slice(0, 220)} »` : '';
  if (status === 401) return `Jeton refusé : invalide, révoqué ou expiré.${suite}`;
  if (status === 403) return `Jeton valide mais accès refusé : il manque le droit ${scopeHint}.${suite}`;
  if (status === 404) return `Ressource introuvable sur ${host} — dépôt inexistant, ou jeton sans visibilité dessus.${suite}`;
  if (status === 409) return `Conflit : le fichier a changé entre la lecture et l'écriture. Recharge et réessaie.${suite}`;
  if (status >= 500) return `${host} répond une erreur serveur (${status}).${suite}`;
  return `La forge a répondu ${status}.${suite}`;
}

/*
 * ── LE REPLI PAR LE RELAIS ───────────────────────────────────────────────────
 *
 * Un appel direct qui échoue AVANT toute réponse HTTP — `fetch` qui jette — a deux causes
 * possibles, et une seule est une panne :
 *
 *   le réseau ne passe pas          → il n'y a rien à faire, et on le dit ;
 *   le navigateur a REFUSÉ la réponse pour cause de CORS → la forge a répondu, c'est le
 *   navigateur qui a jeté. Le réseau, lui, marche parfaitement.
 *
 * Le second cas s'est produit : `api.github.com` a renvoyé
 * `Access-Control-Allow-Origin: *;` — un en-tête invalide — et plus personne n'a pu se
 * connecter. Aucune ligne de notre code n'y pouvait quoi que ce soit, parce que le refus
 * vient du navigateur et pas de nous.
 *
 * Le navigateur ne nous dit PAS laquelle des deux causes c'est : `fetch` jette un
 * `TypeError` sans détail dans les deux cas, par conception. On ne peut donc pas choisir —
 * on RÉESSAIE, une fois, par un relais qui n'a pas de politique d'origine. S'il répond,
 * c'était le CORS ; s'il échoue aussi, c'était bien le réseau, et on rend le message
 * d'origine.
 *
 * Le direct reste la voie normale, toujours tentée d'abord. Là où aucun serveur ne tourne
 * — l'appli servie en fichiers statiques sur un poste — le relais échoue en silence et le
 * comportement est exactement celui d'avant.
 */
const RELAIS = '/api/forge';

async function parLeRelais(url, { method, headers, body }, fetchImpl) {
  const r = await fetchImpl(RELAIS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, methode: method, entetes: headers, corps: body || null })
  });
  if (!r.ok) throw new Error('relais indisponible');
  const enveloppe = await r.json();
  if (enveloppe.erreur) throw new Error(enveloppe.erreur);

  /*
   * On reconstruit une réponse à la forme de `fetch`, pour que la suite de `call` ne
   * sache pas par où l'appel est passé. Un chemin qui aurait sa propre gestion d'erreurs
   * finirait par ne plus dire la même chose que l'autre.
   */
  return {
    ok: enveloppe.statut >= 200 && enveloppe.statut < 300,
    status: enveloppe.statut,
    json: async () => JSON.parse(enveloppe.corps || 'null'),
    /*
     * Le corps BRUT, garde de côté pour le message d'erreur.
     *
     * Par le relais, on l'a déjà entièrement lu — c'est la seule voie où on peut le
     * montrer sans risquer de consommer un flux qu'on lira ensuite. En direct, le
     * navigateur nous refuse souvent jusqu'au corps des réponses d'erreur.
     */
    brut: enveloppe.corps || ''
  };
}

/** Le message d'une réponse d'erreur, quand la forge en met un. Les deux en mettent. */
function messageDe(brut) {
  if (!brut) return '';
  try {
    const o = JSON.parse(brut);
    return o.message || o.error || o.error_description || '';
  } catch {
    // Une page HTML d'erreur — un portail, un proxy — n'a pas de message exploitable.
    return /^\s*</.test(brut) ? '' : String(brut).trim();
  }
}

/*
 * ── RÉESSAYER CE QUI EST SANS CONSÉQUENCE ────────────────────────────────────
 *
 * Une panne totale se voit et on l'attend. Un TAUX D'ERREUR ne se voit pas : pendant
 * l'incident GitHub du 17 août, l'API rendait ~20 % de 5xx. Neuf appels passent, le
 * dixième tombe — et un agent qui en fait soixante, comme le scan de secrets, n'a
 * pratiquement aucune chance d'aboutir. L'écran affiche alors « erreur serveur » sur un
 * service qui, vu de l'extérieur, fonctionne.
 *
 * Deux réessais espacés ramènent un appel à 20 % d'échec sous 1 %. C'est la différence
 * entre une démo qui tient et une démo qui tombe au milieu.
 *
 * ── ON NE RÉESSAIE QUE CE QUI EST SANS CONSÉQUENCE ───────────────────────────
 *
 * Uniquement les LECTURES, et uniquement sur 5xx ou 429. Rejouer un POST qui a peut-être
 * abouti ouvrirait deux merge requests, poserait deux commentaires, approuverait deux
 * fois — un dégât bien pire que l'erreur qu'on répare. Le doute sur un écrit se tranche
 * en le laissant échouer.
 *
 * Un 4xx n'est jamais réessayé : un jeton refusé le restera, et insister ne fait que
 * doubler le temps avant d'afficher la vraie cause.
 */
const REESSAIS = 2;
const ATTENTE = [400, 1200];
const A_REESSAYER = (statut) => statut === 429 || statut >= 500;
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

function makeCaller({ base, headers, host, scopeHint }, fetchImpl) {
  return async function call(path, { params, body, method = 'GET' } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }

    const entetes = { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) };

    // Une lecture peut être rejouée sans conséquence. Un écrit qui a peut-être abouti,
    // non — voir plus haut : deux merge requests valent pire qu'une erreur.
    const rejouable = method === 'GET';

    const unAppel = async () => {
      try {
        return await fetchImpl(url.toString(), {
          method,
          // Sans ceci, le navigateur peut resservir une liste d'artefacts mise en cache :
          // on publie, et le catalogue continue d'afficher l'état d'avant.
          cache: 'no-store',
          headers: entetes,
          ...(body ? { body: JSON.stringify(body) } : {})
        });
      } catch {
        try {
          return await parLeRelais(url.toString(), { method, headers: entetes, body }, fetchImpl);
        } catch {
          throw new ForgeError(
            `Impossible de joindre ${host}. Vérifie l'adresse, ton accès réseau (VPN), ` +
            'et que la forge autorise les appels depuis le navigateur (CORS). Le relais du '
            + 'serveur local n\'a pas répondu non plus.', 0
          );
        }
      }
    };

    let response = await unAppel();
    for (let essai = 0; essai < REESSAIS
                        && rejouable && !response.ok && A_REESSAYER(response.status); essai += 1) {
      await dormir(ATTENTE[essai]);
      response = await unAppel();
    }

    if (!response.ok) {
      const dit = messageDe(response.brut);
      throw new ForgeError(explain(response.status, { host, scopeHint, dit }), response.status);
    }
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

    /* ── Ce qu'exige la livraison (moment 5) ─────────────────────────────── */

    /*
     * Les merge requests, OUVERTES par défaut — on vient d'ordinaire chercher ce qui est en
     * relecture, pas de l'archive.
     *
     * `etat: 'fusionnees'` ouvre l'archive, et c'est le lead time qui l'a rendu nécessaire :
     * il se mesure sur ce qui est PARTI, donc sur ce qui est fermé. Sans lui, une des quatre
     * métriques DORA restait à coller à la main.
     */
    listPullRequests: async (repo, { etat = 'ouvertes', perPage = 50, depuis = '' } = {}) => {
      const list = await call(`/projects/${encodeURIComponent(repo)}/merge_requests`, {
        params: {
          state: etat === 'fusionnees' ? 'merged' : 'opened',
          per_page: perPage, order_by: 'updated_at',
          ...(depuis ? { updated_after: depuis } : {})
        }
      });
      return list.map((m) => ({ numero: m.iid, titre: m.title, branche: m.source_branch,
                                cible: m.target_branch, auteur: m.author?.username || '',
                                url: m.web_url || '',
                                ouvert: m.created_at || '', fusionne: m.merged_at || '' }));
    },

    pullRequestChanges: async (repo, numero) => {
      const r = await call(`/projects/${encodeURIComponent(repo)}/merge_requests/${numero}/changes`);
      return (r.changes || []).map((c) => ({
        fichier: c.new_path, ancien: c.old_path, patch: c.diff || '',
        binaire: Boolean(c.binary) || !c.diff
      }));
    },

    /*
     * ── LES QUATRE GESTES D'UNE MERGE REQUEST ─────────────────────────────────
     *
     * Ils ÉCRIVENT dans la merge request de quelqu'un, sous le nom du porteur du jeton.
     * Ce n'est pas la plateforme qui approuve : c'est vous, et la trace le dira.
     *
     * Les quatre existent des deux côtés, et c'est la raison pour laquelle ils sont ici
     * plutôt que dans l'écran : GitLab approuve par une route dédiée, GitHub par une
     * « review » ; GitLab ferme par un `state_event`, GitHub par un `state`. Un écran qui
     * connaîtrait ces deux vocabulaires finirait par n'en gérer qu'un.
     */
    commenterPullRequest: (repo, numero, texte) =>
      call(`/projects/${encodeURIComponent(repo)}/merge_requests/${numero}/notes`,
        { method: 'POST', body: { body: texte } }).then((n) => ({ id: n.id })),

    approuverPullRequest: (repo, numero) =>
      call(`/projects/${encodeURIComponent(repo)}/merge_requests/${numero}/approve`,
        { method: 'POST', body: {} }).then(() => ({ approuve: true })),

    /*
     * Fusionner est le seul geste de cette liste qu'on ne défait pas d'un clic. Il n'est
     * jamais appelé sans confirmation par l'écran — et jamais par un modèle.
     */
    fusionnerPullRequest: (repo, numero) =>
      call(`/projects/${encodeURIComponent(repo)}/merge_requests/${numero}/merge`,
        { method: 'PUT', body: {} }).then((m) => ({ fusionne: m.state === 'merged', etat: m.state })),

    fermerPullRequest: (repo, numero) =>
      call(`/projects/${encodeURIComponent(repo)}/merge_requests/${numero}`,
        { method: 'PUT', body: { state_event: 'close' } }).then((m) => ({ etat: m.state })),

    projectInfo: async (repo) => {
      const p = await call(`/projects/${encodeURIComponent(repo)}`);
      return { defaultBranch: p.default_branch, path: p.path_with_namespace, visibility: p.visibility };
    },

    /*
     * Les dernières exécutions de la CI, dans une forme commune aux deux forges.
     *
     * Le signal le plus utile qu'un dépôt puisse donner : « ça vient de casser ». Il sert
     * à la recommandation, qui doit partir d'un FAIT observé plutôt que d'une devinette.
     *
     * `statut` est normalisé sur trois valeurs, parce que GitLab dit `failed` et GitHub
     * `failure` : un appelant qui devrait connaître les deux vocabulaires finirait par
     * n'en gérer qu'un, et le signal se perdrait sur l'autre forge sans que rien le dise.
     */
    listRuns: async (repo, { perPage = 20, depuis = '' } = {}) => {
      const list = await call(`/projects/${encodeURIComponent(repo)}/pipelines`, {
        params: { per_page: perPage, order_by: 'updated_at',
                  ...(depuis ? { updated_after: depuis } : {}) }
      });
      return list.map((p) => ({
        id: p.id, statut: statutCI(p.status), branche: p.ref || '',
        quand: p.updated_at || p.created_at || '', url: p.web_url || '',
        /*
         * `sha` et `debut` servent aux mesures, `quand` à l'affichage.
         *
         * La fréquence de déploiement DÉDUPLIQUE par commit — un commit qui déclenche
         * trois pipelines est une livraison, pas trois — et sans `sha` on ne peut pas le
         * faire. Le taux d'échec et le temps de rétablissement, eux, comptent l'âge d'un
         * pipeline : `updated_at` bouge quand un job est relancé des jours après, et
         * daterait l'incident du jour de sa réparation.
         */
        sha: p.sha || '', debut: p.created_at || ''
      }));
    },

    /*
     * GitLab donne la date du dernier commit avec la branche ; GitHub non — voir plus bas.
     * On la remonte quand elle est là plutôt que de l'ignorer des deux côtés : sans elle,
     * impossible de dire qu'une branche est morte.
     */
    listBranches: async (repo) => {
      const list = await call(`/projects/${encodeURIComponent(repo)}/repository/branches`, { params: { per_page: 100 } });
      return list.map((b) => ({
        name: b.name, protectee: Boolean(b.protected), default: Boolean(b.default),
        sha: b.commit?.id || '',
        quand: b.commit?.committed_date || b.commit?.created_at || ''
      }));
    },

    /** Arbre récursif d'une réf — sert à découvrir les overlays sans les deviner. */
    listTree: async (repo, ref) => {
      try {
        const list = await call(`/projects/${encodeURIComponent(repo)}/repository/tree`,
          { params: { recursive: true, ref, per_page: 100 } });
        return list.filter((e) => e.type === 'blob').map((e) => e.path);
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
    },

    /*
     * Commit ATOMIQUE de plusieurs fichiers.
     *
     * GitLab prend un tableau d'actions et fait un seul commit : c'est exactement la
     * sémantique qu'il faut ici. Une livraison qui bumperait la CI sans les overlays
     * laisserait le dépôt dans un état incohérent, et il n'y aurait rien à annuler d'un
     * bloc. L'atomicité n'est pas un confort, c'est ce qui rend l'opération réversible.
     */
    /*
     * `depuis` crée la branche si elle n'existe pas — c'est `start_branch` de GitLab.
     *
     * Sans lui, proposer un correctif demandait de créer la branche à part, donc un appel
     * de plus et un état intermédiaire : une branche vide qui traîne si le commit échoue.
     * GitLab fait les deux en une fois, et l'atomicité vaut ici autant qu'ailleurs.
     *
     * `action: create` plutôt que `update` quand on part d'une branche neuve : GitLab
     * refuse `update` sur un fichier qui n'existe pas, et `SECURITY.md` absent est
     * précisément le cas nominal. On retombe sur `update` si le fichier était déjà là —
     * une branche de correctifs rejouée porte déjà les fichiers du coup précédent.
     */
    commitFiles: async (repo, { branch, message, files, depuis = '' }) => {
      const chemin = `/projects/${encodeURIComponent(repo)}/repository/commits`;
      const corps = (action) => ({
        branch, commit_message: message, ...(depuis ? { start_branch: depuis } : {}),
        actions: files.map((f) => ({ action, file_path: f.path, content: f.content }))
      });

      if (depuis) {
        try {
          const neuf = await call(chemin, { method: 'POST', body: corps('create') });
          return { sha: neuf.id, url: neuf.web_url };
        } catch (error) {
          // 400 : un des fichiers existe déjà sur la branche de départ. On réécrit.
          if (error.status !== 400) throw error;
          const maj = await call(chemin, { method: 'POST', body: corps('update') });
          return { sha: maj.id, url: maj.web_url };
        }
      }

      const actions = files.map((f) => ({ action: 'update', file_path: f.path, content: f.content }));
      const c = await call(`/projects/${encodeURIComponent(repo)}/repository/commits`, {
        method: 'POST', body: { branch, commit_message: message, actions }
      });
      return { sha: c.id, url: c.web_url };
    },

    createMergeRequest: async (repo, { source, target, title, description = '' }) => {
      const mr = await call(`/projects/${encodeURIComponent(repo)}/merge_requests`, {
        method: 'POST', body: { source_branch: source, target_branch: target, title, description }
      });
      return { number: mr.iid, url: mr.web_url, title: mr.title };
    },

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

    /*
     * La livraison n'est PAS implémentée ici, et c'est un choix.
     *
     * GitHub héberge le prototype ; la cible est GitLab. Un commit multi-fichiers y
     * demande une danse d'arbres et de blobs — du code non trivial, pour une opération
     * que personne n'exécutera jamais sur cette forge. Le construire « au cas où » serait
     * du poids mort à maintenir. Mieux vaut une erreur qui dit la vérité.
     */
    /*
     * GitHub n'a pas d'état « fusionnée » : une PR fusionnée est une PR CLOSE dont
     * `merged_at` est rempli. Demander `state: merged` ne rendrait rien, et prendre les
     * `closed` sans regarder `merged_at` compterait les PR ABANDONNÉES comme des
     * livraisons — le lead time se mettrait alors à mesurer des changements qui ne sont
     * jamais partis. Le filtre est donc ici, et il est la seule différence entre les deux
     * forges sur cette opération.
     */
    listPullRequests: async (repo, { etat = 'ouvertes', perPage = 50 } = {}) => {
      const fusionnees = etat === 'fusionnees';
      const list = await call(`/repos/${repo}/pulls`, {
        params: { state: fusionnees ? 'closed' : 'open', per_page: perPage,
                  sort: 'updated', direction: 'desc' }
      });
      return list
        .filter((p) => !fusionnees || Boolean(p.merged_at))
        .map((p) => ({ numero: p.number, titre: p.title, branche: p.head?.ref || '',
                       cible: p.base?.ref || '', auteur: p.user?.login || '',
                       url: p.html_url || '',
                       ouvert: p.created_at || '', fusionne: p.merged_at || '' }));
    },

    /*
     * `/pulls/:n/files` et pas l'en-tête `Accept: …v3.diff`.
     *
     * Le diff brut demanderait une variante du transport qui ne parse pas de JSON — un
     * chemin à part pour un seul appel. Cette route rend la même information en JSON, et
     * dans la MÊME forme que GitLab : un patch par fichier, que `lib/matiere.js` recolle.
     * Un format commun aux deux forges vaut mieux qu'un raccourci propre à l'une.
     */
    pullRequestChanges: async (repo, numero) => {
      const list = await call(`/repos/${repo}/pulls/${numero}/files`, { params: { per_page: 100 } });
      return list.map((f) => ({ fichier: f.filename, ancien: f.previous_filename || f.filename,
                                patch: f.patch || '', binaire: !f.patch }));
    },

    /*
     * ── LES QUATRE GESTES, CÔTÉ GITHUB ────────────────────────────────────────
     *
     * Même intention, trois vocabulaires différents — et c'est exactement pourquoi ils
     * vivent ici et pas dans l'écran.
     *
     * Un COMMENTAIRE de pull request est une note d'ISSUE : GitHub range les deux au même
     * endroit, et `/pulls/:n/comments` désigne autre chose — les commentaires attachés à
     * une ligne du diff. Se tromper de route rend un 422 incompréhensible.
     */
    commenterPullRequest: (repo, numero, texte) =>
      call(`/repos/${repo}/issues/${numero}/comments`,
        { method: 'POST', body: { body: texte } }).then((n) => ({ id: n.id })),

    // GitHub n'a pas d'approbation isolée : approuver, c'est déposer une « review » dont
    // le verdict est APPROVE.
    approuverPullRequest: (repo, numero) =>
      call(`/repos/${repo}/pulls/${numero}/reviews`,
        { method: 'POST', body: { event: 'APPROVE' } }).then(() => ({ approuve: true })),

    /*
     * Fusionner est le seul geste de cette liste qu'on ne défait pas d'un clic. Il n'est
     * jamais appelé sans confirmation par l'écran — et jamais par un modèle.
     */
    fusionnerPullRequest: (repo, numero) =>
      call(`/repos/${repo}/pulls/${numero}/merge`, { method: 'PUT', body: {} })
        .then((m) => ({ fusionne: Boolean(m.merged), etat: m.merged ? 'merged' : 'open' })),

    // Refuser une pull request, c'est la FERMER. GitHub n'a pas d'état « refusée ».
    fermerPullRequest: (repo, numero) =>
      call(`/repos/${repo}/pulls/${numero}`, { method: 'PATCH', body: { state: 'closed' } })
        .then((m) => ({ etat: m.state })),

    projectInfo: async (repo) => {
      const r = await call(`/repos/${repo}`);
      return { defaultBranch: r.default_branch, path: r.full_name,
               visibility: r.private ? 'private' : 'public' };
    },

    /*
     * Même forme que côté GitLab. `/actions/runs` demande la permission Actions du jeton :
     * sans elle l'appel échoue en 403, et c'est à l'appelant de traiter l'absence de
     * signal comme une absence — pas comme une panne.
     */
    listRuns: async (repo, { perPage = 20, depuis = '' } = {}) => {
      const r = await call(`/repos/${repo}/actions/runs`, {
        // GitHub filtre les dates par une expression dans `created`, là où GitLab a un
        // paramètre dédié. Même intention, deux écritures — c'est le rôle de cette couche.
        params: { per_page: perPage, ...(depuis ? { created: `>=${depuis.slice(0, 10)}` } : {}) }
      });
      return (r.workflow_runs || []).map((w) => ({
        id: w.id, statut: statutCI(w.status === 'completed' ? w.conclusion : w.status),
        branche: w.head_branch || '', quand: w.updated_at || w.created_at || '',
        url: w.html_url || '',
        // Voir le commentaire côté GitLab : `sha` pour dédupliquer les livraisons, `debut`
        // parce qu'un job relancé plus tard déplacerait `updated_at` et daterait un
        // incident du jour de sa réparation.
        sha: w.head_sha || '', debut: w.created_at || ''
      }));
    },

    /*
     * GitHub ne rend PAS la date du dernier commit d'une branche — seulement son SHA.
     * `quand` reste donc vide, et l'appelant va la chercher branche par branche s'il en a
     * besoin. Inventer une date ici serait pire que de ne rien rendre : une branche
     * paraîtrait fraîche ou morte sans que rien ne l'ait mesuré.
     */
    listBranches: async (repo) => {
      const list = await call(`/repos/${repo}/branches`, { params: { per_page: 100 } });
      return list.map((b) => ({
        name: b.name, protectee: Boolean(b.protected), default: false,
        sha: b.commit?.sha || '', quand: ''
      }));
    },

    listTree: async (repo, ref) => {
      try {
        const t = await call(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}`, { params: { recursive: 1 } });
        return (t.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
    },

    commitFiles: async () => {
      throw new ForgeError(
        'La livraison vise GitLab. Sur GitHub, un commit atomique de plusieurs fichiers '
        + 'demande de reconstruire un arbre git à la main — non implémenté ici, faute '
        + 'd\'usage réel. Connecte-toi au GitLab cible pour exécuter.', 501);
    },

    createMergeRequest: async () => {
      throw new ForgeError('La livraison vise GitLab : la création de merge request n\'est pas implémentée sur GitHub.', 501);
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
