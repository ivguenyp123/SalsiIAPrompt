/*
 * L'analyse d'UN fichier — ce qui se mesure avant que le modèle ne lise.
 *
 * ── LA QUESTION QUI A PRODUIT CE MODULE ─────────────────────────────────────
 *
 * « On a plein de mesures de sécurité, certaines s'appliquent au niveau du code. Dans
 * l'agent analyseur de code, on ne pourrait pas tester ça en amont ? »
 *
 * Si. Et le code était déjà écrit. `scannerSecrets(contenu, fichier)` et
 * `verifierManifeste(eco, contenu, fichier)` sont pures, prennent UN fichier, rendent des
 * constats avec numéro de ligne — extraites de `js/secrets-scanner.js` motif pour motif.
 * Elles n'étaient branchées qu'à des signaux qui balaient le dépôt ENTIER : `rapport_secrets`
 * et `inventaire_dependances`. Sur le fichier qu'on est en train de lire, personne ne les
 * appelait.
 *
 * ── CE QUE ÇA CHANGE, ET CE QUE ÇA NE CHANGE PAS ────────────────────────────
 *
 * Le caviardage posé plus tôt PROTÈGE l'envoi : le jeton ne part pas chez le fournisseur.
 * Il ne MESURE rien, et il ne dit rien à l'agent — le modèle voit `[secret caviardé]` et
 * doit deviner ce que c'était. La section « Sécurité » de l'agent était donc, jusqu'ici,
 * cent pour cent du jugement de modèle.
 *
 * Ici, la matière porte des constats DATÉS, LOCALISÉS et REJOUABLES : « ligne 2, GitLab
 * PAT, glpat-Ab*** ». Le modèle n'a plus à les trouver — il a à dire quoi en faire. C'est
 * la même séparation que partout ailleurs dans ce registre :
 *
 *   le CHIFFRE      un motif de secret, une dépendance non figée, une image non pinnée
 *   l'EXPLICATION   l'injection, le contrôle d'accès absent, la désérialisation risquée —
 *                   tout ce qu'aucune expression régulière ne verra jamais
 *
 * ── ET CE QUE LE SCAN NE SAIT PAS FAIRE, DIT EN TOUTES LETTRES ──────────────
 *
 * Vingt-quatre motifs de secret et une poignée de contrôles de chaîne d'approvisionnement,
 * ce n'est pas une analyse de sécurité. Un fichier sans constat n'est pas un fichier sain,
 * et c'est précisément la phrase qu'un lecteur pressé retiendra si on ne l'écrit pas. La
 * matière porte donc sa propre liste de ce qui n'a PAS été cherché — au même titre que le
 * plan de livraison.
 *
 * Module PUR : ni forge, ni DOM, ni réseau. Il reçoit un contenu déjà lu.
 */
import { scannerSecrets, ecosysteme, verifierManifeste, caviarder,
         MOTIFS_SECRET } from './signaux-securite.js';

/** Ce qu'on sait calculer pour un fichier. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_CODE = {
  analyse_fichier: {
    libelle: 'le fichier, scanné avant lecture',
    besoin: 'un fichier du dépôt, choisi dans l\'arborescence',
    source: 'js/secrets-scanner.js',
    /*
     * Un réglage, et non une liste de choix comme pour une merge request.
     *
     * `listeDeChoix` sert quand la matière coûte cher à calculer et qu'il faut donc choisir
     * l'objet avant de la lire. Ici la lecture est d'un fichier, et c'est l'utilisateur qui
     * SAIT lequel il veut analyser — c'est une intention, pas une découverte.
     */
    reglages: [
      { nom: 'fichier', libelle: 'Fichier à analyser', genre: 'fichier', requis: true }
    ]
  }
};

/*
 * Combien de lignes partent au modèle.
 *
 * Un fichier de dix mille lignes coûterait une fortune et serait mal lu : noyée dans le
 * volume, la remarque utile a moins de chances d'être trouvée. Ce qui est coupé est
 * COMPTÉ et dit — un extrait présenté comme un fichier ferait conclure sur ce qui n'a
 * pas été lu.
 *
 * Le SCAN, lui, porte sur le fichier ENTIER : couper avant de scanner ferait rater un
 * secret posé à la ligne 4000, ce qui est exactement là où on les oublie.
 */
export const MAX_LIGNES = 900;

/** Au-delà, une ligne est du minifié ou une donnée encodée : on ne la montre pas. */
export const MAX_LARGEUR = 500;

const SEVERITE = { rouge: 'grave', orange: 'à regarder' };

/**
 * La matière d'un fichier : ce que le scan trouve, puis le fichier lui-même.
 *
 * @param {object} e
 *   @param {string} e.depot    identifiant du dépôt
 *   @param {string} e.chemin   chemin du fichier dans le dépôt
 *   @param {string} e.contenu  son contenu, tel que lu
 *   @param {Date}   e.maintenant
 */
export function analyseFichier({ depot = '', chemin = '', contenu = '',
                                 maintenant = new Date() } = {}) {
  const brut = String(contenu);
  const lignes = brut === '' ? [] : brut.split('\n');

  // Le scan porte sur le fichier ENTIER, avant toute coupe.
  const secrets = scannerSecrets(brut, chemin);
  const eco = ecosysteme(chemin);
  const chaine = eco ? verifierManifeste(eco, brut, chemin) : [];

  /*
   * Le contenu est caviardé AVANT d'être découpé, jamais l'inverse.
   *
   * Un secret qui tombe hors de la fenêtre n'est pas caviardé, et le jour où la fenêtre
   * bouge il repart. C'est la même règle que pour le log de CI, et elle a la même raison.
   * Le dernier garde-fou de `runtime/lancer.js` rattraperait le cas — mais un filet ne
   * dispense pas de tenir la barre.
   */
  const { texte: sur } = caviarder(brut);
  const surLignes = sur === '' ? [] : sur.split('\n');
  const montrees = surLignes.slice(0, MAX_LIGNES);

  const r = {
    depot,
    chemin,
    ecosysteme: eco || '',
    lignes: lignes.length,
    caracteres: brut.length,
    secrets,
    chaine,
    montrees: montrees.length,
    coupees: Math.max(0, surLignes.length - montrees.length),
    extrait: montrees.map((l, i) => `${String(i + 1).padStart(4)} | `
      + (l.length > MAX_LARGEUR ? `${l.slice(0, MAX_LARGEUR)}… (${l.length} car.)` : l)).join('\n'),
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteFichier(r) };
}

/* ── Le texte, et lui seul part au modèle ─────────────────────────────────── */

function texteFichier(r) {
  const L = [];
  L.push(`Fichier — ${r.depot} · ${r.chemin}`);
  L.push(`${r.lignes} ligne(s), ${r.caracteres} caractères`
       + `${r.ecosysteme ? ` · manifeste ${r.ecosysteme}` : ''}.`);
  L.push('');

  const total = r.secrets.length + r.chaine.length;
  L.push(`CE QUE LE SCAN DÉTERMINISTE A TROUVÉ (${total})`);

  if (!total) {
    /*
     * La formulation compte plus que le compte.
     *
     * « Aucun constat » se lit « fichier propre », et c'est faux : on a cherché vingt-quatre
     * motifs de secret, pas des vulnérabilités. Un fichier truffé d'injections SQL ressort
     * ici sans un seul constat.
     */
    L.push('  Aucun. Ce qui veut dire : aucun des motifs cherchés ci-dessous n\'apparaît.');
    L.push('  Ce n\'est PAS « ce fichier est sain » — voir la section suivante.');
  } else {
    for (const s of r.secrets) {
      L.push(`  ligne ${String(s.ligne).padEnd(5)} ${'SECRET'.padEnd(8)}${s.type} — ${s.apercu}`
           + `${s.cis ? `  (CIS ${s.cis})` : ''}`);
    }
    for (const c of r.chaine) {
      L.push(`  ligne ${String(c.ligne ?? '?').padEnd(5)} ${String(c.tag).toUpperCase().padEnd(8)}`
           + `${c.type} — ${c.apercu}  [${SEVERITE[c.severite] || c.severite}]`);
    }
    if (r.secrets.length) {
      L.push('');
      L.push('  Les valeurs ne sont montrées qu\'en aperçu : assez pour retrouver la ligne,');
      L.push('  jamais assez pour s\'en servir. Elles sont aussi retirées de l\'extrait plus bas.');
    }
  }
  L.push('');
  L.push(...nonCherche(r));

  L.push(`LE FICHIER${r.coupees ? ` — ${r.montrees} premières lignes` : ''}`);
  if (r.coupees) {
    L.push(`  ${r.coupees} ligne(s) NON montrées. Le scan ci-dessus a porté sur le fichier`);
    L.push('  entier ; ta lecture, non. Ne conclus rien sur ce qui n\'est pas là.');
  }
  L.push('');
  L.push(r.extrait || '  (fichier vide)');
  return L.join('\n');
}

/*
 * Ce que le scan ne cherche pas — la section la plus importante du texte.
 *
 * Sans elle, un modèle à qui l'on montre un rapport vide écrit « aucun problème de
 * sécurité détecté », et cette phrase a l'autorité d'une mesure alors qu'elle n'en est
 * pas une. On énumère donc ce que vingt-quatre expressions régulières ne verront jamais,
 * et c'est exactement le travail qu'on attend du modèle.
 */
function nonCherche(r) {
  return [
    'CE QUI N\'A PAS ÉTÉ CHERCHÉ',
    `  Le scan couvre ${MOTIFS_SECRET.length} motifs de secret`
      + `${r.ecosysteme ? ` et les contrôles de chaîne d'approvisionnement ${r.ecosysteme}` : ''}.`,
    '  Il ne cherche RIEN d\'autre. En particulier, il ne voit pas :',
    '    · l\'injection SQL, shell ou de commande, ni la concaténation qui la produit',
    '    · le contrôle d\'accès absent là où il en faudrait un',
    '    · la désérialisation d\'une donnée reçue',
    '    · le chiffrement fait à la main, l\'aléatoire non cryptographique',
    '    · la journalisation d\'une donnée sensible',
    '    · les vulnérabilités connues des dépendances (CVE) — jamais scannées ici',
    '  Un secret entropique sans forme reconnaissable lui échappe aussi.',
    '',
    '  Autrement dit : ces constats sont un plancher, pas un verdict. Ce qui suit est à',
    '  lire, et c\'est là que tu sers.',
    ''
  ];
}

/** Le résumé d'une ligne, affiché sous le champ. */
export function resumeCode(r) {
  const n = r.secrets.length + r.chaine.length;
  const coupe = r.coupees ? `, ${r.coupees} ligne(s) non montrées` : '';
  if (!n) return `${r.chemin} — ${r.lignes} ligne(s), aucun motif connu${coupe}`;
  const quoi = [];
  if (r.secrets.length) quoi.push(`${r.secrets.length} secret(s)`);
  if (r.chaine.length) quoi.push(`${r.chaine.length} constat(s) de chaîne`);
  return `${r.chemin} — ${quoi.join(' · ')}${coupe}`;
}

export default { SIGNAUX_CODE, analyseFichier, resumeCode, MAX_LIGNES, MAX_LARGEUR };
