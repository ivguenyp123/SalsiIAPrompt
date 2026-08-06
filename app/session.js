/*
 * Session — identité de l'utilisateur courant sur sa forge.
 *
 * Reprise du principe de `login.html` de Salsifi : l'utilisateur fournit l'adresse de sa
 * forge et un jeton personnel, on le valide auprès d'elle, on retient l'identité.
 *
 * Trois écarts assumés par rapport au hub :
 *
 * 1. CLÉ DE STOCKAGE PROPRE. Le registre est une autre application : partager
 *    `devops_hub_workspaces` coupleraient leurs cycles de vie. On lit la clé du hub
 *    UNIQUEMENT pour pré-remplir le formulaire — jamais pour ouvrir une session à
 *    l'insu de l'utilisateur.
 *
 * 2. sessionStorage PAR DÉFAUT. Le hub écrit le jeton dans localStorage, où il survit
 *    à la fermeture du navigateur et reste lisible par n'importe quelle XSS. Ici il vit
 *    dans l'onglet et disparaît avec lui. « Rester connecté » bascule sur localStorage,
 *    en connaissance de cause.
 *
 * 3. AUCUN JETON N'ENTRE DANS UN ARTEFACT. Le jeton sert à parler à la forge, point.
 *    L007 refuse déjà tout secret dans un artefact ; encore faut-il ne pas l'y mettre.
 *
 * Cela reste un jeton dans le navigateur. C'est acceptable pour une application interne
 * en construction ; ce n'est pas la cible bancaire, qui demandera OAuth et un back.
 */

import { detectKind } from './forge.js';

const KEY = 'salsi_ia_session';
const HUB_KEY = 'devops_hub_workspaces';   // lecture seule, pour le pré-remplissage

/** Normalise l'URL d'une forge. Lève un message lisible si elle est inutilisable. */
export function normalizeGitlabUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) throw new Error('Indique l\'adresse de ta forge — https://github.com, ou ton GitLab.');

  // Un schéma explicite autre que http(s) doit être REFUSÉ, pas préfixé : sans ce test,
  // « ftp://x » devient « https://ftp://x », une URL valide pointant n'importe où.
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    throw new Error(`Schéma « ${scheme[1]} » non géré : l'URL doit être en http ou https.`);
  }
  const withScheme = scheme ? value : `https://${value}`;
  let url;
  try { url = new URL(withScheme); }
  catch { throw new Error(`« ${raw} » n'est pas une URL valide.`); }

  if (!/^https?:$/.test(url.protocol)) throw new Error('L\'URL doit être en http ou https.');
  if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
    throw new Error('En http, le jeton circulerait en clair. Utilise https.');
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** Le jeton a-t-il une forme plausible ? Évite un aller-retour réseau pour rien. */
export function checkToken(raw) {
  const token = String(raw || '').trim();
  if (!token) throw new Error('Indique ton jeton d\'accès personnel.');
  if (token.length < 20) throw new Error('Ce jeton semble trop court.');
  if (/\s/.test(token)) throw new Error('Le jeton ne doit contenir aucun espace.');
  return token;
}

/** Ce qu'on retient d'une identité — le strict nécessaire, dans la forme de la forge. */
export function toSession(gitlabUrl, token, user, remember = false) {
  return {
    gitlabUrl,
    kind: detectKind(gitlabUrl),   // gitlab ou github, déduit de l'URL
    token,
    username: user.username,
    name: user.name || user.username,
    avatar: user.avatar || '',
    userId: user.id,
    connectedAt: new Date().toISOString(),
    remember: Boolean(remember)
  };
}

/* ── Accès au stockage. Isolés ici pour rester testables hors navigateur. ── */

const stores = () => {
  if (typeof globalThis.sessionStorage === 'undefined') return [];
  return [globalThis.sessionStorage, globalThis.localStorage];
};

export function save(session) {
  const [session_, local] = stores();
  if (!session_) return;
  const raw = JSON.stringify(session);
  // Un seul emplacement fait foi : on efface l'autre pour éviter deux sessions divergentes.
  if (session.remember) { local.setItem(KEY, raw); session_.removeItem(KEY); }
  else { session_.setItem(KEY, raw); local.removeItem(KEY); }
}

export function load() {
  const [session_, local] = stores();
  if (!session_) return null;
  const raw = session_.getItem(KEY) || local.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.gitlabUrl && parsed?.token && parsed?.username ? parsed : null;
  } catch { return null; }
}

export function clear() {
  const [session_, local] = stores();
  if (!session_) return;
  session_.removeItem(KEY);
  local.removeItem(KEY);
}

/**
 * Pré-remplissage depuis une session Salsifi existante — commodité, pas connexion.
 * On ne reprend jamais le jeton du hub : l'utilisateur le ressaisit, en connaissance
 * de cause, pour une application qui n'est pas celle où il l'avait donné.
 */
export function hubHint() {
  const [session_, local] = stores();
  if (!session_) return null;
  try {
    const raw = local.getItem(HUB_KEY);
    if (!raw) return null;
    const { gitlabUrl, username } = JSON.parse(raw) || {};
    return gitlabUrl ? { gitlabUrl, username: username || '' } : null;
  } catch { return null; }
}

/** Garde de page : renvoie la session, ou redirige vers la connexion. */
export function requireSession(loginPath = './login.html') {
  const session = load();
  if (!session) { globalThis.location.replace(loginPath); return null; }
  return session;
}

export default { normalizeGitlabUrl, checkToken, toSession, save, load, clear, hubHint, requireSession };
