/*
 * Le motif d'arrêt d'un modèle — et la seule question qu'on lui pose.
 *
 * ── POURQUOI UN MODULE POUR UN `if` ─────────────────────────────────────────
 *
 * Parce que les fournisseurs ne disent pas la même chose. DeepSeek rend `length`, Vertex
 * rend `MAX_TOKENS`, et un troisième dira encore autre chose. Un test écrit à un seul
 * endroit ne reconnaîtrait qu'un fournisseur, et la coupure passerait inaperçue sur
 * l'autre — exactement le défaut qu'on cherche à fermer.
 *
 * ── CE QUI SE JOUE, ET CE N'EST PAS UN DÉTAIL ───────────────────────────────
 *
 * Une réponse tronquée par le plafond de jetons a l'air FINIE. Elle a un début, des
 * sections, un ton assuré. Rien ne signale que le modèle a été interrompu au milieu d'une
 * phrase — ou pire, entre deux sections, là où la coupure est invisible.
 *
 * C'est le même défaut que partout ailleurs dans ce produit : une mesure partielle qui se
 * présente comme complète. Le motif d'arrêt remontait déjà du moteur jusqu'à l'écran, et
 * personne ne le lisait.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/*
 * Les mots par lesquels chaque fournisseur dit « j'ai été coupé ».
 *
 * Comparés en minuscules : `MAX_TOKENS` et `max_tokens` sont le même fait, et un jour un
 * fournisseur changera la casse sans prévenir.
 */
export const MOTIFS_COUPURE = new Set(['length', 'max_tokens', 'maxtokens', 'max_output_tokens']);

/**
 * Cette réponse a-t-elle été coupée par le plafond de jetons ?
 *
 * Un motif inconnu rend `false` : on ne crie pas à la coupure sur un mot qu'on ne
 * comprend pas. Le prix de l'erreur n'est pas le même dans les deux sens — annoncer une
 * coupure qui n'a pas eu lieu fait douter d'une réponse entière, et on cesse de lire
 * l'avertissement le jour où il compte vraiment.
 */
export const coupee = (motif) => MOTIFS_COUPURE.has(String(motif || '').trim().toLowerCase());

export default { MOTIFS_COUPURE, coupee };
