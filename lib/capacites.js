/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  LE REGISTRE DES CAPACITÉS — CE QU'UN AGENT FAIT, PAS COMMENT IL EST ÉCRIT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── LE PROBLÈME ──────────────────────────────────────────────────────────────
 *
 * À vingt agents, un catalogue suffit. À cent trente, choisir devient un travail. À cinq
 * cents, personne ne choisit : on prend celui qu'on connaît, ou on en écrit un trente-
 * huitième qui relit une merge request.
 *
 * `L015` cherche déjà les doublons — par SIMILARITÉ DE TEXTE. C'est le signal le plus
 * faible qui existe ici, et il se trompe dans les deux sens :
 *
 *   FAUX POSITIF   deux specs qui se ressemblent parce qu'ils partagent nos tournures
 *                  maison — « rends exactement ces sections », « n'écris jamais que » —
 *                  et qui ne répondent pas du tout à la même question.
 *   FAUX NÉGATIF   deux agents écrits par deux personnes, avec des mots entièrement
 *                  différents, qui lisent la MÊME matière et rendent les MÊMES sections.
 *                  Ceux-là sont les vrais doublons, et le texte ne les voit pas.
 *
 * ── CE QUE CE MODULE CALCULE, ET CE QU'IL REFUSE DE CALCULER ─────────────────
 *
 * L'avantage de cette plateforme est que la MATIÈRE est normalisée : un agent déclare ses
 * entrées dans un vocabulaire fermé, ses sections attendues dans ses critères, ses outils
 * et leur mode. Tout cela est écrit, vérifié par le linter, et ne dépend d'aucune
 * formulation.
 *
 * L'empreinte fonctionnelle est donc construite sur ces déclarations, jamais sur le spec.
 *
 * CE QU'IL NE CALCULE PAS : UN POURCENTAGE D'ADÉQUATION. « Cet agent couvre 94 % de ton
 * besoin » est un chiffre que rien ne mesure, et il serait cru — c'est exactement la faute
 * que la moitié des specs de ce registre passent leur temps à interdire. On rend donc les
 * composantes SÉPARÉMENT — même matière, quatre sections sur cinq communes, moins de
 * droits — et le lecteur décide. Un nombre unique écraserait précisément ce qui permet de
 * choisir.
 *
 * ── ET CE QU'IL NE PEUT PAS ENCORE FAIRE ─────────────────────────────────────
 *
 * Le meilleur signal de déduplication serait le comportement : « sur les mêmes cas d'or,
 * A et B rendent la même chose ». Le banc n'a JAMAIS tourné avec une vraie clé, et aucun
 * cas d'or n'a de résultat enregistré. Ce module ne prétend donc rien sur le comportement,
 * et il le dit dans sa sortie plutôt que de laisser croire qu'il l'a mesuré.
 *
 * Module PUR : ni DOM, ni réseau, ni modèle.
 */

/** Les modes d'outil, du plus permissif au moins. L'ordre est une décision de sécurité. */
export const MODES = ['write', 'read', 'none'];

const rangMode = (m) => {
  const i = MODES.indexOf(String(m || '').toLowerCase());
  return i === -1 ? MODES.length : i;
};

const trier = (l) => [...new Set((l || []).filter(Boolean).map(String))].sort();

/**
 * La fiche canonique d'un agent — tout ce qui est DÉCLARÉ, rien qui soit deviné.
 *
 * Chaque champ vient d'un endroit que le linter vérifie déjà. Si un champ manque, il vaut
 * la valeur vide et non une valeur plausible : un agent sans critère de sections n'a pas
 * « des sections inconnues », il n'en déclare aucune, et c'est une information.
 */
export function ficheDe(a = {}) {
  const sections = (a.criteria || [])
    .filter((c) => c.target === 'output.sections' && Array.isArray(c.value))
    .flatMap((c) => c.value);

  const outils = (a.tools || []).map((t) => ({
    id: String(t.id || ''), mode: String(t.mode || 'none').toLowerCase()
  }));

  // Le droit le plus permissif que l'agent réclame. C'est LUI qui décide de ce qu'il faut
  // accepter pour le lancer — pas la moyenne, pas le nombre d'outils.
  const droit = outils.length
    ? MODES[Math.min(...outils.map((o) => rangMode(o.mode)))] || 'none'
    : 'none';

  return {
    id: String(a.id || ''),
    titre: String(a.title || ''),
    kind: String(a.kind || ''),
    entrees: trier((a.variables || []).map((v) => v.name)),
    // La SOURCE de chaque entrée : deux agents qui lisent `code` en `repo` et en `signal`
    // ne demandent pas le même travail à celui qui lance.
    sources: trier((a.variables || []).map((v) => `${v.name}:${v.source}`)),
    sections: trier(sections),
    outils: trier(outils.map((o) => o.id)),
    droit,
    portee: String(a.owner?.scope || ''),
    palier: String(a.model_tier || ''),
    niveau: String(a.target_level || ''),
    tags: trier(a.tags),
    // Ce que le texte dit, gardé pour l'affichage — JAMAIS pour l'identité.
    intention: String(a.intent?.purpose || '').trim(),
    pasPour: String(a.intent?.not_for || '').trim()
  };
}

/**
 * L'empreinte fonctionnelle : ce qui identifie ce que l'agent FAIT.
 *
 * Ni le nom, ni le titre, ni un mot du spec. Deux agents de même empreinte demandent la
 * même matière, rendent les mêmes sections et réclament les mêmes droits — quelle que
 * soit la façon dont ils sont écrits.
 *
 * Le PALIER et le NIVEAU en sont volontairement absents : un même travail fait par un
 * modèle plus cher reste le même travail. Ils servent à départager deux candidats, pas à
 * les distinguer.
 */
export function empreinte(fiche) {
  return [
    `k=${fiche.kind}`,
    `e=${fiche.sources.join('+') || '∅'}`,
    `s=${fiche.sections.join('+') || '∅'}`,
    `d=${fiche.droit}`,
    `o=${fiche.outils.join('+') || '∅'}`
  ].join(' | ');
}

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return null;   // deux vides ne se ressemblent pas : ils se taisent
  const commun = [...A].filter((x) => B.has(x)).length;
  return { commun, total: new Set([...A, ...B]).size, a: A.size, b: B.size };
};

/**
 * Ce que deux fiches ont en commun — EN COMPOSANTES, jamais en score.
 *
 * On rend les nombres bruts : combien d'entrées communes sur combien, combien de sections
 * communes sur combien, et la comparaison des droits. Un pourcentage unique agrégerait
 * des choses qui ne s'additionnent pas — « même matière mais droits différents » et
 * « matière différente mais mêmes droits » donneraient le même chiffre et n'appellent pas
 * du tout la même décision.
 */
export function rapprochement(x, y) {
  const e = jaccard(x.entrees, y.entrees);
  const s = jaccard(x.sections, y.sections);
  return {
    a: x.id,
    b: y.id,
    memeEmpreinte: empreinte(x) === empreinte(y),
    memeMatiere: x.sources.join('+') === y.sources.join('+') && x.sources.length > 0,
    entrees: e,
    sections: s,
    // Lequel demande le MOINS de droits. « aucun » quand ils demandent la même chose.
    moinsDeDroits: rangMode(x.droit) === rangMode(y.droit) ? ''
      : (rangMode(x.droit) > rangMode(y.droit) ? x.id : y.id),
    droits: { [x.id]: x.droit, [y.id]: y.droit }
  };
}

/**
 * Les agents groupés par empreinte — les candidats au doublon FONCTIONNEL.
 *
 * Un groupe de deux ou plus n'est PAS une preuve de doublon : deux agents peuvent lire la
 * même matière et rendre les mêmes sections en disant des choses très différentes — c'est
 * même le cas des trois agents qui lisent `activite_du_jour`. La seule chose que ce
 * regroupement établit, c'est qu'il faut aller regarder.
 */
export function familles(fiches = []) {
  const par = new Map();
  for (const f of fiches) {
    const cle = empreinte(f);
    if (!par.has(cle)) par.set(cle, { empreinte: cle, membres: [] });
    par.get(cle).membres.push(f.id);
  }
  return [...par.values()].filter((g) => g.membres.length > 1)
    .sort((a, b) => b.membres.length - a.membres.length);
}

/**
 * Les agents qui répondent à un besoin exprimé en ENTRÉES et en SECTIONS.
 *
 * Le routeur ne cherche pas un texte ressemblant : il cherche qui SAIT LIRE la matière
 * disponible et qui REND ce qu'on attend. C'est ce que la normalisation de la matière rend
 * possible, et c'est ce qu'une recherche vectorielle sur les specs ne saura jamais faire.
 *
 * Le classement est EXPLIQUÉ, pas noté : on trie par ce qui manque, puis par droits
 * demandés, puis par palier. Chaque candidat porte ses composantes pour que le choix se
 * conteste.
 */
export function candidats(fiches = [], { entrees = [], sections = [] } = {}) {
  const veutE = new Set(entrees);
  const veutS = new Set(sections);

  return fiches.map((f) => {
    // Ce que l'agent réclame et qu'on n'a pas : c'est ça qui l'écarte, pas un score.
    const manquantes = f.entrees.filter((e) => veutE.size && !veutE.has(e));
    const couvertes = [...veutS].filter((s) => f.sections.includes(s));
    return {
      id: f.id,
      titre: f.titre,
      droit: f.droit,
      palier: f.palier,
      niveau: f.niveau,
      entreesManquantes: manquantes,
      sectionsCouvertes: couvertes,
      sectionsAttendues: veutS.size,
      sectionsEnPlus: f.sections.filter((s) => veutS.size && !veutS.has(s))
    };
  })
    .filter((c) => !c.entreesManquantes.length && (!veutS.size || c.sectionsCouvertes.length))
    .sort((a, b) =>
      (b.sectionsCouvertes.length - a.sectionsCouvertes.length)
      || (rangMode(b.droit) - rangMode(a.droit))
      || a.sectionsEnPlus.length - b.sectionsEnPlus.length
      || a.id.localeCompare(b.id));
}

/**
 * Ce qu'on peut dire d'un rapprochement, en toutes lettres — et ce qu'on ne peut pas.
 *
 * Cette phrase est la sortie utile du module. Elle nomme les faits établis et refuse
 * explicitement le verdict, parce que la seule chose qui trancherait vraiment — le
 * comportement sur les mêmes cas d'or — n'a jamais été mesurée.
 */
export function direLeRapprochement(r) {
  const L = [];
  if (r.memeEmpreinte) {
    L.push(`\`${r.a}\` et \`${r.b}\` ont la MÊME empreinte fonctionnelle : même matière,`
         + ' mêmes sections attendues, mêmes droits.');
  } else {
    if (r.memeMatiere) L.push('Même matière, à l\'entrée près.');
    if (r.entrees) {
      L.push(`Entrées : ${r.entrees.commun} commune(s) sur ${r.entrees.total}`
           + ` (${r.entrees.a} et ${r.entrees.b}).`);
    }
    if (r.sections) {
      L.push(`Sections : ${r.sections.commun} commune(s) sur ${r.sections.total}`
           + ` (${r.sections.a} et ${r.sections.b}).`);
    }
  }
  if (r.moinsDeDroits) {
    L.push(`\`${r.moinsDeDroits}\` demande MOINS de droits`
         + ` (${Object.entries(r.droits).map(([k, v]) => `${k} : ${v}`).join(', ')}).`);
  }
  L.push('CE QUI N\'EST PAS ÉTABLI : qu\'ils rendent la même chose. Aucun cas d\'or n\'a '
       + 'été joué, donc le comportement réel des deux est inconnu — ce rapprochement dit '
       + 'où regarder, jamais lequel supprimer.');
  return L.join(' ');
}

/**
 * Les MATIÈRES du registre, avec combien d'agents savent chacune la lire.
 *
 * C'est la liste sur laquelle un routeur travaille : quelqu'un dit ce qu'il a sous la main
 * — un diff, un dépôt, une exécution de CI — et la question devient « qui sait lire ça »,
 * pas « quel texte ressemble à ma phrase ».
 *
 * Le compte est nécessaire : une matière que trois agents lisent et une que seize lisent
 * ne posent pas le même problème de choix.
 */
export function matieres(fiches = []) {
  const par = new Map();
  for (const f of fiches) {
    for (const e of f.entrees) {
      if (!par.has(e)) par.set(e, { entree: e, n: 0, agents: [] });
      const m = par.get(e);
      m.n += 1;
      m.agents.push(f.id);
    }
  }
  return [...par.values()].sort((a, b) => b.n - a.n || a.entree.localeCompare(b.entree));
}

/**
 * Les voisins fonctionnels d'un agent — ceux qu'il faut regarder avant d'en écrire un de plus.
 *
 * L'ordre est celui de la PARENTÉ ÉTABLIE, pas d'un score : même empreinte d'abord, puis
 * même matière, puis sections communes. Chaque voisin porte ses composantes, et la phrase
 * qui l'accompagne dit ce qui n'est pas établi.
 *
 * On ne rend RIEN quand un agent n'a aucune matière déclarée : sans entrée, la parenté ne
 * se calcule sur rien, et proposer des voisins au hasard serait pire que de se taire.
 */
export function voisins(fiche, fiches = [], { max = 5 } = {}) {
  if (!fiche.entrees.length) return [];
  return fiches
    .filter((f) => f.id !== fiche.id)
    .map((f) => ({ fiche: f, r: rapprochement(fiche, f) }))
    .filter(({ r }) => r.memeEmpreinte || r.memeMatiere
                    || (r.entrees && r.entrees.commun > 0))
    .sort((a, b) =>
      (Number(b.r.memeEmpreinte) - Number(a.r.memeEmpreinte))
      || (Number(b.r.memeMatiere) - Number(a.r.memeMatiere))
      || ((b.r.sections?.commun || 0) - (a.r.sections?.commun || 0))
      || ((b.r.entrees?.commun || 0) - (a.r.entrees?.commun || 0))
      || a.fiche.id.localeCompare(b.fiche.id))
    .slice(0, max)
    .map(({ fiche: f, r }) => ({ id: f.id, titre: f.titre, droit: f.droit, rapprochement: r }));
}

export default { MODES, ficheDe, empreinte, rapprochement, familles, candidats,
                 direLeRapprochement, matieres, voisins };
