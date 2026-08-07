/*
 * DeepSeek — le second fournisseur, et la preuve que le premier n'était pas structurant.
 *
 * ── POURQUOI IL EXISTE ───────────────────────────────────────────────────────
 *
 * Pour essayer la chaîne sans attendre un projet GCP. Mais il rend un service plus
 * durable que ça : il oblige le produit à ne pas être « la plateforme Vertex ». Un
 * registre de capacités IA qui ne saurait parler qu'à un fournisseur serait périmé au
 * premier appel d'offres — et à LCL, le fournisseur se décide bien au-dessus de l'équipe
 * qui écrit les agents.
 *
 * Ce qui compte est donc ce que ce fichier ne contient PAS : aucune règle, aucun
 * contrôle, aucun critère. Le pré-vol, le post-vol, la porte, la banque d'entrées ne
 * savent rien de lui. Il rend un texte et un décompte de jetons, comme l'autre.
 *
 * ── CE QU'IL FAUT POUR L'UTILISER ────────────────────────────────────────────
 *
 *   DEEPSEEK_API_KEY        la clé, dans la variable — jamais dans le dépôt
 *   DEEPSEEK_BASE           facultatif, défaut https://api.deepseek.com
 *
 * L'API suit la convention OpenAI : une seule requête, pas de jeton à échanger. C'est
 * plus simple que Vertex, et c'est justement pour ça que le socle doit rester capable
 * des deux — le plus simple n'est pas toujours celui qu'on aura le droit d'utiliser.
 */
import { VertexError } from './vertex.js';

const BASE_DEFAUT = 'https://api.deepseek.com';

/** Le modèle réel derrière un palier, côté DeepSeek. */
export function modeleDeepseek(tier, models = [], env = process.env) {
  const palier = tier || 'mid';
  const force = env[`SALSI_MODELE_${palier.toUpperCase()}`];
  if (force) return force;
  const ref = models.find((m) => m.tier === palier) || models.find((m) => m.tier === 'mid');
  if (!ref?.deepseek) {
    throw new VertexError(
      `Aucun modèle DeepSeek déclaré pour le palier \`${palier}\` dans registries/models.yaml.`, 0);
  }
  return ref.deepseek;
}

/** Les identifiants, depuis l'environnement. */
export function identifiantsDeepseek(env = process.env) {
  const cle = env.DEEPSEEK_API_KEY;
  if (!cle) {
    throw new VertexError(
      'Aucune clé DeepSeek : renseigne DEEPSEEK_API_KEY. '
      + '(Pour passer par Vertex à la place : GOOGLE_SERVICE_ACCOUNT_JSON et VERTEX_PROJECT.)', 0);
  }
  return { cle, base: (env.DEEPSEEK_BASE || BASE_DEFAUT).replace(/\/+$/, '') };
}

/**
 * Un client DeepSeek, de la même forme que le client Vertex.
 *
 * `fournisseur` et `ou` remplacent `project`/`region` : tout ce qui les affiche doit
 * pouvoir le faire sans savoir à qui il parle. Et il DOIT l'afficher — savoir quel
 * modèle a répondu n'est pas un détail dans un registre gouverné, c'est la moitié de
 * ce qu'un auditeur demandera.
 */
export function createDeepseek({ env = process.env, models = [], fetchImpl = globalThis.fetch } = {}) {
  const ids = identifiantsDeepseek(env);

  return {
    fournisseur: 'deepseek',
    ou: new URL(ids.base).host,

    modele: (tier) => modeleDeepseek(tier, models, env),

    async generer({ prompt, tier = 'mid', temperature = 0.2, maxTokens = 4096 }) {
      const modele = modeleDeepseek(tier, models, env);

      const reponse = await fetchImpl(`${ids.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ids.cle}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modele,
          messages: [{ role: 'user', content: prompt }],
          temperature, max_tokens: maxTokens, stream: false
        })
      });

      const corps = await reponse.json().catch(() => ({}));
      if (!reponse.ok) {
        throw new VertexError(
          `DeepSeek a refusé l'appel (${reponse.status}) : ${corps.error?.message || 'sans détail'}.`
          + (reponse.status === 401 ? ' Vérifie DEEPSEEK_API_KEY.' : '')
          + (reponse.status === 402 ? ' Solde insuffisant sur le compte.' : '')
          + (reponse.status === 403 ? ' Un 403 vient plus souvent d\'un proxy sortant que du '
             + 'fournisseur : vérifie que api.deepseek.com est autorisé au réseau.' : ''),
          reponse.status, JSON.stringify(corps));
      }

      const choix = corps.choices?.[0];
      /*
       * `message.content` et pas `reasoning_content` : sur `deepseek-reasoner`, le
       * raisonnement est renvoyé à part. L'évaluer contre le contrat porterait sur des
       * brouillons — un critère de longueur exploserait pour une réponse finale courte.
       */
      const texte = choix?.message?.content || '';

      if (!texte) {
        throw new VertexError(
          `DeepSeek n'a rien renvoyé (motif d'arrêt : ${choix?.finish_reason || 'inconnu'}).`
          + (choix?.finish_reason === 'length' ? ' La réponse a été coupée par max_tokens.' : ''),
          200, JSON.stringify(corps));
      }

      const u = corps.usage || {};
      return {
        texte, modele, tier, fournisseur: 'deepseek',
        jetons: { entree: u.prompt_tokens || 0, sortie: u.completion_tokens || 0 },
        motifArret: choix?.finish_reason || ''
      };
    }
  };
}

export default { createDeepseek, identifiantsDeepseek, modeleDeepseek };
