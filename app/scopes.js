/*
 * Périmètres — d'où vient le `owner.scope` d'un artefact.
 *
 * Le périmètre n'est pas décoratif : c'est lui qui décide quels outils l'artefact a le
 * droit d'invoquer (L006). Le laisser en saisie libre, comme le faisait le formulaire,
 * a deux défauts — une faute de frappe fait échouer L006 sans raison compréhensible, et
 * surtout n'importe qui peut écrire « Plateforme » pour s'ouvrir les outils de livraison.
 *
 * Ici : la liste des périmètres est DÉRIVÉE du registre des outils — elle ne se saisit
 * pas — et le groupe GitLab du dépôt sert à pré-sélectionner le bon.
 *
 * Limite assumée : l'auteur choisit encore son périmètre, il ne le prouve pas. Le
 * prouver suppose de vérifier son appartenance au groupe GitLab côté serveur, avec une
 * identité qu'il ne contrôle pas. C'est un travail de back, et c'est là qu'il ira.
 */

/** Les périmètres connus, dérivés du registre des outils. `*` n'en est pas un. */
export function knownScopes(tools) {
  const set = new Set();
  for (const tool of tools || []) {
    for (const scope of tool.scopes || []) if (scope !== '*') set.add(scope);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

const fold = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Devine le périmètre depuis le chemin GitLab d'un dépôt.
 * « plateforme/demo-spring » → « Plateforme » si ce périmètre existe au registre.
 * Les sous-groupes sont parcourus du plus précis au plus général : sur
 * « tribu-data/etl/api », `etl` est tenté avant `tribu-data`.
 *
 * @returns {string} le périmètre trouvé, ou '' — on ne devine jamais au hasard.
 */
export function guessScope(pathWithNamespace, scopes) {
  const groups = String(pathWithNamespace || '').split('/').slice(0, -1);   // le projet lui-même n'est pas un groupe
  if (groups.length === 0 || !scopes?.length) return '';

  const byFold = new Map(scopes.map((s) => [fold(s), s]));

  for (const group of groups.reverse()) {
    const exact = byFold.get(fold(group));
    if (exact) return exact;
  }
  return '';
}

export default { knownScopes, guessScope };
