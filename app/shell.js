/*
 * Coque de l'application — la barre d'onglets de la maquette, en un seul endroit.
 *
 * Les onglets non construits sont affichés et marqués « à venir » plutôt que masqués :
 * l'utilisateur doit voir où va le produit, sans croire que ça marche déjà.
 */

const TABS = [
  { id: 'catalogue', label: '🧰 Catalogue', href: null },
  { id: 'studio', label: '🛠️ Studio', href: 'studio' },
  { id: 'admin', label: '📊 Admin', href: null },
  { id: 'maquette', label: '✨ Maquette', href: 'maquette' }
];

/**
 * Injecte la barre en tête de page.
 * @param {{active?:string, session:object, base?:string, onLogout:Function}} options
 *   base : préfixe vers la racine du dépôt ('' depuis /app, '../' depuis /studio)
 */
export function mountShell({ active = '', session, base = '', onLogout }) {
  const href = { studio: `${base}studio/index.html`, maquette: `${base}maquette.html` };

  const bar = document.createElement('div');
  bar.className = 'tabs';

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = `${base}app/index.html`;
  brand.innerHTML = '🧂 SalsiIAPrompt<small>registre de capacités IA</small>';
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
