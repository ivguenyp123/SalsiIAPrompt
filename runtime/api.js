/*
 * Le point d'entrée d'exécution — le pont entre l'écran et Vertex.
 *
 * ── POURQUOI IL EXISTE ───────────────────────────────────────────────────────
 *
 * Tout le produit tourne dans l'onglet, et c'est délibéré : le jeton de forge appartient
 * à l'utilisateur, il ne transite par aucun serveur. Vertex casse cette symétrie. Sa clé
 * de compte de service est une clé privée RSA qui ouvre le projet GCP ENTIER — pas un
 * modèle, le projet. Dans une page, elle appartient à qui ouvre les outils de
 * développement, et aucune précaution côté client n'y change rien.
 *
 * D'où ce module : le seul endroit du produit qui tourne côté serveur, et le plus petit
 * possible. Il reçoit un identifiant d'artefact et des valeurs, il rend une sortie et un
 * verdict. Les identifiants ne franchissent jamais la frontière dans l'autre sens.
 *
 * ── CE QU'IL NE FAIT PAS ─────────────────────────────────────────────────────
 *
 * Il ne contourne rien. Le pré-vol tourne ici comme il tourne dans l'écran, et la
 * confirmation humaine reste obligatoire : `assume` doit être transmis explicitement,
 * il n'a pas de valeur par défaut permissive. Un point d'entrée qui relâcherait les
 * contrôles « parce qu'il est côté serveur » rendrait tout le moment 4 décoratif.
 *
 * Il ne lit rien hors du registre : l'identifiant d'artefact est cherché dans une liste
 * de dossiers connus, jamais concaténé à un chemin.
 *
 * Module INJECTÉ de bout en bout — forge de Vertex, lecture de fichiers, registres.
 * C'est ce qui permet de le tester sans clé, sans réseau et sans serveur.
 */
import { lancer, valeursDepuisContexte, rendre, manquantes } from './lancer.js';
import { derouler, depense as depenseChaine } from './chaine.js';
import { prevol } from '../preflight/index.js';
import { ERROR } from '../lint/index.js';
import { chemin } from '../lib/entrees.js';
import { cout } from './vertex.js';
import { rediger as redigerArtefact, composer as composerChaine } from './redacteur.js';
import { knownScopes } from '../app/scopes.js';
import { toYaml } from '../studio/to-yaml.js';
import { relire } from './coherence.js';
import { ligne as ligneJournal } from '../lib/executions.js';
import { promptDe as promptProposeur, verifier as verifierPropositions,
         MAX_CORPS_PROPOSEUR } from '../lib/import-proposer.js';
import { caviarder } from '../lib/signaux-securite.js';

/*
 * Les dossiers où un artefact peut VIVRE — et le seul d'où il peut être LANCÉ.
 *
 * ── LE TROU QUE CETTE DISTINCTION FERME ─────────────────────────────────────
 *
 * Les trois dossiers ont servi de liste de recherche à l'exécution depuis le premier
 * commit de cette route. Conséquence restée invisible dix jours : `POST /executer` avec
 * l'identifiant d'un artefact EN ATTENTE le trouvait et le lançait. Le catalogue ne
 * montre pas `pending/`, mais c'est une porte d'écran — quelqu'un qui connaît l'id (il
 * est dans la MR de dépôt) contournait la validation humaine avec un curl. « En attente
 * de validation » était une phrase, pas une règle.
 *
 * On cherche donc dans les trois — pour pouvoir NOMMER le refus — et on ne lance que
 * depuis le premier. Un 403 qui dit « attend une validation humaine » vaut mieux qu'un
 * 404 qui déguise un refus en absence : l'un se comprend, l'autre se débogue.
 */
export const DOSSIERS = ['artifacts', 'artifacts/pending', 'artifacts/retires'];
export const LANCABLE = 'artifacts';

const REFUS_DOSSIER = {
  'artifacts/pending':
    'attend une validation humaine dans l\'Admin. Rien de ce qui est en attente ne se '
    + 'lance : la file de validation est une porte, pas un dossier.',
  'artifacts/retires':
    'a été retiré du catalogue. Un artefact retiré ne se lance plus — le réactiver est '
    + 'un geste d\'Admin, pas un paramètre d\'appel.'
};

/** Un identifiant d'artefact : le même motif que le schéma, appliqué à l'entrée. */
export const ID_VALIDE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Ce que l'écran a besoin de savoir avant de proposer un bouton.
 *
 * Sans ça, « Lancer » apparaîtrait sur une plateforme non configurée et échouerait au
 * clic. Mieux vaut que le produit dise ce qu'il sait faire.
 */
export function etat({ creerVertex, models = [] } = {}) {
  try {
    const v = creerVertex();
    // `fournisseur` et `ou` plutôt que projet/région : l'écran doit pouvoir l'afficher
    // sans savoir à qui il parle, et il DOIT l'afficher.
    return { pret: true, fournisseur: v.fournisseur, ou: v.ou,
             paliers: models.map((m) => ({ tier: m.tier, modele: m[v.fournisseur] || '—' })) };
  } catch (error) {
    // Le message dit quoi poser comme variable : c'est la seule chose utile ici.
    return { pret: false, raison: error.message };
  }
}

/**
 * Exécute un artefact, et l'INSCRIT AU JOURNAL.
 *
 * ── POURQUOI LE JOURNAL EST ICI, ET PAS DANS LE SERVEUR ──────────────────────
 *
 * Le serveur de développement n'est pas le seul appelant prévu : à LCL, cette route
 * vivra dans un vrai back, et c'est ce module-là qui partira, pas `serve.js`. Journaliser
 * dans le serveur reviendrait à ne tracer que le poste du développeur — c'est-à-dire
 * précisément l'endroit où la mesure n'intéresse personne.
 *
 * Ici, en revanche, TOUTE exécution passe par cette fonction, quel qu'en soit l'appelant.
 * C'est la seule position d'où « 100 % des lancements sont tracés » est une propriété du
 * code, et pas une consigne qu'on rappelle aux gens.
 *
 * `journaliser` est INJECTÉ, et facultatif. Absent, ce module se comporte exactement
 * comme avant — les tests existants n'ont rien à savoir de tout ceci, et une plateforme
 * sans magasin n'est pas une plateforme cassée.
 *
 * Et il ne peut RIEN casser : ce qu'il jette est avalé. Perdre une réponse attendue et
 * payée parce que le disque du journal est plein serait un très mauvais échange.
 *
 * @param {object} requete  { id, valeurs, cas, criticite, depot, assume }
 * @param {object} deps     { charger, banque, registres, models, creerVertex, lireEntree,
 *                            derive, journaliser, horloge }
 * @returns {{status, corps}}  status HTTP et corps JSON — le serveur ne décide rien
 */
export async function executer(requete = {}, deps = {}) {
  const { journaliser, horloge = () => new Date() } = deps;
  if (typeof journaliser !== 'function') return await conduire(requete, deps, {});

  const trace = {};
  const debut = horloge();
  const r = await conduire(requete, deps, trace);

  try {
    journaliser(ligneJournal({
      le: debut.toISOString(), artifact: trace.artifact, requete,
      status: r.status, corps: r.corps, fournisseur: trace.fournisseur,
      ms: horloge() - debut
    }));
  } catch { /* un journal en panne ne fait pas échouer ce qu'il devait décrire */ }

  return r;
}

/** Le travail réel. `trace` recueille ce que le journal ne peut pas lire dans la sortie. */
async function conduire(requete = {}, deps = {}, trace = {}) {
  const { charger, banque, registres, models = [], fournisseurs = {}, creerVertex, lireEntree,
          derive = null, briques = [], budget = null, attestations = null, ci } = deps;
  const id = String(requete.id || '');

  if (!ID_VALIDE.test(id)) {
    return { status: 400, corps: { erreur: `Identifiant d'artefact invalide : \`${id}\`.` } };
  }

  /*
   * `await`, alors que le chargement était synchrone.
   *
   * Un serveur de développement lit un fichier ; un vrai back lit le registre chez la
   * forge, ce qui est asynchrone. Attendre une valeur qui n'en est pas une ne coûte rien,
   * et c'est ce qui permet aux deux de fournir le MÊME `charger` sans que ce module ait
   * à savoir lequel il a.
   */
  /*
   * Dossier par dossier, avec le MÊME `charger` injecté : sa signature ne bouge pas,
   * mais on sait maintenant D'OÙ vient ce qu'on a trouvé — et c'est ce qui permet de
   * refuser en nommant la raison au lieu de lancer ou de mentir « introuvable ».
   */
  let artifact = null;
  let dossier = null;
  for (const d of DOSSIERS) {
    artifact = await charger(id, [d]);
    if (artifact) { dossier = d; break; }
  }
  trace.artifact = artifact;
  if (!artifact) {
    return { status: 404, corps: { erreur: `Artefact \`${id}\` introuvable au registre.` } };
  }
  if (dossier !== LANCABLE) {
    return { status: 403, corps: { erreur: `\`${id}\` ${REFUS_DOSSIER[dossier]}` } };
  }

  /*
   * Les valeurs : celles du cas d'or s'il est demandé, complétées par celles de l'écran.
   * L'ordre compte — ce que l'utilisateur a tapé l'emporte sur ce que le cas propose,
   * sinon rejouer un cas rendrait le formulaire inopérant sans le dire.
   */
  let valeurs = {};
  let joue = null;
  if (requete.cas) {
    const cas = (artifact.golden_cases || []).find((g) => g.id === requete.cas);
    if (!cas) return { status: 400, corps: { erreur: `Cas d'or \`${requete.cas}\` inconnu.` } };
    try {
      valeurs = valeursDepuisContexte(cas.context, banque, lireEntree);
    } catch (error) {
      return { status: 409, corps: { erreur: error.message } };
    }
    joue = cas.id;
  }
  for (const [k, v] of Object.entries(requete.valeurs || {})) {
    if (v !== undefined && v !== null && v !== '') valeurs[k] = String(v);
  }

  let vertex;
  try { vertex = creerVertex(); }
  catch (error) { return { status: 503, corps: { erreur: error.message } }; }
  trace.fournisseur = vertex.fournisseur;

  /*
   * `derive` est ce que le banc d'essai a MESURÉ. Le passer ici est ce qui resserre le
   * pré-vol tout seul, sans toucher à P005 ni à P006 : tant qu'il vaut `null`, un niveau
   * insuffisant se confirme d'une case cochée ; dès qu'un passage a eu lieu, le même
   * constat devient un refus, parce qu'il porte alors sur un fait et non sur une
   * déclaration. C'était la promesse écrite dans le pré-vol le jour du desserrage.
   */
  const contexte = {
    registres,
    derive,
    depot: { path: requete.depot || 'local/execution', scope: artifact.owner?.scope,
             sensibilite: requete.sensibilite || undefined },
    criticite: requete.criticite || 'test',
    /*
     * La dépense de la fenêtre, pour P008. Le PÉRIMÈTRE VIENT DE L'ARTEFACT, jamais de
     * la requête : sinon n'importe qui choisirait l'enveloppe d'une autre équipe en
     * changeant un mot dans un POST.
     *
     * `budget` absent — un appelant qui n'a pas de journal à lire, le banc, un test —
     * laisse P008 muet plutôt que de refuser sur une ignorance.
     */
    budget: typeof budget === 'function' ? budget(artifact.owner?.scope || '') : budget,
    /*
     * Les attestations du jour, pour P009 — une FONCTION côté serveur, relue à chaque
     * appel : la péremption est ce qui fait leur sécurité, et une liste figée au
     * démarrage lancerait sur la foi d'attestations mortes. Absentes, P009 recalcule
     * quand même : sans attestation, un isolement attesté sort « non vérifiable », ce
     * qui est exactement la vérité.
     */
    attestations: typeof attestations === 'function' ? attestations() : (attestations || new Map()),
    /*
     * Le fichier de CI du dépôt cible, pour la preuve `job_ci_declare` de P009. Une
     * fonction côté serveur (elle va lire chez la forge), une valeur dans un test.
     * ABSENT (`undefined`) veut dire « pas regardé » — et P009 rend alors « non
     * vérifiable » sur cette preuve, jamais « pas de CI ».
     */
    ci: typeof ci === 'function' ? ci(requete.depot) : ci
  };

  /*
   * ── UNE CHAÎNE NE SE LANCE PAS COMME UN AGENT ──────────────────────────────
   *
   * Défaut vu à la relecture, et il aurait été invisible : `lancer()` rend le `spec` et
   * l'envoie au modèle. Sur une chaîne, le `spec` est la NARRATION de la séquence —
   * « 1. Expliquer un code · 2. Résumer un incident ». L'envoyer au modèle aurait produit
   * un texte plausible et faux, sans qu'aucun contrôle ne s'en aperçoive : la narration
   * est du français bien formé, elle passe tous les critères de forme.
   *
   * Une chaîne se DÉROULE. Chaque étape joue son propre artefact, avec son propre prompt
   * et son propre contrat, et celui qui viole le sien arrête tout.
   */
  if (artifact.kind === 'chain') {
    return await deroulerChaine(artifact, { valeurs, contexte, vertex, models, fournisseurs, briques,
                                            assume: requete.assume === true, cas: joue });
  }

  let r;
  try {
    // `assume` n'a pas de valeur par défaut permissive : c'est la case cochée par un
    // humain, transmise telle quelle. Sans elle, P007 refuse et c'est le but.
    r = await lancer(artifact, { vertex, valeurs, contexte, models, fournisseurs,
                                 assume: requete.assume === true });
  } catch (error) {
    // Une erreur Vertex porte son statut : la relayer permet à l'écran de distinguer
    // un quota d'une clé refusée, au lieu d'afficher « échec » pour les deux.
    return { status: error.status && error.status >= 400 ? error.status : 502,
             corps: { erreur: error.message } };
  }

  if (r.refuse) {
    return { status: 409, corps: {
      refuse: true, raison: r.raison, cas: joue,
      constats: r.prevol.constats,
      confirmationRequise: r.prevol.confirmationRequise,
      raisons: r.prevol.raisons
    } };
  }

  /*
   * Le prompt n'est PAS renvoyé.
   *
   * Il contient le spec — que le catalogue masque volontairement aux utilisateurs — et
   * la matière injectée, qui peut être un diff de dépôt confidentiel. Le renvoyer par
   * confort de débogage le ferait fuiter dans la console de tout le monde.
   */
  return { status: 200, corps: {
    refuse: false, cas: joue,
    sortie: r.sortie,
    modele: r.modele,
    jetons: r.jetons,
    cout: r.cout,
    motifArret: r.motifArret,
    /*
     * Les TYPES de secrets retirés du prompt avant l'appel — jamais leurs valeurs.
     *
     * Le prompt ne revient pas (voir ci-dessus), mais ceci doit revenir : quelqu'un dont
     * le fichier contenait un jeton doit l'apprendre. Le taire protégerait l'appel et
     * laisserait le secret en dur dans le dépôt, ce qui est le vrai problème.
     */
    caviarde: r.caviarde || [],
    postvol: r.postvol,
    confirmationRequise: r.prevol.confirmationRequise,
    raisons: r.prevol.raisons
  } };
}

/* ── Dérouler une chaîne ──────────────────────────────────────────────────── */

/**
 * Le pré-vol de CHAQUE brique, avant la première.
 *
 * Une chaîne ne déclare ni outil ni palier : ce sont ses briques qui en portent. Ne
 * contrôler que la chaîne laisserait donc passer, sans un mot, une étape qui invoque un
 * outil interdit au périmètre — et le pré-vol deviendrait contournable en enveloppant
 * n'importe quoi dans une chaîne.
 *
 * Une chaîne ne dilue pas les contrôles de ses briques : son risque est leur UNION.
 */
function prevolDesEtapes(artefact, parId, contexte) {
  const constats = [];
  for (const e of artefact.steps || []) {
    const cible = parId.get(e.artefact);
    if (!cible) {
      constats.push({ code: 'P000', severity: ERROR, etape: e.id,
                      message: `L'étape \`${e.id}\` désigne \`${e.artefact}\`, absent du registre.` });
      continue;
    }
    /*
     * Les valeurs passées à P003 sont les entrées CÂBLÉES, pas les valeurs de la chaîne.
     *
     * P003 demande « le prompt partirait-il avec un trou ? ». Sur l'étape 2, la réponse
     * dépend de ce que l'étape 1 aura produit — donc elle n'existe pas encore, et lui
     * passer les valeurs de la chaîne ferait refuser TOUTE chaîne de plus d'une étape.
     *
     * Ce que P003 protège est déjà couvert deux fois, mieux : `L025` refuse au lint une
     * variable requise que rien ne câble, et `jouer()` refuse au départ un prompt resté
     * troué. On lui dit donc ce qu'il peut savoir — « cette entrée est branchée » — et on
     * laisse les six autres contrôles faire leur travail, qui est le vrai sujet ici :
     * périmètre, outils, sensibilité, certification, niveau, écriture.
     */
    const cablees = Object.fromEntries(Object.keys(e.entrees || {}).map((k) => [k, '(câblée)']));
    const r = prevol(cible, { ...contexte, valeurs: cablees,
                              depot: { ...contexte.depot, scope: cible.owner?.scope } });
    for (const c of r.constats) constats.push({ ...c, etape: e.id });
  }
  return { constats, bloque: constats.some((c) => c.severity === ERROR),
           raisons: constats.filter((c) => c.confirme) };
}

async function deroulerChaine(artefact, { valeurs, contexte, vertex, models, fournisseurs = {}, briques,
                                          assume, cas }) {
  const parId = new Map(briques.map((a) => [a.id, a]));

  const avant = prevolDesEtapes(artefact, parId, contexte);
  if (avant.bloque) {
    const codes = [...new Set(avant.constats.filter((c) => c.severity === ERROR)
      .map((c) => `${c.etape}/${c.code}`))];
    return { status: 409, corps: {
      refuse: true, cas,
      raison: `Pré-vol refusé sur ${codes.length} point(s) : ${codes.join(', ')}.`,
      constats: avant.constats, confirmationRequise: avant.raisons.length > 0,
      raisons: avant.raisons } };
  }
  if (avant.raisons.length && !assume) {
    return { status: 409, corps: {
      refuse: true, cas,
      raison: `${avant.raisons.length} point(s) exigent une confirmation humaine : `
            + `${[...new Set(avant.raisons.map((c) => c.code))].join(', ')}.`,
      constats: avant.constats, confirmationRequise: true, raisons: avant.raisons } };
  }

  /*
   * `jouer` est le SEUL endroit qui parle au modèle. Il rend le prompt de la brique — le
   * sien, pas celui de la chaîne — et refuse de partir avec un trou, comme `lancer()`.
   */
  const jouer = async (cible, entrees) => {
    const prompt = rendre(cible.spec, entrees);
    // Sur le SPEC, pas sur le rendu : la sortie d'une brique amont a le droit de
    // contenir `{{x}}` — c'est de la matière, pas un trou de la brique suivante.
    const sansValeur = manquantes(cible.spec, entrees);
    if (sansValeur.length) {
      throw new Error(`prompt à trou sur \`${cible.id}\` : ${sansValeur.join(', ')}`);
    }
    const rep = await vertex.generer({ prompt, tier: cible.model_tier || 'mid' });
    return { sortie: rep.texte, jetons: rep.jetons, modele: rep.modele,
             cout: cout({ ...rep, quand: new Date() }, models, fournisseurs), motifArret: rep.motifArret };
  };

  let passage;
  try {
    passage = await derouler(artefact, { parId, jouer, valeurs });
  } catch (error) {
    return { status: error.status && error.status >= 400 ? error.status : 502,
             corps: { erreur: error.message } };
  }

  const d = depenseChaine(passage.etapes);

  return { status: 200, corps: {
    refuse: false, cas, chaine: true,
    sortie: passage.sortie,
    conforme: passage.conforme,
    arretee: passage.arretee,
    raison: passage.raison,
    /*
     * Chaque étape avec SA sortie et SON verdict. C'est ce qui distingue une chaîne d'un
     * tuyau : quand elle s'arrête, on sait quelle brique a lâché et sur quel critère,
     * au lieu de constater un résultat aberrant au bout.
     */
    etapes: passage.etapes.map((e) => ({
      etape: e.etape, artefact: e.artefact, titre: e.artefactTitre,
      sortie: e.sortie, conforme: e.conforme, erreur: e.erreur || '',
      postvol: e.postvol, jetons: e.jetons, modele: e.modele
    })),
    jetons: d.jetons,
    cout: d.euros,
    confirmationRequise: avant.raisons.length > 0,
    raisons: avant.raisons
  } };
}

/* ── Le proposeur d'import ────────────────────────────────────────────────── */

/**
 * Un SKILL.md → des propositions VÉRIFIÉES pour le formulaire d'import.
 *
 * Ce que ce point d'entrée NE fait pas, comme `rediger` : il n'écrit rien, ne décide
 * rien, n'accorde rien. Il rend des propositions dont chaque citation a été retrouvée
 * MÉCANIQUEMENT dans le document (la ligne est calculée ici, jamais reprise du modèle),
 * séparées en deux classes que l'écran ne peut pas confondre : les descriptives, qu'il
 * peut pré-remplir, et les droits, qu'il affiche à côté du contrôle sans jamais cliquer.
 *
 * Le corps passe au CAVIARDAGE avant l'appel — un SKILL.md peut contenir un secret
 * d'exemple, et la règle de `lancer()` vaut ici : rien ne part en clair.
 *
 * @param {object} requete  { corps, chemin }
 * @param {object} deps     { registres, creerVertex }
 */
export async function proposer(requete = {}, deps = {}) {
  const { registres = {}, creerVertex } = deps;
  const corps = String(requete.corps || '').trim();

  if (corps.length < 20) {
    return { status: 400, corps: { erreur: 'Rien à lire : le corps du SKILL.md est vide.' } };
  }
  if (corps.length > MAX_CORPS_PROPOSEUR) {
    return { status: 400, corps: { erreur: `Document de ${corps.length} caractères : au-delà `
      + `de ${MAX_CORPS_PROPOSEUR}, la lecture coûte plus qu'elle n'aide. Remplis à la main `
      + 'ce document-là.' } };
  }

  let vertex;
  try { vertex = creerVertex(); }
  catch (error) { return { status: 503, corps: { erreur: error.message } }; }

  const { texte: corpsSur, trouves: caviarde } = caviarder(corps);
  const prompt = promptProposeur({
    corps: corpsSur, chemin: String(requete.chemin || ''),
    outils: registres.tools || [], isolements: registres.isolements || [],
    ecritures: registres.ecritures || []
  });

  let reponse;
  try {
    // `nano` : proposer cinq champs est une extraction, pas un raisonnement.
    reponse = await vertex.generer({ prompt, tier: 'nano' });
  } catch (error) {
    return { status: error.status && error.status >= 400 ? error.status : 502,
             corps: { erreur: error.message } };
  }

  /*
   * LA VÉRIFICATION SE FAIT SUR LE TEXTE CAVIARDÉ — le même que le modèle a lu. Vérifier
   * contre l'original ferait échouer toute citation contenant `[secret caviardé]`, et
   * réussir une citation du secret en clair : les deux mauvais côtés à la fois.
   */
  const crible = verifierPropositions(reponse?.texte || '', {
    corps: corpsSur,
    outils: registres.tools || [], isolements: registres.isolements || [],
    ecritures: registres.ecritures || []
  });

  return { status: 200, corps: {
    ...crible, caviarde,
    fournisseur: vertex.fournisseur, modele: reponse?.modele || '',
    jetons: reponse?.jetons || null
  } };
}

/* ── La dictée ────────────────────────────────────────────────────────────── */

/** Une phrase plus longue que ça n'est plus un besoin, c'est un cahier des charges. */
export const PHRASE_MAX = 2000;

/**
 * Une phrase → un brouillon d'artefact linté.
 *
 * Ce que ce point d'entrée NE fait pas, et c'est le plus important : il n'écrit rien au
 * dépôt. Il rend un brouillon, son verdict de lint et le journal des tours. C'est le
 * Studio qui le pose dans le formulaire, et c'est un humain qui le soumet — le même
 * bouton, le même commit, le même passage par la file de validation qu'un artefact tapé
 * à la main. Un rédacteur qui pousserait directement dans `artifacts/pending/` ferait de
 * la file de validation une formalité pour machines.
 *
 * @param {object} requete  { phrase, scope, auteur }
 * @param {object} deps     { registres, models, creerVertex, lint, parse, tours }
 */
export async function rediger(requete = {}, deps = {}) {
  const { registres = {}, models = [], creerVertex, lint, parse, tours } = deps;
  const phrase = String(requete.phrase || '').trim();

  if (phrase.length < 10) {
    return { status: 400, corps: { erreur:
      'Décris le besoin en une phrase — au moins quelques mots. « un agent » ne dit pas '
      + 'ce qu\'il doit faire, et le brouillon serait générique.' } };
  }
  if (phrase.length > PHRASE_MAX) {
    return { status: 400, corps: { erreur:
      `Phrase de ${phrase.length} caractères (maximum ${PHRASE_MAX}). Au-delà, ce n'est `
      + 'plus une intention à traduire : écris-le au formulaire.' } };
  }

  /*
   * L'auteur vient de la REQUÊTE parce que la session vit dans l'onglet — ce serveur ne
   * l'a pas. C'est une limite assumée et elle est dite dans le README : tant que
   * l'identité n'est pas vérifiée côté serveur, `owner.person` est déclaratif, exactement
   * comme quand on le tape au formulaire. Le rédacteur n'y ajoute aucune faiblesse.
   */
  const auteur = String(requete.auteur || '').slice(0, 64);
  const scopes = knownScopes(registres.tools);
  const scope = scopes.includes(requete.scope) ? requete.scope : '';

  let moteur;
  try { moteur = creerVertex(); }
  catch (error) { return { status: 503, corps: { erreur: error.message } }; }

  let r;
  try {
    r = await redigerArtefact({ phrase, auteur, scope },
                              { moteur, registres, lint, parse, scopes, tours,
                                cout, models, serialiser: toYaml });
  } catch (error) {
    return { status: error.status && error.status >= 400 ? error.status : 502,
             corps: { erreur: error.message } };
  }

  return { status: 200, corps: {
    artefact: r.artefact,
    // Le YAML re-sérialisé depuis l'artefact NORMALISÉ, pas le texte du modèle : ce que
    // l'écran montre doit être ce que le linter a jugé, à la ligne près.
    yaml: r.rendu,
    // Le rapport en entier : l'écran doit pouvoir montrer ce qui reste, pas seulement
    // un feu vert. Un brouillon avec deux avertissements est un brouillon à finir.
    report: r.report,
    abandon: r.abandon,
    // Le journal des tours est ce qui rend la boucle honnête : on voit ce que le linter
    // a refusé, et donc ce que la machine n'avait pas su faire du premier coup.
    tours: r.tours.map((t) => ({
      tour: t.tour,
      illisible: t.illisible,
      erreurs: t.report ? t.report.errors : null,
      avertissements: t.report ? t.report.warnings : null,
      constats: t.report ? t.report.findings.map((f) => ({ code: f.code, severity: f.severity,
                                                           message: f.message, path: f.path })) : []
    })),
    modele: moteur.modele('mid'),
    fournisseur: moteur.fournisseur,
    jetons: r.jetons,
    cout: r.cout
  } };
}

/* ── La composition ───────────────────────────────────────────────────────── */

/**
 * Une phrase → une chaîne d'artefacts EXISTANTS.
 *
 * La différence avec `rediger` tient en une ligne et elle est structurante : ici le modèle
 * ne peut pas écrire de prompt. Il choisit des briques du registre et les branche ; le
 * spec, les variables et les critères sont recalculés depuis ces briques.
 *
 * `briques` vient du DISQUE, pas de la requête. Une page qui enverrait sa propre liste
 * pourrait faire composer avec des artefacts qui n'existent pas — et l'héritage de
 * validation, qui est toute la raison d'être des chaînes, deviendrait une fiction.
 */
export async function composer(requete = {}, deps = {}) {
  const { registres = {}, models = [], creerVertex, lint, parse, tours, briques = [] } = deps;
  const phrase = String(requete.phrase || '').trim();

  if (phrase.length < 10) {
    return { status: 400, corps: { erreur:
      'Décris ce que tu veux en une phrase — au moins quelques mots. Sans ça, aucune '
      + 'brique ne peut être choisie plutôt qu\'une autre.' } };
  }
  if (phrase.length > PHRASE_MAX) {
    return { status: 400, corps: { erreur: `Phrase de ${phrase.length} caractères (maximum ${PHRASE_MAX}).` } };
  }
  if (briques.length === 0) {
    return { status: 409, corps: { erreur:
      'Aucun artefact validé au registre : il n\'y a rien à composer. Demande d\'abord '
      + 'quelques agents, valide-les, et reviens assembler.' } };
  }

  const auteur = String(requete.auteur || '').slice(0, 64);
  const scopes = knownScopes(registres.tools);
  const scope = scopes.includes(requete.scope) ? requete.scope : '';

  let moteur;
  try { moteur = creerVertex(); }
  catch (error) { return { status: 503, corps: { erreur: error.message } }; }

  let r;
  try {
    r = await composerChaine({ phrase, auteur, scope },
                             { moteur, registres, briques, lint, parse, scopes, tours,
                               cout, models, serialiser: toYaml });
  } catch (error) {
    return { status: error.status && error.status >= 400 ? error.status : 502,
             corps: { erreur: error.message } };
  }

  return { status: 200, corps: {
    artefact: r.artefact,
    yaml: r.rendu,
    report: r.report,
    abandon: r.abandon,
    // `forfait` n'est pas une erreur : le registre n'avait pas de quoi répondre. L'écran
    // propose alors d'écrire un agent neuf, ce qui est la bonne suite.
    forfait: r.forfait,
    tours: r.tours.map((t) => ({
      tour: t.tour, illisible: t.illisible || '', forfait: Boolean(t.forfait),
      erreurs: t.report ? t.report.errors : null,
      avertissements: t.report ? t.report.warnings : null,
      constats: t.report ? t.report.findings.map((f) => ({ code: f.code, severity: f.severity,
                                                           message: f.message, path: f.path })) : []
    })),
    modele: moteur.modele('mid'),
    fournisseur: moteur.fournisseur,
    jetons: r.jetons,
    cout: r.cout
  } };
}

/* ── L'aide à la validation ───────────────────────────────────────────────── */

/**
 * Relire un artefact soumis, à la recherche de contradictions internes.
 *
 * L'artefact vient de la REQUÊTE et non du disque, et c'est le seul point d'entrée où
 * c'est vrai : le relecteur regarde ce qui est en attente dans `artifacts/pending/`, que
 * l'écran a chargé depuis la forge. Le serveur ne le connaît pas.
 *
 * Ce que ça n'est pas : une porte. Le verdict des 25 règles ne bouge pas d'un iota, et
 * rien de ce qui sort d'ici ne peut faire ACCEPTER quelque chose — au pire ça ajoute du
 * doute, ce qui est le seul sens acceptable pour un conseil de modèle dans un registre
 * gouverné.
 */
export async function coherence(requete = {}, deps = {}) {
  const { creerVertex } = deps;
  const artefact = requete.artefact;

  if (!artefact || typeof artefact !== 'object' || !artefact.spec) {
    return { status: 400, corps: { erreur: 'Aucun artefact lisible à relire.' } };
  }

  let moteur;
  try { moteur = creerVertex(); }
  catch (error) { return { status: 503, corps: { erreur: error.message } }; }

  try {
    const r = await relire(artefact, { moteur });
    return { status: 200, corps: { ...r, fournisseur: moteur.fournisseur } };
  } catch (error) {
    return { status: error.status && error.status >= 400 ? error.status : 502,
             corps: { erreur: error.message } };
  }
}

export default { executer, etat, rediger, composer, coherence, proposer, DOSSIERS, LANCABLE, ID_VALIDE, PHRASE_MAX };
