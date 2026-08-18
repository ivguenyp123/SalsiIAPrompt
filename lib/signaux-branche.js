/*
 * L'état d'une branche — avant qu'elle devienne une merge request.
 *
 * ── LE TROU QU'IL COMBLE ─────────────────────────────────────────────────────
 *
 * `revue_mr` relit une merge request : elle existe, elle a un diff assemblé, un relecteur
 * l'attend. Très bien — mais c'est la FIN du travail. Une branche en cours, celle où l'on
 * est depuis trois jours, n'avait aucun agent. Or c'est là que les questions se posent :
 * est-ce que je diverge trop, est-ce que ça va coincer au merge, est-ce que je pars dans
 * tous les sens, est-ce que j'ai oublié cette branche il y a six semaines.
 *
 * ── CE QU'IL MESURE, ET CE QU'IL NE REGARDE PAS ──────────────────────────────
 *
 * Il ne lit PAS le contenu du changement. C'est délibéré, et ce n'est pas une économie :
 * relire un diff est le métier de `revue_mr`, qui le fait bien. Deux agents qui liraient
 * le même diff divergeraient au premier correctif, et l'un des deux finirait par dire le
 * contraire de l'autre sur la même branche.
 *
 * Celui-ci répond à une autre question — OÙ EN EST cette branche :
 *
 *   la DIVERGENCE      combien de commits d'avance, combien de retard. Le retard est le
 *                      chiffre qui prédit le conflit, et personne ne le regarde.
 *   la DISPERSION      combien de fichiers, dans combien de zones. Une branche qui touche
 *                      six répertoires n'a plus un sujet, elle en a six.
 *   l'ÂGE              depuis quand, et depuis quand plus rien.
 *   les CONVENTIONS    le nom de la branche, les messages de commit — mesurés avec les
 *                      mêmes règles que le reste du dépôt, jamais avec des règles à part.
 *   l'ÉTAT             une merge request ouverte ? un pipeline ? lequel ?
 *
 * ── LE CHIFFRE AU CODE, L'EXPLICATION À L'AGENT ──────────────────────────────
 *
 * Tout ce qui précède se compte. Ce qui ne se compte pas — « cette branche part dans tous
 * les sens », « il faut rebaser maintenant plutôt que dans deux semaines », « ces deux
 * zones n'ont rien à voir » — est le travail du modèle, et il n'a plus besoin d'inventer un
 * seul nombre pour le faire.
 *
 * Module PUR : ni forge, ni DOM, ni réseau.
 */
import { PREFIXES_ACCEPTES } from './signaux-depot.js';

/** Ce qu'on sait calculer pour une branche. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_BRANCHE = {
  etat_branche: {
    libelle: 'l\'état d\'une branche — divergence, dispersion, âge',
    besoin: 'une branche du dépôt, comparée à la branche par défaut',
    source: 'js/branch-cleaner.js · js/repo-analyzer.js',
    reglages: [
      { nom: 'branche', libelle: 'Branche à analyser', genre: 'branche', requis: true }
    ]
  }
};

/*
 * Les seuils. Repris de `signaux-depot.js` là où ils existent déjà — une branche « morte »
 * ne doit pas vouloir dire deux choses différentes selon l'écran qui la regarde.
 */
export const SEUILS = {
  // Ceux du rapport de dépôt, à l'identique.
  morte_j: 90,
  dormante_j: 30,
  // Propres à cette analyse, et assumés comme des conventions, pas des mesures.
  retard_gene: 20,          // au-delà, un rebase coûte plus cher qu'il ne rapporte
  retard_attention: 5,
  zones_dispersee: 4,       // six répertoires, six sujets
  fichiers_grosse: 30,
  commits_grosse: 20
};

/** Combien de fichiers on liste en clair. Au-delà, on compte : cent lignes ne se lisent pas. */
export const MAX_FICHIERS_LISTES = 25;

/** Combien de commits on liste. Idem — c'est un état, pas un journal. */
export const MAX_COMMITS_LISTES = 20;

/** Conventional Commits, en tête de message. Le même motif que le résolveur du contrat. */
const CONVENTION = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?!?: .{1,}$/;

const jours = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

/** La zone d'un fichier : ses deux premiers segments, comme le bus factor. */
const zoneDe = (chemin) => String(chemin).split('/').slice(0, 2).join('/') || '(racine)';

/**
 * L'état d'une branche.
 *
 * @param {object} e
 *   @param {string} e.depot          identifiant du dépôt
 *   @param {string} e.branche        la branche analysée
 *   @param {string} e.brancheDefaut  la branche de référence
 *   @param {object} e.comparaison    ce que rend `forge.comparer()`
 *   @param {Array}  e.mrs            les merge requests ouvertes du dépôt
 *   @param {Array}  e.runs           les pipelines récents
 *   @param {string} e.defaut         le flow observé du dépôt, s'il est connu
 *   @param {string} e.maintenant     ISO
 */
export function etatBranche({ depot = '', branche = '', brancheDefaut = 'main',
                              comparaison = {}, mrs = [], runs = [],
                              maintenant = new Date().toISOString() } = {}) {
  const commits = (comparaison.commits || []).slice();
  const fichiers = comparaison.fichiers || [];

  // Les commits arrivent du plus ancien au plus récent chez les deux forges.
  const dates = commits.map((c) => c.date).filter(Boolean).sort();
  const premier = dates[0] || '';
  const dernier = dates[dates.length - 1] || '';

  const zones = [...new Set(fichiers.map((f) => zoneDe(f.chemin)))].sort();
  const auteurs = [...new Set(commits.map((c) => c.author).filter(Boolean))].sort();

  const horsConvention = commits.filter((c) => !CONVENTION.test(String(c.message).split('\n')[0]));
  const prefixeOk = PREFIXES_ACCEPTES.some((p) => branche.toLowerCase().startsWith(p));

  const mr = mrs.find((m) => m.branche === branche) || null;
  const runsBranche = runs.filter((r) => r.branche === branche);

  const r = {
    depot,
    branche,
    brancheDefaut,
    enAvance: comparaison.enAvance ?? commits.length,
    enRetard: comparaison.enRetard ?? null,
    commits: commits.slice(-MAX_COMMITS_LISTES).reverse(),
    commitsTotal: commits.length,
    fichiers: fichiers.slice(0, MAX_FICHIERS_LISTES),
    fichiersTotal: fichiers.length,
    ajouts: fichiers.reduce((s, f) => s + (f.ajouts || 0), 0),
    retraits: fichiers.reduce((s, f) => s + (f.retraits || 0), 0),
    zones,
    auteurs,
    premier,
    dernier,
    ageJours: premier ? jours(premier, maintenant) : null,
    silenceJours: dernier ? jours(dernier, maintenant) : null,
    prefixeOk,
    horsConvention: horsConvention.length,
    mr,
    dernierRun: runsBranche[0] || null,
    runsBranche: runsBranche.length,
    le: maintenant
  };
  // Les constats d'abord, le texte ensuite — il les cite.
  const constats = constatsDe(r);
  return { ...r, constats, texte: texteBranche({ ...r, constats }) };
}

/*
 * Les constats — ce qui se COMPTE, avec son seuil déclaré à côté.
 *
 * Aucun n'est un jugement : « 42 commits de retard » est un fait, « il faut rebaser » est
 * une opinion, et c'est celle de l'agent. On donne le fait et le seuil qui le rend
 * remarquable, jamais la conclusion.
 */
function constatsDe(r) {
  const out = [];
  const dire = (niveau, quoi, detail) => out.push({ niveau, quoi, detail });

  if (r.enRetard === null) {
    dire('inconnu', 'Retard non mesuré',
      'La forge n\'a pas rendu la comparaison inverse : le risque de conflit est INCONNU, pas nul.');
  } else if (r.enRetard >= SEUILS.retard_gene) {
    dire('grave', `${r.enRetard} commits de retard sur ${r.brancheDefaut}`,
      `Au-delà de ${SEUILS.retard_gene}, c'est le chiffre qui prédit le conflit au merge.`);
  } else if (r.enRetard >= SEUILS.retard_attention) {
    dire('attention', `${r.enRetard} commits de retard sur ${r.brancheDefaut}`, '');
  }

  if (r.silenceJours !== null && r.silenceJours >= SEUILS.morte_j) {
    dire('grave', `Aucun commit depuis ${r.silenceJours} jours`,
      `Au-delà de ${SEUILS.morte_j} jours, le rapport de dépôt la compte comme morte.`);
  } else if (r.silenceJours !== null && r.silenceJours >= SEUILS.dormante_j) {
    dire('attention', `Aucun commit depuis ${r.silenceJours} jours`, '');
  }

  if (r.zones.length >= SEUILS.zones_dispersee) {
    dire('attention', `${r.zones.length} zones touchées`,
      `${r.zones.join(', ')} — au-delà de ${SEUILS.zones_dispersee}, une branche n'a plus un sujet.`);
  }

  if (r.fichiersTotal >= SEUILS.fichiers_grosse || r.commitsTotal >= SEUILS.commits_grosse) {
    dire('attention', `${r.fichiersTotal} fichiers, ${r.commitsTotal} commits`,
      'Une revue de cette taille se lit mal : c\'est le volume, pas la difficulté, qui la fait rater.');
  }

  if (!r.prefixeOk) {
    dire('mineur', `Le nom ne suit aucun préfixe connu`,
      `Attendus : ${PREFIXES_ACCEPTES.join(', ')}.`);
  }

  if (r.horsConvention > 0) {
    dire('mineur', `${r.horsConvention} commit(s) hors Conventional Commits`,
      'Les notes de version se génèrent depuis ces messages : hors convention, ils en sortent.');
  }

  if (r.dernierRun && r.dernierRun.statut === 'echec') {
    dire('grave', 'Le dernier pipeline de cette branche a échoué', '');
  }

  return out;
}

/* ── Le texte, et lui seul part au modèle ─────────────────────────────────── */

const LIGNE = (l, v) => `  ${String(l).padEnd(22)} ${v}`;

function texteBranche(r) {
  const L = [];
  L.push(`Branche — ${r.depot} · ${r.branche}`);
  L.push(`Comparée à \`${r.brancheDefaut}\`, lue le ${dateLisible(r.le)}.`);
  L.push('');

  L.push('DIVERGENCE');
  L.push(LIGNE('En avance', `${r.enAvance} commit(s) — ce que cette branche apporte`));
  L.push(LIGNE('En retard', r.enRetard === null
    ? 'INCONNU — la forge n\'a pas rendu la comparaison inverse'
    : `${r.enRetard} commit(s) — ce qu'elle n'a pas encore`));
  L.push('');

  L.push('CE QU\'ELLE TOUCHE');
  L.push(LIGNE('Fichiers', `${r.fichiersTotal} · +${r.ajouts} / -${r.retraits} lignes`));
  L.push(LIGNE('Zones', r.zones.length ? `${r.zones.length} — ${r.zones.join(', ')}` : 'aucune'));
  if (r.fichiers.length) {
    L.push('');
    for (const f of r.fichiers) {
      L.push(`    ${f.statut.padEnd(9)} ${f.chemin}  (+${f.ajouts} / -${f.retraits})`);
    }
    if (r.fichiersTotal > r.fichiers.length) {
      L.push(`    … et ${r.fichiersTotal - r.fichiers.length} autre(s), non listés.`);
    }
  }
  L.push('');

  L.push('DANS LE TEMPS');
  L.push(LIGNE('Premier commit', r.premier ? `${dateLisible(r.premier)} (il y a ${r.ageJours} j)` : 'inconnu'));
  L.push(LIGNE('Dernier commit', r.dernier ? `${dateLisible(r.dernier)} (il y a ${r.silenceJours} j)` : 'inconnu'));
  L.push(LIGNE('Auteurs', r.auteurs.length ? r.auteurs.join(', ') : 'inconnus'));
  L.push('');

  L.push('ÉTAT');
  L.push(LIGNE('Merge request', r.mr
    ? `#${r.mr.numero} « ${r.mr.titre} » → ${r.mr.cible}`
    : 'aucune ouverte depuis cette branche'));
  L.push(LIGNE('Pipelines lus', String(r.runsBranche)));
  L.push(LIGNE('Dernier pipeline', r.dernierRun
    ? `${r.dernierRun.statut} · ${dateLisible(r.dernierRun.debut || r.dernierRun.quand)}`
    : 'aucun — l\'état de CI est INCONNU, pas vert'));
  L.push('');

  L.push(`CE QUI SE REMARQUE (${r.constats.length})`);
  if (!r.constats.length) {
    L.push('  Aucun seuil franchi. Ce qui veut dire : aucun des contrôles ci-dessous');
    L.push('  ne s\'est déclenché — pas que cette branche est prête à fusionner.');
  } else {
    for (const c of r.constats) {
      L.push(`  [${c.niveau}] ${c.quoi}${c.detail ? `\n      ${c.detail}` : ''}`);
    }
  }
  L.push('');

  L.push(...nonRegarde());
  return L.join('\n');
}

/*
 * Ce que cette matière ne contient pas — et c'est beaucoup.
 *
 * Sans cette section, un modèle à qui l'on montre une branche sans constat écrira
 * « cette branche est prête à être fusionnée ». Il n'a pourtant pas lu une seule ligne du
 * changement : ni sa correction, ni ses tests, ni ce qu'il casse.
 */
function nonRegarde() {
  return [
    'CE QUI N\'A PAS ÉTÉ REGARDÉ',
    '  LE CONTENU DU CHANGEMENT. Cette matière décrit l\'ÉTAT d\'une branche — sa',
    '  divergence, sa dispersion, son âge — pas ce que le code fait. Aucune ligne de diff',
    '  n\'est ici. Relire le changement est le travail de l\'agent de revue de merge',
    '  request, sur une matière qui contient le diff.',
    '',
    '  Donc : ne dis JAMAIS que cette branche est prête à fusionner, ni qu\'elle est',
    '  correcte, ni qu\'elle est sûre. Tu peux dire qu\'elle diverge, qu\'elle se disperse,',
    '  qu\'elle dort, ou que sa CI est rouge. Pas ce que son code vaut.',
    ''
  ];
}

function dateLisible(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'date inconnue';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Le résumé d'une ligne, affiché sous le champ. */
export function resumeBranche(r) {
  const graves = r.constats.filter((c) => c.niveau === 'grave').length;
  const retard = r.enRetard === null ? 'retard inconnu' : `${r.enRetard} de retard`;
  const fin = graves ? ` · ${graves} point(s) grave(s)` : '';
  return `${r.branche} — ${r.enAvance} d'avance, ${retard} · ${r.fichiersTotal} fichier(s)${fin}`;
}

export default { SIGNAUX_BRANCHE, etatBranche, resumeBranche, SEUILS,
                 MAX_FICHIERS_LISTES, MAX_COMMITS_LISTES };
