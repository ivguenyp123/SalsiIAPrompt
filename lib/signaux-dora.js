/*
 * Les quatre métriques DORA — calculées, jamais demandées.
 *
 * ── L'AGENT QUI DEMANDAIT DE COLLER SES PROPRES CHIFFRES ─────────────────────
 *
 * « Pour expliquer les DORA, cet agent demande qu'on copie les DORA — ce qui est
 * ridicule. » Le constat était juste, et il vaut pour tout l'inventaire : `chiffres_dora`
 * y est déclaré comme une entrée à FOURNIR. Autrement dit : va ouvrir « DORA Insights »,
 * exporte, colle. Personne ne le fera. Et un agent lancé sans ce collage reçoit un champ
 * vide — donc il écrit « élevée » là où la plateforme calcule `4.2 /sem`, et la porte
 * répond « contrat satisfait », parce qu'un critère vérifie une forme et jamais un fait.
 *
 * ── EXTRAIT DE `js/insights.js`, LIGNE À LIGNE ───────────────────────────────
 *
 * Le contrat `inventaire/contrats/dora-insights.yaml` a servi de cahier des charges, et
 * le code du hub d'arbitre quand les deux se contredisaient :
 *
 *   computeDORA()        les quatre calculs, la fenêtre, le périmètre de production
 *   doraLevel()          les seuils de chaque métrique
 *   renderGlobalScore()  le score, ses deux plafonds, et le refus de décerner « Elite »
 *
 * Rien n'est arrondi de mémoire. Un seuil approximatif ferait diverger deux rapports
 * censés être le même, et personne ne saurait lequel croire.
 *
 * ── QUATRE DIVERGENCES, TOUTES DITES DANS LE TEXTE PRODUIT ───────────────────
 *
 * 1. LE LEAD TIME NE PART PAS DU PREMIER COMMIT, et le hub non plus. Son code lit
 *    `mr.first_commit_at || mr.created_at` — mais l'API des merge requests ne rend jamais
 *    `first_commit_at`, donc la branche de gauche est morte. Ce que la plateforme mesure
 *    RÉELLEMENT est « MR ouverte → fusionnée ». On mesure la même chose, et on l'écrit
 *    ainsi plutôt que de recopier une intention que le code ne tient pas.
 *
 * 2. UNE EXÉCUTION ANNULÉE COMPTE POUR UN ÉCHEC. La couche de forge normalise trois
 *    vocabulaires en trois valeurs, et range `canceled` avec `failed` ; le hub, lui,
 *    compare à `failed` seul. Le taux d'échec peut donc être plus sévère ici.
 *
 * 3. UNE SEULE PAGE. Le hub pagine jusqu'au bout ; notre couche demande cent pipelines et
 *    cent MR. Sur un dépôt très actif la fenêtre réelle est plus courte que trente jours —
 *    le texte annonce toujours la période RÉELLEMENT couverte, jamais celle qu'on visait.
 *
 * 4. `N/A` EST UNE VALEUR. La plateforme l'affiche quand elle n'a pas de quoi calculer, et
 *    refuse « Elite » sans temps de rétablissement. Écrire zéro ferait lire une mesure
 *    manquante comme une mesure catastrophique.
 *
 * Module PUR : ni forge, ni DOM, ni réseau, ni horloge.
 */

/** Ce qu'on sait calculer côté DORA. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_DORA = {
  chiffres_dora: {
    libelle: 'les quatre métriques DORA',
    mots: ['comite', 'gouvernance', 'performance'],
    besoin: 'les pipelines et les merge requests fusionnées des 30 derniers jours',
    source: 'js/insights.js'
  }
};

/** La fenêtre du hub. Glissante, et jamais élargie en douce pour trouver de la matière. */
export const FENETRE_JOURS = 30;

/*
 * Ce qu'on demande à la forge. Une page chacune : notre couche ne pagine pas, et un dépôt
 * très actif épuise donc les cent avant les trente jours. Ce qui est tronqué est DIT.
 */
export const MAX_PIPELINES = 100;
export const MAX_MR = 100;

/** En dessous, le hub refuse de calculer le taux d'échec et le rétablissement. */
export const MINI_PIPELINES_PROD = 5;

/** Un pipeline cassé une semaine n'est plus un incident : il est hors norme. */
export const CAP_MTTR_H = 24 * 7;

/** Une durée de plus d'un an est une erreur de données, pas une livraison lente. */
export const MAX_LEAD_H = 8760;

/*
 * Les seuils, lus dans `doraLevel()`. Rangés du meilleur au moins bon ; `mieux: 'haut'`
 * veut dire qu'on dépasse le seuil, `'bas'` qu'on reste dessous.
 */
export const SEUILS = {
  df:   { libelle: 'Fréquence de déploiement', unite: '/sem', mieux: 'haut',
          paliers: [['Elite', 7], ['High', 1], ['Medium', 0.25]] },
  lt:   { libelle: 'Lead time', unite: 'h', mieux: 'bas',
          paliers: [['Elite', 24], ['High', 168], ['Medium', 720]] },
  cfr:  { libelle: 'Taux d\'échec des changements', unite: '%', mieux: 'bas',
          paliers: [['Elite', 5], ['High', 10], ['Medium', 15]] },
  mttr: { libelle: 'Temps de rétablissement', unite: 'h', mieux: 'bas',
          paliers: [['Elite', 1], ['High', 24], ['Medium', 168]] }
};

/** Ce que vaut un niveau en points, dans la moyenne du score global. */
export const POINTS = { Elite: 100, High: 70, Medium: 40, Low: 15 };

/** Les paliers du score global. */
export const PALIERS_SCORE = [['Elite', 85], ['High', 60], ['Medium', 35]];

/** Le niveau d'une métrique. `null` n'est pas `Low` : c'est `N/A`, et ça change tout. */
export function niveauDe(metrique, valeur) {
  const s = SEUILS[metrique];
  if (!s || valeur === null || valeur === undefined) return 'N/A';
  for (const [niveau, seuil] of s.paliers) {
    if (s.mieux === 'haut' ? valeur >= seuil : valeur <= seuil) return niveau;
  }
  return 'Low';
}

/** Le niveau d'un score sur 100. */
export const paliersScore = (note) => {
  for (const [niveau, seuil] of PALIERS_SCORE) if (note >= seuil) return niveau;
  return 'Low';
};

/** La médiane — jamais la moyenne. Une livraison qui traîne trois mois écraserait tout. */
export function mediane(valeurs = []) {
  if (!valeurs.length) return null;
  const v = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  const brut = v.length % 2 === 0 ? (v[m - 1] + v[m]) / 2 : v[m];
  return Number(brut.toFixed(1));
}

const heures = (de, a) => (new Date(a).getTime() - new Date(de).getTime()) / 3600000;
const jours = (de, a) => (new Date(a).getTime() - new Date(de).getTime()) / 86400000;

/**
 * Les branches de production, au sens du hub.
 *
 * `main` et `master` toujours — c'est la convention universelle — plus la branche par
 * défaut du dépôt si elle porte un autre nom. Une équipe qui livre depuis `release` ne
 * doit pas voir son taux d'échec calculé sur ses branches de travail.
 */
export function branchesDeProduction(defaut = '') {
  const s = new Set(['main', 'master']);
  if (defaut) s.add(defaut);
  return s;
}

/*
 * Le taux d'échec, sur une fenêtre pondérée.
 *
 * Les jours récents pèsent double : un taux calculé à plat sur trente jours met un mois à
 * refléter une amélioration, et l'équipe qui vient de corriger ne voit rien bouger. Les
 * poids sont ceux du hub, fenêtre par fenêtre.
 */
function tauxPondere(pipelines, maintenant, { jours: nbJours, coupure, mini }) {
  const dans = pipelines.filter((p) => jours(p.debut, maintenant) <= nbJours);
  if (dans.length < mini) return null;
  let echecs = 0;
  let total = 0;
  for (const p of dans) {
    const age = jours(p.debut, maintenant);
    const poids = age <= coupure[0] ? 2 : coupure[1] === null ? 1.5 : (age <= coupure[1] ? 1.5 : 1);
    total += poids;
    if (p.statut === 'echec') echecs += poids;
  }
  return total ? Number(((echecs / total) * 100).toFixed(1)) : null;
}

/**
 * Les quatre métriques, le score et ses plafonds.
 *
 * @param {object} donnees
 *   depot         le dépôt
 *   pipelines     `[{ statut, branche, sha, debut }]` — déjà lus
 *   mrs           `[{ ouvert, fusionne }]` — les merge requests FUSIONNÉES
 *   brancheDefaut le nom de la branche par défaut
 *   maintenant    la date de référence — ce module n'a pas d'horloge
 *   tronque       vrai si la forge a rendu une page pleine, donc peut-être incomplète
 */
export function chiffresDora({ depot = '', pipelines = [], mrs = [], brancheDefaut = '',
                               maintenant = null, tronque = false } = {}) {
  const ref = maintenant || new Date().toISOString();
  const dans30 = (d) => d && jours(d, ref) >= 0 && jours(d, ref) <= FENETRE_JOURS;

  const p30 = pipelines.filter((p) => dans30(p.debut));
  const prod = branchesDeProduction(brancheDefaut);
  const prod30 = p30.filter((p) => prod.has(p.branche))
    .sort((a, b) => new Date(a.debut) - new Date(b.debut));

  /* ── Fréquence de déploiement ───────────────────────────────────────────────
   * Tous les pipelines en succès servent de témoin de livraison — un dépôt n'étiquette
   * pas toujours ses environnements de façon fiable. Dédupliqués PAR COMMIT : un commit
   * qui déclenche trois pipelines est une livraison, pas trois.
   */
  const parCommit = new Map();
  const sansSha = [];
  for (const p of p30) {
    if (p.statut !== 'succes') continue;
    if (!p.sha) { sansSha.push(p); continue; }
    const vu = parCommit.get(p.sha);
    if (!vu || new Date(p.debut) > new Date(vu.debut)) parCommit.set(p.sha, p);
  }
  const livraisons = parCommit.size + sansSha.length;
  /*
   * DIVERGENCE ASSUMÉE, et c'est la loi du registre appliquée à la lettre.
   *
   * Le hub écrit `df = 0` quand il ne lit aucun pipeline, ce qui donne « Low » : une
   * équipe dont le jeton n'a pas le droit de lire la CI est notée comme une équipe qui ne
   * livre jamais. Zéro pipeline LU et zéro déploiement ne sont pas la même chose.
   *
   * Aucun pipeline lu → `N/A`, et le plafond du score s'applique. Zéro succès parmi des
   * pipelines bien lus → `0`, et là c'est une vraie mesure, qui mérite son « Low ».
   */
  const df = p30.length ? Number(((livraisons / FENETRE_JOURS) * 7).toFixed(2)) : null;

  /* ── Lead time ──────────────────────────────────────────────────────────────
   * MR ouverte → fusionnée, en heures, MÉDIANE. Voir l'en-tête : le hub prétend partir du
   * premier commit, son code ne le fait pas, et on mesure ce qu'il mesure.
   */
  const fusionnees = mrs.filter((m) => m.fusionne && dans30(m.fusionne) && m.ouvert);
  const durees = fusionnees.map((m) => heures(m.ouvert, m.fusionne))
    .filter((h) => h > 0 && h < MAX_LEAD_H);
  const lt = mediane(durees);

  /* ── Taux d'échec ───────────────────────────────────────────────────────────
   * Trois fenêtres, puis leur moyenne pondérée : 5 jours pèse 50 %, 10 jours 30 %,
   * 30 jours 20 %. Une fenêtre trop maigre est OMISE et son poids retiré du total — pas
   * remplacée par zéro, ce qui ferait passer le silence pour une réussite.
   */
  let cfr = null;
  let cfr30 = null;
  let cfr10 = null;
  let cfr5 = null;
  let tendance = null;
  const assezDePipelines = prod30.length >= MINI_PIPELINES_PROD;

  if (assezDePipelines) {
    cfr30 = tauxPondere(prod30, ref, { jours: 30, coupure: [10, 20], mini: 1 });
    cfr10 = tauxPondere(prod30, ref, { jours: 10, coupure: [5, null], mini: 3 });
    cfr5 = tauxPondere(prod30, ref, { jours: 5, coupure: [2, null], mini: 2 });

    // La fenêtre de 30 jours porte le taux ; sans elle, il n'y a pas de base à pondérer.
    // Elle est toujours là dès qu'on a les 5 pipelines, mais on ne le suppose pas.
    if (cfr30 !== null) {
      let poids = 0.2;
      let somme = cfr30 * 0.2;
      if (cfr10 !== null) { somme += cfr10 * 0.3; poids += 0.3; }
      if (cfr5 !== null) { somme += cfr5 * 0.5; poids += 0.5; }
      cfr = Number((somme / poids).toFixed(1));

      const recent = cfr5 ?? cfr10;
      if (recent !== null) {
        tendance = recent < cfr30 - 5 ? 'en baisse' : recent > cfr30 + 5 ? 'en hausse' : 'stable';
      }
    }
  }

  /* ── Temps de rétablissement ────────────────────────────────────────────────
   * Échec → succès suivant sur la même branche. Une SÉRIE d'échecs consécutifs est UN
   * incident : le chronomètre part du premier, sinon `F F S` fournit deux échantillons
   * courts et tire la médiane vers le bas — un dépôt qui casse longtemps paraîtrait vif.
   */
  const retablissements = [];
  if (assezDePipelines) {
    for (let i = 0; i < prod30.length - 1; i += 1) {
      const p = prod30[i];
      if (p.statut !== 'echec') continue;
      const precedent = prod30.slice(0, i).reverse().find((n) => n.branche === p.branche);
      if (precedent && precedent.statut === 'echec') continue;
      const suivant = prod30.slice(i + 1)
        .find((n) => n.branche === p.branche && n.statut === 'succes');
      if (!suivant) continue;
      const h = heures(p.debut, suivant.debut);
      if (h > 0 && h <= CAP_MTTR_H) retablissements.push(h);
    }
  }
  const mttr = mediane(retablissements);

  const valeurs = { df, lt, cfr, mttr };
  const niveaux = Object.fromEntries(
    Object.keys(SEUILS).map((k) => [k, niveauDe(k, valeurs[k])]));

  const mesurees = Object.keys(SEUILS).filter((k) => niveaux[k] !== 'N/A');
  const manquantes = Object.keys(SEUILS).filter((k) => niveaux[k] === 'N/A');

  /* ── Le score global, et les deux plafonds ──────────────────────────────────
   * Moyenne des SEULES métriques disponibles. Une métrique absente n'entre pas dans la
   * moyenne : elle déclenche un plafond, ce qui est très différent de valoir zéro.
   */
  let score = null;
  let verdict = 'N/A';
  const avertissements = [];

  if (mesurees.length) {
    score = Math.round(mesurees.reduce((s, k) => s + POINTS[niveaux[k]], 0) / mesurees.length);

    /*
     * Sans temps de rétablissement, le score est plafonné à 75 — donc « High » au mieux,
     * puisque « Elite » commence à 85. Le plafond EST le refus : il n'y a pas de seconde
     * règle qui rétrograderait un Elite.
     *
     * Le hub en écrit une quand même, avec un message à part — « Score plafonné à High » —
     * mais elle est INATTEIGNABLE : il plafonne à 75 avant de tester si le résultat vaut
     * Elite, ce qui ne peut plus arriver. On ne recopie pas la branche morte ; on garde
     * son intention, qui est la même que celle de tout le registre : on ne décerne pas
     * l'excellence sur une résilience qu'on n'a pas mesurée.
     */
    if (niveaux.mttr === 'N/A') {
      score = Math.min(score, 75);
      verdict = paliersScore(score);
      avertissements.push('Score plafonné : sans temps de rétablissement, la résilience '
        + 'n\'est pas évaluée et « Elite » ne peut pas être décerné. Le score est donc '
        + 'potentiellement surévalué.');
    } else {
      verdict = paliersScore(score);
    }

    if (manquantes.length >= 2) {
      score = Math.min(score, 50);
      verdict = paliersScore(score);
      avertissements.push(`${manquantes.length} métriques manquantes sur 4 — score limité.`);
    }
  }

  const comptes = {
    pipelines: p30.length, pipelinesProd: prod30.length, livraisons,
    mrsFusionnees: fusionnees.length, dureesRetenues: durees.length,
    incidents: retablissements.length, tronque,
    branchesProd: [...prod], mesurees: mesurees.length, manquantes: manquantes.length,
    couverture: couverture(p30, mrs, ref)
  };

  const r = { df, lt, cfr, cfr30, cfr10, cfr5, tendance, mttr, niveaux, score, verdict,
              avertissements, comptes, depot };
  return { ...r, texte: texteDora(r), presentation: presentationDora(r) };
}

/**
 * La période RÉELLEMENT couverte, en jours.
 *
 * Elle vaut trente quand la forge a tout rendu, et moins quand une page pleine a coupé la
 * fenêtre. Annoncer trente jours après en avoir lu six mentirait sur l'assise du score —
 * et un score DORA sert à décider, pas à décorer.
 */
function couverture(pipelines, mrs, ref) {
  const dates = [...pipelines.map((p) => p.debut), ...mrs.map((m) => m.fusionne)]
    .filter(Boolean).map((d) => new Date(d).getTime()).filter(Number.isFinite);
  if (!dates.length) return 0;
  return Math.min(FENETRE_JOURS, Math.ceil((new Date(ref).getTime() - Math.min(...dates)) / 86400000));
}

/** La valeur d'une métrique, telle qu'on l'écrit — `N/A` compris. */
export function valeurLisible(metrique, valeur) {
  if (valeur === null || valeur === undefined) return 'N/A';
  return `${valeur} ${SEUILS[metrique].unite}`;
}

const POURQUOI_MANQUE = {
  df: 'aucun pipeline lu — la CI n\'est pas visible, ce n\'est pas une absence de livraison',
  lt: 'aucune merge request fusionnée avec une date d\'ouverture exploitable',
  cfr: `moins de ${MINI_PIPELINES_PROD} pipelines sur les branches de production`,
  mttr: 'aucune séquence échec → succès sur une branche de production'
};

function texteDora(r) {
  const c = r.comptes;
  const l = [
    `DORA — ${r.depot}`,
    `Fenêtre : ${FENETRE_JOURS} jours glissants. Période réellement couverte : `
      + `${c.couverture} jour(s).`,
    `${c.pipelines} pipeline(s) lus, dont ${c.pipelinesProd} sur les branches de `
      + `production (${c.branchesProd.join(', ')}). ${c.mrsFusionnees} merge request(s) `
      + 'fusionnée(s).',
    ''
  ];

  if (!c.pipelines && !c.mrsFusionnees) {
    l.push('Aucun pipeline ni aucune merge request sur la fenêtre. Il n\'y a pas de quoi '
      + 'calculer un score DORA. Ce n\'est pas un score de 0, c\'est une absence de mesure.');
    return l.join('\n');
  }

  if (r.score === null) {
    l.push('Score global : indisponible — aucune des quatre métriques n\'a pu être '
      + 'calculée. Écrire 0 ferait lire une mesure manquante comme une mesure '
      + 'catastrophique.', '');
  } else {
    l.push(`Score global : ${r.score} / 100 — ${r.verdict}`,
      `  Moyenne des ${c.mesurees} métrique(s) DISPONIBLES, converties en points `
      + '(Elite 100, High 70, Medium 40, Low 15).',
      '');
    for (const a of r.avertissements) l.push(`  ⚠ ${a}`);
    if (r.avertissements.length) l.push('');
  }

  l.push('Les quatre métriques :');
  for (const [cle, s] of Object.entries(SEUILS)) {
    const niveau = r.niveaux[cle];
    l.push(`  ${s.libelle.padEnd(30)} ${valeurLisible(cle, r[cle]).padStart(10)}   `
      + `${niveau.padEnd(7)} ${niveau === 'N/A' ? `— ${POURQUOI_MANQUE[cle]}` : `(${seuilsLisibles(cle)})`}`);
  }
  l.push('');

  if (r.cfr !== null) {
    const f = (v) => (v === null ? 'trop peu de pipelines' : `${v} %`);
    l.push('Le détail du taux d\'échec, fenêtre par fenêtre :',
      `  5 derniers jours  : ${f(r.cfr5)}   (pèse 50 % dans le taux retenu)`,
      `  10 derniers jours : ${f(r.cfr10)}   (pèse 30 %)`,
      `  30 derniers jours : ${f(r.cfr30)}   (pèse 20 %)`,
      r.tendance ? `  Tendance : ${r.tendance}.` : '',
      '');
  }

  l.push('Ce sur quoi chaque chiffre repose :',
    `  Fréquence      ${c.livraisons} livraison(s) — pipelines en succès dédupliqués par commit`,
    `  Lead time      ${c.dureesRetenues} merge request(s) retenue(s) sur ${c.mrsFusionnees}`,
    `  Taux d'échec   ${c.pipelinesProd} pipeline(s) de production`,
    `  Rétablissement ${c.incidents} incident(s) résolu(s) mesuré(s)`,
    '');

  if (c.tronque) {
    l.push('ATTENTION : la forge a rendu une page pleine. Le dépôt est plus actif que ce '
      + 'qu\'une page peut contenir, et la fenêtre réelle est donc plus courte que trente '
      + 'jours. Les chiffres portent sur la période annoncée plus haut, pas sur le mois.', '');
  }

  l.push('Méthode : la fréquence de déploiement compte les pipelines en succès, '
    + 'dédupliqués par commit, ramenés à la semaine. Le lead time est la MÉDIANE des '
    + 'durées ouverture → fusion des merge requests fusionnées. Le taux d\'échec ne porte '
    + 'que sur les branches de production, sur trois fenêtres pondérées dont les jours '
    + `récents pèsent double. Le rétablissement est la MÉDIANE des durées échec → succès `
    + `suivant, une série d'échecs comptant pour UN incident, au-delà de ${CAP_MTTR_H / 24} `
    + 'jours écarté.',
    '',
    'TROIS ÉCARTS AVEC LA PAGE « DORA Insights », et il faut les connaître. Le lead time '
    + 'part de l\'OUVERTURE de la merge request, pas de son premier commit — c\'est ce que '
    + 'la plateforme mesure réellement, son code prévoit le premier commit mais l\'API ne '
    + 'le lui donne jamais. Une exécution ANNULÉE est comptée ici comme un échec, là où '
    + 'la plateforme ne compte que les échecs francs : le taux peut être plus sévère. Et '
    + 'quand AUCUN pipeline n\'est lisible, la fréquence de déploiement vaut N/A et non 0 : '
    + 'un jeton sans droit sur la CI ne doit pas se lire comme une équipe qui ne livre pas.');

  return l.join('\n');
}

const seuilsLisibles = (cle) => {
  const s = SEUILS[cle];
  const signe = s.mieux === 'haut' ? '≥' : '≤';
  return s.paliers.map(([n, v]) => `${n} ${signe} ${v}`).join(' · ');
};

function presentationDora(r) {
  const entete = r.score === null
    ? { valeur: '—', libelle: 'score indisponible',
        sous: 'aucune des quatre métriques n\'a pu être calculée', ton: 'na' }
    : { valeur: String(r.score), libelle: r.verdict,
        sous: `${r.comptes.mesurees} métrique(s) mesurée(s) sur 4 · `
            + `${r.comptes.couverture} jour(s) couverts`,
        ton: r.verdict === 'Elite' || r.verdict === 'High' ? 'ok'
           : r.verdict === 'Medium' ? 'moyen' : 'ko' };

  const ton = { Elite: '', High: '', Medium: 'moyen', Low: 'ko', 'N/A': 'moyen' };
  const tableaux = [{
    titre: 'Les quatre métriques',
    colonnes: [{ libelle: 'Métrique' }, { libelle: 'Valeur', align: 'n' },
               { libelle: 'Niveau' }, { libelle: 'Les paliers' }],
    lignes: Object.entries(SEUILS).map(([cle, s]) => ({
      ton: ton[r.niveaux[cle]],
      cellules: [{ texte: s.libelle }, { texte: valeurLisible(cle, r[cle]) },
                 { texte: r.niveaux[cle] },
                 { texte: r.niveaux[cle] === 'N/A' ? POURQUOI_MANQUE[cle] : seuilsLisibles(cle) }]
    })),
    note: r.avertissements.join(' ')
  }];

  if (r.cfr !== null) {
    const f = (v) => (v === null ? 'trop peu de pipelines' : `${v} %`);
    tableaux.push({
      titre: 'Le taux d\'échec, fenêtre par fenêtre',
      colonnes: [{ libelle: 'Fenêtre' }, { libelle: 'Taux', align: 'n' },
                 { libelle: 'Poids', align: 'n' }],
      lignes: [['5 derniers jours', f(r.cfr5), '50 %'], ['10 derniers jours', f(r.cfr10), '30 %'],
               ['30 derniers jours', f(r.cfr30), '20 %']]
        .map(([a, b, c]) => ({ cellules: [{ texte: a }, { texte: b }, { texte: c }] })),
      note: r.tendance ? `Tendance : ${r.tendance}.` : ''
    });
  }

  if (r.comptes.tronque) {
    tableaux.push({ titre: 'L\'assise de ces chiffres', colonnes: [], lignes: [],
      note: 'La forge a rendu une page pleine : la fenêtre réelle est plus courte que '
          + `trente jours — ${r.comptes.couverture} jour(s) couverts.` });
  }

  return { sujet: 'Les métriques DORA', entete, tableaux };
}

/** Le résumé d'une ligne affiché à l'écran. */
export function resumeDora(r) {
  const c = r?.comptes;
  if (!c) return 'aucune mesure';
  if (!c.pipelines && !c.mrsFusionnees) return 'aucun pipeline ni MR sur la fenêtre';
  if (r.score === null) return `score indisponible · ${c.pipelines} pipeline(s) lus`;
  return `DORA ${r.score}/100 — ${r.verdict} · ${c.mesurees}/4 métriques · `
       + `${c.couverture} j couverts`;
}

export default { SIGNAUX_DORA, FENETRE_JOURS, MAX_PIPELINES, MAX_MR, MINI_PIPELINES_PROD,
                 CAP_MTTR_H, MAX_LEAD_H, SEUILS, POINTS, PALIERS_SCORE, niveauDe,
                 paliersScore, mediane, branchesDeProduction, chiffresDora, resumeDora,
                 valeurLisible };
