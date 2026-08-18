/*
 * Vertex AI — le premier endroit où ce registre appelle vraiment un modèle.
 *
 * ── POURQUOI CE MODULE NE PEUT PAS VIVRE DANS LE NAVIGATEUR ──────────────────
 *
 * Tout le reste du produit tourne dans l'onglet, avec le jeton de l'utilisateur. Pas
 * ça. Vertex s'authentifie avec une clé de compte de service — une clé privée RSA. La
 * mettre dans une page, c'est la donner à quiconque ouvre les outils de développement,
 * et elle ouvre le projet GCP entier, pas seulement un modèle. Le navigateur ne verra
 * donc jamais ces identifiants : ce module tourne côté serveur, là où le CI tourne déjà.
 *
 * ── ZÉRO DÉPENDANCE, COMME LE RESTE ──────────────────────────────────────────
 *
 * `google-auth-library` ferait ça en trois lignes et amènerait cinquante paquets dans
 * un dépôt qui n'en a aucun. Or ce qu'il faut tient en peu de choses : signer un JWT
 * RS256 (`node:crypto`), l'échanger contre un jeton d'accès, appeler une URL. Node sait
 * déjà tout faire. Le socle reste installable derrière un proxy d'entreprise sans
 * demander l'ouverture d'un registre npm — au moment où ce produit entre à LCL, ça
 * compte plus que trois lignes de moins.
 *
 * ── LES IDENTIFIANTS NE SONT JAMAIS DANS LE DÉPÔT ────────────────────────────
 *
 *   VERTEX_PROJECT                    identifiant du projet GCP
 *   VERTEX_LOCATION                   région, ex. europe-west9 (Paris). Défaut : europe-west1
 *   GOOGLE_SERVICE_ACCOUNT_JSON       la clé, en JSON, dans la variable
 *   GOOGLE_APPLICATION_CREDENTIALS    ou le chemin d'un fichier de clé
 *   SALSI_MODELE_<PALIER>             pour forcer un modèle sur un palier (rare)
 *
 * Rien de tout ça n'est écrit, journalisé, ni renvoyé par une fonction de ce fichier :
 * la clé privée ne sort pas de `signer()`.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const OAUTH = 'https://oauth2.googleapis.com/token';
const PORTEE = 'https://www.googleapis.com/auth/cloud-platform';
const REGION_DEFAUT = 'europe-west1';

/** Une erreur qui porte le statut HTTP : l'appelant distingue un 401 d'un 429. */
export class VertexError extends Error {
  constructor(message, status = 0, detail = '') {
    super(message);
    this.name = 'VertexError';
    this.status = status;
    this.detail = detail;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Les identifiants, depuis l'environnement.
 *
 * On accepte les deux conventions parce que les deux existent pour de vrai : un runner
 * de CI passe la clé en variable, un poste de développement pointe un fichier. Refuser
 * l'une des deux ferait recopier la clé quelque part — donc la ferait fuiter.
 */
export function identifiants(env = process.env, lire = readFileSync) {
  const brut = env.GOOGLE_SERVICE_ACCOUNT_JSON
    || (env.GOOGLE_APPLICATION_CREDENTIALS ? lire(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8') : '');

  if (!brut) {
    throw new VertexError(
      'Aucun identifiant Vertex : renseigne GOOGLE_SERVICE_ACCOUNT_JSON (la clé en JSON) '
      + 'ou GOOGLE_APPLICATION_CREDENTIALS (le chemin d\'un fichier de clé).', 0);
  }

  let cle;
  try { cle = JSON.parse(brut); }
  catch { throw new VertexError('Identifiants Vertex illisibles : le JSON de la clé de compte de service est invalide.', 0); }

  if (!cle.client_email || !cle.private_key) {
    throw new VertexError('Clé de compte de service incomplète : `client_email` et `private_key` sont requis.', 0);
  }

  const project = env.VERTEX_PROJECT || cle.project_id;
  if (!project) throw new VertexError('Projet GCP inconnu : renseigne VERTEX_PROJECT.', 0);

  return { email: cle.client_email, cle: cle.private_key, project,
           region: env.VERTEX_LOCATION || REGION_DEFAUT };
}

/**
 * Le JWT signé, échangeable contre un jeton d'accès.
 *
 * `now` est injecté : sans ça, rien de ce fichier ne serait testable sans attendre une
 * vraie horloge, et les tests deviendraient des paris.
 */
export function signer({ email, cle }, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const entete = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corps = b64url(JSON.stringify({
    iss: email, scope: PORTEE, aud: OAUTH, iat, exp: iat + 3600
  }));
  const signature = createSign('RSA-SHA256').update(`${entete}.${corps}`).end().sign(cle);
  return `${entete}.${corps}.${b64url(signature)}`;
}

/** Le modèle réel derrière un palier déclaré, chez ce fournisseur. */
export function modelePour(tier, models = [], env = process.env, fournisseur = 'vertex') {
  const palier = tier || 'mid';
  // `SALSI_MODELE_<PALIER>` force un modèle sans toucher aux artefacts : c'est ce qui
  // permettra de rejouer les cas d'or sur un modèle candidat avant de basculer.
  const force = env[`SALSI_MODELE_${palier.toUpperCase()}`];
  if (force) return force;
  const ref = models.find((m) => m.tier === palier) || models.find((m) => m.tier === 'mid');
  if (!ref?.[fournisseur]) {
    throw new VertexError(
      `Aucun modèle ${fournisseur} déclaré pour le palier \`${palier}\` dans registries/models.yaml.`, 0);
  }
  return ref[fournisseur];
}

/**
 * Un client Vertex.
 *
 * `fetchImpl` et `now` sont injectés pour la même raison que partout ailleurs ici :
 * ce qui n'est pas injecté n'est pas testable, et ce qui n'est pas testable finit par
 * n'être vérifié qu'en production.
 */
export function createVertex({ env = process.env, models = [], fetchImpl = globalThis.fetch,
                               now = () => Date.now(), lire = readFileSync } = {}) {
  const ids = identifiants(env, lire);
  // Le jeton vaut une heure : le redemander à chaque appel ajouterait un aller-retour
  // par exécution, et un banc d'essai qui joue 5 × 200 cas en ferait mille pour rien.
  let jeton = null;

  async function accessToken() {
    if (jeton && jeton.expire > now() + 60_000) return jeton.valeur;

    const reponse = await fetchImpl(OAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signer(ids, now())
      }).toString()
    });

    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      // Le message de Google est souvent le seul indice utile : on le garde, sans
      // jamais y joindre la clé.
      throw new VertexError(
        `Authentification Vertex refusée (${reponse.status}) : ${corps.error_description || corps.error || 'sans détail'}. `
        + 'Vérifie que le compte de service a le rôle « Utilisateur Vertex AI » sur le projet.',
        reponse.status, JSON.stringify(corps));
    }

    jeton = { valeur: corps.access_token, expire: now() + (corps.expires_in || 3600) * 1000 };
    return jeton.valeur;
  }

  return {
    project: ids.project,
    region: ids.region,

    /** Le modèle qui répondra pour ce palier — utile pour l'écrire au journal. */
    modele: (tier) => modelePour(tier, models, env, 'vertex'),

    /**
     * Un appel. Rend le TEXTE et ce qu'il a coûté — les deux, toujours : une sortie
     * sans son coût rend le FinOps impossible à reconstituer après coup.
     */
    async generer({ prompt, tier = 'mid', temperature = 0.2, maxTokens = 4096 }) {
      const modele = modelePour(tier, models, env, 'vertex');
      const url = `https://${ids.region}-aiplatform.googleapis.com/v1/projects/${ids.project}`
                + `/locations/${ids.region}/publishers/google/models/${modele}:generateContent`;

      const reponse = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        })
      });

      const corps = await reponse.json().catch(() => ({}));
      if (!reponse.ok) {
        throw new VertexError(
          `Vertex a refusé l'appel (${reponse.status}) : ${corps.error?.message || 'sans détail'}.`
          + (reponse.status === 404 ? ` Le modèle \`${modele}\` n'est peut-être pas servi en `
             + `\`${ids.region}\` : essaie une autre région, ou force le modèle avec `
             + `SALSI_MODELE_${(tier || 'mid').toUpperCase()}.` : '')
          + (reponse.status === 403 ? ' Un 403 sans message vient plus souvent d\'un proxy '
             + 'sortant que de Google : vérifie que l\'hôte est autorisé au réseau.' : ''),
          reponse.status, JSON.stringify(corps));
      }

      const candidat = corps.candidates?.[0];
      const texte = (candidat?.content?.parts || []).map((p) => p.text || '').join('');
      const u = corps.usageMetadata || {};

      /*
       * Une réponse vide n'est pas une réponse : elle vient presque toujours d'un
       * filtre de sécurité ou d'une coupure par longueur, et la rendre telle quelle
       * ferait échouer un cas d'or sur « la sortie ne respecte pas la convention »
       * au lieu de « le modèle n'a rien répondu, voilà pourquoi ».
       */
      if (!texte) {
        throw new VertexError(
          `Vertex n'a rien renvoyé (motif d'arrêt : ${candidat?.finishReason || 'inconnu'}).`
          + (candidat?.finishReason === 'SAFETY' ? ' Un filtre de sécurité a bloqué la réponse.' : ''),
          200, JSON.stringify(corps));
      }

      return {
        texte,
        modele,
        tier,
        fournisseur: 'vertex',
        jetons: { entree: u.promptTokenCount || 0, sortie: u.candidatesTokenCount || 0 },
        motifArret: candidat?.finishReason || ''
      };
    }
  };
}

/**
 * Ce que coûte un appel, d'après le registre des modèles. En euros.
 *
 * Le tarif se lit SOUS LE FOURNISSEUR qui a répondu. Un tarif au niveau du palier
 * facturerait un appel DeepSeek au prix de Vertex — un coût faux, affiché avec l'aplomb
 * d'un coût mesuré. `null` quand le tarif n'est pas déclaré : l'écran dit alors « tarif
 * inconnu », ce qui est exact, plutôt que zéro, qui serait une mesure.
 */
export function cout({ tier, jetons, fournisseur = 'vertex', quand = null },
                     models = [], fournisseurs = {}) {
  const tarif = models.find((m) => m.tier === tier)?.tarifs?.[fournisseur];
  if (!tarif || !jetons) return null;

  const g = enCreux(quand, fournisseurs?.[fournisseur]?.heures_pleines_utc)
    ? (tarif.creux || tarif)
    : tarif;

  return (jetons.entree / 1e6) * (g.entree_mtok || 0)
       + (jetons.sortie / 1e6) * (g.sortie_mtok || 0);
}

/**
 * L'appel tombe-t-il HORS des heures pleines du fournisseur ?
 *
 * ── POURQUOI L'HEURE ENTRE DANS UN CALCUL DE COÛT ───────────────────────────
 *
 * DeepSeek facture le DOUBLE en heures pleines : « Off-peak rates are half of the peak
 * rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC ». Un tarif unique se serait
 * donc trompé d'un facteur deux la moitié du temps — dans un sens ou dans l'autre selon
 * le nombre retenu, et sans jamais le dire.
 *
 * On ne moyenne pas : une moyenne serait fausse à chaque appel pris isolément, et c'est
 * appel par appel que le journal enregistre. L'heure est une donnée qu'on a ; le calcul
 * la lit.
 *
 * ── ET SANS HEURE, ON PREND LE PLEIN ────────────────────────────────────────
 *
 * `quand` absent — une estimation avant lancement, un plan de banc — rend `false` : le
 * tarif plein s'applique. Majorant, jamais minorant. Un coût annoncé sous la réalité,
 * dans un outil qui se vend sur le FinOps, est pire qu'un coût absent.
 *
 * En UTC, jamais en heure locale : c'est le fournisseur qui facture, pas le poste de
 * celui qui lance.
 */
export function enCreux(quand, plages) {
  if (!quand || !Array.isArray(plages) || plages.length === 0) return false;
  const d = quand instanceof Date ? quand : new Date(quand);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getUTCHours();
  // Bornes : `[1, 4]` couvre 01:00 à 03:59. À 04:00 le tarif creux reprend — c'est ce que
  // « 01:00 - 04:00 » veut dire d'une plage horaire.
  return !plages.some(([debut, fin]) => h >= debut && h < fin);
}

export default { createVertex, identifiants, signer, modelePour, cout, enCreux, VertexError };
