/*
 * Le plafond de dépense — ce qui manquait pour que « tracer le coût » serve à quelque chose.
 *
 * ── LA PANNE QU'IL EMPÊCHE ───────────────────────────────────────────────────
 *
 * Le journal enregistre le coût de chaque appel, l'Admin le trace en graphiques, et le
 * registre porte désormais les tarifs réels. Tout ça dit COMBIEN ÇA A COÛTÉ. Rien ne dit
 * STOP.
 *
 * C'est le point de départ de ce produit, rappelé par son commanditaire : « pleins de
 * boîtes arrêtent car trop cher ». Une plateforme qui découvre la facture à la fin du mois
 * a exactement le même problème que celles-là, avec de plus jolis graphiques.
 *
 * ── POURQUOI « INCONNU » NE VAUT PAS ZÉRO, ICI PLUS QU'AILLEURS ──────────────
 *
 * Certains appels n'ont pas de coût calculable : un palier dont le tarif n'a pas été
 * relevé — `large` chez DeepSeek aujourd'hui — rend `null`. Les compter pour zéro
 * ouvrirait la porte la plus bête qui soit : le plafond se contournerait EN CHOISISSANT
 * LE PALIER LE PLUS CHER, celui dont on ignore le prix.
 *
 * La dépense connue est donc un MINORANT, jamais un total, et le module le dit dans sa
 * réponse plutôt que de le laisser deviner. Un plafond franchi refuse ; un plafond
 * approché avec des appels non tarifés au compteur demande un humain, parce que la
 * plateforme ne sait pas où elle en est.
 *
 * ── CE QU'IL NE FAIT PAS ─────────────────────────────────────────────────────
 *
 * Il n'estime PAS le coût de l'appel à venir. On ne connaît ni la longueur de la réponse
 * ni le taux de cache avant d'avoir appelé ; une estimation serait un chiffre inventé posé
 * devant un contrôle de sécurité budgétaire. Le plafond porte donc sur ce qui a DÉJÀ été
 * dépensé, et le dernier appel peut le franchir — d'au plus un appel. C'est une limite
 * assumée, écrite ici pour que personne ne la découvre en la subissant.
 *
 * Module PUR : ni fichier, ni réseau, ni horloge implicite.
 */

/** Les fenêtres qu'un plafond peut couvrir, et leur durée en millisecondes. */
export const FENETRES = {
  jour: 24 * 60 * 60 * 1000,
  mois: 30 * 24 * 60 * 60 * 1000
};

/**
 * La part du plafond au-delà de laquelle on prévient sans encore refuser.
 *
 * Refuser à 100 % et se taire à 99 % ferait découvrir la limite au moment où elle tombe,
 * en pleine démonstration. Le seuil n'est pas une science — c'est le moment où quelqu'un
 * a encore le temps de décider.
 */
export const SEUIL_ALERTE = 0.8;

/**
 * Un nombre, ou `null` — et `null` n'est PAS zéro.
 *
 * ── LE PIÈGE, ATTRAPÉ PAR SON PROPRE TEST ───────────────────────────────────
 *
 * Écrit d'abord `Number.isFinite(Number(x)) ? Number(x) : null`. Or `Number(null)` vaut
 * **0**, et zéro est parfaitement fini. Un coût absent ressortait donc à zéro dollar —
 * c'est-à-dire GRATUIT — et le plafond se serait contourné exactement par la porte que ce
 * module existe pour fermer : prendre le palier dont on ignore le prix.
 *
 * Le même piège avait déjà coûté une ligne de journal ailleurs dans ce dépôt. Il ne se
 * voit pas à la lecture ; il se voit quand un test demande « combien d'appels non
 * tarifés ? » et qu'on répond un au lieu de deux.
 */
const nombre = (x) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/**
 * Ce qui a été dépensé sur une fenêtre, d'après le journal.
 *
 * @param {Array} lignes   les lignes du journal (`lib/executions.js`)
 * @param {object} o
 *   @param {string} o.fenetre  'jour' | 'mois'
 *   @param {Date|string} o.jusqua  la borne haute — l'instant de la décision
 *   @param {string} [o.scope]  ne compter que ce périmètre ; absent = tout
 * @returns {{connu, appels, inconnus, jetons, depuis}}
 */
export function depense(lignes = [], { fenetre = 'mois', jusqua = new Date(), scope = '' } = {}) {
  const fin = new Date(jusqua).getTime();
  const debut = fin - (FENETRES[fenetre] || FENETRES.mois);

  let connu = 0;
  let appels = 0;
  let inconnus = 0;
  let jetons = 0;

  for (const l of lignes) {
    const t = new Date(l?.le).getTime();
    if (!Number.isFinite(t) || t < debut || t > fin) continue;
    if (scope && l.scope !== scope) continue;

    /*
     * ── UN REFUS N'EST PAS UN APPEL, ET SURTOUT PAS UN APPEL NON TARIFÉ ──────
     *
     * Vu en éprouvant le plafond pour de vrai : le tout premier appel refusé par P008
     * entrait au journal avec `cout: null`, comme n'importe quelle exécution sans tarif.
     * La fenêtre passait donc définitivement en « minorant », et P008 exigeait une
     * confirmation humaine sur TOUT — y compris après que la fenêtre se soit vidée.
     *
     * Le plafond se dégradait donc lui-même en le franchissant une fois. Or un refus de
     * pré-vol tombe AVANT le premier jeton : aucun modèle n'a répondu, le coût est zéro
     * et il est CONNU. Ces lignes sortent du calcul, elles ne le troublent pas.
     */
    if (l.issue === 'refus') continue;

    appels += 1;
    jetons += (nombre(l.entree) || 0) + (nombre(l.sortie) || 0);

    const c = nombre(l.cout);
    /*
     * `null` ET `undefined` comptent pour un appel NON TARIFÉ, pas pour un appel gratuit.
     * C'est la ligne qui empêche de contourner le plafond en prenant le palier dont on
     * ignore le prix.
     */
    if (c === null) inconnus += 1;
    else connu += c;
  }

  return { connu, appels, inconnus, jetons, depuis: new Date(debut).toISOString() };
}

/**
 * Où en est-on du plafond ?
 *
 * @param {number|null} plafond  en dollars ; `null` ou absent = aucun plafond déclaré
 * @param {object} d             ce que rend `depense()`
 * @returns {{declare, plafond, connu, part, franchi, alerte, inconnus, raison}}
 */
export function etat(plafond, d = {}) {
  const p = nombre(plafond);
  const connu = nombre(d.connu) || 0;
  const inconnus = nombre(d.inconnus) || 0;

  if (p === null || p <= 0) {
    return { declare: false, plafond: null, connu, part: null, franchi: false,
             alerte: false, inconnus, raison: '' };
  }

  const part = connu / p;
  const franchi = connu >= p;

  return {
    declare: true,
    plafond: p,
    connu,
    part,
    franchi,
    alerte: !franchi && (part >= SEUIL_ALERTE || inconnus > 0),
    inconnus,
    raison: raisonDe({ p, connu, part, franchi, inconnus })
  };
}

function raisonDe({ p, connu, part, franchi, inconnus }) {
  const sous = inconnus
    ? ` ${inconnus} appel(s) de la fenêtre n'ont pas de tarif au registre : la dépense `
      + 'réelle est AU-DESSUS de ce chiffre.'
    : '';

  if (franchi) {
    return `Plafond atteint : ${argent(connu)} dépensés sur ${argent(p)}.${sous}`;
  }
  if (inconnus) {
    return `${argent(connu)} sur ${argent(p)} — soit ${(part * 100).toFixed(0)} % du plafond,`
         + ` et c'est un MINORANT.${sous}`;
  }
  if (part >= SEUIL_ALERTE) {
    return `${argent(connu)} sur ${argent(p)} — ${(part * 100).toFixed(0)} % du plafond.`;
  }
  return '';
}

/** Un montant lisible. Sous le centime, les centimes ne disent plus rien. */
export function argent(x) {
  const n = nombre(x);
  if (n === null) return '—';
  if (n < 0.01) return `${(n * 100).toFixed(2)} ¢`;
  return `${n.toFixed(2)} $`;
}

/**
 * Le plafond qui s'applique à une exécution, et d'où il vient.
 *
 * ── LE PLUS PETIT L'EMPORTE, ET CE N'EST PAS ANODIN ─────────────────────────
 *
 * Un plafond d'équipe et un plafond global se cumulent : l'équipe Data ne doit pas
 * pouvoir dépenser au-delà de son enveloppe MÊME si le global est loin d'être atteint, et
 * personne ne doit dépasser le global même si son équipe a de la marge. On rend donc les
 * DEUX, et l'appelant les évalue tous les deux — plutôt que d'en choisir un et de laisser
 * l'autre inappliqué en croyant l'avoir déclaré.
 *
 * @returns {Array<{portee, nom, fenetre, montant}>}
 */
export function plafondsDe(config = {}, { scope = '' } = {}) {
  const out = [];
  for (const [fenetre, montant] of Object.entries(config.global || {})) {
    if (nombre(montant) !== null) out.push({ portee: 'global', nom: '', fenetre, montant: Number(montant) });
  }
  const parScope = (config.scopes || {})[scope] || {};
  for (const [fenetre, montant] of Object.entries(parScope)) {
    if (nombre(montant) !== null) out.push({ portee: 'scope', nom: scope, fenetre, montant: Number(montant) });
  }
  return out;
}

export default { FENETRES, SEUIL_ALERTE, depense, etat, argent, plafondsDe };
