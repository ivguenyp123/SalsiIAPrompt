/*
 * Le journal des décisions.
 *
 * Qui a soumis quoi, qui l'a validé, qui l'a refusé, et quand. C'est la moitié de
 * l'auditabilité qu'une banque réclame, et elle existe déjà : chaque décision de l'Admin
 * est un commit, donc l'historique du dépôt EST le journal. Il n'était simplement pas
 * affiché.
 *
 * ── LA COUTURE VERS LA BASE ──────────────────────────────────────────────────
 *
 * Ce module ne connaît PAS git. Il transforme des commits en `événements`, et c'est
 * l'événement qui est le contrat :
 *
 *   { date, action, artefactId, cible, acteur, source, ref }
 *
 * Le jour où le journal viendra d'une base — avec les exécutions, les coûts, les
 * certifications, tout ce que git ne peut pas porter — il suffira d'une seconde fonction
 * `depuisBase(lignes)` qui rende la même forme. Le rendu, les filtres et les tests ne
 * bougent pas. `source` distingue déjà les deux origines pour qu'elles puissent coexister
 * pendant la bascule, au lieu de se remplacer d'un coup.
 *
 * Module PUR : ni forge, ni DOM, ni horloge. Testable en Node.
 */

/*
 * Le vocabulaire des messages de commit écrits par l'application.
 *
 * Il ne couvre plus seulement l'entrée au registre. Un parc vit aussi par ce qu'on en
 * retire : un agent qu'on désactive parce qu'il ne sert plus, qu'on réactive, ou qu'on
 * supprime. Sans ces verbes ici, ces décisions-là tomberaient en « hors parcours » —
 * c'est-à-dire au même endroit que ce qui contourne le produit, ce qui est faux et
 * rendrait l'alerte de contournement inexploitable.
 */
export const ACTIONS = {
  soumettre: { label: 'soumis', verbe: 'a soumis', icone: '📤', ordre: 0 },
  valider: { label: 'validé', verbe: 'a validé', icone: '✅', ordre: 1 },
  refuser: { label: 'refusé', verbe: 'a refusé', icone: '🚫', ordre: 2 },
  retirer: { label: 'retiré', verbe: 'a retiré du catalogue', icone: '📦', ordre: 3 },
  reactiver: { label: 'réactivé', verbe: 'a remis au catalogue', icone: '♻️', ordre: 4 },
  supprimer: { label: 'supprimé', verbe: 'a supprimé', icone: '🗑️', ordre: 5 },
  autre: { label: 'hors parcours', verbe: 'a modifié', icone: '✏️', ordre: 6 }
};

// « registre : valider Préparer la livraison » — le préfixe est écrit par l'application,
// jamais saisi. Ce qui ne le porte pas n'est pas passé par le produit.
const SUJET = /^registre\s*:\s*(soumettre|valider|refuser|retirer|reactiver|supprimer)\s+(.*)$/i;

/*
 * L'acteur DÉCLARÉ dans le corps du commit. Il n'est pas redondant avec l'auteur du
 * commit : l'auteur est celui dont le jeton a écrit, l'acteur est celui que
 * l'application a inscrit. Ils coïncident aujourd'hui parce que chacun agit avec son
 * propre jeton — mais un jeton de service les séparerait, et c'est exactement le cas
 * où il faut pouvoir le voir.
 */
// Le point final de la phrase se retire APRÈS coup : un identifiant en contient
// lui-même (`m.dubois`), donc l'exclure de la capture tronquerait le nom à sa première
// initiale.
const ACTEUR = /(?:soumis depuis le Studio par|Validé par|Refusé par|Retiré par|Réactivé par|Supprimé par)\s+([^\s,\n]+)/i;
const sansPointFinal = (nom) => nom.replace(/\.+$/, '');
const ARTEFACT = /Artefact\s+([a-z0-9][a-z0-9-]*)\s+soumis/i;

/** Une ligne de journal à partir d'un commit. */
function evenement(commit) {
  const message = String(commit?.message || '');
  const [sujet] = message.split('\n');
  const trouve = SUJET.exec(sujet.trim());

  const action = trouve ? trouve[1].toLowerCase() : 'autre';
  const acteur = sansPointFinal(ACTEUR.exec(message)?.[1] || '');

  return {
    date: commit?.date || '',
    action,
    // L'identifiant n'est présent que dans les corps de soumission. Ailleurs on n'a que
    // le titre — on ne l'invente pas, on laisse vide plutôt que de deviner faux.
    artefactId: ARTEFACT.exec(message)?.[1] || '',
    cible: trouve ? trouve[2].trim() : sujet.trim(),
    // Faute d'acteur déclaré, l'auteur du commit fait foi : c'est toujours quelqu'un.
    acteur: acteur || commit?.author || '',
    acteurDeclare: Boolean(acteur),
    auteurCommit: commit?.author || '',
    source: 'git',
    ref: commit?.sha || ''
  };
}

/**
 * Convertit des commits en événements de journal.
 * @param {Array} commits [{ sha, message, author, date }] — du plus récent au plus ancien
 */
export function depuisCommits(commits = []) {
  return commits.map(evenement);
}

/**
 * Ce qui a touché le registre SANS passer par l'application.
 *
 * C'est le constat qui a le plus de valeur pour un auditeur : une modification directe
 * dans le dépôt contourne la porte du lint et la file de validation. La signaler ne la
 * bloque pas — seules les branches protégées le peuvent — mais elle cesse d'être
 * invisible.
 */
export const horsParcours = (evenements = []) => evenements.filter((e) => e.action === 'autre');

/** Regroupe par jour, pour que le journal se lise comme un journal. */
export function parJour(evenements = []) {
  const jours = new Map();
  for (const e of evenements) {
    const jour = String(e.date || '').slice(0, 10) || 'date inconnue';
    if (!jours.has(jour)) jours.set(jour, []);
    jours.get(jour).push(e);
  }
  return [...jours.entries()].map(([jour, liste]) => ({ jour, evenements: liste }));
}

/** Compte par action — le résumé de haut de page. */
export function resume(evenements = []) {
  const total = Object.fromEntries(Object.keys(ACTIONS).map((k) => [k, 0]));
  for (const e of evenements) total[e.action] = (total[e.action] || 0) + 1;
  return total;
}

export default { depuisCommits, parJour, resume, horsParcours, ACTIONS };
