/*
 * Le moteur — quel fournisseur répond, et comment on le sait.
 *
 * ── UN SEUL POINT DE CHOIX ───────────────────────────────────────────────────
 *
 * Le reste du produit ne doit jamais savoir à qui il parle. Le pré-vol, le post-vol, la
 * porte, la banque d'entrées, les cas d'or : rien de tout ça n'a de raison de connaître
 * Vertex ou DeepSeek. Un seul fichier décide, et tout le reste reçoit un client de forme
 * identique — `{ fournisseur, ou, modele(), generer() }`.
 *
 * C'est ce qui a permis de brancher un second fournisseur sans toucher à une seule règle.
 * Et c'est ce qui compte à LCL : le fournisseur de modèle se décide bien au-dessus de
 * l'équipe qui écrit les agents, et il changera.
 *
 * ── LE CHOIX EST EXPLICITE, OU DÉDUIT — MAIS TOUJOURS DIT ────────────────────
 *
 *   SALSI_FOURNISSEUR=vertex|deepseek   pour trancher soi-même
 *   sinon : DeepSeek si sa clé est là, Vertex autrement
 *
 * La déduction est un confort pour essayer vite. Elle ne doit jamais devenir un silence :
 * le fournisseur et le modèle remontent dans chaque réponse, s'affichent à l'écran et
 * partent dans le journal. Dans un registre gouverné, « quel modèle a répondu » n'est pas
 * un détail — c'est la moitié de ce qu'un auditeur demandera.
 */
import { createVertex } from './vertex.js';
import { createDeepseek } from './deepseek.js';
import { VertexError } from './vertex.js';

export const FOURNISSEURS = ['vertex', 'deepseek'];

/** Qui doit répondre, d'après l'environnement. */
export function fournisseurChoisi(env = process.env) {
  const demande = (env.SALSI_FOURNISSEUR || '').toLowerCase();
  if (demande) {
    if (!FOURNISSEURS.includes(demande)) {
      throw new VertexError(
        `Fournisseur inconnu : \`${demande}\`. Connus : ${FOURNISSEURS.join(', ')}.`, 0);
    }
    return demande;
  }
  // Déduction : la clé la plus simple d'abord. Elle ne masque rien — le client rend son
  // nom, et tous les écrans l'affichent.
  return env.DEEPSEEK_API_KEY ? 'deepseek' : 'vertex';
}

/**
 * Le client du fournisseur en vigueur.
 *
 * Même signature, même forme de retour, quel que soit celui qui répond. Les appelants —
 * le CLI, la route d'exécution — n'ont pas de branche à écrire.
 */
export function createMoteur({ env = process.env, models = [], fetchImpl, now, lire } = {}) {
  const qui = fournisseurChoisi(env);
  if (qui === 'deepseek') return createDeepseek({ env, models, fetchImpl });

  const v = createVertex({ env, models, fetchImpl, now, lire });
  // Vertex parle en projet et région ; l'écran, lui, veut « qui » et « où ». On adapte
  // ici plutôt que dans chaque affichage.
  return { ...v, fournisseur: 'vertex', ou: `${v.project} · ${v.region}` };
}

export default { createMoteur, fournisseurChoisi, FOURNISSEURS };
