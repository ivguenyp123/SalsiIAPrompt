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
    auteur = '', perimetre = ''
  } = r;

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

  <div class="fiche">
    ${ligne('Agent', agent + (version ? ` · v${version}` : ''))}
    ${ligne('Qui en répond', auteur)}
    ${ligne('Périmètre', perimetre)}
    ${ligne('Modèle', modele)}
    ${ligne('Coût de l\'appel', cout)}
  </div>

  ${bloc('Le rapport', corps)}
  ${bloc('Ce qui a été vérifié', controles(postvol))}
  ${bloc('Les chiffres fournis à l\'agent', annexe)}

  <footer>
    Rapport produit par SalsiIAPrompt.<br>
    Les chiffres sont calculés par la plateforme ; le commentaire est rédigé par un modèle.
    Les deux figurent séparément pour pouvoir être confrontés.
  </footer>

</div>
</body>
</html>`;
}

export default { rapportHtml, nomFichier };
