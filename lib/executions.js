/*
 * Le journal des EXÉCUTIONS, et ce qu'on en tire.
 *
 * ── POURQUOI IL N'EXISTAIT PAS, ET POURQUOI C'EST UN PROBLÈME ────────────────
 *
 * Le produit sait déjà journaliser les DÉCISIONS : qui a soumis, qui a validé, qui a
 * refusé. C'est `admin/journal.js`, et sa source est l'historique du dépôt — chaque
 * décision étant un commit, git EST le journal.
 *
 * Une exécution, elle, ne laisse aucun commit. Elle était affichée, puis perdue. Toutes,
 * sans exception. Conséquence pratique : la plateforme AFFIRME qu'elle envoie dix fois
 * moins de jetons parce qu'elle calcule avant d'appeler, et elle ne peut pas le PROUVER.
 * Un argument qui repose sur une mesure faite ailleurs, dans un terminal, un jour, par
 * quelqu'un, n'est pas un argument défendable en comité.
 *
 * Ce module est la moitié pure de la réponse : la forme d'une ligne, et les agrégats.
 * L'écriture sur disque vit dans `runtime/journal-exec.js`, l'affichage dans l'Admin.
 *
 * ── CE QU'UNE LIGNE NE CONTIENT PAS, ET C'EST DÉLIBÉRÉ ───────────────────────
 *
 * Ni le prompt rendu, ni la sortie du modèle. Un prompt porte la matière injectée — un
 * diff, un extrait de dépôt, un journal de pipeline — et une sortie porte ce que le
 * modèle en a fait. Les écrire sur disque créerait un magasin de données confidentielles
 * là où il n'y en avait pas, et il faudrait alors le protéger, le purger, le déclarer.
 *
 * On garde la TAILLE et le VERDICT. C'est exactement ce dont les agrégats ont besoin, et
 * ça ne fuite rien. `derive/etat.json` a pris la même décision pour les mêmes raisons.
 *
 * Module PUR : ni disque, ni DOM, ni horloge. Les fonctions qui ont besoin de « maintenant »
 * le reçoivent en paramètre — sinon les tests seraient à refaire chaque heure, et une
 * série calculée deux fois de suite ne serait jamais la même.
 */

/* ── L'issue d'une exécution ──────────────────────────────────────────────── */

/*
 * Cinq issues, et la distinction entre elles est le cœur du module.
 *
 * Confondre « refusé au pré-vol » et « échoué » serait la faute la plus coûteuse : un
 * refus est la PORTE QUI FONCTIONNE. Le compter comme un échec ferait baisser le taux de
 * réussite chaque fois que la gouvernance fait son travail, et la première réaction
 * rationnelle d'une équipe serait alors de desserrer les contrôles pour faire remonter
 * son chiffre. Un indicateur qui punit le contrôle finit par le supprimer.
 */
export const ISSUES = {
  succes:  { label: 'réussie',            icone: '✅', jugee: true,  reussie: true },
  contrat: { label: 'contrat non tenu',   icone: '⚠️', jugee: true,  reussie: false },
  coupe:   { label: 'réponse coupée',     icone: '✂️', jugee: true,  reussie: false },
  refus:   { label: 'refusée au pré-vol', icone: '🚫', jugee: false, reussie: false },
  erreur:  { label: 'erreur technique',   icone: '💥', jugee: false, reussie: false }
};

/** L'ordre d'affichage — le plus fréquent d'abord ne marcherait pas, il bougerait. */
export const ORDRE_ISSUES = ['succes', 'contrat', 'coupe', 'refus', 'erreur'];

/*
 * Les motifs d'arrêt qui signalent une réponse tronquée.
 *
 * Dupliqués de `lib/arret.js` ? Non : importés. Deux listes qui doivent rester égales
 * finissent toujours par diverger, et celle-ci divergerait en silence — une réponse
 * coupée serait alors comptée comme une réussite, ce qui est précisément le cas qu'on
 * cherche à rendre visible.
 */
import { coupee } from './arret.js';

/**
 * Classe une exécution à partir de ce que `runtime/api.js` a rendu.
 *
 * L'ORDRE DES TESTS COMPTE. Une réponse coupée est souvent AUSSI non conforme — il lui
 * manque les sections de la fin, forcément, puisqu'elle s'est arrêtée avant. La classer
 * « contrat non tenu » enverrait corriger un contrat qui n'a rien à se reprocher, alors
 * que le vrai geste est de relever `max_sortie`. La cause d'abord, le symptôme ensuite.
 *
 * @param {number} status  le statut rendu par `executer`
 * @param {object} corps   le corps rendu par `executer`
 */
export function issueDe(status, corps = {}) {
  if (status === 409 && corps?.refuse) return 'refus';
  /*
   * UN 403 EST UN REFUS DE PORTE, PAS UNE PANNE.
   *
   * Vu dans le journal en montant la démonstration d'import : une tentative de lancer un
   * artefact encore EN ATTENTE tombait en « erreur technique » — la même case qu'un
   * `fetch failed` ou une clé absente. C'est faux, et c'est exactement la confusion que ce
   * module dit vouloir éviter : le 403 est la PORTE QUI A FONCTIONNÉ (validation humaine,
   * dossier retiré), pas l'agent qui a lâché. Le classer en refus le retire du taux
   * d'échec, où il n'a rien à faire.
   */
  if (status === 403) return 'refus';
  if (status >= 400 || !corps || corps.refuse) return 'erreur';
  if (coupee(corps.motifArret)) return 'coupe';

  /*
   * UNE CHAÎNE NE REND PAS `postvol`, ELLE REND `conforme`.
   *
   * Défaut trouvé en branchant le journal, et il aurait été indétectable : une chaîne
   * arrêtée à sa deuxième brique parce que la première a violé son contrat rend bien
   * `status: 200` — l'exécution s'est déroulée normalement, c'est son résultat qui est
   * mauvais. En ne regardant que `postvol`, on la comptait « réussie ».
   *
   * Le taux de réussite aurait alors été d'autant plus flatteur que les chaînes cassaient
   * souvent, ce qui est exactement l'inverse de ce qu'un indicateur doit faire.
   */
  if (corps.chaine) return (corps.conforme === false || corps.arretee) ? 'contrat' : 'succes';

  if (corps.postvol && corps.postvol.conforme === false) return 'contrat';
  return 'succes';
}

/* ── La forme d'une ligne ─────────────────────────────────────────────────── */

const entier = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const texte = (v) => (v === undefined || v === null ? '' : String(v));

/*
 * La raison est TRONQUÉE, à dessein.
 *
 * Un message d'erreur de fournisseur peut faire plusieurs kilo-octets et recopier le
 * corps de la requête — donc le prompt, donc la matière. Le journal doit dire ce qui
 * s'est passé, pas rejouer ce qui est parti.
 */
export const MAX_RAISON = 200;

/**
 * Construit la ligne de journal d'une exécution.
 *
 * Tout est normalisé ici et nulle part ailleurs : une ligne relue dans six mois doit
 * avoir la même forme qu'une ligne écrite aujourd'hui, quelle que soit la version du
 * serveur qui l'a produite. D'où le `schema`, qui n'a coûté qu'un champ.
 */
export function ligne({ le, artifact, requete, status, corps,
                        fournisseur = '', ms = 0 } = {}) {
  /*
   * `?? {}` ET NON UNE VALEUR PAR DÉFAUT DE PARAMÈTRE.
   *
   * Une valeur par défaut ne s'applique qu'à `undefined`, jamais à `null`. Or l'artefact
   * vaut précisément `null` dans le cas le plus intéressant à journaliser : celui où le
   * registre ne l'a pas trouvé. La construction de la ligne jetait alors — et comme
   * l'appelant avale tout ce que le journal jette (à raison : une exécution ne doit pas
   * échouer parce que sa trace échoue), AUCUN artefact introuvable n'entrait au journal.
   *
   * Le symptôme aurait été un journal parfaitement crédible où « agent inexistant » ne
   * figure jamais — c'est-à-dire un angle mort là où il faut justement regarder.
   */
  const a = artifact ?? {};
  const q = requete ?? {};
  const c = corps ?? {};
  const issue = issueDe(status, c);
  const jetons = c.jetons || {};

  return {
    schema: 1,
    le: texte(le),
    id: texte(a.id || q.id),
    titre: texte(a.title),
    genre: texte(a.kind || 'prompt'),
    scope: texte(a.owner?.scope),
    tier: texte(a.model_tier || 'mid'),
    depot: texte(q.depot),
    criticite: texte(q.criticite || 'test'),
    cas: texte(c.cas || q.cas),
    issue,
    modele: texte(c.modele),
    fournisseur: texte(fournisseur),
    entree: entier(jetons.entree),
    sortie: entier(jetons.sortie),
    // `null` et non `0` : un tarif non déclaré n'est pas un appel gratuit. Le confondre
    // ferait afficher « 0 € » pour DeepSeek, dont aucun tarif n'est au registre — un coût
    // faux, présenté avec l'aplomb d'un coût mesuré.
    cout: c.cout === null || c.cout === undefined || !Number.isFinite(Number(c.cout))
      ? null : Number(c.cout),
    ms: entier(ms),
    motifArret: texte(c.motifArret),
    /*
     * Les TYPES de secrets retirés du prompt avant l'appel. Jamais leurs valeurs.
     *
     * Un journal qui recopierait le secret qu'il vient de faire retirer serait pire que
     * pas de journal : il le rendrait persistant sur disque, là où il ne faisait que
     * passer en mémoire. On garde donc « GitLab PAT », et rien d'autre.
     *
     * C'est aussi ce qui rend la fuite CHIFFRABLE : sans cette colonne, on saurait que le
     * garde-fou existe, jamais combien de fois il a servi.
     */
    caviarde: Array.isArray(c.caviarde) ? c.caviarde.map(texte).filter(Boolean) : [],
    raison: texte(c.raison || c.erreur).slice(0, MAX_RAISON)
  };
}

/* ── Le temps ─────────────────────────────────────────────────────────────── */

/*
 * Trois pas, et un décalage.
 *
 * Le journal écrit en UTC — c'est la seule façon d'avoir des lignes comparables entre un
 * poste, un serveur et une bascule d'heure d'été. Mais « les jetons par heure » en UTC ne
 * veut rien dire pour quelqu'un à Paris : la pointe de 14 h apparaîtrait à 12 h, et
 * personne ne saurait pourquoi le graphique ne ressemble pas à sa journée.
 *
 * D'où `decalageMin`, fourni par l'appelant — le navigateur connaît le sien. Le module,
 * lui, ne devine rien : deviner un fuseau est la meilleure façon d'avoir raison onze mois
 * sur douze.
 */
export const PAS = {
  heure: { label: 'par heure', defaut: 24, coupe: 13, unite: 'h' },
  jour:  { label: 'par jour',  defaut: 30, coupe: 10, unite: 'j' },
  mois:  { label: 'par mois',  defaut: 12, coupe: 7,  unite: 'mois' }
};

const decale = (iso, decalageMin) => new Date(new Date(iso).getTime() + decalageMin * 60000);

/** La clé de seau : `2026-08-17T14`, `2026-08-17`, `2026-08`. */
export function cleDe(iso, pas = 'jour', decalageMin = 0) {
  const d = decale(iso, decalageMin);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, PAS[pas]?.coupe ?? PAS.jour.coupe);
}

/** Le seau précédent, en reculant de `n` pas depuis une clé. */
function reculer(cle, pas, n) {
  if (pas === 'mois') {
    const [a, m] = cle.split('-').map(Number);
    const t = new Date(Date.UTC(a, m - 1 - n, 1));
    return t.toISOString().slice(0, 7);
  }
  const base = pas === 'heure' ? new Date(`${cle}:00:00Z`) : new Date(`${cle}T00:00:00Z`);
  const ms = pas === 'heure' ? 3600000 : 86400000;
  const t = new Date(base.getTime() - n * ms);
  return t.toISOString().slice(0, PAS[pas].coupe);
}

/** Un libellé court, pour un axe qui ne doit pas déborder. */
export function libelle(cle, pas) {
  if (pas === 'heure') return `${cle.slice(11, 13)}h`;
  if (pas === 'jour') return cle.slice(8, 10) + '/' + cle.slice(5, 7);
  const mois = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin',
                'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  return `${mois[Number(cle.slice(5, 7)) - 1] || '?'} ${cle.slice(2, 4)}`;
}

/**
 * La série temporelle, en seaux CONTIGUS.
 *
 * ── LE PIÈGE QU'ON ÉVITE ICI ────────────────────────────────────────────────
 *
 * L'implémentation naturelle regroupe les lignes par clé et rend les groupes trouvés.
 * Elle produit un graphique qui MENT : une semaine sans aucune exécution disparaît de
 * l'axe, et la courbe relie le dernier jour actif au suivant comme s'ils se touchaient.
 * On lit alors « activité stable » là où il faut lire « plus rien pendant huit jours »,
 * et c'est exactement le constat qu'un journal d'exécutions doit rendre visible.
 *
 * Les seaux vides sont donc ÉMIS, à zéro.
 *
 * @param {Array}  lignes
 * @param {string} pas          'heure' | 'jour' | 'mois'
 * @param {string} jusqua       ISO — l'instant de lecture, fourni, jamais deviné
 * @param {number} combien      nombre de seaux
 * @param {number} decalageMin  fuseau du lecteur
 */
export function serie(lignes = [], { pas = 'jour', jusqua, combien, decalageMin = 0 } = {}) {
  const n = combien || PAS[pas]?.defaut || 30;
  const fin = cleDe(jusqua || lignes.at(-1)?.le || new Date(0).toISOString(), pas, decalageMin);
  if (!fin) return [];

  const seaux = new Map();
  for (let i = n - 1; i >= 0; i--) {
    const cle = reculer(fin, pas, i);
    seaux.set(cle, { cle, label: libelle(cle, pas), n: 0, entree: 0, sortie: 0,
                     jetons: 0, cout: 0, coutConnu: false, succes: 0, jugees: 0 });
  }

  for (const l of lignes) {
    const s = seaux.get(cleDe(l.le, pas, decalageMin));
    if (!s) continue;                       // hors fenêtre : ignoré, pas empilé sur un bord
    s.n += 1;
    s.entree += l.entree || 0;
    s.sortie += l.sortie || 0;
    s.jetons += (l.entree || 0) + (l.sortie || 0);
    if (typeof l.cout === 'number') { s.cout += l.cout; s.coutConnu = true; }
    if (ISSUES[l.issue]?.jugee) s.jugees += 1;
    if (l.issue === 'succes') s.succes += 1;
  }

  // Un coût qui reste à zéro parce qu'aucun tarif n'est déclaré n'est pas « zéro euro ».
  return [...seaux.values()].map((s) => ({ ...s, cout: s.coutConnu ? s.cout : null }));
}

/* ── Les palmarès ─────────────────────────────────────────────────────────── */

/**
 * Les agents les plus lancés, avec ce que chacun a consommé et tenu.
 *
 * Le taux de réussite se calcule sur les exécutions JUGÉES — celles où le modèle a
 * effectivement répondu et où le contrat a pu être évalué. Un refus au pré-vol et une
 * erreur de réseau en sont retirés : ni l'un ni l'autre ne dit quoi que ce soit sur la
 * qualité de l'agent, et les y laisser rendrait le chiffre ininterprétable.
 *
 * C'est la même règle que `unverif` retiré du dénominateur côté conformité. Un
 * dénominateur qui gonfle de tout ce qu'on n'a pas mesuré transforme un taux en opinion.
 */
export function palmares(lignes = [], { combien = 0 } = {}) {
  const par = new Map();
  for (const l of lignes) {
    const cle = l.id || '(sans identifiant)';
    if (!par.has(cle)) {
      par.set(cle, { id: cle, titre: l.titre || cle, genre: l.genre || '', n: 0,
                     entree: 0, sortie: 0, jetons: 0, cout: 0, coutConnu: false,
                     jugees: 0, succes: 0, issues: {}, dernier: '', ms: 0 });
    }
    const a = par.get(cle);
    if (l.titre) a.titre = l.titre;         // le dernier titre connu, pas le premier
    a.n += 1;
    a.entree += l.entree || 0;
    a.sortie += l.sortie || 0;
    a.jetons += (l.entree || 0) + (l.sortie || 0);
    a.ms += l.ms || 0;
    if (typeof l.cout === 'number') { a.cout += l.cout; a.coutConnu = true; }
    a.issues[l.issue] = (a.issues[l.issue] || 0) + 1;
    if (ISSUES[l.issue]?.jugee) a.jugees += 1;
    if (l.issue === 'succes') a.succes += 1;
    if (l.le > a.dernier) a.dernier = l.le;
  }

  const liste = [...par.values()]
    .map((a) => ({ ...a,
      cout: a.coutConnu ? a.cout : null,
      // `null`, jamais 0 % : un agent qui n'a jamais été jugé n'a pas échoué.
      taux: a.jugees ? a.succes / a.jugees : null,
      msMoyen: a.n ? Math.round(a.ms / a.n) : 0 }))
    // À égalité de lancements, le plus gourmand devant : c'est celui qu'on veut voir.
    .sort((x, y) => y.n - x.n || y.jetons - x.jetons || x.id.localeCompare(y.id));

  return combien > 0 ? liste.slice(0, combien) : liste;
}

/* ── Le résumé ────────────────────────────────────────────────────────────── */

/** Les totaux de haut de page — ceux qu'on lit avant les graphiques. */
export function resume(lignes = []) {
  const issues = Object.fromEntries(ORDRE_ISSUES.map((k) => [k, 0]));
  let entree = 0, sortie = 0, cout = 0, coutConnu = false, jugees = 0, avecTarif = 0;

  for (const l of lignes) {
    issues[l.issue] = (issues[l.issue] || 0) + 1;
    entree += l.entree || 0;
    sortie += l.sortie || 0;
    if (typeof l.cout === 'number') { cout += l.cout; coutConnu = true; avecTarif += 1; }
    if (ISSUES[l.issue]?.jugee) jugees += 1;
  }

  return {
    n: lignes.length,
    issues,
    entree, sortie, jetons: entree + sortie,
    cout: coutConnu ? cout : null,
    // Combien d'appels le coût couvre RÉELLEMENT. Sans ça, « 0,42 € » sur cent appels
    // dont soixante sans tarif se lit comme le coût des cent.
    coutSur: avecTarif,
    jugees,
    taux: jugees ? issues.succes / jugees : null,
    premier: lignes.reduce((m, l) => (!m || l.le < m ? l.le : m), ''),
    dernier: lignes.reduce((m, l) => (l.le > m ? l.le : m), '')
  };
}

/**
 * La part d'entrée dans le total des jetons.
 *
 * C'est LE chiffre que la plateforme cherche à défendre. « Le chiffre au code,
 * l'explication à l'agent » veut dire qu'on n'envoie pas la matière brute au modèle mais
 * son résumé calculé — donc que l'entrée reste petite. Tant que ce ratio n'était mesuré
 * nulle part, la thèse tenait sur une parole.
 *
 * Rend `null` sans aucun jeton : une plateforme qui n'a rien lancé n'a pas 0 % d'entrée.
 */
export const partEntree = (r) => (r && r.jetons ? r.entree / r.jetons : null);

export default { ISSUES, ORDRE_ISSUES, PAS, issueDe, ligne, cleDe, libelle,
                 serie, palmares, resume, partEntree, MAX_RAISON };
