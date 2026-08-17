/*
 * Coque de l'application — la barre d'onglets de la maquette, en un seul endroit.
 *
 * Les onglets non construits sont affichés et marqués « à venir » plutôt que masqués :
 * l'utilisateur doit voir où va le produit, sans croire que ça marche déjà.
 */

/*
 * ── « DEMANDER » EST RETIRÉ, ET C'EST UNE DÉCISION ───────────────────────────
 *
 * L'écran laissait un modèle écrire un artefact COMPLET à partir d'une phrase. Ce qu'il
 * produisait franchissait la porte à chaque fois, et ne se lançait jamais :
 *
 *   · des noms d'entrées inventés — `repo_metadata`, `contribution_data` — que rien ne
 *     sait remplir, donc autant de champs à coller à la main ;
 *   · une entrée de plus que nécessaire : `historique_commits` ajoutée à un bus factor
 *     qui n'en a aucun besoin, et le pré-vol refuse pour un champ vide ;
 *   · des outils qui n'existent pas, appelés dans la consigne — le modèle rendait alors
 *     un faux bloc d'appel d'outil en guise de réponse.
 *
 * Chacun de ces cas a été corrigé par un mécanisme de plus : un vocabulaire dans la
 * consigne, une règle de lint, des instructions plus longues. Chaque correctif réglait un
 * cas et alourdissait le reste. Le motif est net, et il a fallu se le faire dire trois
 * fois : CE QUI EST CADRÉ MARCHE, CE QUI EST LIBRE ÉCHOUE.
 *
 * Le code de l'écran reste au dépôt — il n'y a rien à jeter, et la dictée du Studio
 * s'appuie sur le même rédacteur. C'est le CHEMIN DE CRÉATION LIBRE qu'on ferme, le temps
 * d'écrire à la main des agents dont on maîtrise la forme.
 */
const TABS = [
  { id: 'composer', label: '🧩 Fabriquer', href: 'composer' },
  { id: 'catalogue', label: '🧰 Les agents', href: 'catalogue' },
  { id: 'studio', label: '🛠️ Studio', href: 'studio' },
  /*
   * « Admin », et pas « À relire ».
   *
   * L'onglet s'est appelé « ✅ À relire » le temps d'une passe d'ergonomie, au motif qu'un
   * nom vaut mieux quand il dit ce qu'on FAIT derrière. Il ne disait qu'un tiers de ce
   * qu'on y fait : l'écran porte aussi LE PARC — retirer, remettre, éditer, supprimer un
   * agent — et le journal des décisions.
   *
   * Un onglet qui nomme une seule de ses trois vues fait disparaître les deux autres.
   * C'est exactement ce qui est arrivé : la gestion du catalogue est devenue introuvable
   * alors qu'elle n'avait pas bougé d'une ligne. Le nom d'un onglet promet ce qu'il y a
   * derrière ; trop précis, il ment par omission.
   */
  { id: 'admin', label: '📊 Admin', href: 'admin' },
  // Le guide est en queue de barre, jamais en tête : on l'ouvre quand quelque chose
  // coince, pas au démarrage. Mais il est DANS la barre, visible depuis tous les écrans —
  // une aide qu'il faut chercher est une aide que personne ne lit.
  { id: 'guide', label: '📖 Guide', href: 'guide' },
  { id: 'maquette', label: '✨ Maquette', href: 'maquette' }
];

/**
 * Injecte la barre en tête de page.
 * @param {{active?:string, session:object, base?:string, onLogout:Function}} options
 *   base : préfixe vers la racine du dépôt ('' depuis /app, '../' depuis /studio)
 */
export function mountShell({ active = '', session, base = '', onLogout }) {
  const href = { demande: `${base}demande/index.html`,
                 composer: `${base}composer/index.html`,
                 catalogue: `${base}catalogue/index.html`, studio: `${base}studio/index.html`,
                 admin: `${base}admin/index.html`, guide: `${base}guide/index.html`,
                 maquette: `${base}maquette.html` };

  const bar = document.createElement('div');
  bar.className = 'tabs';

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = `${base}app/index.html`;
  brand.innerHTML = '🧂 SalsiIAPrompt<small>des agents IA, relus avant d\'être partagés</small>';
  bar.append(brand);

  for (const tab of TABS) {
    const node = document.createElement(tab.href ? 'a' : 'span');
    node.className = `nav${tab.id === active ? ' on' : ''}${tab.href ? '' : ' soon'}`;
    node.textContent = tab.label;
    if (tab.href) node.href = href[tab.href];
    bar.append(node);
  }

  const spacer = document.createElement('span');
  spacer.className = 'sp';
  bar.append(spacer);

  if (session) {
    const who = document.createElement('span');
    who.className = 'who';
    if (session.avatar) {
      const img = document.createElement('img');
      img.alt = ''; img.src = session.avatar;
      who.append(img);
    }
    who.append(`${session.name} · ${new URL(session.gitlabUrl).host}`);
    bar.append(who);

    const out = document.createElement('button');
    out.className = 'nav';
    out.textContent = 'Se déconnecter';
    out.onclick = onLogout;
    bar.append(out);
  }

  document.body.prepend(bar);
  return bar;
}

export default { mountShell };
