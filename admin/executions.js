/*
 * L'écran des exécutions — ce que la plateforme a réellement fait.
 *
 * ── CE QUE CET ÉCRAN EXISTE POUR RÉPONDRE ────────────────────────────────────
 *
 * Quatre questions, et aucune n'avait de réponse avant lui :
 *
 *   combien de jetons, par heure, par jour, par mois
 *   combien de lancements, sur les mêmes pas
 *   quels agents servent vraiment
 *   lesquels tiennent leur contrat
 *
 * Et une cinquième, qui est la raison d'être du produit : QUELLE PART DES JETONS PART EN
 * ENTRÉE. La plateforme affirme calculer avant d'appeler — donc n'envoyer au modèle qu'un
 * résumé chiffré, pas la matière brute. Tant que ce ratio n'était mesuré nulle part, la
 * thèse tenait sur une parole. Elle est maintenant en haut de l'écran, tirée du journal.
 *
 * ── ZÉRO DÉPENDANCE, DONC SVG À LA MAIN ──────────────────────────────────────
 *
 * Aucune bibliothèque de graphiques. Ce ne sont que des rectangles : une échelle, une
 * hauteur, un `title` au survol. Une dépendance de rendu coûterait ici plus cher qu'elle
 * ne rapporte — à commencer par une revue de sécurité pour dessiner des barres.
 */

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), attrs);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/* ── Les formats ──────────────────────────────────────────────────────────── */

/*
 * Les jetons se comptent par millions au bout de quelques semaines. « 4 219 336 » sur un
 * axe est illisible et n'apprend rien de plus que « 4,2 M ».
 */
export function jetonsLisibles(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')} k`;
  return String(n);
}

/*
 * Le coût : `null` n'est PAS zéro.
 *
 * Aucun tarif DeepSeek n'est déclaré au registre — parce qu'on refuse d'en inventer.
 * Afficher « 0,00 € » là où on ne sait pas serait la faute la plus facile à commettre et
 * la plus difficile à rattraper : personne ne conteste un coût qui l'arrange.
 */
export function coutLisible(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'non tarifé';
  const n = Number(v);
  if (n === 0) return '0 €';
  return n < 0.01 ? `< 0,01 €` : `${n.toFixed(2).replace('.', ',')} €`;
}

export const pourcent = (v) => (v === null || v === undefined ? 'N/A'
  : `${Math.round(v * 100)} %`);

const dureeLisible = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  : `${ms} ms`);

/* ── Le graphique ─────────────────────────────────────────────────────────── */

const H = 132;          // hauteur du tracé
const HAUT_LABEL = 18;  // la bande des libellés, sous le tracé

/**
 * Un histogramme empilé.
 *
 * ── LA DÉCISION QUI COMPTE ICI : L'ÉCHELLE ──────────────────────────────────
 *
 * L'échelle part de ZÉRO, toujours. Un axe qui commencerait au minimum observé — ce que
 * font la plupart des bibliothèques par défaut, pour « mieux remplir » — transforme une
 * variation de 3 % en falaise. Sur un écran qui sert à décider où porter l'effort, c'est
 * une manière très efficace de faire paniquer sur du bruit.
 *
 * @param {Array}  seaux   la série, seaux vides compris
 * @param {Array}  couches [{ champ, couleur, nom }] — empilées dans l'ordre
 */
export function histogramme(seaux, couches, { unite = jetonsLisibles } = {}) {
  const max = Math.max(1, ...seaux.map((s) => couches.reduce((t, c) => t + (s[c.champ] || 0), 0)));
  const n = seaux.length;
  const large = 100 / n;
  const g = svg('svg', { viewBox: `0 0 100 ${H + HAUT_LABEL}`, preserveAspectRatio: 'none',
                         class: 'graf', role: 'img' });

  /*
   * Trois repères horizontaux, et leur valeur écrite.
   *
   * Sans eux, on lit des hauteurs relatives et on ne sait pas de quoi on parle : « la
   * barre de mardi est deux fois celle de lundi » n'aide pas à décider si c'est cher.
   */
  for (const part of [0.25, 0.5, 0.75, 1]) {
    const y = H - part * H;
    g.append(svg('line', { x1: 0, x2: 100, y1: y, y2: y, class: 'grille' }));
  }

  seaux.forEach((s, i) => {
    const x = i * large;
    let bas = H;
    const total = couches.reduce((t, c) => t + (s[c.champ] || 0), 0);

    for (const c of couches) {
      const v = s[c.champ] || 0;
      if (v <= 0) continue;
      const h = (v / max) * H;
      bas -= h;
      const r = svg('rect', { x: x + large * 0.14, y: bas, width: large * 0.72, height: h,
                              fill: c.couleur, class: 'barre' });
      const t = svg('title');
      t.textContent = `${s.label} — ${c.nom} : ${unite(v)}`;
      r.append(t);
      g.append(r);
    }

    // Un seau VIDE reste visible : un trait au ras de l'axe. Sans lui, une semaine sans
    // aucune exécution ressemble à une absence de données plutôt qu'à une absence
    // d'activité, et ce n'est pas la même conclusion.
    if (total === 0) {
      g.append(svg('rect', { x: x + large * 0.14, y: H - 0.8, width: large * 0.72,
                             height: 0.8, class: 'vide' }));
    }
  });

  g.append(svg('line', { x1: 0, x2: 100, y1: H, y2: H, class: 'axe' }));
  return { svg: g, max };
}

/** Les libellés d'axe, en HTML : du texte dans un SVG étiré se déforme. */
function axe(seaux) {
  // Un libellé sur N, pour que l'axe ne se chevauche pas sur trente jours.
  const pas = Math.ceil(seaux.length / 12);
  const d = el('div', { className: 'axe-x' });
  seaux.forEach((s, i) => {
    d.append(el('span', { textContent: i % pas === 0 ? s.label : '' }));
  });
  return d;
}

function carteGraphique(titre, sous, seaux, couches, unite) {
  // UN seul appel : le dessiner deux fois pour en relire le maximum coûterait le double
  // de nœuds SVG à chaque changement de pas, sur un écran qu'on redessine à chaque clic.
  const { svg: trace, max } = histogramme(seaux, couches, { unite });
  const box = el('section', { className: 'carte-graf' });
  box.append(el('div', { className: 'gtitre' },
    el('b', { textContent: titre }),
    el('span', { className: 'gsous', textContent: sous })));

  const legende = el('div', { className: 'legende' });
  for (const c of couches) {
    legende.append(el('span', {}, Object.assign(el('i'), { style: `background:${c.couleur}` }),
      document.createTextNode(` ${c.nom}`)));
  }
  legende.append(el('span', { className: 'gmax', textContent: `max ${unite(max)}` }));
  box.append(legende);

  const zone = el('div', { className: 'gzone' });
  zone.append(trace);
  box.append(zone, axe(seaux));
  return box;
}

/* ── L'écran ──────────────────────────────────────────────────────────────── */

const COULEURS = {
  entree:  '#38bdf8',
  sortie:  '#818cf8',
  succes:  '#34d399',
  contrat: '#fbbf24',
  coupe:   '#f472b6',
  refus:   '#94a3b8',
  erreur:  '#f87171'
};

/*
 * Deux jeux de libellés, et ce n'est pas de la coquetterie.
 *
 * La légende compte — « 298 réussies » — et une ligne de journal qualifie UNE exécution.
 * Un seul jeu donnait « RÉUSSIES » en face d'un lancement unique : lu vite, ça se prend
 * pour un compte, et on cherche à quoi il se rapporte.
 */
const LABELS_ISSUE = {
  succes: 'réussies', contrat: 'contrat non tenu', coupe: 'réponses coupées',
  refus: 'refusées au pré-vol', erreur: 'erreurs techniques'
};

const LABEL_UNE = {
  succes: 'réussie', contrat: 'contrat non tenu', coupe: 'réponse coupée',
  refus: 'refusée au pré-vol', erreur: 'erreur technique'
};

let etat = { donnees: null, pas: 'jour', charge: false };

/** L'état courant, pour les tests d'écran et le rechargement. */
export const chargeEs = () => etat.charge;

function chiffre(valeur, libelle, { ton = '', aide = '' } = {}) {
  const c = el('div', { className: `chiffre ${ton}` });
  c.append(el('b', { textContent: valeur }), el('span', { textContent: libelle }));
  if (aide) c.append(el('small', { textContent: aide }));
  return c;
}

function rendreResume(hote, d) {
  const r = d.resume;
  hote.replaceChildren();

  if (!r.n) {
    hote.append(el('div', { className: 'empty' },
      el('b', { textContent: 'Aucune exécution enregistrée.' }),
      document.createTextNode(
        'Le journal se remplit tout seul dès qu\'un agent est lancé depuis le catalogue. '
        + 'Rien à activer.')));
    return false;
  }

  const jetons = r.jetons;
  const part = jetons ? r.entree / jetons : null;

  hote.append(
    chiffre(String(r.n), r.n > 1 ? 'exécutions' : 'exécution',
      { aide: d.meta.tronque ? `journal plafonné à ${d.meta.plafond} lignes` : '' }),
    chiffre(jetonsLisibles(jetons), 'jetons au total',
      { aide: `${jetonsLisibles(r.entree)} entrée · ${jetonsLisibles(r.sortie)} sortie` }),
    /*
     * LE CHIFFRE QUI DÉFEND LE PRODUIT.
     *
     * « Le chiffre au code, l'explication à l'agent » veut dire qu'on n'envoie pas la
     * matière brute au modèle mais son résumé calculé. Si ce ratio grimpe, c'est qu'un
     * agent est reparti à envoyer du brut — et c'est le premier endroit où ça se verra.
     */
    chiffre(part === null ? 'N/A' : pourcent(part), 'de jetons en entrée',
      { ton: 'accent', aide: 'la matière est calculée avant d\'être envoyée' }),
    chiffre(r.taux === null ? 'N/A' : pourcent(r.taux), 'contrats tenus',
      { ton: r.taux === null ? '' : (r.taux >= 0.9 ? 'bon' : (r.taux >= 0.7 ? 'moyen' : 'mauvais')),
        // Le dénominateur est ÉCRIT. Un taux dont on ne sait pas sur quoi il porte est
        // une opinion présentée comme une mesure.
        aide: `sur ${r.jugees} exécution(s) jugée(s)` }),
    chiffre(coutLisible(r.cout), 'coût mesuré',
      { aide: r.cout === null ? 'aucun tarif déclaré au registre'
            : `sur ${r.coutSur} appel(s) tarifé(s) / ${r.n}` })
  );
  return true;
}

function rendreIssues(hote, r) {
  hote.replaceChildren();
  const total = r.n || 1;
  const barre = el('div', { className: 'bandeau' });
  for (const [cle, n] of Object.entries(r.issues)) {
    if (!n) continue;
    barre.append(el('i', { className: 'seg-issue',
      style: `flex:${n};background:${COULEURS[cle]}`,
      title: `${n} ${LABELS_ISSUE[cle]} (${Math.round((n / total) * 100)} %)` }));
  }
  hote.append(barre);

  const l = el('div', { className: 'legende' });
  for (const [cle, n] of Object.entries(r.issues)) {
    if (!n) continue;
    l.append(el('span', {}, Object.assign(el('i'), { style: `background:${COULEURS[cle]}` }),
      document.createTextNode(` ${n} ${LABELS_ISSUE[cle]}`)));
  }
  hote.append(l);
}

function rendrePalmares(hote, liste) {
  hote.replaceChildren();
  if (!liste.length) return;

  const t = el('div', { className: 'tblx' });
  t.append(el('div', { className: 'theadx' },
    el('span', { textContent: 'Agent' }),
    el('span', { textContent: 'Lancé' }),
    el('span', { textContent: 'Jetons' }),
    el('span', { textContent: 'Entrée' }),
    el('span', { textContent: 'Contrats tenus' }),
    el('span', { textContent: 'Durée moy.' })));

  const maxN = Math.max(...liste.map((a) => a.n));
  for (const a of liste) {
    const l = el('div', { className: 'rowx' });
    const nom = el('span', { className: 'nomx' },
      el('b', { textContent: a.titre || a.id }),
      el('small', { textContent: a.id }));
    // La barre de fréquence DANS la cellule : on cherche « lesquels servent », et une
    // colonne de nombres ne se compare pas d'un coup d'œil.
    const jauge = el('span', { className: 'jauge' },
      Object.assign(el('i'), { style: `width:${Math.round((a.n / maxN) * 100)}%` }),
      el('em', { textContent: String(a.n) }));

    const part = a.jetons ? `${Math.round((a.entree / a.jetons) * 100)} %` : '—';
    l.append(nom, jauge,
      el('span', { textContent: jetonsLisibles(a.jetons) }),
      el('span', { textContent: part }),
      el('span', { className: a.taux === null ? 'tm'
                    : (a.taux >= 0.9 ? 'ok' : (a.taux >= 0.7 ? 'moy' : 'ko')),
                   textContent: a.taux === null ? 'jamais jugé' : pourcent(a.taux) }),
      el('span', { textContent: dureeLisible(a.msMoyen) }));
    t.append(l);
  }
  hote.append(t);
}

function rendreJournal(hote, lignes, meta) {
  hote.replaceChildren();
  if (!lignes.length) return;

  const t = el('div', { className: 'tblj' });
  t.append(el('div', { className: 'theadj' },
    el('span', { textContent: 'Quand' }),
    el('span', { textContent: 'Agent' }),
    el('span', { textContent: 'Dépôt' }),
    el('span', { textContent: 'Modèle' }),
    el('span', { textContent: 'Jetons' }),
    el('span', { textContent: 'Issue' })));

  for (const l of lignes) {
    const d = new Date(l.le);
    const quand = Number.isNaN(d.getTime()) ? l.le
      : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit',
                                    minute: '2-digit' });
    const r = el('div', { className: 'rowj' });
    r.append(
      el('span', { className: 'quand', textContent: quand }),
      el('span', { textContent: l.titre || l.id || '—' }),
      el('span', { className: 'mono', textContent: l.depot || '—' }),
      el('span', { className: 'mono', textContent: l.modele || '—' }),
      el('span', { textContent: l.entree + l.sortie ? `${l.entree} / ${l.sortie}` : '—' }),
      el('span', { className: `iss ${l.issue}`, textContent: LABEL_UNE[l.issue] || l.issue }));
    // La raison au survol : elle est trop longue pour la colonne, et trop utile pour
    // être jetée.
    if (l.raison) r.title = l.raison;
    t.append(r);
  }
  hote.append(t);

  if (meta.rendus < meta.total) {
    hote.append(el('p', { className: 'coupe-note',
      textContent: `${meta.rendus} dernières exécutions affichées sur ${meta.total} au journal.` }));
  }
}

function rendreGraphiques(hote) {
  const d = etat.donnees;
  const seaux = d.series[etat.pas] || [];
  const sous = { heure: 'les 24 dernières heures', jour: 'les 30 derniers jours',
                 mois: 'les 12 derniers mois' }[etat.pas];

  hote.replaceChildren(
    carteGraphique('Jetons consommés', sous, seaux,
      [{ champ: 'entree', couleur: COULEURS.entree, nom: 'entrée' },
       { champ: 'sortie', couleur: COULEURS.sortie, nom: 'sortie' }], jetonsLisibles),
    carteGraphique('Lancements', sous, seaux,
      [{ champ: 'succes', couleur: COULEURS.succes, nom: 'contrat tenu' },
       { champ: 'autres', couleur: COULEURS.refus, nom: 'le reste' }],
      (n) => String(n))
  );
}

/* ── Le chargement ────────────────────────────────────────────────────────── */

/**
 * Va chercher le journal et dessine l'écran.
 *
 * Le décalage horaire du LECTEUR part avec la requête. Le journal est écrit en UTC — la
 * seule façon d'avoir des lignes comparables d'un poste à l'autre — mais un graphique
 * « par heure » doit se lire dans l'heure de celui qui le regarde.
 */
export async function chargerExecutions({ fetchImpl = fetch } = {}) {
  const hote = $('vue-executions');
  if (!hote) return;
  etat.charge = true;

  const decalage = new Date().getTimezoneOffset();
  let d;
  try {
    const r = await fetchImpl(`../api/executions?decalage=${decalage}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`le serveur a répondu ${r.status}`);
    d = await r.json();
  } catch (error) {
    $('es-resume').replaceChildren(el('div', { className: 'empty' },
      el('b', { textContent: 'Journal indisponible.' }),
      document.createTextNode(
        `${error.message}. Le journal des exécutions vit côté serveur : il faut que `
        + '`node serve.js` tourne pour le lire.')));
    return;
  }

  etat.donnees = d;

  // `autres` est calculé ICI et pas au serveur : c'est une commodité d'affichage — « ce
  // qui n'a pas réussi » — et non une catégorie du modèle. L'inventer côté serveur
  // ajouterait au contrat un champ que personne d'autre n'utilise.
  for (const serie of Object.values(d.series)) {
    for (const s of serie) s.autres = Math.max(0, s.n - s.succes);
  }

  const ya = rendreResume($('es-resume'), d);
  $('es-issues').hidden = !ya;
  $('es-graphs').hidden = !ya;
  $('es-pas').hidden = !ya;
  if (!ya) { $('es-palmares').replaceChildren(); $('es-journal').replaceChildren(); return; }

  rendreIssues($('es-issues'), d.resume);
  rendreGraphiques($('es-graphs'));
  rendrePalmares($('es-palmares'), d.palmares);
  rendreJournal($('es-journal'), d.journal, d.meta);

  /*
   * La panne du journal, DITE.
   *
   * Une écriture qui échoue est avalée pour ne pas faire tomber une exécution — c'est la
   * bonne décision. Mais avalée ET silencieuse, elle produirait un écran parfaitement
   * calme sur un journal qui a cessé de grandir, et on prendrait des décisions sur une
   * activité qu'on croit complète.
   */
  const alerte = $('es-alerte');
  if (d.meta.echec || d.meta.erreur || d.meta.illisibles) {
    const bouts = [];
    if (d.meta.echec) bouts.push(`Dernière écriture en échec (${d.meta.echec.message}).`);
    if (d.meta.erreur) bouts.push(`Lecture du journal : ${d.meta.erreur}.`);
    if (d.meta.illisibles) bouts.push(`${d.meta.illisibles} ligne(s) illisible(s), ignorée(s).`);
    alerte.textContent = bouts.join(' ');
    alerte.hidden = false;
  } else {
    alerte.hidden = true;
  }
}

/** Le sélecteur de pas — heure, jour, mois. */
export function monterPas() {
  const hote = $('es-pas');
  if (!hote) return;
  for (const [cle, label] of [['heure', 'Par heure'], ['jour', 'Par jour'], ['mois', 'Par mois']]) {
    const b = el('button', { textContent: label, className: cle === etat.pas ? 'on' : '' });
    b.onclick = () => {
      etat.pas = cle;
      for (const autre of hote.children) autre.className = autre === b ? 'on' : '';
      if (etat.donnees) rendreGraphiques($('es-graphs'));
    };
    hote.append(b);
  }
}

export default { chargerExecutions, monterPas, histogramme, jetonsLisibles, coutLisible,
                 pourcent, chargeEs };
