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
  },

  /*
   * LE MÊME TRAVAIL, SUR CE QU'UNE BRANCHE A CHANGÉ.
   *
   * `analyse_fichier` demande un chemin — encore faut-il savoir lequel. Quand on revient
   * sur une branche, on ne sait justement plus : on sait qu'on a touché « des trucs ».
   * Choisir une branche et lire ce qu'elle a changé est le geste naturel, et il n'existait
   * pas.
   *
   * À ne pas confondre avec `etat_branche`, qui ne contient AUCUNE ligne de code —
   * divergence, dispersion, âge. Ici c'est le contenu, scanné puis caviardé, exactement
   * comme pour un fichier seul. Deux signaux parce que ce sont deux questions : « où en
   * est cette branche » et « que vaut ce qu'elle contient ».
   */
  code_de_la_branche: {
    libelle: 'le code changé par une branche, scanné avant lecture',
    besoin: 'les fichiers qu\'une branche modifie, lus sur cette branche',
    source: 'js/secrets-scanner.js',
    reglages: [
      { nom: 'branche', libelle: 'Branche à analyser', genre: 'branche', requis: true }
    ]
  },

  /*
   * LE MÊME TRAVAIL, À L'ÉCHELLE DU DÉPÔT ENTIER.
   *
   * ── LA QUESTION QUI A PRODUIT CE SIGNAL ──────────────────────────────────
   *
   * Les capacités importées d'un pack tiers — synthétiser une architecture, cartographier
   * un système — travaillent sur LE CODE D'UN DÉPÔT, pas sur un fichier ni sur une
   * branche. Chez leur auteur, l'agent allait le chercher lui-même ; chez nous, un import
   * n'a ni outil ni exécution, et sa matière se collait donc à la main. Coller un dépôt
   * entier dans une zone de texte n'est pas un geste : c'est un aveu qu'il manque un
   * signal.
   *
   * ── CE QU'IL N'EST PAS ────────────────────────────────────────────────────
   *
   * Ce n'est pas `rapport_depot`, qui porte vingt-cinq CONTRÔLES et pas une ligne de
   * code. Ici c'est le code lui-même : la carte des répertoires, la pile détectée, le
   * scan, puis le contenu des fichiers retenus — scanné puis caviardé, comme les deux
   * autres. Deux signaux parce que ce sont deux questions : « que faut-il corriger dans
   * ce dépôt » et « comment ce dépôt est-il fait ».
   *
   * ── ET CE QU'IL NE PRÉTEND PAS ÊTRE ───────────────────────────────────────
   *
   * Un dépôt ne tient pas dans une fenêtre de contexte. Ce signal en lit une PARTIE,
   * choisie par une règle écrite (`fichiersARetenir`) et ANNONCÉE dans le texte — avec le
   * compte de ce qui n'a pas été lu. Un extrait présenté comme un dépôt ferait conclure
   * sur ce qu'on n'a pas vu, et c'est exactement l'erreur qu'un agent d'architecture
   * commettrait le plus volontiers.
   */
  code_du_depot: {
    libelle: 'le code du dépôt, scanné avant lecture',
    besoin: 'l\'arborescence du dépôt et le contenu des fichiers retenus',
    source: 'js/secrets-scanner.js',
    /*
     * Le dossier est FACULTATIF, et son absence est une valeur : « tout le dépôt ».
     * L'exiger obligerait à choisir un sous-dossier là où la question porte souvent sur
     * l'ensemble — et le tester comme un manque bloquerait le cas le plus courant.
     */
    reglages: [
      { nom: 'dossier', libelle: 'Se limiter à un dossier', genre: 'dossier', requis: false }
    ]
  }
};

/*
 * Ce qui ne se lit pas comme du texte, et ce qui n'est pas le code du projet.
 *
 * Ici plutôt que dans l'écran, où ces deux expressions vivaient : le choix des fichiers à
 * lire est désormais une RÈGLE du signal, testable sans navigateur, et deux copies
 * auraient fini par diverger — l'une écartant `node_modules`, l'autre non, sur un écran
 * où personne ne compare les deux chemins. `catalogue.js` les importe.
 */
export const ILLISIBLE = /\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|eot|mp[34]|mov|avi|zip|tar|gz|rar|7z|pdf|jar|war|class|so|dll|exe|bin|lock)$/i;
export const HORS_SOURCE = /(?:^|\/)(?:node_modules|vendor|dist|build|target|coverage|\.git|out|\.next|\.nuxt|\.cache|__pycache__|\.venv|venv)(?:\/|$)/;

/*
 * Ce qu'on lit EN PREMIER quand on découvre un dépôt.
 *
 * Un manifeste dit la pile et les dépendances ; un README dit l'intention ; un point
 * d'entrée dit par où ça commence. Aucune heuristique ne remplace une lecture humaine —
 * mais servir les fichiers dans l'ordre alphabétique servirait `.eslintrc` avant
 * `main.py`, ce qui est pire qu'un ordre discutable : c'est un ordre absurde.
 */
const PRIORITAIRES = [
  /(?:^|\/)(?:package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle|Gemfile|composer\.json|requirements\.txt)$/i,
  /(?:^|\/)READ ?ME(?:\.md|\.rst|\.txt)?$/i,
  /(?:^|\/)(?:index|main|app|server|cli)\.[a-z]+$/i,
  /(?:^|\/)(?:Dockerfile|docker-compose\.ya?ml|Makefile)$/i
];

/** Le rang de priorité d'un chemin : plus petit, plus tôt. Sans correspondance : après tout. */
const rangDe = (chemin) => {
  const i = PRIORITAIRES.findIndex((rx) => rx.test(chemin));
  return i === -1 ? PRIORITAIRES.length : i;
};

/** La profondeur d'un chemin : la racine avant les feuilles, un dépôt se lit du haut. */
const profondeurDe = (chemin) => chemin.split('/').length;

/*
 * Combien de fichiers on LIT sur un dépôt.
 *
 * Un appel de forge chacun, et un dépôt réel en porte des milliers. Le plafond est plus
 * haut que celui d'une branche — on découvre un système, pas un changement — sans être
 * généreux : au-delà, la lecture coûte plus qu'elle ne rapporte et le contexte déborde.
 */
export const MAX_FICHIERS_DEPOT = 40;

/** Le budget de lignes, tous fichiers confondus. C'est le total qui coûte. */
export const MAX_LIGNES_DEPOT = 2500;

/** Combien de répertoires la carte montre. Au-delà, elle se compte au lieu de se lister. */
export const MAX_ZONES_CARTE = 40;

/**
 * QUELS FICHIERS ON LIT — la règle, écrite ici et annoncée dans la matière.
 *
 * Elle est PURE et déterministe : deux personnes qui la lancent sur le même dépôt lisent
 * les mêmes fichiers, et c'est ce qui rend la matière contestable. Une sélection au fil
 * de l'eau — « les vingt premiers que la forge a rendus » — aurait produit deux lectures
 * différentes du même dépôt sans que rien ne le dise.
 *
 * @param {Array<string>} chemins  l'arborescence entière
 * @param {object} e
 *   @param {string} e.dossier  se limiter à ce préfixe ('' : tout le dépôt)
 *   @param {number} e.max
 * @returns {{retenus: Array<string>, candidats: number, ecartes: number, hors: number}}
 */
export function fichiersARetenir(chemins = [], { dossier = '', max = MAX_FICHIERS_DEPOT } = {}) {
  const prefixe = String(dossier || '').replace(/^\/+|\/+$/g, '');
  const dansLeDossier = (c) => !prefixe || c === prefixe || c.startsWith(`${prefixe}/`);

  const duDossier = chemins.filter(dansLeDossier);
  const candidats = duDossier.filter((c) => !ILLISIBLE.test(c) && !HORS_SOURCE.test(c));

  const ordonnes = [...candidats].sort((a, b) =>
    rangDe(a) - rangDe(b)
    || profondeurDe(a) - profondeurDe(b)
    || a.localeCompare(b));

  const retenus = ordonnes.slice(0, Math.max(0, max));
  return {
    retenus,
    candidats: candidats.length,
    ecartes: Math.max(0, candidats.length - retenus.length),
    hors: duDossier.length - candidats.length
  };
}

/**
 * LA CARTE DES RÉPERTOIRES — ce qu'on voit d'un dépôt avant d'ouvrir un fichier.
 *
 * Elle est calculée sur l'arborescence ENTIÈRE, y compris ce qu'on ne lira pas : un
 * agent d'architecture doit savoir qu'il existe un `migrations/` de trois cents fichiers,
 * même si aucun n'est lu. Compter n'est pas lire, et les deux se disent séparément.
 */
export function carteDesZones(chemins = [], { dossier = '' } = {}) {
  const prefixe = String(dossier || '').replace(/^\/+|\/+$/g, '');
  const zones = new Map();
  for (const c of chemins) {
    if (prefixe && c !== prefixe && !c.startsWith(`${prefixe}/`)) continue;
    const reste = prefixe ? c.slice(prefixe.length + 1) : c;
    const zone = reste.includes('/') ? `${prefixe ? `${prefixe}/` : ''}${reste.split('/')[0]}`
                                     : (prefixe || '.');
    const z = zones.get(zone) || { zone, fichiers: 0, source: 0 };
    z.fichiers += 1;
    if (!ILLISIBLE.test(c) && !HORS_SOURCE.test(c)) z.source += 1;
    zones.set(zone, z);
  }
  return [...zones.values()].sort((a, b) => b.fichiers - a.fichiers || a.zone.localeCompare(b.zone));
}

/*
 * Combien de fichiers on LIT sur la branche.
 *
 * Un appel de forge chacun. Une branche qui en touche deux cents en déclencherait deux
 * cents — et personne ne lit deux cents fichiers. Ce qui n'est pas lu est COMPTÉ et dit :
 * un extrait présenté comme un changement complet ferait conclure sur ce qu'on n'a pas vu.
 */
export const MAX_FICHIERS_BRANCHE = 20;

/*
 * Combien de lignes de code partent au modèle, TOUS FICHIERS CONFONDUS.
 *
 * Un plafond par fichier ne suffit pas : vingt fichiers de neuf cents lignes font dix-huit
 * mille lignes. C'est le total qui coûte, et c'est donc le total qu'on borne.
 */
export const MAX_LIGNES_BRANCHE = 1200;

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

/* ══ LE CODE D'UNE BRANCHE ════════════════════════════════════════════════════ */

/**
 * Les fichiers qu'une branche a changés, scannés puis caviardés.
 *
 * ── UNE SEULE RÈGLE NOUVELLE PAR RAPPORT À UN FICHIER SEUL ──────────────────
 *
 * Le budget de lignes est GLOBAL. Sur un fichier, couper à neuf cents lignes suffit ; sur
 * vingt fichiers, ça fait dix-huit mille lignes et une facture. On répartit donc un budget
 * commun, et on sert les fichiers dans l'ordre où ils comptent — le plus changé d'abord,
 * parce que c'est là que le travail a eu lieu.
 *
 * Deux invariants tenus, les mêmes qu'ailleurs :
 *   · le SCAN porte sur TOUS les fichiers lus, avant toute coupe. Un secret dans le
 *     dernier fichier du lot doit remonter même si son contenu n'est pas montré.
 *   · ce qui est coupé est COMPTÉ et DIT. Un extrait présenté comme un changement complet
 *     ferait conclure sur ce qu'on n'a pas vu.
 *
 * @param {object} e
 *   @param {string} e.depot
 *   @param {string} e.branche
 *   @param {string} e.brancheDefaut
 *   @param {Array<{chemin, contenu, ajouts, retraits, statut}>} e.fichiers  déjà lus
 *   @param {number} e.touches   combien de fichiers la branche change EN TOUT
 *   @param {Array<string>} e.nonLus  ceux qu'on n'a pas pu lire, et pourquoi
 *   @param {Date} e.maintenant
 */
export function analyseBranche({ depot = '', branche = '', brancheDefaut = 'main',
                                 fichiers = [], touches = 0, nonLus = [],
                                 maintenant = new Date() } = {}) {
  // Le plus changé d'abord : c'est là que le travail a eu lieu, donc là qu'on veut lire.
  const ordonnes = [...fichiers].sort(
    (a, b) => ((b.ajouts || 0) + (b.retraits || 0)) - ((a.ajouts || 0) + (a.retraits || 0)));

  let budget = MAX_LIGNES_BRANCHE;
  const analyses = ordonnes.map((f) => {
    const brut = String(f.contenu ?? "");

    // Le scan porte sur le fichier ENTIER, quoi qu'il advienne du budget.
    const secrets = scannerSecrets(brut, f.chemin);
    const eco = ecosysteme(f.chemin);
    const chaine = eco ? verifierManifeste(eco, brut, f.chemin) : [];

    const { texte: sur } = caviarder(brut);
    const toutes = sur === "" ? [] : sur.split("\n");
    const part = Math.max(0, Math.min(toutes.length, budget));
    budget -= part;

    return {
      chemin: f.chemin,
      statut: f.statut || "modifie",
      ajouts: f.ajouts || 0,
      retraits: f.retraits || 0,
      ecosysteme: eco || "",
      lignes: toutes.length,
      secrets,
      chaine,
      montrees: part,
      coupees: toutes.length - part,
      extrait: toutes.slice(0, part).map((l, i) => `${String(i + 1).padStart(4)} | `
        + (l.length > MAX_LARGEUR ? `${l.slice(0, MAX_LARGEUR)}… (${l.length} car.)` : l)).join("\n")
    };
  });

  const r = {
    depot,
    branche,
    brancheDefaut,
    fichiers: analyses,
    lus: analyses.length,
    touches: touches || analyses.length,
    nonLus,
    secrets: analyses.flatMap((a) => a.secrets),
    chaine: analyses.flatMap((a) => a.chaine),
    lignesMontrees: analyses.reduce((s, a) => s + a.montrees, 0),
    lignesCoupees: analyses.reduce((s, a) => s + a.coupees, 0),
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteBranche(r) };
}

function texteBranche(r) {
  const L = [];
  L.push(`Code de la branche — ${r.depot} · ${r.branche}`);
  L.push(`Comparée à \`${r.brancheDefaut}\`. ${r.touches} fichier(s) changé(s), `
       + `${r.lus} lu(s), ${r.lignesMontrees} ligne(s) montrée(s).`);
  /*
   * DEUX RAISONS DE NE PAS AVOIR LU UN FICHIER, ET ELLES NE SE CONFONDENT PAS.
   *
   * Vu à l'écran : le rapport annonçait « 1 fichier NON LU — plafond de 20 » alors que le
   * plafond n'y était pour rien — le fichier était binaire ou illisible. Le lecteur en
   * conclut qu'il suffit de relever le plafond, ce qui ne changerait rien.
   *
   * `ecartes` est donc ce que le PLAFOND a coupé, une fois les illisibles retirés du
   * compte. Il n'apparaît que s'il vaut vraiment quelque chose.
   */
  const ecartes = Math.max(0, r.touches - r.lus - r.nonLus.length);
  if (ecartes) {
    L.push(`  ${ecartes} fichier(s) non lus — plafond de ${MAX_FICHIERS_BRANCHE} par branche.`);
  }
  if (r.nonLus.length) {
    L.push(`  ${r.nonLus.length} illisible(s), et ce n'est pas le plafond : ${r.nonLus.join(", ")}.`);
  }
  L.push("");

  const total = r.secrets.length + r.chaine.length;
  L.push(`CE QUE LE SCAN DÉTERMINISTE A TROUVÉ (${total})`);
  if (!total) {
    L.push("  Aucun. Ce qui veut dire : aucun des motifs cherchés plus bas n'apparaît");
    L.push("  dans les fichiers LUS. Ce n'est PAS « ce changement est sain ».");
  } else {
    for (const s of r.secrets) {
      L.push(`  ${s.fichier}:${s.ligne}  SECRET   ${s.type} — ${s.apercu}`);
    }
    for (const c of r.chaine) {
      L.push(`  ${c.fichier}:${c.ligne ?? "?"}  ${String(c.tag).toUpperCase()}  ${c.type}`
           + ` — ${c.apercu}  [${SEVERITE[c.severite] || c.severite}]`);
    }
  }
  L.push("");
  L.push(...nonCherche({ ecosysteme: [...new Set(r.fichiers.map((f) => f.ecosysteme).filter(Boolean))].join(", ") }));

  L.push("LES FICHIERS");
  for (const f of r.fichiers) {
    L.push("");
    L.push(`── ${f.chemin}  (${f.statut}, +${f.ajouts} / -${f.retraits}`
         + `${f.ecosysteme ? `, manifeste ${f.ecosysteme}` : ""})`);
    if (f.coupees) {
      L.push(`   ${f.coupees} ligne(s) non montrées sur ${f.lignes} — budget global épuisé.`);
      L.push("   Le scan a porté sur le fichier entier ; ta lecture, non.");
    }
    L.push(f.extrait || "   (vide, ou entièrement coupé)");
  }
  return L.join("\n");
}

/** Le résumé d'une ligne, pour le code d'une branche. */
export function resumeBrancheCode(r) {
  const n = r.secrets.length + r.chaine.length;
  const coupe = r.lignesCoupees ? `, ${r.lignesCoupees} ligne(s) non montrées` : "";
  const manque = r.touches > r.lus ? `, ${r.touches - r.lus} fichier(s) non lus` : "";
  return `${r.branche} — ${r.lus}/${r.touches} fichier(s), `
       + `${n ? `${n} constat(s)` : "aucun motif connu"}${coupe}${manque}`;
}

/* ══ LE CODE D'UN DÉPÔT ═══════════════════════════════════════════════════════ */

/**
 * Le code d'un dépôt : sa carte, sa pile, son scan, et les fichiers retenus.
 *
 * Mêmes invariants que les deux échelles plus petites, et ils comptent davantage ici
 * parce que la part non lue est bien plus grande :
 *   · le SCAN porte sur tous les fichiers LUS, avant toute coupe ;
 *   · le budget de lignes est GLOBAL, et ce qui est coupé est compté ;
 *   · ce qui n'a pas été lu est COMPTÉ et DIT — la carte, elle, porte sur l'arbre entier.
 *
 * @param {object} e
 *   @param {string} e.depot
 *   @param {string} e.ref       la branche lue
 *   @param {string} e.dossier   le sous-dossier demandé ('' : tout le dépôt)
 *   @param {Array<string>} e.arbre       l'arborescence ENTIÈRE, pour la carte
 *   @param {Array<{chemin, contenu}>} e.fichiers  ceux qui ont été lus
 *   @param {number} e.candidats  combien de fichiers de source le dossier porte EN TOUT
 *   @param {Array<string>} e.nonLus  ceux qu'on n'a pas pu lire, nommés
 *   @param {Date} e.maintenant
 */
export function analyseDepot({ depot = '', ref = '', dossier = '', arbre = [],
                               fichiers = [], candidats = 0, nonLus = [],
                               maintenant = new Date() } = {}) {
  let budget = MAX_LIGNES_DEPOT;
  const analyses = fichiers.map((f) => {
    const brut = String(f.contenu ?? '');

    // Le scan porte sur le fichier ENTIER, quoi qu'il advienne du budget.
    const secrets = scannerSecrets(brut, f.chemin);
    const eco = ecosysteme(f.chemin);
    const chaine = eco ? verifierManifeste(eco, brut, f.chemin) : [];

    const { texte: sur } = caviarder(brut);
    const toutes = sur === '' ? [] : sur.split('\n');
    const part = Math.max(0, Math.min(toutes.length, budget));
    budget -= part;

    return {
      chemin: f.chemin,
      ecosysteme: eco || '',
      lignes: toutes.length,
      secrets,
      chaine,
      montrees: part,
      coupees: toutes.length - part,
      extrait: toutes.slice(0, part).map((l, i) => `${String(i + 1).padStart(4)} | `
        + (l.length > MAX_LARGEUR ? `${l.slice(0, MAX_LARGEUR)}… (${l.length} car.)` : l)).join('\n')
    };
  });

  const r = {
    depot,
    ref,
    dossier,
    zones: carteDesZones(arbre, { dossier }),
    zonesTotal: carteDesZones(arbre, { dossier }).length,
    arbre: arbre.length,
    fichiers: analyses,
    lus: analyses.length,
    candidats: candidats || analyses.length,
    nonLus,
    piles: [...new Set(analyses.map((a) => a.ecosysteme).filter(Boolean))],
    secrets: analyses.flatMap((a) => a.secrets),
    chaine: analyses.flatMap((a) => a.chaine),
    lignesMontrees: analyses.reduce((s, a) => s + a.montrees, 0),
    lignesCoupees: analyses.reduce((s, a) => s + a.coupees, 0),
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteDepot(r) };
}

function texteDepot(r) {
  const L = [];
  L.push(`Code du dépôt — ${r.depot}${r.ref ? ` · ${r.ref}` : ''}`
       + `${r.dossier ? ` · dossier \`${r.dossier}\`` : ''}`);
  L.push(`${r.arbre} fichier(s) dans l'arbre, ${r.candidats} de source dans le périmètre, `
       + `${r.lus} lu(s), ${r.lignesMontrees} ligne(s) montrée(s).`);
  L.push('');

  /*
   * LA PART NON LUE, EN TÊTE ET EN TOUTES LETTRES.
   *
   * C'est l'erreur que ce signal rend possible et qu'aucun autre ne rend aussi facile :
   * conclure « ce dépôt est fait comme ça » après avoir lu quarante fichiers sur trois
   * mille. La phrase est donc AVANT le contenu, pas dans une note de bas de page.
   */
  const ecartes = Math.max(0, r.candidats - r.lus - r.nonLus.length);
  L.push('CE QUE TU N\'AS PAS SOUS LES YEUX');
  if (ecartes) {
    L.push(`  ${ecartes} fichier(s) de source NON lus — plafond de ${MAX_FICHIERS_DEPOT}.`);
    L.push('  Tu vois une PARTIE de ce dépôt. Écris ce que les fichiers lus montrent, et');
    L.push('  dis « non vu » pour le reste — ne le déduis pas.');
  } else {
    L.push(`  Tous les fichiers de source du périmètre ont été lus (${r.lus}).`);
  }
  if (r.nonLus.length) {
    L.push(`  ${r.nonLus.length} illisible(s), et ce n'est pas le plafond : ${r.nonLus.join(', ')}.`);
  }
  if (r.lignesCoupees) {
    L.push(`  ${r.lignesCoupees} ligne(s) coupées par le budget global de ${MAX_LIGNES_DEPOT}.`);
  }
  L.push('  L\'ordre de lecture est une RÈGLE, pas un jugement : manifestes, README, points');
  L.push('  d\'entrée, puis de la racine vers les feuilles. Un fichier absent de cette liste');
  L.push('  n\'est pas un fichier sans importance.');
  L.push('');

  L.push(`LA CARTE — ${r.zonesTotal} répertoire(s) de premier niveau, comptés sur l'arbre ENTIER`);
  for (const z of r.zones.slice(0, MAX_ZONES_CARTE)) {
    L.push(`  ${z.zone.padEnd(34)} ${String(z.fichiers).padStart(5)} fichier(s)`
         + `${z.source !== z.fichiers ? `, dont ${z.source} de source` : ''}`);
  }
  if (r.zones.length > MAX_ZONES_CARTE) {
    L.push(`  … ${r.zones.length - MAX_ZONES_CARTE} autre(s) répertoire(s) non listés.`);
  }
  L.push('');
  L.push(`PILE DÉTECTÉE : ${r.piles.length ? r.piles.join(', ')
    : 'aucun manifeste reconnu parmi les fichiers lus'}.`);
  L.push('');

  const total = r.secrets.length + r.chaine.length;
  L.push(`CE QUE LE SCAN DÉTERMINISTE A TROUVÉ (${total})`);
  if (!total) {
    L.push('  Aucun. Ce qui veut dire : aucun des motifs cherchés plus bas n\'apparaît');
    L.push('  dans les fichiers LUS. Ce n\'est PAS « ce dépôt est sain ».');
  } else {
    for (const s of r.secrets) {
      L.push(`  ${s.fichier}:${s.ligne}  SECRET   ${s.type} — ${s.apercu}`);
    }
    for (const c of r.chaine) {
      L.push(`  ${c.fichier}:${c.ligne ?? '?'}  ${String(c.tag).toUpperCase()}  ${c.type}`
           + ` — ${c.apercu}  [${SEVERITE[c.severite] || c.severite}]`);
    }
  }
  L.push('');
  L.push(...nonCherche({ ecosysteme: r.piles.join(', ') }));

  L.push('LES FICHIERS');
  for (const f of r.fichiers) {
    L.push('');
    L.push(`── ${f.chemin}  (${f.lignes} ligne(s)`
         + `${f.ecosysteme ? `, manifeste ${f.ecosysteme}` : ''})`);
    if (f.coupees) {
      L.push(`   ${f.coupees} ligne(s) non montrées — budget global épuisé.`);
      L.push('   Le scan a porté sur le fichier entier ; ta lecture, non.');
    }
    L.push(f.extrait || '   (vide, ou entièrement coupé)');
  }
  return L.join('\n');
}

/** Le résumé d'une ligne, pour le code d'un dépôt. */
export function resumeDepotCode(r) {
  const n = r.secrets.length + r.chaine.length;
  const ou = r.dossier ? `${r.dossier}/` : r.depot;
  const pile = r.piles.length ? ` · ${r.piles.join(', ')}` : '';
  return `${ou} — ${r.lus}/${r.candidats} fichier(s) lus, ${r.zonesTotal} répertoire(s)`
       + `${pile} · ${n ? `${n} constat(s)` : 'aucun motif connu'}`;
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

export default { SIGNAUX_CODE, analyseFichier, resumeCode, analyseBranche, resumeBrancheCode,
                 analyseDepot, resumeDepotCode, fichiersARetenir, carteDesZones,
                 ILLISIBLE, HORS_SOURCE,
                 MAX_LIGNES, MAX_LARGEUR, MAX_FICHIERS_BRANCHE, MAX_LIGNES_BRANCHE,
                 MAX_FICHIERS_DEPOT, MAX_LIGNES_DEPOT, MAX_ZONES_CARTE };
