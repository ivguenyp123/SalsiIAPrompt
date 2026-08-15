/*
 * Le guide — la doc utilisateur, dans le produit.
 *
 * ── POURQUOI DANS LE PRODUIT ET PAS SEULEMENT DANS LE DÉPÔT ──────────────────
 *
 * Ce sont les MÊMES fichiers `docs/*.md` : ils se lisent sur GitHub, et ils s'affichent
 * ici. Rien n'est recopié, donc rien ne peut diverger.
 *
 * Ce qui change, c'est le moment. Une doc dans le dépôt se lit quand on a décidé d'aller
 * la chercher — c'est-à-dire à peu près jamais. Une doc à un onglet de l'écran qui vient
 * de refuser quelque chose se lit à cet instant-là, qui est le seul où l'on a vraiment la
 * question en tête.
 *
 * ── PAS DE SESSION REQUISE ───────────────────────────────────────────────────
 *
 * Seul écran du produit à s'ouvrir sans jeton. « Comment ça marche » ne peut pas être
 * réservé à ceux qui ont déjà réussi à entrer : c'est justement ce qu'on veut lire avant.
 * La barre d'onglets s'affiche quand même, sans le bloc identité.
 */
import { load, clear } from '../app/session.js';
import { mountShell } from '../app/shell.js';
import { PAGES, page, chemin, lien } from '../lib/guide.js';
import { rendre, plan } from '../lib/md.js';

const session = load();
mountShell({
  active: 'guide', session, base: '../',
  onLogout: () => { clear(); location.href = '../app/login.html'; }
});

const $ = (s) => document.querySelector(s);
const cache = new Map();

/* La page courante vit dans l'URL. Un lien vers une page précise du guide doit pouvoir
 * se coller dans un message — sans quoi on renvoie ses collègues vers « le guide,
 * troisième section », ce qui n'est pas une référence. */
const courante = () => page(new URLSearchParams(location.search).get('p') || 'index');

function sommaire(actif) {
  const box = $('#pages');
  box.replaceChildren();
  for (const p of PAGES) {
    const a = document.createElement('a');
    a.href = `?p=${p.cle}`;
    a.className = p.cle === actif.cle ? 'on' : '';
    const b = document.createElement('b'); b.textContent = p.titre;
    const s = document.createElement('small'); s.textContent = p.pour;
    a.append(b, s);
    a.onclick = (e) => { e.preventDefault(); aller(p.cle); };
    box.append(a);
  }
}

function sommairePage(source) {
  const box = $('#plan');
  box.replaceChildren();
  const titres = plan(source);
  box.parentElement.hidden = titres.length === 0;
  for (const t of titres) {
    const a = document.createElement('a');
    a.href = `#${t.ancre}`;
    a.className = t.niveau === 3 ? 'n3' : '';
    a.textContent = t.texte.replace(/[`*]/g, '');
    box.append(a);
  }
}

async function charger(p) {
  if (cache.has(p.cle)) return cache.get(p.cle);
  const r = await fetch(`../${chemin(p)}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} sur ${chemin(p)}`);
  const texte = await r.text();
  cache.set(p.cle, texte);
  return texte;
}

async function afficher(p) {
  const art = $('#texte');
  sommaire(p);
  document.title = `${p.titre} — SalsiIAPrompt`;

  try {
    const source = await charger(p);
    // `rendre` échappe tout avant de baliser : il n'y a aucun chemin où le contenu d'un
    // fichier devienne du HTML actif. C'est ce qui autorise `innerHTML` ici.
    art.innerHTML = rendre(source, { lien });
    sommairePage(source);

    /*
     * La manœuvre — la ligne « → fais ceci » sous chaque code de refus. C'est la seule
     * qu'on cherche quand on arrive ici parce que quelque chose vient d'être refusé ;
     * elle doit se trouver en balayant la page, pas en la lisant.
     *
     * Marqué après coup plutôt que dans le rendu : c'est une convention de CETTE doc,
     * pas du Markdown. Le rendu reste un rendu.
     */
    for (const el of art.querySelectorAll('p')) {
      if (el.textContent.trimStart().startsWith('→')) el.classList.add('manoeuvre');
    }

    // Un lien interne ne doit pas recharger la page : le sommaire et la position se
    // perdraient à chaque saut entre deux pages du guide.
    for (const a of art.querySelectorAll('a[href^="?p="]')) {
      a.onclick = (e) => {
        e.preventDefault();
        const u = new URL(a.getAttribute('href'), location.href);
        aller(u.searchParams.get('p'), u.hash.slice(1));
      };
    }

    const cible = location.hash.slice(1);
    if (cible) document.getElementById(cible)?.scrollIntoView();
    else globalThis.scrollTo({ top: 0 });
  } catch (e) {
    art.replaceChildren();
    const box = document.createElement('div');
    box.className = 'rate';
    box.textContent = `La page ne s'est pas chargée (${e.message}). `
      + `Elle se lit aussi directement dans le dépôt, sous docs/${p.fichier}.`;
    art.append(box);
    $('#plan').parentElement.hidden = true;
  }
}

function aller(cle, ancre = '') {
  const p = page(cle);
  history.pushState({}, '', `?p=${p.cle}${ancre ? `#${ancre}` : ''}`);
  afficher(p);
}

globalThis.addEventListener('popstate', () => afficher(courante()));
afficher(courante());
