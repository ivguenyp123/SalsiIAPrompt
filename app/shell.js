/*
 * Coque de l'application — la barre d'onglets de la maquette, en un seul endroit.
 *
 * Les onglets non construits sont affichés et marqués « à venir » plutôt que masqués :
 * l'utilisateur doit voir où va le produit, sans croire que ça marche déjà.
 */

const TABS = [
  // « Demander » en tête : c'est l'entrée du public le plus large — celui qui a un besoin
  // et pas un artefact. Le mettre après les écrans d'auteur reviendrait à le réserver à
  // ceux qui savent déjà que le registre existe.
  { id: 'demande', label: '✨ Demander', href: 'demande' },
  { id: 'composer', label: '🧩 Fabriquer', href: 'composer' },
  { id: 'catalogue', label: '🧰 Les agents', href: 'catalogue' },
  { id: 'studio', label: '🛠️ Studio', href: 'studio' },
  { id: 'admin', label: '✅ À relire', href: 'admin' },
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
