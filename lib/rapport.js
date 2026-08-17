/*
 * Le rapport exporté — un fichier qu'on garde, qu'on envoie, qu'on met en pièce jointe.
 *
 * ── POURQUOI EXPORTER ────────────────────────────────────────────────────────
 *
 * Une réponse qui ne vit que dans un onglet ne sert qu'une fois. Le hub DevOps l'avait
 * compris : `exportReport()` dans `js/insights.js` fabrique une page HTML autonome qu'on
 * télécharge, et c'est elle qu'on retrouve dans un mail ou dans un comité. On boucle ici
 * la même chose — pour un agent, et non plus pour un module.
 *
 * ── CE QU'IL PORTE, ET QUI N'EST PAS QUE LA RÉPONSE ──────────────────────────
 *
 * Un rapport sans provenance est une opinion joliment mise en page. Celui-ci dit, en
 * clair et sur la page :
 *
 *   D'OÙ viennent les chiffres — le dépôt, la date, la méthode de calcul
 *   QUI a écrit le commentaire — l'agent, sa version, le modèle qui l'a rendu
 *   CE QUI a été vérifié — les critères et leur verdict, un par un
 *
 * C'est ce qui sépare un rapport d'une capture d'écran. Quelqu'un qui le reçoit six mois
 * plus tard doit pouvoir dire sur quoi il porte et ce qui a été contrôlé, sans nous.
 *
 * ── LA SÉPARATION RESTE VISIBLE JUSQU'AU BOUT ────────────────────────────────
 *
 * Les chiffres sont calculés par du code ; le commentaire est écrit par un modèle. Le
 * rapport ne les mélange pas : la matière figure telle quelle, en annexe, et le lecteur
 * peut confronter les deux. Un document qui les fondrait en une seule voix ferait passer
 * une rédaction pour une mesure.
 *
 * ── AUTONOME, VRAIMENT ───────────────────────────────────────────────────────
 *
 * Aucune police distante, aucune feuille de style, aucun script. Le fichier s'ouvre sur
 * un poste sans réseau, dans dix ans, et rend la même chose. Le hub, lui, appelle Google
 * Fonts depuis son export : hors ligne, sa mise en page tombe.
 *
 * Module PUR : ni DOM, ni réseau, ni horloge — la date se passe en paramètre.
 */
import { rendre, echapper, lienSur } from './md.js';

/** Le nom du fichier téléchargé. Lisible, triable, sans caractère qui fâche. */
export function nomFichier({ agent = 'rapport', depot = '', date = '' } = {}) {
  const propre = (s) => String(s).replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return [propre(agent), propre(depot), String(date).slice(0, 10)]
    .filter(Boolean).join('_') + '.html';
}

const bloc = (titre, contenu) => (contenu
  ? `<section><h2>${echapper(titre)}</h2>${contenu}</section>` : '');

const ligne = (cle, valeur) => (valeur
  ? `<div class="l"><span>${echapper(cle)}</span><b>${echapper(valeur)}</b></div>` : '');

/**
 * Le verdict des critères, tel qu'il a été calculé — pas tel qu'on l'espérait.
 *
 * Un rapport qui montrerait la réponse sans son contrôle laisserait croire qu'elle a été
 * vérifiée. Un rapport qui masquerait un critère violé mentirait. Les deux figurent.
 */
function controles(postvol) {
  const constats = postvol?.constats || [];
  if (!constats.length) return '';

  const items = constats.map((c) => {
    const ok = c.verdict === 'satisfait';
    const nr = c.verdict === 'non résolu';
    return `<li class="${ok ? 'ok' : nr ? 'na' : 'ko'}">`
      + `<span class="ic">${ok ? '✔' : nr ? '·' : '✕'}</span>`
      + `<code>${echapper(c.cible)}</code> ${echapper(c.op)} `
      + `<code>${echapper(JSON.stringify(c.attendu))}</code>`
      + (c.pourquoi ? `<small>${echapper(c.pourquoi)}</small>` : '')
      + '</li>';
  }).join('');

  const dit = postvol.conforme
    ? '✔ Tous les contrôles automatiques passent'
    : `✕ ${(postvol.violes || []).length} critère(s) violé(s)`;

  return `<div class="verdict ${postvol.conforme ? 'ok' : 'ko'}">${echapper(dit)}</div>`
    + `<ul class="ctrl">${items}</ul>`;
}

/**
 * Le score, en grand — parce que c'est ce qu'on vient chercher.
 *
 * Il vient des MESURES, pas du texte du modèle. Si les deux divergeaient un jour, c'est
 * celui-ci qui ferait foi, et c'est pour ça qu'il est calculé à part.
 */
function enTete(m) {
  if (!m) return '';
  if (m.score === null) {
    return '<div class="score na"><b>—</b><span>score non calculable</span></div>';
  }
  const classe = m.score < 2 ? 'ko' : m.score < 3 ? 'moyen' : 'ok';
  return `<div class="score ${classe}">`
    + `<b>${echapper(String(m.score))}</b>`
    + `<span>${echapper(m.niveau || '')}</span>`
    + '<em>personnes qui couvrent l\'essentiel du code</em>'
    + '</div>';
}

/** Qui porte quoi. Un tableau se lit d'un coup d'œil ; un paragraphe non. */
function tableauContributeurs(m) {
  const gens = m?.contributeurs || [];
  if (!gens.length) return '';
  const total = gens.reduce((s, c) => s + c.commits, 0);
  const lignes = gens.slice(0, 12).map((c) => {
    const pc = total ? Math.round((c.commits / total) * 100) : 0;
    return `<tr><td>${echapper(c.nom)}</td><td class="n">${c.commits}</td>`
      + `<td class="n">${pc} %</td>`
      + `<td class="bar"><i style="width:${pc}%"></i></td></tr>`;
  }).join('');
  return `<table class="tb"><thead><tr><th>Qui</th><th class="n">Commits</th>`
    + `<th class="n">Part</th><th></th></tr></thead><tbody>${lignes}</tbody></table>`;
}

/*
 * ── UN RAPPORT QUI N'EST PAS QUE CELUI DU BUS FACTOR ─────────────────────────
 *
 * Les trois fonctions ci-dessus lisent `score`, `contributeurs`, `zones` : elles ne
 * savent parler que de bus factor. Un rapport de secrets exposés n'a ni score sur cinq ni
 * contributeurs, et il ne se ramène pas à ces colonnes-là.
 *
 * Plutôt que d'ajouter une fonction par sujet — et de rouvrir ce fichier à chaque signal
 * neuf — chaque signal DÉCRIT sa mise en page : un en-tête, et des tableaux. Le rapport
 * ne connaît alors ni les secrets, ni la conformité, ni ce qui viendra ensuite.
 *
 * La forme historique reste là et reste la voie par défaut : c'est celle qui marche, et
 * elle n'a aucune raison d'être réécrite pour faire de la place à une autre.
 */
function enTeteDecrit(p) {
  const e = p?.entete;
  if (!e) return '';
  return `<div class="score ${echapper(e.ton || '')}">`
    + `<b>${echapper(String(e.valeur))}</b>`
    + `<span>${echapper(e.libelle || '')}</span>`
    + (e.sous ? `<em>${echapper(e.sous)}</em>` : '')
    + '</div>';
}

/*
 * Un agent peut recevoir PLUSIEURS matières — une revue de sécurité lit les secrets, les
 * dépendances et la conformité d'un coup. Les trois chiffres montent alors côte à côte
 * plutôt qu'en cascade : on veut voir l'état d'un dépôt d'un seul regard, et trois cartes
 * empilées sur trois écrans ne sont plus un tableau de bord.
 *
 * Aucun chiffre n'est agrégé. Fabriquer une note de sécurité globale reviendrait à
 * inventer une pondération que personne n'a écrite, et à noyer un secret exposé dans deux
 * cents versions non figées.
 */
function enTetesDecrits(liste) {
  const cartes = liste.map((p) => enTeteDecrit(p)).filter(Boolean);
  if (cartes.length <= 1) return cartes.join('');
  return `<div class="scores">${cartes.join('')}</div>`;
}

/** Une cellule : du code se lit en chasse fixe, le reste non. */
const cellule = (c, align) => `<td class="${align || ''}">`
  + (c.code ? `<code>${echapper(c.texte)}</code>` : echapper(c.texte)) + '</td>';

function tableauxDecrits(p) {
  return (p?.tableaux || []).map((t) => {
    if (!t.lignes?.length) {
      return t.note ? bloc(t.titre, `<p class="note">${echapper(t.note)}</p>`) : '';
    }
    const entetes = t.colonnes
      .map((c) => `<th class="${c.align || ''}">${echapper(c.libelle)}</th>`).join('');
    const corps = t.lignes.map((l) => `<tr class="${echapper(l.ton || '')}">`
      + l.cellules.map((c, i) => cellule(c, t.colonnes[i]?.align)).join('') + '</tr>').join('');
    const note = t.note ? `<p class="note">${echapper(t.note)}</p>` : '';
    return bloc(t.titre,
      `<div class="scroll"><table class="tb"><thead><tr>${entetes}</tr></thead>`
      + `<tbody>${corps}</tbody></table></div>${note}`);
  }).join('');
}

/** Les zones, de la plus fragile à la plus solide, avec qui les tient. */
function tableauZones(m) {
  const zones = m?.zones || [];
  if (!zones.length) return '';
  const lignes = zones.map((z) => {
    const qui = (z.parts || []).slice(0, 3)
      .map((c) => `${echapper(c.nom)} <b>${c.part} %</b>`).join(' · ');
    const urgence = z.facteur === 1 ? 'ko' : z.facteur === 2 ? 'moyen' : 'ok';
    return `<tr class="${urgence}"><td><code>${echapper(z.chemin)}</code></td>`
      + `<td class="n">${z.facteur}</td><td class="n">${z.commits}</td><td>${qui}</td></tr>`;
  }).join('');
  const reste = m.comptes?.ignorees
    ? `<p class="note">${m.comptes.ignorees} répertoire(s) n'ont pas été interrogés — `
      + 'une zone fragile peut s\'y cacher.</p>'
    : '';
  return `<table class="tb"><thead><tr><th>Zone</th><th class="n">Facteur</th>`
    + `<th class="n">Commits</th><th>Qui la tient</th></tr></thead>`
    + `<tbody>${lignes}</tbody></table>${reste}`;
}

/**
 * Le rapport complet, en un seul fichier.
 *
 * @param {object} r
 *   titre    ce que le rapport annonce
 *   agent    l'identifiant de l'agent, et sa version
 *   depot    le dépôt sur lequel il a tourné
 *   quand    la date, formatée par l'appelant — ce module n'a pas d'horloge
 *   modele   le modèle qui a rédigé
 *   sortie   la réponse du modèle, en Markdown
 *   matiere  les chiffres qui lui ont été donnés, en texte brut
 *   postvol  le résultat des critères
 *   jetons   ce que l'appel a coûté
 */
export function rapportHtml(r = {}) {
  const {
    titre = 'Rapport', agent = '', version = '', depot = '', quand = '',
    modele = '', sortie = '', matiere = '', postvol = null, jetons = null,
    auteur = '', perimetre = '', mesures = null
  } = r;

  /*
   * `mesures` accepte une matière ou plusieurs. Un agent à une seule entrée passe l'objet
   * tel quel — la forme historique, celle du bus factor, n'a pas bougé.
   */
  const toutes = (Array.isArray(mesures) ? mesures : [mesures]).filter(Boolean);
  const decrites = toutes.map((m) => m.presentation).filter(Boolean);
  const premiere = toutes[0] || null;

  const corps = String(sortie).trim()
    ? `<div class="lu">${rendre(sortie, { lien: lienSur })}</div>`
    : '<p class="vide">Aucune réponse.</p>';

  const annexe = String(matiere).trim()
    ? `<p class="note">Ces chiffres ont été calculés par la plateforme, à partir du dépôt.
        Ils n'ont pas été produits par le modèle : c'est sur eux qu'il a travaillé, et
        c'est à eux qu'il faut se référer en cas de doute.</p>
       <pre>${echapper(matiere)}</pre>`
    : '';

  const cout = jetons
    ? `${jetons.entree} + ${jetons.sortie} jetons`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapper(titre)}${depot ? ` — ${echapper(depot)}` : ''}</title>
<style>
  /* Aucune police distante : ce fichier doit s'ouvrir hors ligne, et dans dix ans. */
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       background:linear-gradient(135deg,#1e1b4b,#312e81 55%,#4c1d95);
       min-height:100vh;color:#e9e7f5;padding:40px 20px;line-height:1.65}
  .page{max-width:860px;margin:0 auto}

  header{text-align:center;padding:36px 30px;background:rgba(255,255,255,.08);
         border:1px solid rgba(255,255,255,.16);border-radius:22px;margin-bottom:26px}
  header .ic{font-size:44px;line-height:1;margin-bottom:14px}
  header h1{font-size:27px;font-weight:800;letter-spacing:-.02em}
  header .cible{display:inline-block;margin-top:14px;padding:8px 16px;font-weight:700;
                font-size:14px;background:rgba(255,255,255,.13);border-radius:11px}
  header .quand{margin-top:11px;font-size:12.5px;opacity:.62}

  .fiche{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:11px;
         margin-bottom:26px}
  .l{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);
     border-radius:13px;padding:12px 15px}
  .l span{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
          opacity:.6;margin-bottom:3px}
  .l b{font-size:13.5px;font-weight:700;word-break:break-word}

  section{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);
          border-radius:18px;padding:24px 26px;margin-bottom:20px}
  section h2{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
             opacity:.66;margin-bottom:16px;padding-bottom:11px;
             border-bottom:1px solid rgba(255,255,255,.13)}

  .lu h1,.lu h2,.lu h3{color:#fff;line-height:1.3;margin:22px 0 10px;letter-spacing:-.01em;
                       text-transform:none;opacity:1;border:0;padding:0}
  .lu h1{font-size:21px} .lu h2{font-size:18px} .lu h3{font-size:15px}
  .lu > :first-child{margin-top:0}
  .lu p{margin:0 0 12px}
  .lu ul,.lu ol{margin:0 0 14px;padding-left:22px}
  .lu li{margin-bottom:7px}
  .lu li::marker{color:#a5b4fc}
  .lu b,.lu strong{color:#fff}
  .lu code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;
           background:rgba(252,211,77,.14);color:#fcd34d;border-radius:5px;padding:1px 6px}
  .lu pre{background:rgba(0,0,0,.34);border-radius:11px;padding:14px 16px;overflow:auto;
          margin:0 0 14px}
  .lu pre code{background:none;color:#d7d3ec;padding:0}
  .lu table{border-collapse:collapse;width:100%;margin:0 0 14px;font-size:13px}
  .lu th,.lu td{border:1px solid rgba(255,255,255,.16);padding:8px 11px;text-align:left}
  .lu th{background:rgba(255,255,255,.07)}
  .lu blockquote{margin:0 0 14px;padding-left:14px;border-left:3px solid rgba(255,255,255,.24);
                 opacity:.85}
  .lu hr{border:0;border-top:1px solid rgba(255,255,255,.14);margin:18px 0}

  .verdict{padding:13px 17px;border-radius:12px;font-weight:800;font-size:14px;
           margin-bottom:15px}
  .verdict.ok{background:rgba(52,211,153,.16);color:#6ee7b7;border:1px solid rgba(52,211,153,.4)}
  .verdict.ko{background:rgba(248,113,113,.16);color:#fca5a5;border:1px solid rgba(248,113,113,.42)}
  ul.ctrl{list-style:none;padding:0;font-size:12.5px}
  ul.ctrl li{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;padding:7px 0;
             border-top:1px solid rgba(255,255,255,.09)}
  ul.ctrl li:first-child{border-top:0}
  ul.ctrl .ic{width:14px;flex:none}
  ul.ctrl li.ok .ic{color:#6ee7b7} ul.ctrl li.ko .ic{color:#fca5a5}
  ul.ctrl li.na .ic{opacity:.5}
  ul.ctrl code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;
               background:rgba(0,0,0,.3);border-radius:5px;padding:1px 6px}
  ul.ctrl small{flex-basis:100%;opacity:.6;font-size:11.5px;padding-left:23px}

  section pre{background:rgba(0,0,0,.34);border-radius:12px;padding:16px 18px;overflow:auto;
              font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
              font-size:11.5px;line-height:1.6;color:#d7d3ec;white-space:pre-wrap}
  /* ── Le score, en grand : c'est ce qu'on vient chercher ── */
  .score{text-align:center;padding:30px;border-radius:20px;margin-bottom:22px;
         border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08)}
  .score b{display:block;font-size:66px;font-weight:800;line-height:1}
  .score span{display:block;margin-top:8px;font-size:15px;font-weight:800;
              text-transform:uppercase;letter-spacing:.07em}
  .score em{display:block;margin-top:7px;font-size:12.5px;opacity:.6;font-style:normal}
  .score.ko b,.score.ko span{color:#fca5a5}
  .score.moyen b,.score.moyen span{color:#fcd34d}
  .score.ok b,.score.ok span{color:#6ee7b7}
  .score.na b{opacity:.45}
  /* Plusieurs matières : les chiffres côte à côte, jamais empilés sur trois écrans. */
  .scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;
          margin-bottom:22px}
  .scores .score{margin-bottom:0;padding:24px 18px}
  .scores .score b{font-size:46px}
  .scores .score span{font-size:13px}

  /* ── Des tableaux : un état se lit d'un coup d'œil, un paragraphe non ── */
  table.tb{border-collapse:collapse;width:100%;font-size:13px}
  table.tb th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;
              opacity:.6;padding:0 10px 9px;font-weight:700}
  table.tb td{padding:9px 10px;border-top:1px solid rgba(255,255,255,.1);vertical-align:middle}
  table.tb .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.tb code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                font-size:12px;background:rgba(0,0,0,.3);border-radius:5px;padding:2px 7px}
  table.tb .bar{width:34%}
  table.tb .bar i{display:block;height:7px;border-radius:4px;background:#a5b4fc}
  table.tb tr.ko td:first-child code{background:rgba(248,113,113,.2);color:#fca5a5}
  table.tb tr.moyen td:first-child code{background:rgba(252,211,77,.16);color:#fcd34d}
  /* Un liseré à gauche : sur trente lignes de contrôles, la couleur d'un bout de code
     isolé ne se voit plus. Le liseré tient la colonne du regard. */
  table.tb tr.ko td:first-child{box-shadow:inset 3px 0 0 #f87171}
  table.tb tr.moyen td:first-child{box-shadow:inset 3px 0 0 #fbbf24}
  /* Un tableau plus large que la page défile DANS son cadre : sans ça, c'est la page
     entière qui part de travers, et le texte devient illisible sur téléphone. */
  .scroll{overflow-x:auto}

  /* ── La technique : disponible, jamais devant ── */
  .tech{border:1px solid rgba(255,255,255,.11);border-radius:16px;padding:16px 20px;
        margin-bottom:20px;background:rgba(255,255,255,.04)}
  .tech > summary{cursor:pointer;font-size:11.5px;font-weight:800;text-transform:uppercase;
                  letter-spacing:.07em;opacity:.55}
  .tech[open] > summary{margin-bottom:16px}
  .tech .fiche{margin-bottom:16px}
  .tech h3{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;
           opacity:.55;margin:20px 0 11px}

  .note{font-size:12.5px;opacity:.72;margin-bottom:13px}
  .vide{opacity:.6}

  footer{text-align:center;margin-top:30px;font-size:12px;opacity:.5;line-height:1.7}

  @media print{
    body{background:#fff;color:#111}
    header,section,.l{background:#fff;border-color:#ccc}
    .lu h1,.lu h2,.lu h3,.lu b,.lu strong{color:#000}
    section pre,.lu pre{background:#f4f4f7;color:#222}
  }
</style>
</head>
<body>
<div class="page">

  <header>
    <div class="ic">📊</div>
    <h1>${echapper(titre)}</h1>
    ${depot ? `<div class="cible">📦 ${echapper(depot)}</div>` : ''}
    ${quand ? `<div class="quand">Généré le ${echapper(quand)}</div>` : ''}
  </header>

  ${decrites.length ? enTetesDecrits(decrites) : enTete(premiere)}

  ${decrites.length ? decrites.map(tableauxDecrits).join('') : `
  ${bloc('Qui porte le code', tableauContributeurs(premiere))}
  ${bloc('Les zones, de la plus fragile à la plus solide', tableauZones(premiere))}`}
  ${bloc('Le diagnostic et le plan', corps)}

  <!--
    LA TECHNIQUE AU FOND, ET REPLIÉE.

    Elle occupait le haut de page : agent, version, modèle, coût, critères. Personne ne
    vient chercher ça — on vient chercher quoi faire de son dépôt. Mais on ne la SUPPRIME
    pas : le jour où quelqu'un conteste un chiffre, il doit pouvoir savoir quel agent l'a
    produit et ce qui a été vérifié. Repliée, elle est disponible sans être encombrante.
  -->
  <details class="tech">
    <summary>Provenance et contrôles</summary>
    <div class="fiche">
      ${ligne('Agent', agent + (version ? ` · v${version}` : ''))}
      ${ligne('Qui en répond', auteur)}
      ${ligne('Périmètre', perimetre)}
      ${ligne('Modèle', modele)}
      ${ligne('Coût de l\'appel', cout)}
    </div>
    ${controles(postvol)}
    ${annexe ? `<h3>Les chiffres fournis à l'agent</h3>${annexe}` : ''}
  </details>

  <footer>
    Rapport produit par SalsiIAPrompt.<br>
    Les chiffres sont calculés par la plateforme ; le diagnostic est rédigé par un modèle.
    Les deux figurent séparément pour pouvoir être confrontés.
  </footer>

</div>
</body>
</html>`;
}

export default { rapportHtml, nomFichier };
