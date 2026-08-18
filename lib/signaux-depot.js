/*
 * Le rapport d'un dépôt, et surtout SES CORRECTIONS À FAIRE.
 *
 * ── CE QU'ON REPRODUIT ───────────────────────────────────────────────────────
 *
 * `js/repo-analyzer.js`, fonction `generateQuickWins()` : vingt-cinq contrôles rangés en
 * quatre niveaux de gravité, plus le bus factor, le flow et le Health Score du module.
 *
 * C'est la seule chose que le Repo Analyzer produit et qu'aucun autre module ne fait. Le
 * reste de son écran — l'activité, les contributeurs, les branches — recoupe des agents
 * qui existent déjà. Les quick wins, non : ce sont des CONSTATS ACTIONNABLES, chacun avec
 * son geste et son ordre de priorité.
 *
 * ── LE HEALTH SCORE DE CE MODULE N'EST PAS CELUI DU DAILY ────────────────────
 *
 * Deux écrans de la même plateforme affichent un « Health Score », avec deux formules
 * incompatibles :
 *
 *   Daily Report     −20/−15 taux de succès · −15 branches dormantes · −10 MR anciennes
 *   Repo Analyzer    −40 aucun commit · −10 si ≥10 MR ouvertes · −15 si un seul auteur ≥80 %
 *
 * Le même dépôt peut valoir 65 ici et 100 là. On ne choisit pas : on reproduit les deux et
 * on les NOMME distinctement, comme on a fait pour les autres divergences. Arbitrer entre
 * deux écrans de la plateforme n'est pas notre rôle ; les rendre comparables l'est.
 *
 * ── CE QUI N'EST PAS MESURABLE, ET QUI EST DIT ──────────────────────────────
 *
 * Un seul des vingt-cinq contrôles réclame une lecture que la forge ne fait pas : les
 * approbations d'une merge request fusionnée (`upvotes`). Il est déclaré non mesuré plutôt
 * que compté comme conforme — une revue qu'on n'a pas vue n'est pas une revue qui a eu
 * lieu.
 *
 * Module PUR : ni forge, ni DOM, ni horloge. `maintenant` est fourni.
 */

/* ── Les niveaux, dans l'ordre du module ──────────────────────────────────── */

export const NIVEAUX = {
  critique:    { rang: 0, libelle: 'Critique',   quoi: 'sécurité et risques majeurs' },
  urgent:      { rang: 1, libelle: 'Urgent',     quoi: 'ce qui bloque l\'équipe aujourd\'hui' },
  important:   { rang: 2, libelle: 'Important',  quoi: 'les pratiques qui dérivent' },
  amelioration:{ rang: 3, libelle: 'Amélioration', quoi: 'ce qui rendrait le dépôt plus lisible' }
};

/* ── Les seuils, tous extraits ────────────────────────────────────────────── */

export const SEUILS = {
  bus_critique: 90,          // un seul auteur ≥ 90 % des commits
  bus_eleve: 70,             // entre 70 et 90
  mr_abandonnee_j: 30,
  mr_ancienne_j: 7,
  branche_morte_j: 90,
  branche_stale_j: 30,       // entre 30 et 90
  branches_actives_max: 10,
  echecs_part: 0.3,          // ≥ 30 % de pipelines en échec
  commits_non_standards: 0.7,
  hors_horaires: 0.3,
  contributeurs_contributing: 2,
  contributeurs_codeowners: 3,
  mr_sans_etiquette_min: 2,
  commits_min: 10
};

/** Les branches que le module ne juge jamais : ce sont les branches de tronc. */
export const BRANCHES_DE_TRONC = ['main', 'master', 'develop', 'dev'];

/** Les préfixes de branche que le module accepte, verbatim. */
export const PREFIXES_ACCEPTES = ['feature/', 'feat/', 'feature_', 'fix/', 'bugfix/',
                                  'hotfix/', 'release/', 'chore/'];

/** Les branches produites par un robot, exclues du contrôle de nommage. */
export const ROBOTS = ['renovate', 'dependabot'];

/** Le motif des Conventional Commits, verbatim. */
export const CONVENTIONNEL = /^(feat|fix|docs|style|refactor|test|chore|build|ci)(\(.+\))?:/;

/** Où vit une configuration de CI, selon la forge. */
export const CONFIGS_CI = ['.gitlab-ci.yml', '.github/workflows', 'jenkinsfile',
                           'azure-pipelines.yml'];

const JOUR_MS = 86400000;
const jours = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / JOUR_MS;
const dateValide = (v) => v && !Number.isNaN(new Date(v).getTime());
const estTronc = (nom) => BRANCHES_DE_TRONC.includes(String(nom || '').toLowerCase());

/* ── Le bus factor ────────────────────────────────────────────────────────── */

/**
 * La part du plus gros contributeur.
 *
 * ── UNE DIVERGENCE DÉCLARÉE ─────────────────────────────────────────────────
 *
 * Le module lit `/repository/contributors`, qui compte les commits de TOUT l'historique en
 * un appel. Notre couche de forge n'expose pas cette route : on compte donc sur la page de
 * commits qu'on a lue, c'est-à-dire une fenêtre récente.
 *
 * Ce n'est pas le même chiffre, et il n'est pas moins vrai — il est même souvent plus
 * utile : un dépôt repris par une nouvelle équipe a un bus factor historique rassurant et
 * un bus factor récent alarmant, et c'est le second qui décrit le risque d'aujourd'hui.
 * Mais il DOIT être annoncé, sinon deux écrans donnent deux pourcentages sans explication.
 */
export function busFactor(commits = []) {
  const parAuteur = new Map();
  for (const c of commits) {
    const a = String(c.author || c.auteur || '').trim();
    if (!a) continue;
    parAuteur.set(a, (parAuteur.get(a) || 0) + 1);
  }
  const total = [...parAuteur.values()].reduce((s, n) => s + n, 0);
  if (!total) return { nom: '', part: 0, auteurs: 0, commits: 0 };

  const [nom, n] = [...parAuteur.entries()].sort((a, b) => b[1] - a[1])[0];
  return { nom, part: Math.round((n / total) * 100), auteurs: parAuteur.size, commits: total };
}

/**
 * Les branches de développement RÉELLEMENT présentes. Vide quand il n'y en a pas.
 *
 * Séparée de la détection pour une raison précise : le texte du rapport doit pouvoir
 * NOMMER ce qu'il a vu. Il annonçait « d'après la présence d'une branche `develop` » quel
 * que soit le résultat — donc en affirmant l'existence d'une branche sur un dépôt qui n'en
 * avait aucune. Une liste, vide ou nommée, rend cette phrase impossible à écrire de
 * travers.
 */
export const branchesDeDev = (noms = []) =>
  noms.map((n) => String(n || '').toLowerCase()).filter((n) => n === 'develop' || n === 'dev');

/**
 * Le flow, détecté comme le module le détecte : la présence d'une branche `develop`.
 *
 * C'est grossier, et c'est reproduit tel quel. « Trunk-based » n'est jamais détecté par ce
 * code — la valeur existe dans l'affichage mais aucune branche n'y mène. On ne comble pas
 * le trou : un flow inventé serait un conseil donné sur une observation qui n'a pas eu
 * lieu.
 */
export function flowDetecte(branches = []) {
  return branchesDeDev(branches.map((b) => b.name)).length ? 'gitflow' : 'feature-branching';
}

/* ── Le flow OBSERVÉ — au-delà de ce que le module regarde ────────────────── */

/*
 * ── CE QUI SUIT N'EST PAS EXTRAIT, ET C'EST DIT ─────────────────────────────
 *
 * Tout le reste de ce fichier reproduit `js/repo-analyzer.js`. Cette section-ci va
 * DÉLIBÉRÉMENT plus loin, et il faut que ça se voie : les constats qu'elle produit portent
 * `origine: 'observation'`, les vingt-cinq autres portent `origine: 'repo-analyzer'`.
 *
 * La raison est que `detectFlow()` ne regarde qu'une chose — l'existence d'une branche
 * `develop` — et en conclut « GitFlow ». C'est un flow DÉCLARÉ. Une équipe peut très bien
 * avoir une branche `develop` que plus personne ne cible depuis six mois : l'écran affiche
 * alors « GitFlow bien appliqué », et c'est faux.
 *
 * Ce qu'on ajoute est le flow PRATIQUÉ : où vont réellement les merge requests, combien de
 * temps vivent les branches, et ce qui arrive sur le tronc sans passer par une revue. Ce
 * sont trois observations, toutes calculables avec ce qu'on lit déjà — aucun appel de plus.
 */

/** Un commit dont le message porte la trace d'une fusion. */
const MOTIFS_FUSION = [
  /^Merge branch /i,
  /^Merge pull request #\d+/i,
  /^Merge remote-tracking branch /i,
  /^Merge tag /i,
  // GitHub ajoute « (#123) » au titre d'un squash. GitLab, non — voir l'avertissement.
  /\(#\d+\)\s*$/
];

export const estUneFusion = (message) =>
  MOTIFS_FUSION.some((m) => m.test(String(message || '').split('\n')[0].trim()));

/** La médiane d'une liste de nombres. Vide → `null`, jamais 0. */
export function mediane(valeurs = []) {
  const v = valeurs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Ce que le dépôt FAIT, par opposition à ce qu'il déclare.
 *
 * @param {Array}  branches
 * @param {Array}  mrsFusionnees  avec `ouvert`, `fusionne` et `cible`
 * @param {Array}  mrsOuvertes
 * @param {Array}  commits        ceux de la branche PAR DÉFAUT
 * @param {string} defaut         le nom de cette branche
 */
export function flowObserve({ branches = [], mrsFusionnees = [], mrsOuvertes = [],
                              commits = [], defaut = '' } = {}) {
  const declare = flowDetecte(branches);

  /* Où vont les merge requests. */
  const toutes = [...mrsFusionnees, ...mrsOuvertes].filter((m) => m.cible);
  const parCible = new Map();
  for (const m of toutes) parCible.set(m.cible, (parCible.get(m.cible) || 0) + 1);
  const cibles = [...parCible.entries()]
    .map(([cible, n]) => ({ cible, n, part: Math.round((n / toutes.length) * 100) }))
    .sort((a, b) => b.n - a.n);

  /*
   * Le flow pratiqué.
   *
   * `develop` existe et reçoit des merge requests → GitFlow est vraiment appliqué.
   * `develop` existe et n'en reçoit pas → il est déclaré et abandonné, ce qui est PIRE
   * qu'un feature branching assumé : la branche traîne, diverge, et on croit avoir un
   * garde-fou qu'on n'a plus.
   */
  const versDev = cibles.filter((c) => ['develop', 'dev'].includes(c.cible.toLowerCase()))
    .reduce((s, c) => s + c.n, 0);
  const pratique = !toutes.length ? null
    : (versDev > 0 && versDev >= toutes.length * 0.2 ? 'gitflow' : 'feature-branching');

  /* Combien de temps vit une branche, mesuré sur les MR fusionnées. */
  const durees = mrsFusionnees
    .filter((m) => m.ouvert && m.fusionne)
    .map((m) => jours(m.fusionne, m.ouvert))
    .filter((d) => Number.isFinite(d) && d >= 0);
  const vie = mediane(durees);

  /*
   * Ce qui arrive sur le tronc sans trace de fusion.
   *
   * ── LA LIMITE, ET ELLE EST SÉRIEUSE ────────────────────────────────────────
   *
   * Un dépôt configuré pour ÉCRASER les commits à la fusion (squash) sans référence à la
   * merge request produit, sur le tronc, des commits qui ressemblent en tout point à des
   * pushs directs. GitHub ajoute « (#123) » au titre et reste détectable ; GitLab, par
   * défaut, non.
   *
   * Ce compte est donc un MAJORANT, jamais un compte. Le signal l'écrit, et le prompt a
   * interdiction de le présenter comme une mesure.
   */
  const surLeTronc = commits.length;
  const sansFusion = commits.filter((c) => !estUneFusion(c.message)).length;

  return {
    declare,
    /*
     * CE QU'ON A VU, pas le résumé du critère.
     *
     * Le texte se contentait d'annoncer « d'après la présence d'une branche `develop` »,
     * quel que soit le résultat — donc en affirmant l'existence d'une branche sur un dépôt
     * qui n'en a pas. Porter la LISTE observée rend la phrase impossible à écrire de
     * travers : elle est vide, ou elle nomme.
     */
    branches_de_dev: branchesDeDev(branches.map((b) => b.name)),
    pratique,
    accord: pratique === null ? null : declare === pratique,
    cibles: cibles.slice(0, 6),
    mrs_observees: toutes.length,
    duree_vie_mediane_j: vie === null ? null : Math.round(vie * 10) / 10,
    duree_vie_sur: durees.length,
    tronc: { branche: defaut, commits: surLeTronc, sans_trace_de_fusion: sansFusion,
             part: surLeTronc ? Math.round((sansFusion / surLeTronc) * 100) : null }
  };
}

/* ── Les constats ─────────────────────────────────────────────────────────── */

/*
 * `origine` distingue les vingt-cinq contrôles EXTRAITS du module de ce qu'on ajoute.
 *
 * Sans elle, un rapport mélangerait ce que la plateforme constate et ce que le registre
 * observe en plus, sous la même autorité. Quelqu'un qui irait vérifier sur l'écran du Repo
 * Analyzer ne retrouverait pas la moitié des constats, et conclurait que le registre
 * invente — alors qu'il regarde simplement une chose de plus.
 */
const constat = (niveau, cle, titre, quoi, geste, extra = {}) =>
  ({ niveau, cle, titre, quoi, geste, origine: 'repo-analyzer', ...extra });

const observe = (niveau, cle, titre, quoi, geste, extra = {}) =>
  ({ niveau, cle, titre, quoi, geste, ...extra, origine: 'observation' });

/**
 * Les corrections à faire, du plus grave au moins grave.
 *
 * @param {string} depot
 * @param {object} info        { defaut, visibilite }
 * @param {Array}  branches    [{ name, protectee, quand, default }]
 * @param {Array}  chemins     l'arbre du dépôt
 * @param {Array}  commits     [{ message, author, date }]
 * @param {Array}  mrsOuvertes [{ numero, titre, ouvert, description, conflits, relecteurs, etiquettes }]
 * @param {Array}  mrsFusionnees
 * @param {Array}  pipelines   [{ statut, branche, quand }]
 * @param {string} maintenant
 */
export function rapportDepot({ depot = '', info = {}, branches = [], chemins = [],
                               commits = [], mrsOuvertes = [], mrsFusionnees = [],
                               pipelines = [], maintenant = new Date().toISOString(),
                               tronque = {} } = {}) {
  const constats = [];
  const angles = [];

  const racine = chemins.filter((c) => !String(c).includes('/')).map((c) => String(c).toLowerCase());
  const tous = chemins.map((c) => String(c).toLowerCase());
  const bus = busFactor(commits);

  const datees = branches.filter((b) => dateValide(b.quand));
  const sansDate = branches.length - datees.length;
  const ageDe = (b) => Math.floor(jours(maintenant, b.quand));
  const horsTronc = datees.filter((b) => !estTronc(b.name));

  /* ── Critique ───────────────────────────────────────────────────────────── */

  /*
   * La branche par défaut non protégée.
   *
   * Le module cherche `main` ou `master` dans les branches protégées. On regarde la
   * branche PAR DÉFAUT telle que la forge la déclare : un dépôt dont le tronc s'appelle
   * `production` passait au travers du contrôle d'origine, faute d'être dans la liste.
   */
  const defaut = branches.find((b) => b.default) || branches.find((b) => estTronc(b.name));
  if (defaut && !defaut.protectee) {
    constats.push(constat('critique', 'main_non_protegee',
      `Protéger la branche \`${defaut.name}\``,
      'La branche principale n\'est pas protégée : n\'importe qui peut y pousser '
        + 'directement, sans revue ni pipeline.',
      'Réglages du dépôt → branches protégées. Deux minutes.'));
  }

  const aDesPipelines = pipelines.length > 0;
  const aUneConfigCi = CONFIGS_CI.some((c) => tous.some((f) => f === c || f.startsWith(`${c}/`)));
  if (!aDesPipelines && !aUneConfigCi) {
    constats.push(constat('critique', 'pas_de_ci', 'Configurer une intégration continue',
      'Aucun pipeline et aucun fichier de CI : rien n\'est construit ni testé '
        + 'automatiquement.',
      'Ajouter un fichier de CI à la racine, même minimal — un job qui lance les tests.'));
  }

  if (bus.part >= SEUILS.bus_critique) {
    constats.push(constat('critique', 'bus_factor_critique', 'Bus factor critique',
      `${bus.nom} porte ${bus.part} % des commits lus. Si cette personne s'arrête, `
        + 'plus personne ne connaît ce dépôt.',
      'Faire relire les prochaines merge requests par quelqu\'un d\'autre, et documenter '
        + 'les zones que cette personne est seule à toucher.',
      { part: bus.part, qui: bus.nom }));
  }

  const abandonnees = mrsOuvertes.filter((m) => dateValide(m.ouvert)
    && jours(maintenant, m.ouvert) > SEUILS.mr_abandonnee_j);
  if (abandonnees.length) {
    constats.push(constat('critique', 'mr_abandonnees',
      `Trancher ${abandonnees.length} merge request(s) abandonnée(s)`,
      `Ouvertes depuis plus de ${SEUILS.mr_abandonnee_j} jours. Une MR de cet âge ne se `
        + 'fusionne plus : elle a divergé, et elle occupe l\'écran de tout le monde.',
      'Fermer, ou reprendre et fusionner cette semaine. Ne pas laisser en l\'état.',
      { elements: abandonnees.slice(0, 8).map((m) => ({ numero: m.numero, titre: m.titre,
          auteur: m.auteur || '', jours: Math.floor(jours(maintenant, m.ouvert)) })) }));
  }

  const mortes = horsTronc.filter((b) => ageDe(b) > SEUILS.branche_morte_j);
  if (mortes.length) {
    constats.push(constat('critique', 'branches_mortes',
      `Supprimer ${mortes.length} branche(s) morte(s)`,
      `Sans commit depuis plus de ${SEUILS.branche_morte_j} jours.`,
      'Supprimer après avoir vérifié qu\'elles sont fusionnées. Une branche morte cache '
        + 'les vivantes.',
      { elements: mortes.slice(0, 10).map((b) => ({ nom: b.name, jours: ageDe(b) })) }));
  }

  /* ── Urgent ─────────────────────────────────────────────────────────────── */

  const enConflit = mrsOuvertes.filter((m) => m.conflits);
  if (enConflit.length) {
    constats.push(constat('urgent', 'mr_en_conflit',
      `Résoudre ${enConflit.length} conflit(s) de fusion`,
      'Ces merge requests ne peuvent pas être fusionnées en l\'état.',
      'Rebaser sur la branche cible. Plus on attend, plus le conflit grossit.',
      { elements: enConflit.slice(0, 8).map((m) => ({ numero: m.numero, titre: m.titre })) }));
  }

  const anciennes = mrsOuvertes.filter((m) => dateValide(m.ouvert)
    && jours(maintenant, m.ouvert) > SEUILS.mr_ancienne_j
    && jours(maintenant, m.ouvert) <= SEUILS.mr_abandonnee_j);
  if (anciennes.length) {
    constats.push(constat('urgent', 'mr_en_attente',
      `Relire ${anciennes.length} merge request(s) en attente`,
      `Ouvertes depuis plus de ${SEUILS.mr_ancienne_j} jours et pas encore abandonnées : `
        + 'ce sont celles qu\'on peut encore rattraper.',
      'Bloquer trente minutes pour les relire. C\'est le geste qui débloque le plus de monde.',
      { elements: anciennes.slice(0, 8).map((m) => ({ numero: m.numero, titre: m.titre,
          auteur: m.auteur || '', jours: Math.floor(jours(maintenant, m.ouvert)) })) }));
  }

  const sansRelecteur = mrsOuvertes.filter((m) => !(m.relecteurs || []).length);
  if (sansRelecteur.length) {
    constats.push(constat('urgent', 'mr_sans_relecteur',
      `Assigner un relecteur à ${sansRelecteur.length} merge request(s)`,
      'Sans relecteur désigné, personne n\'est responsable de la revue — et elle n\'a pas '
        + 'lieu.',
      'Assigner quelqu\'un, nommément. « L\'équipe » n\'est pas un relecteur.',
      { elements: sansRelecteur.slice(0, 8).map((m) => ({ numero: m.numero, titre: m.titre })) }));
  }

  const stales = horsTronc.filter((b) => ageDe(b) > SEUILS.branche_stale_j
    && ageDe(b) <= SEUILS.branche_morte_j);
  if (stales.length) {
    constats.push(constat('urgent', 'branches_stale',
      `Trancher ${stales.length} branche(s) qui dorment`,
      `Sans commit depuis ${SEUILS.branche_stale_j} à ${SEUILS.branche_morte_j} jours : `
        + 'encore rattrapables, bientôt mortes.',
      'Reprendre ou supprimer. C\'est maintenant que ça coûte le moins cher.',
      { elements: stales.slice(0, 10).map((b) => ({ nom: b.name, jours: ageDe(b) })) }));
  }

  const echecs = pipelines.filter((p) => p.statut === 'echec');
  if (echecs.length && pipelines.length
      && echecs.length >= pipelines.length * SEUILS.echecs_part) {
    constats.push(constat('urgent', 'pipelines_en_echec', 'La CI échoue trop souvent',
      `${echecs.length} pipeline(s) en échec sur ${pipelines.length} lus, soit `
        + `${Math.round((echecs.length / pipelines.length) * 100)} %. Au-delà de `
        + `${Math.round(SEUILS.echecs_part * 100)} %, l'équipe cesse de regarder la CI.`,
      'Regarder le dernier échec et le réparer avant d\'ajouter des tests. Une CI rouge '
        + 'en permanence ne protège plus de rien.'));
  }

  /* ── Important ──────────────────────────────────────────────────────────── */

  const malNommees = branches.filter((b) => {
    const nom = String(b.name || '').toLowerCase();
    if (estTronc(nom)) return false;
    if (ROBOTS.some((r) => nom.includes(r))) return false;
    return !PREFIXES_ACCEPTES.some((p) => nom.startsWith(p));
  });
  if (malNommees.length) {
    constats.push(constat('important', 'nommage_branches',
      `${malNommees.length} branche(s) hors convention`,
      `Elles ne commencent par aucun des préfixes attendus (${PREFIXES_ACCEPTES.join(', ')}).`,
      'Renommer les branches actives. Les mortes se suppriment plutôt qu\'elles ne se '
        + 'renomment.',
      { elements: malNommees.slice(0, 10).map((b) => ({ nom: b.name })) }));
  }

  const sansDescription = mrsOuvertes.filter((m) => String(m.description || '').trim().length < 10);
  if (sansDescription.length) {
    constats.push(constat('important', 'mr_sans_description',
      `Documenter ${sansDescription.length} merge request(s)`,
      'Description vide ou de moins de dix caractères. Le relecteur doit alors deviner '
        + 'l\'intention à partir du diff.',
      'Deux phrases : ce que ça change, et pourquoi.',
      { elements: sansDescription.slice(0, 8).map((m) => ({ numero: m.numero, titre: m.titre })) }));
  }

  const sansEtiquette = mrsOuvertes.filter((m) => !(m.etiquettes || []).length);
  if (sansEtiquette.length > SEUILS.mr_sans_etiquette_min) {
    constats.push(constat('important', 'mr_sans_etiquette',
      `Étiqueter ${sansEtiquette.length} merge request(s)`,
      'Sans étiquette, on ne peut ni filtrer ni prioriser une file de merge requests.',
      'Poser au moins le type : correctif, fonctionnalité, technique.'));
  }

  if (bus.part >= SEUILS.bus_eleve && bus.part < SEUILS.bus_critique) {
    constats.push(constat('important', 'bus_factor_eleve', 'Bus factor élevé',
      `${bus.nom} porte ${bus.part} % des commits lus. Ce n'est pas encore critique, `
        + 'mais la connaissance se concentre.',
      'Répartir les prochaines tâches sur ce périmètre.',
      { part: bus.part, qui: bus.nom }));
  }

  const messages = commits.map((c) => String(c.message || '').split('\n')[0]);
  const nonStandards = messages.filter((m) => !CONVENTIONNEL.test(m));
  if (messages.length > SEUILS.commits_min
      && nonStandards.length > messages.length * SEUILS.commits_non_standards) {
    constats.push(constat('important', 'commits_non_standards',
      'Adopter des messages de commit normalisés',
      `${nonStandards.length} des ${messages.length} commits lus ne suivent pas le format `
        + '`type: description`. Une note de version automatique devient impossible.',
      'Commencer par `feat:`, `fix:`, `chore:`. Le reste suit tout seul.'));
  }

  const actives = horsTronc.filter((b) => ageDe(b) <= SEUILS.branche_stale_j);
  if (actives.length > SEUILS.branches_actives_max) {
    constats.push(constat('important', 'trop_de_branches',
      `${actives.length} branches actives en parallèle`,
      `Au-delà de ${SEUILS.branches_actives_max}, les fusions deviennent coûteuses et les `
        + 'conflits fréquents.',
      'Fusionner ou fermer les plus anciennes avant d\'en ouvrir de nouvelles.'));
  }

  /* ── Amélioration ───────────────────────────────────────────────────────── */

  const aLaRacine = (prefixe) => racine.some((f) => f.startsWith(prefixe));

  if (!aLaRacine('readme')) {
    constats.push(constat('amelioration', 'pas_de_readme', 'Créer un README',
      'Rien à la racine ne dit à quoi sert ce dépôt.',
      'Cinq lignes suffisent : à quoi ça sert, comment on le lance, qui le tient.'));
  }
  if (!aLaRacine('contributing') && bus.auteurs > SEUILS.contributeurs_contributing) {
    constats.push(constat('amelioration', 'pas_de_contributing', 'Créer un CONTRIBUTING.md',
      `${bus.auteurs} personnes contribuent, et rien n'écrit comment on travaille ici.`,
      'Le format des branches, celui des commits, qui relit quoi.'));
  }
  if (!racine.includes('.gitignore')) {
    constats.push(constat('amelioration', 'pas_de_gitignore', 'Ajouter un .gitignore',
      'Sans lui, des artefacts de construction et des fichiers locaux finissent au dépôt — '
        + 'parfois avec des secrets dedans.',
      'Partir d\'un modèle pour la technologie du projet.'));
  }
  if (!tous.some((f) => f.endsWith('codeowners')) && bus.auteurs > SEUILS.contributeurs_codeowners) {
    constats.push(constat('amelioration', 'pas_de_codeowners', 'Créer un CODEOWNERS',
      `${bus.auteurs} personnes contribuent : sans propriétaires déclarés, la revue échoit `
        + 'à qui passe par là.',
      'Une ligne par répertoire important, avec l\'équipe responsable.'));
  }
  if (mrsOuvertes.length
      && !tous.some((f) => f.includes('merge_request_template') || f.includes('pull_request_template'))) {
    constats.push(constat('amelioration', 'pas_de_modele_mr',
      'Ajouter un modèle de merge request',
      'Chaque MR est décrite différemment, donc relue différemment.',
      'Un modèle avec trois questions : ce que ça change, comment le tester, ce que ça '
        + 'risque de casser.'));
  }

  /*
   * Les commits hors horaires.
   *
   * Le module lit l'heure LOCALE de la machine qui affiche. Ici, faute de fuseau connu,
   * on lit l'heure UTC — et on le dit. À une heure près, le constat ne change pas de
   * nature ; l'annoncer évite qu'on cherche pourquoi les deux écrans diffèrent.
   */
  const horsHoraires = commits.filter((c) => {
    if (!dateValide(c.date)) return false;
    const d = new Date(c.date);
    const h = d.getUTCHours();
    const j = d.getUTCDay();
    return h < 8 || h > 20 || j === 0 || j === 6;
  });
  if (commits.length > SEUILS.commits_min
      && horsHoraires.length > commits.length * SEUILS.hors_horaires) {
    const part = Math.round((horsHoraires.length / commits.length) * 100);
    constats.push(constat('amelioration', 'hors_horaires',
      `${part} % des commits hors horaires de bureau`,
      'Soirs et week-ends. C\'est un signal d\'organisation, pas un reproche : il indique '
        + 'souvent une charge mal répartie ou des livraisons contraintes.',
      'À regarder en rétrospective, pas à corriger dans le code.',
      { part }));
  }

  /* ── Le flow observé — au-delà des vingt-cinq contrôles ─────────────────── */

  const flow = flowObserve({ branches, mrsFusionnees, mrsOuvertes, commits,
                             defaut: info.defaut || defaut?.name || '' });

  /*
   * Le constat le plus utile de cette section, et il n'existe nulle part dans la
   * plateforme : `develop` est là, et personne ne la cible.
   *
   * C'est PIRE qu'un feature branching assumé. La branche traîne, diverge, et l'écran
   * annonce « GitFlow bien appliqué » — on croit avoir un garde-fou qu'on n'a plus.
   */
  if (flow.declare === 'gitflow' && flow.pratique === 'feature-branching') {
    constats.push(observe('important', 'flow_declare_non_pratique',
      'Une branche `develop` que plus personne ne cible',
      `Le dépôt a une branche de développement — donc la plateforme affiche « GitFlow » — `
        + `mais sur ${flow.mrs_observees} merge request(s) observée(s), presque aucune ne la `
        + 'vise. Le modèle est déclaré, pas pratiqué.',
      'Trancher : soit on rétablit le passage par `develop`, soit on la supprime. Une '
        + 'branche de tronc abandonnée finit par diverger au point d\'être infusionnable.',
      { cibles: flow.cibles }));
  }

  /*
   * ── UN CONSTAT QUE J'AI DÛ REFAIRE, ET LA RAISON VAUT D'ÊTRE ÉCRITE ───────
   *
   * Première version : « plus de la moitié des commits du tronc ne portent aucune trace de
   * fusion ». Elle s'est déclenchée sur le dépôt SAIN du jeu d'essai, et c'était le test
   * qui avait raison — la mesure est un majorant, pas un compte. Un dépôt qui écrase ses
   * commits à la fusion sans référencer la merge request produit, sur le tronc, des
   * commits indiscernables d'un push direct. Sur GitLab c'est le comportement par défaut.
   *
   * Un constat qui se déclenche sur la configuration par défaut d'une forge entière n'est
   * pas un constat : c'est du bruit, et au deuxième faux positif l'équipe cesse de lire la
   * liste.
   *
   * Ce qu'on garde est SANS AMBIGUÏTÉ : du travail arrive sur le tronc, et AUCUNE merge
   * request n'a été fusionnée. Là, aucun mode de fusion n'explique quoi que ce soit — il
   * n'y a simplement pas de revue. Le pourcentage de traces reste dans la matière, en
   * information, avec son avertissement.
   */
  if (flow.tronc.commits >= SEUILS.commits_min && !mrsFusionnees.length) {
    constats.push(observe('urgent', 'travail_sans_revue',
      `${flow.tronc.commits} commits sur \`${flow.tronc.branche}\`, aucune merge request fusionnée`,
      'Le travail arrive sur le tronc sans passer par une revue. Ce n\'est pas une question '
        + 'de mode de fusion : il n\'y a aucune merge request à fusionner.',
      'Protéger la branche par défaut. Tant qu\'elle est ouverte, la revue reste facultative '
        + 'et donc facultative pour de bon.',
      { commits: flow.tronc.commits }));
  }

  /*
   * Les branches qui vivent trop longtemps.
   *
   * Sept jours : c'est le seuil que le module lui-même retient pour dire qu'une merge
   * request « attend ». On l'applique à la durée de vie médiane plutôt qu'à des cas
   * isolés — une médiane au-dessus d'une semaine décrit une pratique, pas un accident.
   */
  if (flow.duree_vie_mediane_j !== null && flow.duree_vie_sur >= 5
      && flow.duree_vie_mediane_j > SEUILS.mr_ancienne_j) {
    constats.push(observe('important', 'branches_qui_vivent_trop',
      `Une branche vit ${flow.duree_vie_mediane_j} jours en médiane`,
      `Mesuré sur ${flow.duree_vie_sur} merge request(s) fusionnée(s). Au-delà d'une `
        + 'semaine, une branche diverge du tronc et la fusion coûte plus cher que le '
        + 'changement lui-même.',
      'Découper les changements plus petit. C\'est le geste qui fait baisser le lead time '
        + 'et les conflits en même temps.',
      { jours: flow.duree_vie_mediane_j }));
  }

  angles.push('Les approbations des merge requests fusionnées ne sont pas lues : la forge '
    + 'demande un appel par MR. Le contrôle « fusionnée sans approbation » du module '
    + 'd\'origine est donc ABSENT ici — ne pas conclure qu\'il est satisfait.');

  if (sansDate > 0) {
    angles.push(`${sansDate} branche(s) sans date de dernier commit : elles ne comptent ni `
      + 'comme actives ni comme mortes. Les contrôles sur les branches sont donc des '
      + 'minorants.');
  }
  for (const [cle, quoi] of [['commits', 'commits'], ['mrs', 'merge requests'],
                             ['pipelines', 'pipelines']]) {
    if (tronque[cle]) {
      angles.push(`La liste des ${quoi} a atteint le plafond de lecture : les comptes sont `
        + 'des minimums, et les proportions portent sur l\'échantillon lu.');
    }
  }

  constats.sort((a, b) => NIVEAUX[a.niveau].rang - NIVEAUX[b.niveau].rang);

  const parNiveau = Object.fromEntries(Object.keys(NIVEAUX).map((n) =>
    [n, constats.filter((c) => c.niveau === n).length]));

  /*
   * Le Health Score du Repo Analyzer — reproduit, et NOMMÉ.
   *
   * Rien à voir avec celui du Daily Report. Les afficher tous deux sous le même mot sans
   * les distinguer serait la meilleure façon de faire perdre confiance aux deux.
   */
  let sante = 100;
  const retraits = [];
  if (!commits.length) { sante -= 40; retraits.push({ points: 40, quoi: 'aucun commit lu sur la période' }); }
  if (mrsOuvertes.length >= 10) { sante -= 10; retraits.push({ points: 10, quoi: '10 merge requests ouvertes ou plus' }); }
  if (bus.part >= 80) { sante -= 15; retraits.push({ points: 15, quoi: `un seul auteur porte ${bus.part} % des commits` }); }
  sante = Math.max(0, Math.min(100, sante));

  const r = {
    depot,
    branche_defaut: info.defaut || defaut?.name || '',
    visibilite: info.visibilite || '',
    flow: flowDetecte(branches),
    flow_observe: flow,
    // Repris tel quel pour que le CONTRIBUTING proposé cite la convention
    // RÉELLEMENT contrôlée, et non une liste réécrite à côté.
    prefixes_acceptes: PREFIXES_ACCEPTES,

    sante: { score: sante, sur: 100, retraits, nom: 'Health Score (Repo Analyzer)',
             /*
              * Ce champ existe pour être RECOPIÉ dans le texte : c'est la phrase qui évite
              * qu'on compare deux chiffres qui ne mesurent pas la même chose.
              */
             attention: 'Ce score n\'est PAS celui du Daily Report : formules différentes, '
                      + 'périmètres différents. Les deux sont justes, ils ne répondent pas '
                      + 'à la même question.' },

    bus: { qui: bus.nom, part: bus.part, auteurs: bus.auteurs, commits: bus.commits,
           sur: 'les commits lus, pas tout l\'historique' },

    compte: { total: constats.length, ...parNiveau },
    constats,
    angles_morts: angles,

    methode: [
      'Vingt-cinq contrôles, rangés en quatre niveaux de gravité, repris du module Repo '
        + 'Analyzer de la plateforme.',
      'Les branches de tronc (main, master, develop, dev) ne sont jamais jugées sur leur '
        + 'nom ni sur leur âge.',
      'Les branches de robots (renovate, dependabot) sont exclues du contrôle de nommage.',
      'Le bus factor est calculé sur les commits LUS — une fenêtre récente — et non sur '
        + 'tout l\'historique comme le fait l\'écran de la plateforme.',
      'Les constats marqués [observé en plus] ne viennent PAS du module : ils portent sur '
        + 'le flow réellement pratiqué, que l\'écran ne regarde pas. Ne pas s\'attendre à '
        + 'les retrouver sur la page du Repo Analyzer.'
    ]
  };

  return { ...r, texte: texteDepot(r) };
}

/* ── Le texte ─────────────────────────────────────────────────────────────── */

function texteDepot(r) {
  const l = [
    `État du dépôt — ${r.depot}`,
    `Branche par défaut : ${r.branche_defaut || 'inconnue'}`
      + (r.visibilite ? ` · ${r.visibilite}` : '')
      + ` · flow détecté : ${r.flow}`,
    ''
  ];

  l.push(`${r.sante.nom} : ${r.sante.score} / 100`);
  for (const t of r.sante.retraits) l.push(`  −${t.points}  ${t.quoi}`);
  l.push(`  ${r.sante.attention}`, '');

  l.push(`Bus factor : ${r.bus.part} % pour ${r.bus.qui || 'personne'}`
    + ` — ${r.bus.auteurs} auteur(s) sur ${r.bus.commits} commit(s) lus.`,
    `  Calculé sur ${r.bus.sur}.`, '');

  /*
   * ── LA LIGNE QUI A MENTI ────────────────────────────────────────────────
   *
   * Elle disait, quel que soit le résultat : « d'après la seule présence d'une branche
   * `develop` ». Or `flowDetecte()` rend `feature-branching` quand cette branche est
   * ABSENTE. Sur un dépôt sans `develop`, la matière affirmait donc qu'il en existait une.
   *
   * Le modèle a repris la phrase telle quelle — c'est exactement ce qu'on lui demande de
   * faire — et a écrit noir sur blanc « une branche `develop` existe » sur un dépôt qui
   * n'en a pas. Ce n'est pas une hallucination : c'est la couche déterministe qui a
   * fourni un fait faux, et l'agent qui l'a fidèlement amplifié.
   *
   * La leçon vaut d'être écrite ici : une consigne qui interdit d'inventer ne protège de
   * rien si la matière, elle, se trompe. Le texte dit désormais ce qui a été OBSERVÉ, pas
   * un résumé du critère.
   */
  const f = r.flow_observe;
  l.push('Le flow, déclaré et pratiqué :',
    `  Déclaré  : ${f.declare}`,
    '             Seul critère du module : l\'existence d\'une branche `develop` ou `dev`.',
    `             Ici : ${f.branches_de_dev.length
      ? `\`${f.branches_de_dev.join('`, `')}\` existe.`
      : 'AUCUNE des deux n\'existe.'}`,
    `  Pratiqué : ${f.pratique || 'non observable'}`
      + (f.mrs_observees ? ` — sur ${f.mrs_observees} merge request(s)` : ''));
  if (f.cibles.length) {
    l.push(`  Cibles   : ${f.cibles.map((c) => `${c.cible} ${c.part} %`).join(' · ')}`);
  }
  if (f.duree_vie_mediane_j !== null) {
    /*
     * L'assise AVANT le chiffre quand elle est maigre.
     *
     * Une « médiane » sur une seule fusion est le nombre lui-même. L'annoncer comme une
     * médiane invite à en tirer une conclusion sur une pratique d'équipe — sur un
     * échantillon de un. Le seuil est celui du constat correspondant : cinq.
     */
    l.push(f.duree_vie_sur < 5
      ? `  Durée de vie d'une branche : ${f.duree_vie_mediane_j} jour(s), mais sur `
        + `${f.duree_vie_sur} fusion(s) seulement — trop peu pour décrire une pratique.`
      : `  Une branche vit ${f.duree_vie_mediane_j} jour(s) en médiane, `
        + `sur ${f.duree_vie_sur} fusion(s).`);
  }
  if (f.tronc.part !== null) {
    l.push(`  ${f.tronc.part} % des ${f.tronc.commits} commits de \`${f.tronc.branche}\` `
      + 'ne portent aucune trace de fusion.',
      '  ATTENTION : ce dernier chiffre est un MAJORANT. Un dépôt qui écrase ses commits à '
      + 'la fusion sans référencer la merge request produit des commits indiscernables '
      + 'd\'un push direct. Vérifier le mode de fusion avant d\'en conclure quoi que ce soit.');
  }
  l.push('');

  if (!r.constats.length) {
    l.push('AUCUN CONSTAT. Les vingt-cinq contrôles passent.',
      'Ce n\'est pas un dépôt parfait : c\'est un dépôt sur lequel ces vingt-cinq '
      + 'contrôles-là ne trouvent rien.');
  } else {
    l.push(`${r.compte.total} constat(s) — `
      + Object.entries(NIVEAUX).map(([n, v]) => `${r.compte[n]} ${v.libelle.toLowerCase()}`)
        .join(', '), '');

    let niveauCourant = '';
    for (const c of r.constats) {
      if (c.niveau !== niveauCourant) {
        niveauCourant = c.niveau;
        l.push(`── ${NIVEAUX[c.niveau].libelle.toUpperCase()} — ${NIVEAUX[c.niveau].quoi} ──`);
      }
      l.push(`  ${c.titre}${c.origine === 'observation' ? '   [observé en plus]' : ''}`,
        `    ${c.quoi}`, `    Geste : ${c.geste}`);
      if (c.elements?.length) {
        for (const e of c.elements) {
          l.push(`      · ${e.numero ? `#${e.numero} ` : ''}${e.titre || e.nom || ''}`
            + (e.jours !== undefined ? `  (${e.jours} j)` : '')
            + (e.auteur ? `  — ${e.auteur}` : ''));
        }
      }
      l.push('');
    }
  }

  l.push('Méthode :');
  for (const m of r.methode) l.push(`  · ${m}`);

  l.push('', 'CE QUI N\'A PAS ÉTÉ MESURÉ :');
  for (const a of r.angles_morts) l.push(`  · ${a}`);

  return l.join('\n');
}

/** La ligne affichée sous le bouton. */
export function resumeDepot(r) {
  if (!r || !r.compte) return 'aucune mesure';
  if (!r.compte.total) return 'aucun constat sur les 25 contrôles';
  return `${r.compte.total} constat(s) — ${r.compte.critique} critique(s), `
       + `${r.compte.urgent} urgent(s) · santé ${r.sante.score}/100`;
}

/** Ce qu'on sait calculer ici. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_DEPOT = {
  rapport_depot: {
    libelle: 'l\'état du dépôt et ses corrections à faire',
    besoin: 'les branches, l\'arbre, les commits, les merge requests et les pipelines',
    source: 'js/repo-analyzer.js'
  }
};

export default { SIGNAUX_DEPOT, rapportDepot, resumeDepot, busFactor, flowDetecte,
                 NIVEAUX, SEUILS, PREFIXES_ACCEPTES, BRANCHES_DE_TRONC, CONVENTIONNEL };
