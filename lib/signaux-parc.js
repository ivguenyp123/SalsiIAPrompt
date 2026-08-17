/*
 * La conformité d'un PARC — plusieurs dépôts d'un coup, et qui est en écart.
 *
 * ── CE QUE LE DÉPÔT-PAR-DÉPÔT NE DIT PAS ────────────────────────────────────
 *
 * `rapport_conformite` répond « ce dépôt est-il conforme ». La question qui se pose
 * vraiment quand on tient une plateforme est autre : « par quelle ÉQUIPE je commence ». On
 * ne la répond pas en ouvrant trente rapports, et personne ne les ouvre.
 *
 * Le parc rend donc ce qu'un rapport unitaire ne peut pas rendre :
 *
 *   CE QUI EST SYSTÉMIQUE. Un écart présent sur trois dépôts sur trente est un oubli
 *   d'équipe. Le même sur vingt-huit est un défaut de la plateforme — un modèle de projet,
 *   une consigne jamais écrite — et il ne se corrige pas dépôt par dépôt.
 *
 *   QUI EST CONCERNÉ. Les dépôts sont groupés par leur préfixe de chemin, qui est le
 *   groupe sur GitLab et l'organisation sur GitHub. C'est l'unité à qui on va parler.
 *
 * ── LES DÉPÔTS SONT CHOISIS, JAMAIS DEVINÉS ─────────────────────────────────
 *
 * Le jeton voit parfois des centaines de dépôts, dont des archives et des bacs à sable.
 * Les scanner tous coûterait des milliers d'appels pour produire un classement où le vrai
 * sujet serait noyé. La sélection est explicite, et ce qui n'a pas été scanné n'est jamais
 * compté comme conforme.
 *
 * Module PUR : ni forge, ni DOM, ni réseau, ni horloge. Il reçoit des audits déjà faits.
 */

/** Ce qu'on sait calculer sur un parc. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_PARC = {
  parc_securite: {
    libelle: 'la conformité de plusieurs dépôts',
    besoin: 'les dépôts que tu choisis parmi ceux que ton jeton voit',
    source: 'js/gouvernance-repo.js',
    // L'écran doit offrir une sélection MULTIPLE plutôt que le sélecteur d'un seul dépôt.
    multi: true
  }
};

/*
 * Combien de dépôts on accepte de scanner d'un coup.
 *
 * Chacun coûte quatre appels — le projet, ses branches, son arbre, son dernier commit —
 * plus un si le dépôt est en Java. Vingt-cinq, c'est une centaine d'appels : long, mais
 * tenable et prévisible. Au-delà, l'écran se fige et personne ne sait si ça avance.
 */
export const MAX_DEPOTS = 25;

/** Le groupe d'un dépôt : son préfixe de chemin. C'est l'unité à qui on parle. */
export const groupeDe = (depot) => {
  const parts = String(depot).split('/');
  return parts.length > 1 ? parts[0] : '—';
};

/**
 * L'état de sécurité d'un parc.
 *
 * @param {object} donnees
 *   depots     `[{ depot, conformite }]` — un audit `rapportConformite` par dépôt
 *   ignores    combien de dépôts visibles n'ont PAS été choisis
 *   echoues    `[{ depot, pourquoi }]` — ceux qu'on n'a pas pu lire
 */
export function parcSecurite({ depots = [], ignores = 0, echoues = [] } = {}) {
  const lignes = depots
    .filter((d) => d.conformite)
    .map(({ depot, conformite }) => ({
      depot,
      groupe: groupeDe(depot),
      note: conformite.note,
      verdict: conformite.verdict,
      ecarts: (conformite.controles || []).filter((c) => c.etat === 'ko'),
      nonVus: (conformite.controles || []).filter((c) => c.etat === 'unverif').length,
      conformite
    }));

  /*
   * Le classement met les NOTES BASSES en tête, et les non mesurés à la fin.
   *
   * Un dépôt sans note n'est pas un bon dépôt : c'est un dépôt qu'on n'a pas su lire. Le
   * mettre en tête ferait commencer par celui sur lequel on ne peut rien faire ; le mettre
   * au milieu le rendrait invisible. Il ferme la liste, et il est compté à part.
   */
  const classees = [...lignes].sort((a, b) => {
    if (a.note === null && b.note === null) return a.depot.localeCompare(b.depot);
    if (a.note === null) return 1;
    if (b.note === null) return -1;
    return a.note - b.note || b.ecarts.length - a.ecarts.length;
  });

  const mesures = lignes.filter((l) => l.note !== null);
  const conformes = mesures.filter((l) => l.verdict === 'conforme');
  const nonConformes = mesures.filter((l) => l.verdict !== 'conforme');

  // Un écart présent partout n'est pas le problème d'une équipe : c'est celui de la
  // plateforme. C'est le seul chiffre du rapport qui change ce qu'on décide d'en faire.
  const parEcart = new Map();
  for (const l of lignes) {
    for (const c of l.ecarts) {
      if (!parEcart.has(c.id)) {
        parEcart.set(c.id, { id: c.id, cis: c.cis, libelle: c.libelle, depots: [] });
      }
      parEcart.get(c.id).depots.push(l.depot);
    }
  }
  const ecartsCommuns = [...parEcart.values()]
    .sort((a, b) => b.depots.length - a.depots.length || a.cis.localeCompare(b.cis));

  const parGroupe = new Map();
  for (const l of lignes) {
    if (!parGroupe.has(l.groupe)) parGroupe.set(l.groupe, { groupe: l.groupe, depots: [] });
    parGroupe.get(l.groupe).depots.push(l);
  }
  const groupes = [...parGroupe.values()].map((g) => {
    const notes = g.depots.filter((d) => d.note !== null).map((d) => d.note);
    return {
      groupe: g.groupe,
      total: g.depots.length,
      nonConformes: g.depots.filter((d) => d.note !== null && d.verdict !== 'conforme').length,
      // MÉDIANE et non moyenne : un dépôt exemplaire ne doit pas racheter cinq dépôts nus.
      note: notes.length ? medianeSimple(notes) : null
    };
  }).sort((a, b) => (a.note ?? 999) - (b.note ?? 999));

  const comptes = {
    scannes: lignes.length, mesures: mesures.length,
    conformes: conformes.length, nonConformes: nonConformes.length,
    nonMesures: lignes.length - mesures.length,
    ignores, echoues: echoues.length, groupes: groupes.length
  };

  const r = { lignes: classees, groupes, ecartsCommuns, comptes, echoues };
  return { ...r, texte: texteParc(r), presentation: presentationParc(r) };
}

/** La médiane d'une liste de nombres. Jamais la moyenne — voir plus haut. */
function medianeSimple(v) {
  const t = [...v].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 === 0 ? Math.round((t[m - 1] + t[m]) / 2) : t[m];
}

function texteParc(r) {
  const c = r.comptes;
  const l = [`CONFORMITÉ DU PARC — ${c.scannes} dépôt(s) scanné(s)`, ''];

  if (!c.scannes) {
    l.push('Aucun dépôt n\'a pu être audité. Ce n\'est pas un parc conforme : c\'est une '
      + 'absence de mesure.');
    if (r.echoues.length) {
      l.push('', 'Ceux qu\'on n\'a pas pu lire :');
      for (const e of r.echoues) l.push(`  ${e.depot} — ${e.pourquoi}`);
    }
    return l.join('\n');
  }

  l.push(`Conformes        : ${c.conformes}`,
    `Non conformes    : ${c.nonConformes}`,
    c.nonMesures ? `Non mesurés      : ${c.nonMesures}` : '',
    '',
    'Rappel : le verdict est BINAIRE. Un seul écart rend un dépôt non conforme, quelle que',
    'soit sa note. La note sert à savoir par où commencer, pas à négocier.',
    '');

  l.push('Les dépôts, du plus en écart au plus sain :');
  for (const d of r.lignes) {
    l.push(`  ${String(d.note ?? '—').padStart(3)}/100  ${d.verdict.padEnd(14)} `
      + `${String(d.ecarts.length).padStart(2)} écart(s)  ${d.depot}`
      + (d.nonVus ? `   (${d.nonVus} non vérifiable(s))` : ''));
  }
  l.push('');

  if (r.ecartsCommuns.length) {
    l.push('LES ÉCARTS PARTAGÉS — c\'est ici que se joue l\'essentiel :');
    for (const e of r.ecartsCommuns) {
      const part = Math.round((e.depots.length / c.scannes) * 100);
      l.push(`  ${String(e.depots.length).padStart(3)}/${c.scannes} dépôts (${part} %)  `
        + `CIS ${e.cis.padEnd(7)} ${e.libelle}`);
    }
    l.push('',
      'Un écart présent sur presque tous les dépôts n\'est pas l\'oubli d\'une équipe : '
      + 'c\'est un défaut de la plateforme — modèle de projet, consigne jamais écrite, '
      + 'réglage de groupe. Il ne se corrige pas dépôt par dépôt.', '');
  }

  if (r.groupes.length > 1) {
    l.push('Par groupe :');
    for (const g of r.groupes) {
      l.push(`  ${String(g.note ?? '—').padStart(3)}/100  ${String(g.nonConformes).padStart(2)}`
        + `/${String(g.total).padEnd(2)} non conforme(s)   ${g.groupe}`);
    }
    l.push('');
  }

  if (c.ignores) {
    l.push(`${c.ignores} dépôt(s) visibles n'ont PAS été choisis. Ils ne sont ni scannés ni `
      + 'comptés — leur absence de constat ne dit rien de leur état.', '');
  }
  if (r.echoues.length) {
    l.push('Non lus, et donc jamais comptés comme conformes :');
    for (const e of r.echoues) l.push(`  ${e.depot} — ${e.pourquoi}`);
    l.push('');
  }

  l.push('Méthode : chaque dépôt est audité comme le fait « Conformité CIS » — mêmes '
    + 'contrôles, mêmes poids, même exclusion du non vérifiable hors du dénominateur. La '
    + 'note d\'un groupe est la MÉDIANE de ses dépôts : un dépôt exemplaire ne doit pas '
    + 'racheter cinq dépôts nus.');

  return l.join('\n');
}

function presentationParc(r) {
  const c = r.comptes;
  const entete = !c.scannes
    ? { valeur: '—', libelle: 'aucune mesure', sous: 'aucun dépôt audité', ton: 'na' }
    : { valeur: String(c.nonConformes),
        libelle: c.nonConformes ? 'dépôts non conformes' : 'parc conforme',
        sous: `${c.scannes} dépôt(s) scanné(s) · ${c.conformes} conforme(s)`
            + (c.ignores ? ` · ${c.ignores} non choisi(s)` : ''),
        ton: c.nonConformes ? 'ko' : 'ok' };

  const tableaux = [];

  if (r.ecartsCommuns.length) {
    tableaux.push({
      titre: 'Les écarts partagés — à traiter au niveau de la plateforme',
      colonnes: [{ libelle: 'Dépôts', align: 'n' }, { libelle: 'Part', align: 'n' },
                 { libelle: 'CIS' }, { libelle: 'Contrôle' }],
      lignes: r.ecartsCommuns.map((e) => ({
        ton: e.depots.length >= c.scannes / 2 ? 'ko' : 'moyen',
        cellules: [{ texte: `${e.depots.length}/${c.scannes}` },
                   { texte: `${Math.round((e.depots.length / c.scannes) * 100)} %` },
                   { texte: e.cis, code: true }, { texte: e.libelle }]
      })),
      note: 'Un écart présent sur presque tous les dépôts est un défaut de la plateforme, '
          + 'pas l\'oubli d\'une équipe. Il ne se corrige pas dépôt par dépôt.'
    });
  }

  tableaux.push({
    titre: 'Les dépôts, du plus en écart au plus sain',
    colonnes: [{ libelle: 'Dépôt' }, { libelle: 'Note', align: 'n' },
               { libelle: 'Verdict' }, { libelle: 'Écarts', align: 'n' },
               { libelle: 'Non vérifiables', align: 'n' }],
    lignes: r.lignes.map((d) => ({
      ton: d.note === null ? 'moyen' : d.verdict === 'conforme' ? '' : 'ko',
      cellules: [{ texte: d.depot, code: true },
                 { texte: d.note === null ? '—' : `${d.note}/100` },
                 { texte: d.verdict }, { texte: String(d.ecarts.length) },
                 { texte: String(d.nonVus) }]
    })),
    note: r.echoues.length
      ? `${r.echoues.length} dépôt(s) n'ont pas pu être lus : ${r.echoues.map((e) => e.depot).join(', ')}.`
      : ''
  });

  if (r.groupes.length > 1) {
    tableaux.push({
      titre: 'Par groupe',
      colonnes: [{ libelle: 'Groupe' }, { libelle: 'Note médiane', align: 'n' },
                 { libelle: 'Non conformes', align: 'n' }, { libelle: 'Dépôts', align: 'n' }],
      lignes: r.groupes.map((g) => ({
        ton: g.nonConformes ? 'ko' : '',
        cellules: [{ texte: g.groupe }, { texte: g.note === null ? '—' : `${g.note}/100` },
                   { texte: String(g.nonConformes) }, { texte: String(g.total) }]
      })),
      note: 'MÉDIANE et non moyenne : un dépôt exemplaire ne doit pas racheter cinq dépôts nus.'
    });
  }

  return { sujet: 'La conformité du parc', entete, tableaux };
}

/** Le résumé d'une ligne affiché à l'écran. */
export function resumeParc(r) {
  const c = r?.comptes;
  if (!c || !c.scannes) return 'aucun dépôt audité';
  return `${c.nonConformes} non conforme(s) sur ${c.scannes} · ${c.conformes} conforme(s)`
       + (c.echoues ? ` · ${c.echoues} non lu(s)` : '');
}

export default { SIGNAUX_PARC, MAX_DEPOTS, groupeDe, parcSecurite, resumeParc };
