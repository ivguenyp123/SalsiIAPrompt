/*
 * Le rapport quotidien du hub, CALCULÉ.
 *
 * ── CE QU'ON REPRODUIT, ET POURQUOI À LA VIRGULE ─────────────────────────────
 *
 * `js/daily-report.js`, fonction `buildStandaloneHTML()` : six indicateurs, un Health
 * Score, et des moyennes par jour. Le contrat extrait vit dans
 * `inventaire/contrats/daily-report.yaml` ; ce module est son implémentation.
 *
 * L'enjeu est le même que pour DORA : si le modèle recalcule, il obtient un autre chiffre
 * que celui affiché à l'écran, et plus personne ne sait lequel croire. On calcule donc
 * ici, une fois, et l'agent ne fait qu'expliquer.
 *
 * ── LE HEALTH SCORE N'EST PAS UNE MOYENNE ────────────────────────────────────
 *
 * C'est 100 dont on RETIRE des points pour des défauts nommés. Il ne monte jamais : un
 * dépôt sans défaut détecté vaut exactement 100, pas davantage. Le reproduire suppose de
 * savoir lesquels, et surtout de ne pas « améliorer » la formule au passage.
 *
 * Et il MÉLANGE DEUX PÉRIMÈTRES, ce que personne ne devine en lisant le chiffre :
 *
 *   sur la fenêtre    le taux de succès des pipelines          −20 puis −15
 *   hors fenêtre      les branches dormantes depuis 90 j       −15
 *   hors fenêtre      les MR ouvertes depuis plus de 7 j       −10
 *
 * Un rapport « de la semaine » peut donc perdre 25 points pour une dette qui n'a rien à
 * voir avec la semaine écoulée. Ce n'est pas un défaut à corriger ici — c'est le calcul
 * de la plateforme — mais c'est une phrase que le rapport doit écrire, sinon une équipe
 * passe sa semaine à chercher ce qu'elle a raté.
 *
 * Module PUR : ni forge, ni DOM, ni horloge. `maintenant` est fourni.
 */

/*
 * Ce qu'on sait calculer ici. Fusionné dans `SIGNAUX` par signaux-matiere.js.
 *
 * ── LA DÉCLARATION QUE J'AVAIS OUBLIÉE ──────────────────────────────────────
 *
 * Un signal doit être inscrit à DEUX endroits, et les deux servent à des choses
 * différentes :
 *
 *   CALCULS, dans le catalogue   COMMENT on le calcule
 *   SIGNAUX, ici                 QUE la plateforme sait le calculer
 *
 * `activite_du_jour` n'était inscrit que dans le premier. `sait()` répondait donc non, et
 * l'écran en concluait — logiquement — que la matière devait être fournie à la main : un
 * champ de saisie vide, un bouton « Récupérer », et aucun sélecteur de dépôt. Le calcul
 * existait, il n'était simplement jamais appelé.
 *
 * Le symptôme est pénible parce qu'il ne ressemble pas à une panne : l'agent s'affiche, se
 * lance, et répond — sur un champ vide.
 */
export const SIGNAUX_DAILY = {
  activite_du_jour: {
    libelle: 'l\'activité de la semaine et le Health Score',
    besoin: 'les pipelines, merge requests, commits, branches et déploiements sur 7 jours',
    source: 'js/daily-report.js'
  }
};

/* ── Les constantes, toutes extraites ─────────────────────────────────────── */

/** Les deux fenêtres proposées par le hub. Rien d'autre n'est offert à l'écran. */
export const FENETRES = { semaine: 7, mois: 30 };

/** Les seuils de lecture du Health Score, verbatim. */
export const SEUILS_SANTE = [[80, 'Bonne santé'], [50, 'À surveiller'], [0, 'Critique']];

/** Les quatre pénalités, dans l'ordre où la plateforme les applique. */
export const PENALITES = {
  succes_sous_80:   { points: 20, quoi: 'taux de succès sous 80 %' },
  succes_sous_60:   { points: 15, quoi: 'taux de succès aussi sous 60 %' },
  branches_mortes:  { points: 15, quoi: 'plus de 20 branches sans commit depuis plus de 90 jours' },
  mr_qui_trainent:  { points: 10, quoi: 'plus de 5 MR ouvertes depuis plus de 7 jours' }
};

export const SEUIL_BRANCHE_MORTE_J = 90;
export const SEUIL_TROP_DE_BRANCHES = 20;
export const SEUIL_MR_AGEE_J = 7;
export const SEUIL_TROP_DE_MR = 5;

/** Le tableau « MR qui traînent » du rapport part à 2 jours, pas à 7 — deux seuils. */
export const SEUIL_MR_LISTEE_J = 2;
export const MAX_MR_LISTEES = 5;
export const MAX_BRANCHES_EN_ECHEC = 8;

/*
 * Les plafonds de lecture.
 *
 * Aucune forge ne rend une fenêtre entière en un appel. Ces nombres sont donc des
 * plafonds de PAGE, et quand une page est pleine le compte est un MINIMUM. Le signal le
 * porte (`tronque`) et le rapport doit l'écrire : un « 43 pipelines » qui vaut en réalité
 * « au moins 43 » se lit exactement pareil, et c'est ce qui le rend dangereux.
 */
export const MAX_PIPELINES = 100;
export const MAX_MR = 100;
export const MAX_COMMITS = 100;
export const MAX_DEPLOIEMENTS = 100;

const JOUR_MS = 86400000;
const jours = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / JOUR_MS;
const dateValide = (v) => v && !Number.isNaN(new Date(v).getTime());

/** Une moyenne par jour, à UNE décimale — comme la plateforme l'écrit. */
const parJour = (total, n) => Number((total / Math.max(n, 1)).toFixed(1));

/* ── Le calcul ────────────────────────────────────────────────────────────── */

/**
 * Les chiffres du rapport quotidien.
 *
 * @param {string} depot
 * @param {number} fenetreJours  7 ou 30
 * @param {Array}  pipelines     [{ statut, branche, quand, debut }] sur la fenêtre
 * @param {Array}  mrsFusionnees sur la fenêtre
 * @param {Array}  mrsOuvertes   AUJOURD'HUI, sans filtre de date
 * @param {Array}  commits       sur la fenêtre
 * @param {Array}  branches      [{ name, quand }] aujourd'hui
 * @param {Array|null} deploiements  `null` si la forge a refusé de les rendre
 * @param {string} maintenant
 * @param {object} tronque       { pipelines, mrs, commits, deploiements } — page pleine ?
 */
export function chiffresDaily({ depot = '', fenetreJours = 7, pipelines = [],
                                mrsFusionnees = [], mrsOuvertes = [], commits = [],
                                branches = [], deploiements = null,
                                maintenant = new Date().toISOString(),
                                tronque = {} } = {}) {
  const jour = Math.max(1, Math.round(fenetreJours));
  const debut = new Date(new Date(maintenant).getTime() - (jour - 1) * JOUR_MS);
  debut.setHours(0, 0, 0, 0);

  /* ── Les pipelines ────────────────────────────────────────────────────── */

  const total = pipelines.length;
  const succes = pipelines.filter((p) => p.statut === 'succes').length;
  const echecs = pipelines.filter((p) => p.statut === 'echec').length;
  /*
   * Les ANNULÉS sont le reste, et c'est une soustraction, pas un filtre.
   *
   * La plateforme écrit `canceled = total - success - failed`. Tout ce qui n'est ni l'un
   * ni l'autre — annulé, en cours, en attente d'un job manuel — atterrit donc ici. Filtrer
   * sur `statut === 'annule'` donnerait un autre nombre, et le total ne tomberait plus
   * juste. On reproduit la soustraction.
   */
  const autres = total - succes - echecs;

  /*
   * Le taux vaut 0 SANS AUCUN PIPELINE, et c'est délibéré.
   *
   * Contrairement à DORA, où on a choisi `N/A` contre le hub, ici on reproduit le 0 :
   * c'est ce que le rapport exporté affiche, et le Health Score en dépend. Le passer à
   * `N/A` changerait la note — ce serait « corriger » la plateforme dans un document
   * censé la refléter.
   *
   * La conséquence est rude et doit être ÉCRITE : ce 0 franchit les deux bornes, donc une
   * semaine sans aucun pipeline est notée comme une semaine où tout a échoué.
   */
  const taux = total > 0 ? Math.round((succes / total) * 100) : 0;

  /* ── Les branches dormantes ───────────────────────────────────────────── */

  /*
   * Les branches SANS DATE sont comptées à part, jamais présumées vivantes.
   *
   * GitHub ne date pas ses branches ; l'appelant en date un lot et abandonne le reste.
   * Les traiter comme fraîches ferait disparaître une pénalité de 15 points, et le Health
   * Score serait faux à la hausse — c'est-à-dire dans le sens que personne ne conteste.
   */
  const datees = branches.filter((b) => dateValide(b.quand));
  const sansDate = branches.length - datees.length;
  const dormantes = datees.filter((b) => jours(maintenant, b.quand) > SEUIL_BRANCHE_MORTE_J);

  /* ── Les MR qui traînent ──────────────────────────────────────────────── */

  const agees = mrsOuvertes
    /*
     * `ouvert`, le nom que la forge rend — pas `ouverteLe`, que j'avais écrit d'abord.
     *
     * L'erreur aurait été MUETTE : sans date valide, chaque MR sort du filtre, la liste
     * « qui traînent » reste vide et la pénalité de 10 points ne tombe jamais. Un Health
     * Score trop haut, sur un dépôt qui a effectivement des MR qui pourrissent, et rien
     * à l'écran pour le dire.
     */
    .filter((mr) => dateValide(mr.ouvert))
    .map((mr) => ({ ...mr, age: Math.floor(jours(maintenant, mr.ouvert)) }))
    .sort((a, b) => b.age - a.age);

  const vieilles = agees.filter((mr) => mr.age > SEUIL_MR_AGEE_J);

  /* ── Le Health Score ──────────────────────────────────────────────────── */

  const retraits = [];
  let sante = 100;
  if (taux < 80) { sante -= PENALITES.succes_sous_80.points; retraits.push({ ...PENALITES.succes_sous_80, cle: 'succes_sous_80' }); }
  if (taux < 60) { sante -= PENALITES.succes_sous_60.points; retraits.push({ ...PENALITES.succes_sous_60, cle: 'succes_sous_60' }); }
  if (dormantes.length > SEUIL_TROP_DE_BRANCHES) { sante -= PENALITES.branches_mortes.points; retraits.push({ ...PENALITES.branches_mortes, cle: 'branches_mortes' }); }
  if (vieilles.length > SEUIL_TROP_DE_MR) { sante -= PENALITES.mr_qui_trainent.points; retraits.push({ ...PENALITES.mr_qui_trainent, cle: 'mr_qui_trainent' }); }
  sante = Math.max(0, Math.min(100, sante));

  const lecture = SEUILS_SANTE.find(([seuil]) => sante >= seuil)[1];

  /* ── Les échecs par branche ───────────────────────────────────────────── */

  const parBranche = new Map();
  for (const p of pipelines.filter((x) => x.statut === 'echec')) {
    const ref = p.branche || 'inconnue';
    parBranche.set(ref, (parBranche.get(ref) || 0) + 1);
  }
  const branchesEnEchec = [...parBranche.entries()]
    .map(([branche, n]) => ({ branche, echecs: n }))
    .sort((a, b) => b.echecs - a.echecs || a.branche.localeCompare(b.branche))
    .slice(0, MAX_BRANCHES_EN_ECHEC);

  /* ── Ce qu'on n'a pas pu lire ─────────────────────────────────────────── */

  const angles = [];
  if (deploiements === null) {
    angles.push('Les déploiements n\'ont pas pu être lus — le jeton n\'a pas la permission, '
      + 'ou la forge n\'en expose pas. Le chiffre est ABSENT, pas nul : ne pas écrire zéro.');
  }
  if (sansDate > 0) {
    angles.push(`${sansDate} branche(s) sans date de dernier commit : la forge ne la donne `
      + 'pas et le lot daté à la main est plafonné. Elles ne comptent ni comme vivantes ni '
      + 'comme dormantes, donc la pénalité « branches » peut être sous-estimée.');
  }
  for (const [cle, plafond] of [['pipelines', MAX_PIPELINES], ['mrs', MAX_MR],
                                ['commits', MAX_COMMITS], ['deploiements', MAX_DEPLOIEMENTS]]) {
    if (tronque[cle]) {
      angles.push(`La liste des ${cle} a atteint le plafond de lecture (${plafond}) : le `
        + 'compte est un MINIMUM, et les moyennes par jour qui en découlent aussi.');
    }
  }

  const r = {
    depot,
    fenetre: {
      jours: jour,
      libelle: jour === 7 ? 'Semaine' : (jour === 30 ? 'Mois' : `${jour} jours`),
      du: debut.toISOString(),
      au: maintenant
    },

    sante: {
      score: sante,
      sur: 100,
      lecture,
      retraits,
      // Ce qui n'a PAS coûté de points est aussi une information : une équipe doit
      // pouvoir voir qu'elle est passée près, pas seulement ce qui l'a punie.
      intacte: retraits.length === 0,
      // Les deux périmètres, explicitement séparés — c'est la phrase que le rapport doit
      // reprendre pour qu'un « −25 » de dette ancienne ne se lise pas comme un accident
      // de la semaine.
      hors_fenetre: retraits.filter((r) => r.cle === 'branches_mortes' || r.cle === 'mr_qui_trainent')
                            .reduce((s, r) => s + r.points, 0)
    },

    indicateurs: [
      { cle: 'mrs_fusionnees', libelle: 'MRs mergées', valeur: mrsFusionnees.length,
        par_jour: parJour(mrsFusionnees.length, jour) },
      { cle: 'pipelines', libelle: 'Pipelines', valeur: total, par_jour: parJour(total, jour) },
      { cle: 'echecs', libelle: 'Échecs', valeur: echecs, par_jour: parJour(echecs, jour) },
      { cle: 'deploiements', libelle: 'Déploiements',
        valeur: deploiements === null ? 'N/A' : deploiements.length,
        par_jour: deploiements === null ? 'N/A' : parJour(deploiements.length, jour),
        ...(deploiements === null ? { pourquoi: 'non lisible avec ce jeton' } : {}) },
      // Pas de moyenne par jour : la plateforme n'en affiche pas sous ce chiffre, et en
      // inventer une donnerait un nombre que personne ne peut retrouver à l'écran.
      { cle: 'taux_succes', libelle: 'Taux succès', valeur: `${taux} %`, par_jour: null },
      { cle: 'commits', libelle: 'Commits', valeur: commits.length,
        par_jour: parJour(commits.length, jour) }
    ],

    pipelines: { total, succes, echecs, autres, taux },
    branches: { total: branches.length, dormantes: dormantes.length, sans_date: sansDate,
                seuil_jours: SEUIL_BRANCHE_MORTE_J },
    mrs: {
      fusionnees: mrsFusionnees.length,
      ouvertes: mrsOuvertes.length,
      ouvertes_depuis_plus_de_7j: vieilles.length,
      // Les cinq plus vieilles, à partir de 2 jours : c'est le tableau du rapport, et il
      // n'a pas le même seuil que la pénalité. Deux seuils, deux usages.
      qui_trainent: agees.filter((mr) => mr.age >= SEUIL_MR_LISTEE_J)
        .slice(0, MAX_MR_LISTEES)
        .map((mr) => ({ numero: mr.numero, titre: mr.titre, auteur: mr.auteur || '',
                        jours: mr.age }))
    },
    branches_en_echec: branchesEnEchec,
    angles_morts: angles,

    methode: [
      `Fenêtre de ${jour} jours, bornes incluses.`,
      'Les pipelines, MR fusionnées, commits et déploiements sont pris sur la fenêtre ; '
        + 'les branches et les MR ouvertes sont prises telles qu\'elles sont aujourd\'hui.',
      'Le taux de succès divise les pipelines en succès par le TOTAL — annulés compris au '
        + 'dénominateur.',
      'Les moyennes par jour divisent par la fenêtre entière, pas par les jours actifs.',
      'Le Health Score part de 100 et ne fait que retirer : il ne récompense rien.'
    ]
  };

  return { ...r, texte: texteDaily(r) };
}

/*
 * ── LE CHAMP QUE J'AVAIS OUBLIÉ ─────────────────────────────────────────────
 *
 * C'est `texte` — et rien d'autre — que l'écran injecte dans le prompt. Un signal qui
 * n'en produit pas laisse `zone.value` à `undefined`, donc envoie un champ VIDE : l'agent
 * part quand même, répond quand même, et invente les chiffres qu'on ne lui a pas donnés.
 *
 * Exactement la faute que ce registre existe pour empêcher, introduite par l'oubli d'un
 * seul champ. Le test « chaque signal calculable rend un `texte` non vide » a été ajouté
 * dans la foulée : c'est un contrat entre les modules purs et l'écran, et un contrat qui
 * ne se vérifie qu'à l'œil finit par ne plus se vérifier.
 */
function texteDaily(r) {
  const l = [
    `Rapport ${r.fenetre.libelle.toLowerCase()} — ${r.depot}`,
    `Fenêtre : ${r.fenetre.jours} jours, du ${r.fenetre.du.slice(0, 10)} `
      + `au ${r.fenetre.au.slice(0, 10)}.`,
    ''
  ];

  l.push(`Health Score : ${r.sante.score} / 100 — ${r.sante.lecture}`);
  if (r.sante.intacte) {
    l.push('  Aucun des quatre défauts surveillés n\'a été détecté. Le calcul ne récompense '
      + 'rien : 100 est le maximum possible, pas une performance.');
  } else {
    for (const t of r.sante.retraits) l.push(`  −${t.points}  ${t.quoi}`);
    if (r.sante.hors_fenetre > 0) {
      l.push('', `  ATTENTION : ${r.sante.hors_fenetre} de ces points ne viennent PAS de la `
        + 'période couverte. Les branches dormantes et les MR anciennes décrivent l\'état '
        + 'actuel du dépôt, pas ce qui s\'est passé pendant la fenêtre.');
    }
  }
  if (!r.pipelines.total) {
    l.push('', '  Le taux de succès vaut 0 % faute de pipeline, PAS parce que des pipelines '
      + 'ont échoué. Le score est donc puni pour une absence de mesure.');
  }
  l.push('');

  l.push('Les six indicateurs :');
  for (const i of r.indicateurs) {
    const moyenne = i.par_jour === null ? '' : `   ${i.par_jour}/jour`;
    l.push(`  ${i.libelle.padEnd(16)} ${String(i.valeur).padStart(8)}${moyenne}`
      + (i.pourquoi ? `   — ${i.pourquoi}` : ''));
  }
  l.push('');

  l.push('Les pipelines :',
    `  ${r.pipelines.total} au total — ${r.pipelines.succes} en succès, `
      + `${r.pipelines.echecs} en échec, ${r.pipelines.autres} ni l'un ni l'autre `
      + '(annulés, en cours).',
    `  Taux de succès : ${r.pipelines.taux} % — les annulés sont AU DÉNOMINATEUR.`, '');

  if (r.branches_en_echec.length) {
    l.push('Les branches qui concentrent les échecs :');
    for (const b of r.branches_en_echec) l.push(`  ${b.echecs} échec(s)   ${b.branche}`);
    l.push('');
  }

  l.push('Les branches :',
    `  ${r.branches.total} au total, dont ${r.branches.dormantes} sans commit depuis plus `
      + `de ${r.branches.seuil_jours} jours.`
      + (r.branches.sans_date ? ` ${r.branches.sans_date} sans date connue.` : ''), '');

  l.push('Les merge requests :',
    `  ${r.mrs.fusionnees} fusionnée(s) sur la fenêtre. ${r.mrs.ouvertes} ouverte(s) `
      + `aujourd'hui, dont ${r.mrs.ouvertes_depuis_plus_de_7j} depuis plus de 7 jours.`);
  for (const mr of r.mrs.qui_trainent) {
    l.push(`  #${mr.numero}  ${mr.jours} jour(s)  ${mr.titre}`
      + (mr.auteur ? `  — ${mr.auteur}` : ''));
  }
  l.push('');

  l.push('Méthode :');
  for (const m of r.methode) l.push(`  · ${m}`);

  if (r.angles_morts.length) {
    l.push('', 'CE QUI N\'A PAS ÉTÉ MESURÉ :');
    for (const a of r.angles_morts) l.push(`  · ${a}`);
  }

  return l.join('\n');
}

/**
 * La ligne que le catalogue affiche sous le bouton, avant même de lancer l'agent.
 *
 * Elle doit dire s'il y a de quoi travailler. Un dépôt sans aucune activité sur la
 * fenêtre n'a pas besoin d'un appel à un modèle pour qu'on le sache — et le laisser
 * partir quand même donnerait un rapport qui commente le néant en cinq paragraphes.
 */
export function resumeDaily(r) {
  const p = r?.pipelines;
  if (!p) return 'aucune mesure';
  const rien = !p.total && !r.mrs.fusionnees && !r.indicateurs.find((i) => i.cle === 'commits').valeur;
  if (rien) return `aucune activité sur ${r.fenetre.jours} jours`;
  return `santé ${r.sante.score}/100 — ${r.sante.lecture} · ${p.total} pipeline(s) · `
       + `${p.taux} % de succès · ${r.mrs.fusionnees} MR fusionnée(s)`;
}

export default { SIGNAUX_DAILY, chiffresDaily, resumeDaily, FENETRES, PENALITES, SEUILS_SANTE, MAX_PIPELINES,
                 MAX_MR, MAX_COMMITS, MAX_DEPLOIEMENTS, SEUIL_BRANCHE_MORTE_J, SEUIL_MR_AGEE_J };
