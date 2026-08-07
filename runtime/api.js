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
import { lancer, valeursDepuisContexte } from './lancer.js';
import { chemin } from '../lib/entrees.js';

/** Les dossiers où un artefact peut vivre. Aucun chemin ne vient de la requête. */
export const DOSSIERS = ['artifacts', 'artifacts/pending', 'artifacts/retires'];

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
 * Exécute un artefact.
 *
 * @param {object} requete  { id, valeurs, cas, criticite, depot, assume }
 * @param {object} deps     { charger, banque, registres, models, creerVertex, lireEntree, derive }
 * @returns {{status, corps}}  status HTTP et corps JSON — le serveur ne décide rien
 */
export async function executer(requete = {}, deps = {}) {
  const { charger, banque, registres, models = [], creerVertex, lireEntree, derive = null } = deps;
  const id = String(requete.id || '');

  if (!ID_VALIDE.test(id)) {
    return { status: 400, corps: { erreur: `Identifiant d'artefact invalide : \`${id}\`.` } };
  }

  const artifact = charger(id, DOSSIERS);
  if (!artifact) {
    return { status: 404, corps: { erreur: `Artefact \`${id}\` introuvable au registre.` } };
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
    criticite: requete.criticite || 'test'
  };

  let r;
  try {
    // `assume` n'a pas de valeur par défaut permissive : c'est la case cochée par un
    // humain, transmise telle quelle. Sans elle, P007 refuse et c'est le but.
    r = await lancer(artifact, { vertex, valeurs, contexte, models, assume: requete.assume === true });
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
    postvol: r.postvol,
    confirmationRequise: r.prevol.confirmationRequise,
    raisons: r.prevol.raisons
  } };
}

export default { executer, etat, DOSSIERS, ID_VALIDE };
