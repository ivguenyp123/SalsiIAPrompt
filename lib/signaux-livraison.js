/*
 * Le plan d'une livraison — calculé sur le dépôt, avec les réglages de celui qui livre.
 *
 * ── LE DÉFAUT QUE CE MODULE CORRIGE ──────────────────────────────────────────
 *
 * `prep-delivery` est le PREMIER artefact du registre, celui qui sert d'exemple canonique.
 * C'était aussi le dernier dont la matière n'était pas calculée. Il déclarait deux
 * variables à taper à la main :
 *
 *     repo   : « issu du dépôt »
 *     stack  : « issu du dépôt »
 *
 * Deux lignes vides, et un modèle à qui l'on demandait ensuite d'« orienter une livraison ».
 * Le résultat était nécessairement une livraison RACONTÉE : le modèle n'avait pas lu le
 * fichier de CI, n'avait pas vu les overlays, ne connaissait ni la version courante ni la
 * version cible. Il produisait donc une marche à suivre plausible — et plausible est
 * exactement ce dont on ne veut pas quand la marche à suivre finit par un déploiement.
 *
 * L'écart était d'autant plus visible que l'artefact avait DÉJÀ son module déterministe :
 * le bouton « 🚚 Livrer » lit le vrai dépôt, calcule le vrai bump, écrit les vrais
 * fichiers. Le bouton « ▶ Exécuter », lui, parlait dans le vide. Deux chemins sur la même
 * fiche, l'un mesuré, l'autre inventé.
 *
 * ── UN SIGNAL QUI PREND DES RÉGLAGES, ET POURQUOI C'EST NOUVEAU ──────────────
 *
 * Les neuf signaux précédents ne demandaient qu'un dépôt — parfois un second choix dans
 * une liste (quelle merge request, quel pipeline). Une livraison n'est pas de cet ordre :
 * elle se DÉCIDE. Quelle branche, vers quel environnement, en majeur, mineur ou patch. Ce
 * ne sont pas des données à lire, ce sont des intentions à recueillir.
 *
 * D'où `reglages` : la déclaration, par le signal, de ce qu'il faut choisir avant de
 * pouvoir calculer. L'écran les rend, et le calcul n'a lieu qu'une fois les réglages requis
 * posés. Deux d'entre eux sont remplis PAR LE DÉPÔT — les branches existantes, les
 * environnements réellement présents dans l'arbre — et c'est ce qui les distingue d'un
 * champ libre : on ne peut pas livrer une branche qui n'existe pas, ni viser un
 * environnement que personne n'a créé.
 *
 * ── CE QUI SE CALCULE, ET CE QUI RESTE À L'AGENT ─────────────────────────────
 *
 *   le CHIFFRE      la version courante, la version cible, les fichiers touchés, les
 *                   overlays laissés en arrière, l'état de la branche et du pipeline
 *   l'EXPLICATION   ce que cette livraison embarque, ce qu'il faut regarder avant de
 *                   fusionner, et ce qui devrait retenir la main
 *
 * La règle de bump n'est PAS réimplémentée ici : elle vient de `runtime/livraison.js`, le
 * module qui écrit réellement. C'est délibéré. Si le plan expliqué par l'agent et le plan
 * exécuté par le module venaient de deux codes différents, ils divergeraient — et l'agent
 * décrirait avec autorité une livraison qui n'aura pas lieu.
 *
 * Module PUR : ni forge, ni DOM, ni réseau. Il reçoit des données déjà lues.
 */
import { planifier, environnementDe, environnements, BUMPS } from '../runtime/livraison.js';

/** Ce qu'on sait calculer pour une livraison. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_LIVRAISON = {
  plan_de_livraison: {
    libelle: 'le plan de la livraison',
    besoin: 'le fichier de CI, les overlays Kustomize, l\'état de la branche et des pipelines',
    source: 'js/pipeline-generator.js',
    /*
     * Les réglages, dans l'ordre où on les prend. `genre` dit à l'écran OÙ chercher les
     * options ; il ne les contient pas — une liste d'environnements écrite ici serait la
     * nôtre, pas celle du dépôt, et c'est exactement la faute du module d'origine.
     */
    reglages: [
      { nom: 'branche', libelle: 'Branche à livrer', genre: 'branche', requis: true },
      { nom: 'environnement', libelle: 'Environnement', genre: 'environnement', requis: false },
      { nom: 'bump', libelle: 'Incrément de version', genre: 'choix',
        options: BUMPS, defaut: 'patch', requis: true }
    ]
  }
};

/** Combien de déploiements on rappelle. Au-delà, c'est de l'historique, pas du contexte. */
export const MAX_DEPLOIEMENTS = 5;

/** Combien de pipelines on regarde pour trouver ceux de la branche livrée. */
export const MAX_RUNS = 30;

const LIBELLE_BUMP = { major: 'majeur', minor: 'mineur', patch: 'correctif' };

const STATUT = { succes: 'succès', echec: 'échec', encours: 'en cours',
                 annule: 'annulé', inconnu: 'statut inconnu' };

const dateLisible = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'date inconnue';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric',
                                     hour: '2-digit', minute: '2-digit' });
};

/**
 * Le plan complet d'une livraison, réglages compris.
 *
 * @param {object} e
 *   @param {string} e.depot           identifiant du dépôt
 *   @param {string} e.branche         branche à livrer (réglage)
 *   @param {string} e.brancheCible    branche par défaut du dépôt
 *   @param {string} e.bump            major | minor | patch (réglage)
 *   @param {string} e.environnement   '' = tous (réglage)
 *   @param {{path,content}|null} e.ci          le fichier de CI trouvé
 *   @param {Array<{path,content}>} e.overlays  les kustomization lus
 *   @param {Array} e.mrs             les merge requests ouvertes du dépôt
 *   @param {Array} e.runs            les pipelines récents
 *   @param {Array} e.deploiements    les déploiements récents
 *   @param {Array<string>} e.stack   les écosystèmes détectés dans l'arbre
 *   @param {Date}  e.maintenant
 */
export function planDeLivraison({ depot = '', branche = '', brancheCible = 'main',
                                  bump = 'patch', environnement = '',
                                  ci = null, overlays = [], mrs = [], runs = [],
                                  deploiements = [], stack = [],
                                  maintenant = new Date() } = {}) {
  const plan = planifier({ branche, brancheCible, bump, environnement, ci, overlays });

  const tous = environnements(overlays.map((o) => o.path));
  const sansEnv = overlays.filter((o) => !environnementDe(o.path)).map((o) => o.path);

  /*
   * La merge request de CETTE branche, s'il y en a une.
   *
   * Son absence n'est pas une anomalie : c'est le cas normal, la livraison en ouvrira une.
   * Le dire évite que l'agent conclue à un problème là où il n'y a qu'un ordre des choses.
   */
  const mr = mrs.find((m) => m.branche === branche) || null;

  const runsBranche = runs.filter((r) => r.branche === branche);
  const dernierRun = runsBranche[0] || null;

  const deploiementsVus = environnement
    ? deploiements.filter((d) => d.environnement === environnement)
    : deploiements;

  const r = {
    depot,
    branche,
    brancheCible,
    bump,
    environnement,
    plan,
    environnementsTrouves: tous,
    overlaysLus: overlays.length,
    overlaysSansEnvironnement: sansEnv,
    cheminCi: ci?.path || '',
    mr,
    dernierRun,
    runsBranche: runsBranche.length,
    deploiements: deploiementsVus.slice(0, MAX_DEPLOIEMENTS),
    deploiementsFiltres: environnement && deploiements.length !== deploiementsVus.length,
    stack: [...stack].sort(),
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteLivraison(r) };
}

/* ── Le texte, et lui seul part au modèle ─────────────────────────────────── */

function texteLivraison(r) {
  const L = [];
  L.push(`Plan de livraison — ${r.depot}`);
  L.push(`Lu le ${dateLisible(r.le)}.`);
  L.push('');

  L.push('RÉGLAGES CHOISIS');
  L.push(`  Branche à livrer : ${r.branche || '(aucune)'} → ${r.brancheCible}`);
  L.push(`  Incrément        : ${r.bump} (${LIBELLE_BUMP[r.bump] || r.bump})`);
  L.push(`  Environnement    : ${r.environnement || 'tous les environnements trouvés'}`);
  L.push('');

  if (!r.plan.ok) {
    /*
     * Un plan refusé est un RÉSULTAT, pas une panne, et il part au modèle tel quel.
     *
     * Rendre un texte vide enverrait l'agent expliquer une livraison dont il ne sait
     * rien ; rendre une erreur ferait croire à un incident de la plateforme. Ce qui s'est
     * passé, c'est que la livraison ne peut pas avoir lieu, et pour une raison précise
     * qu'il vaut mieux faire expliquer que taire.
     */
    L.push('LA LIVRAISON NE PEUT PAS ÊTRE PRÉPARÉE');
    L.push(`  ${r.plan.raison}`);
    L.push(`  Overlays Kustomize lus : ${r.overlaysLus}.`);
    L.push('');
    L.push(...etatDeLaBranche(r));
    L.push(...nonRegarde());
    return L.join('\n');
  }

  L.push('LE BUMP');
  L.push(`  IMAGE_TAG ${r.plan.courante} → ${r.plan.cible}, lu dans \`${r.cheminCi}\` sur \`${r.branche}\`.`);
  L.push('');

  L.push(`FICHIERS QUE LA LIVRAISON MODIFIERAIT (${r.plan.fichiers.length})`);
  for (const f of r.plan.fichiers) L.push(`  ${f.path}  — ${f.quoi}`);
  if (!r.plan.fichiers.length) L.push('  aucun');
  L.push('');

  L.push('OVERLAYS');
  L.push(`  Lus dans l'arbre : ${r.overlaysLus}.`);
  L.push(r.environnementsTrouves.length
    ? `  Environnements trouvés (${r.environnementsTrouves.length}) : ${r.environnementsTrouves.join(', ')}.`
    : '  Aucun environnement nommé : ce dépôt ne suit pas la convention `overlays/<env>/`.');
  if (r.overlaysSansEnvironnement.length) {
    L.push(`  Sans environnement (${r.overlaysSansEnvironnement.length}) : `
         + `${r.overlaysSansEnvironnement.join(', ')} — base ou disposition maison.`);
  }
  if (r.plan.ecartes.length) {
    /*
     * Le point le plus important du texte, et il ne doit pas se lire comme un détail.
     *
     * Livrer `uat` seul laisse les autres overlays à l'ANCIENNE version. C'est ce que le
     * réglage demande — mais un agent qui l'ignore écrira « la livraison met le dépôt à
     * jour », ce qui est faux pour deux environnements sur trois.
     */
    L.push(`  Laissés en arrière par le réglage « ${r.environnement} » (${r.plan.ecartes.length}) :`);
    for (const c of r.plan.ecartes) L.push(`    ${c}`);
    L.push(`  Leur \`newTag\` reste à ${r.plan.courante} : ces environnements ne seront PAS à jour.`);
    L.push('  C\'est le réglage qui le veut, pas un oubli — mais il faut le dire.');
  }
  L.push('');

  L.push(...etatDeLaBranche(r));

  L.push(`DÉPLOIEMENTS RÉCENTS${r.environnement ? ` — ${r.environnement}` : ''}`);
  if (!r.deploiements.length) {
    L.push(r.deploiementsFiltres
      ? `  Aucun déploiement lu sur \`${r.environnement}\` (d'autres environnements en ont).`
      : '  Aucun déploiement lu sur ce dépôt.');
  } else {
    for (const d of r.deploiements) {
      L.push(`  ${d.environnement || '(sans environnement)'} · ${dateLisible(d.quand)}`
           + `${d.branche ? ` · ${d.branche}` : ''}`);
    }
  }
  L.push('');

  L.push('ÉCOSYSTÈMES DÉTECTÉS DANS L\'ARBRE');
  L.push(r.stack.length ? `  ${r.stack.join(', ')}.`
                        : '  Aucun manifeste reconnu (npm, maven, gradle, pip, docker, ci).');
  L.push('');

  L.push(...nonRegarde());
  return L.join('\n');
}

function etatDeLaBranche(r) {
  const L = [`ÉTAT DE LA BRANCHE \`${r.branche}\``];

  if (!r.mr) {
    L.push('  Aucune merge request ouverte depuis cette branche.');
    L.push('  Ce n\'est pas une anomalie : c\'est la livraison qui en ouvrira une.');
  } else {
    L.push(`  Merge request #${r.mr.numero} « ${r.mr.titre} » → ${r.mr.cible}`
         + `${r.mr.auteur ? ` · ${r.mr.auteur}` : ''}`);
    /*
     * `conflits` ne peut être qu'un VRAI positif.
     *
     * GitLab rend `null` tant qu'il n'a pas calculé la fusion ; GitHub ne peuple le champ
     * que sur la fiche d'une PR, jamais dans une liste. « false » veut donc dire « pas de
     * conflit connu », et jamais « fusion garantie ». Écrire la seconde phrase donnerait
     * à un silence la valeur d'une vérification.
     */
    L.push(r.mr.conflits
      ? '  Conflits : OUI, déclarés par la forge. La fusion échouera en l\'état.'
      : '  Conflits : aucun connu — la forge ne renseigne pas toujours ce champ '
        + 'dans une liste, à lire comme « pas de conflit signalé », pas comme « fusion garantie ».');
    if (r.mr.relecteurs?.length) L.push(`  Relecteurs : ${r.mr.relecteurs.join(', ')}.`);
    else L.push('  Relecteurs : aucun demandé.');
  }

  L.push(`  Pipelines lus sur cette branche : ${r.runsBranche}.`);
  if (r.dernierRun) {
    L.push(`  Dernier pipeline : ${STATUT[r.dernierRun.statut] || r.dernierRun.statut}`
         + ` · ${dateLisible(r.dernierRun.debut || r.dernierRun.quand)}`
         + `${r.dernierRun.sha ? ` · ${r.dernierRun.sha.slice(0, 7)}` : ''}`);
  } else {
    L.push('  Aucun pipeline lu sur cette branche : son état de CI est INCONNU, pas vert.');
  }
  L.push('');
  return L;
}

/*
 * Ce que la plateforme ne sait pas, dit à l'agent plutôt que laissé à son imagination.
 *
 * Le contrat de `prep-delivery` exige `vulnerabilities.critical: 0`. On ne scanne pas les
 * vulnérabilités — on scanne les secrets exposés, ce qui n'est pas la même chose. Sans
 * cette section, un modèle à qui l'on montre un plan de livraison propre écrira volontiers
 * « aucune vulnérabilité critique », et ce serait une affirmation sans source.
 */
function nonRegarde() {
  return [
    'CE QUI N\'A PAS ÉTÉ REGARDÉ',
    '  Les vulnérabilités : la plateforme scanne les secrets exposés et les dépendances',
    '  déclarées, jamais les CVE. `vulnerabilities.critical` est donc N/A — pas zéro.',
    '  Les tests : leur résultat n\'est connu qu\'à travers le statut du pipeline ci-dessus.',
    '  Le contenu du changement : cette matière décrit une LIVRAISON, pas un diff. Ce que',
    '  la version embarque se lit dans les commits, qui ne sont pas ici.'
  ];
}

/** Le résumé d'une ligne, affiché sous le champ. */
export function resumeLivraison(r) {
  if (!r.plan.ok) return `livraison impossible — ${r.plan.raison}`;
  const portee = r.environnement ? ` · ${r.environnement}` : '';
  const laisses = r.plan.ecartes.length ? ` · ${r.plan.ecartes.length} overlay(s) en arrière` : '';
  return `${r.plan.courante} → ${r.plan.cible} · ${r.plan.fichiers.length} fichier(s)`
       + `${portee}${laisses}`;
}

export default { SIGNAUX_LIVRAISON, planDeLivraison, resumeLivraison,
                 MAX_DEPLOIEMENTS, MAX_RUNS };
