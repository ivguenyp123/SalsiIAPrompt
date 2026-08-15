/*
 * Un rendu Markdown minimal — juste ce que la doc utilisateur emploie.
 *
 * ── POURQUOI PAS UNE BIBLIOTHÈQUE ────────────────────────────────────────────
 *
 * Même raison que pour le YAML et le JSON Schema : ce dépôt n'a aucune dépendance à
 * l'exécution, et la doc doit s'afficher là où le reste s'affiche — y compris sur une
 * page servie sans `npm install`. Une doc qui ne s'ouvre qu'après une installation n'est
 * pas une doc, c'est un fichier.
 *
 * ── CE QU'IL COUVRE, ET RIEN DE PLUS ─────────────────────────────────────────
 *
 * Titres, paragraphes, listes, tableaux, blocs de code, citations, filets, et en ligne :
 * gras, italique, code, liens. C'est l'inventaire exact de ce que `docs/` utilise, et le
 * test le vérifie : si une page emploie une syntaxe non couverte, il échoue. On ajoute
 * alors la syntaxe — on ne laisse pas la page s'afficher de travers.
 *
 * ── L'ÉCHAPPEMENT EST FAIT D'ABORD, PARTOUT ──────────────────────────────────
 *
 * Le texte est échappé AVANT toute mise en forme, et le balisage n'est produit qu'après.
 * Il n'existe donc aucun chemin où un `<` d'un fichier source devienne une balise. C'est
 * une doc écrite dans le dépôt, pas une saisie d'utilisateur — mais un rendu qui
 * n'échappe « que quand c'est risqué » finit toujours par se tromper d'endroit.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/** Le texte, sans aucun pouvoir de balisage. */
export const echapper = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Le rendu en ligne : gras, italique, code, liens.
 *
 * Le code en ligne est extrait EN PREMIER et remis à la fin : sinon un `*` dans un
 * `\`code\`` deviendrait de l'italique, ce qui est faux précisément là où la fidélité
 * compte le plus — dans un extrait de code.
 */
export function enLigne(texte, { lien = (h) => h } = {}) {
  const codes = [];
  let t = echapper(texte).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });

  t = t
    // `href` sort d'un texte DÉJÀ échappé : le ré-échapper transformerait le `&` d'une
    // URL légitime en `&amp;amp;`. Seul le délimiteur d'attribut reste à garder, contre
    // ce que la réécriture de lien aurait pu introduire.
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, libelle, href) =>
      `<a href="${String(lien(href)).replace(/"/g, '&quot;')}">${libelle}</a>`)
    // Non gourmand, et le contenu a le droit de contenir des `*` : `**a *b*.**` est du
    // gras qui contient de l'italique, et c'est une tournure courante dès qu'on insiste
    // sur un mot au milieu d'une phrase déjà en gras.
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>');

  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

/** Une ligne de tableau, découpée sur les `|` — les bords vides ne comptent pas. */
const cellules = (ligne) => ligne.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

const separateur = (ligne) => /^\|?[\s:-]*-[\s|:-]*\|?$/.test(ligne) && ligne.includes('-');

/**
 * Le document entier, en HTML.
 *
 * @param {string} source
 * @param {{lien?:(href:string)=>string}} [options] réécriture des liens (`.md` → écran)
 */
export function rendre(source, { lien } = {}) {
  const lignes = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  const ligne = (t) => enLigne(t, { lien });

  let i = 0;
  while (i < lignes.length) {
    const l = lignes[i];

    /* Bloc de code — pris tel quel, sans aucune mise en forme à l'intérieur. */
    if (/^```/.test(l)) {
      const langue = l.slice(3).trim();
      const corps = [];
      i++;
      while (i < lignes.length && !/^```/.test(lignes[i])) corps.push(lignes[i++]);
      i++;
      html.push(`<pre${langue ? ` data-langue="${echapper(langue)}"` : ''}><code>`
        + echapper(corps.join('\n')) + '</code></pre>');
      continue;
    }

    if (!l.trim()) { i++; continue; }

    /* Filet. */
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { html.push('<hr>'); i++; continue; }

    /* Titre — l'ancre vient du texte, pour que la table des matières y mène. */
    const titre = /^(#{1,6})\s+(.*)$/.exec(l);
    if (titre) {
      const n = titre[1].length;
      html.push(`<h${n} id="${echapper(ancre(titre[2]))}">${ligne(titre[2])}</h${n}>`);
      i++;
      continue;
    }

    /* Tableau — il faut la ligne de séparation, sinon c'est un paragraphe avec des `|`. */
    if (l.includes('|') && separateur(lignes[i + 1] || '')) {
      const tete = cellules(l);
      i += 2;
      const corps = [];
      while (i < lignes.length && lignes[i].includes('|') && lignes[i].trim()) {
        corps.push(cellules(lignes[i++]));
      }
      html.push('<table><thead><tr>'
        + tete.map((c) => `<th>${ligne(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + corps.map((r) => '<tr>' + r.map((c) => `<td>${ligne(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    /* Citation. */
    if (/^>\s?/.test(l)) {
      const corps = [];
      while (i < lignes.length && /^>\s?/.test(lignes[i])) corps.push(lignes[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${paragraphes(corps, ligne)}</blockquote>`);
      continue;
    }

    /* Listes — une puce peut tenir sur plusieurs lignes, la continuation est indentée. */
    const puce = /^\s*[-*]\s+/, numero = /^\s*\d+[.)]\s+/;
    if (puce.test(l) || numero.test(l)) {
      const ordonnee = numero.test(l) && !puce.test(l);
      const marque = ordonnee ? numero : puce;
      const items = [];
      while (i < lignes.length && (marque.test(lignes[i])
             || (items.length && /^\s+\S/.test(lignes[i])))) {
        if (marque.test(lignes[i])) items.push(lignes[i].replace(marque, ''));
        else items[items.length - 1] += ' ' + lignes[i].trim();
        i++;
      }
      const t = ordonnee ? 'ol' : 'ul';
      html.push(`<${t}>` + items.map((x) => `<li>${ligne(x)}</li>`).join('') + `</${t}>`);
      continue;
    }

    /* Paragraphe : tout jusqu'à la ligne vide ou le prochain bloc. */
    const corps = [];
    while (i < lignes.length && lignes[i].trim()
           && !/^(#{1,6}\s|```|>\s?|\s*[-*]\s|\s*\d+[.)]\s)/.test(lignes[i])
           && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lignes[i])) {
      corps.push(lignes[i++]);
    }
    if (corps.length) html.push(`<p>${ligne(corps.join(' ').trim())}</p>`);
  }

  return html.join('\n');
}

const paragraphes = (lignes, ligne) => {
  const blocs = lignes.join('\n').split(/\n\s*\n/).filter((b) => b.trim());
  return blocs.map((b) => `<p>${ligne(b.replace(/\n/g, ' ').trim())}</p>`).join('');
};

/** L'ancre d'un titre : ce qu'on met dans l'URL pour y sauter. */
export function ancre(texte) {
  return String(texte ?? '')
    .replace(/[`*_]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'titre';
}

/**
 * Le plan du document — ce qui alimente la table des matières latérale.
 *
 * Les titres de niveau 1 en sont exclus : c'est le titre de la page, il est déjà en haut
 * de l'écran. Le répéter dans son propre sommaire n'aide personne.
 */
export function plan(source, { min = 2, max = 3 } = {}) {
  const out = [];
  let dansCode = false;
  for (const l of String(source ?? '').split('\n')) {
    if (/^```/.test(l)) { dansCode = !dansCode; continue; }
    if (dansCode) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (!m) continue;
    const niveau = m[1].length;
    if (niveau < min || niveau > max) continue;
    const texte = m[2].trim();
    out.push({ niveau, texte, ancre: ancre(texte) });
  }
  return out;
}

/** Le titre de la page : son premier `#`, ou rien. */
export function titre(source) {
  const m = /^#\s+(.*)$/m.exec(String(source ?? ''));
  return m ? m[1].trim() : '';
}

export default { rendre, enLigne, echapper, plan, ancre, titre };
