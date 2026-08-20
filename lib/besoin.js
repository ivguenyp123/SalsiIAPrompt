/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  UNE PHRASE → UNE EMPREINTE DE BESOIN. ET RIEN D'AUTRE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── CE QUE CE MODULE FAIT, ET SURTOUT CE QU'IL NE FAIT PAS ───────────────────
 *
 * Quelqu'un écrit « je veux savoir pourquoi mon pipeline casse ». Ce module rend la
 * MATIÈRE que cette phrase désigne — ici `pipeline_log` — et le DROIT qu'elle réclame.
 * C'est une clé de routage : de quoi interroger `candidats()`.
 *
 * IL N'ÉCRIT PAS D'AGENT. C'est la ligne qui tient tout le reste debout. Si une phrase
 * pouvait produire un artefact — un spec, des critères, des outils, des droits — alors le
 * modèle écrirait la pièce gouvernée, et le lint, la porte et le pré-vol deviendraient des
 * choses qu'on contourne en reformulant. Une phrase route ; un humain écrit.
 *
 * ── POURQUOI C'EST DU CODE, PAS UN APPEL DE MODÈLE ───────────────────────────
 *
 * Le vocabulaire des matières est FERMÉ : c'est le registre des signaux, plus les entrées
 * qui se lisent dans un dépôt. Rapprocher des mots d'une liste fermée est exactement ce
 * qu'un déterministe fait mieux — et surtout, il rend le MÊME résultat deux fois, et il
 * peut dire POURQUOI. Un modèle qui route donne un résultat qu'on ne peut ni reproduire
 * ni contester, pour une tâche qui n'avait pas besoin de lui.
 *
 * Le lexique se déduit du registre des signaux lui-même — leur `libelle` et leur `besoin`.
 * Pas d'une seconde table de synonymes : une table recopiée diverge, et on l'a déjà payé
 * aujourd'hui (l'émetteur avait sa propre copie du vocabulaire, cinq artefacts bloqués).
 *
 * ── LE MOT QUI NE SÉLECTIONNE RIEN EST DIT ───────────────────────────────────
 *
 * « dépôt » apparaît dans la description de presque toutes les matières. S'en servir pour
 * en choisir une reviendrait à tirer au sort. Un mot réclamé par trop de matières est donc
 * rendu à part, comme COMMUN — et ce que la phrase contenait sans que rien ne s'y accroche
 * est rendu comme IGNORÉ.
 *
 * C'est le seul rempart contre le routeur qui a l'air magique : sans ça, quelqu'un écrit
 * trente mots, on en comprend deux, et l'écran a exactement la même tête que si on avait
 * tout compris.
 */
import { plier, fragments } from './recherche.js';

/**
 * Les mots qui ne désignent rien. Liste courte et VOLONTAIREMENT incomplète : un mot vide
 * oublié se retrouve dans « ignorés », ce qui est visible et sans dégât. Un mot utile
 * ajouté ici par excès de zèle disparaîtrait en silence.
 */
export const MOTS_VIDES = new Set([
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'mon', 'ma', 'mes', 'ton', 'ta',
  'tes', 'son', 'sa', 'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs', 'ce', 'cet',
  'cette', 'ces', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont', 'ou',
  'a', 'as', 'ai', 'est', 'sont', 'suis', 'es', 'etre', 'ete', 'avoir', 'ont', 'avait',
  'pour', 'par', 'avec', 'sans', 'sur', 'sous', 'dans', 'en', 'y', 'vers', 'chez',
  'plus', 'moins', 'tres', 'trop', 'peu', 'tout', 'tous', 'toute', 'toutes',
  'me', 'te', 'se', 'moi', 'toi', 'lui', 'eux', 'si', 'ne', 'pas', 'n',
  'veux', 'voudrais', 'aimerais', 'faut', 'besoin', 'peux', 'peut', 'faire', 'avoir',
  'quel', 'quelle', 'quels', 'quelles', 'comment', 'pourquoi', 'quand', 'ou',
  'the', 'my', 'i', 'want', 'to', 'of', 'is', 'are'
]);

/**
 * Un mot réclamé par plus de matières que ça ne désigne plus rien.
 *
 * Trois est petit exprès. Le coût d'être trop strict est visible — le mot ressort comme
 * commun, et la personne le voit ; le coût d'être trop laxiste est invisible — on
 * sélectionne quatorze matières et l'écran a l'air d'avoir compris.
 */
export const SEUIL_COMMUN = 3;

/**
 * Le pluriel français, à la hache.
 *
 * `vulnerabilites` et `vulnerabilite` doivent se rejoindre. On coupe le `s` ou le `x`
 * final au-delà de quatre lettres, et rien de plus : `chevaux`/`cheval` ne se rejoindront
 * pas, et c'est assumé. Une vraie racinisation demanderait un dictionnaire, pour un gain
 * nul sur un vocabulaire technique de trente entrées qu'on écrit soi-même.
 */
export const racine = (m) => (m.length > 4 ? m.replace(/[sx]$/, '') : m);

const motsDe = (texte) => fragments(texte).map(racine)
  .filter((m) => m.length > 1 && !MOTS_VIDES.has(m));

/**
 * Le lexique : quels mots désignent quelle matière, et lesquels sont trop répandus.
 *
 * @param {object} o
 *   @param {object} o.signaux  le registre `SIGNAUX` — `libelle` et `besoin` par entrée
 *   @param {object} o.sources  `SOURCES_ENTREES` — toutes les entrées du vocabulaire
 */
export function lexique({ signaux = {}, sources = {} } = {}) {
  const parEntree = new Map();

  // Toute entrée du vocabulaire compte, même sans signal : `diff` et `code` se lisent dans
  // le dépôt et n'ont pas de fiche de signal. Les omettre rendrait le routeur aveugle à la
  // matière la plus courante de la plateforme.
  for (const entree of new Set([...Object.keys(sources), ...Object.keys(signaux)])) {
    const s = signaux[entree] || {};
    /*
     * `mots` : les mots que les gens emploient et que la description n'a pas.
     *
     * « faille » pour une vulnérabilité, « bus factor » pour la répartition. Mesuré :
     * « les failles de mon dépôt » ne trouvait rien, alors que c'est la formulation la
     * plus courante en français.
     *
     * Ce champ vit SUR LA FICHE DU SIGNAL, pas dans une table de synonymes à part. Une
     * table recopiée diverge — on l'a payé aujourd'hui même avec l'émetteur. Colocalisé,
     * il se met à jour là où on modifie déjà le libellé.
     */
    const mots = new Set([...motsDe(entree.replace(/_/g, ' ')),
                          ...motsDe(s.libelle || ''), ...motsDe(s.besoin || ''),
                          ...(s.mots || []).flatMap(motsDe)]);
    parEntree.set(entree, mots);
  }

  const parMot = new Map();
  for (const [entree, mots] of parEntree) {
    for (const m of mots) parMot.set(m, [...(parMot.get(m) || []), entree]);
  }
  return { parEntree, parMot };
}

/**
 * Les verbes qui engagent une ÉCRITURE dans la forge.
 *
 * Liste fermée, et courte. Un verbe manquant coûte un droit non détecté — la personne
 * coche la case elle-même. Un verbe de trop ferait proposer des agents qui écrivent à
 * quelqu'un qui voulait seulement comprendre, et c'est le sens dans lequel on ne se
 * trompe pas.
 */
export const VERBES_ECRITURE = ['corrige', 'corriger', 'correction', 'corrective',
  'propose', 'proposer', 'proposition', 'repare', 'reparer', 'fixe', 'fixer',
  'commit', 'commiter', 'pousse', 'pousser', 'applique', 'appliquer', 'patch', 'patche'];

/*
 * CE QUI N'EST PAS DANS CETTE LISTE, ET POURQUOI.
 *
 * `mr`, `merge`, `request`, `branche`, `ouvrir`, `modifier` en ont été RETIRÉS après
 * mesure : « relire une merge request » était classé comme une demande d'écriture. Or
 * relire ne modifie rien — et le classer ainsi mettait en avant des capacités qui écrivent
 * dans la forge pour quelqu'un qui voulait seulement lire.
 *
 * Ce sont des noms, pas des actions. `propose` attrape déjà « propose une MR », qui est la
 * vraie formulation d'une demande d'écriture. On garde donc les VERBES, et on rate le cas
 * tordu plutôt que d'inventer un droit.
 */

const ECRITURE = new Set(VERBES_ECRITURE.map(racine));

/**
 * Ce qu'une phrase désigne, et ce qu'elle n'a pas désigné.
 *
 * Le résultat n'est PAS un agent, PAS un score, PAS un classement : c'est une empreinte
 * de besoin, faite pour être montrée, corrigée à la main, puis passée à `candidats()`.
 *
 * @returns {object}
 *   `entrees`   les matières désignées, chacune avec les mots qui l'ont désignée
 *   `droit`     `write` si la phrase demande d'agir sur la forge, `none` sinon
 *   `communs`   les mots trop répandus pour désigner quoi que ce soit — DITS, pas cachés
 *   `ignores`   les mots qui n'ont rien accroché du tout — DITS aussi
 */
export function comprendre(phrase, lex) {
  const mots = motsDe(phrase);
  const trouve = new Map();
  const communs = [];
  const ignores = [];

  for (const m of mots) {
    const cibles = lex.parMot.get(m);
    // Un verbe d'écriture EST compris — il a fixé le droit. Le lister aussi comme ignoré
    // ferait dire deux choses contraires du même mot dans le même écran.
    if (!cibles) { if (!ignores.includes(m) && !ECRITURE.has(m)) ignores.push(m); continue; }
    if (cibles.length > SEUIL_COMMUN) {
      if (!communs.some((c) => c.mot === m)) communs.push({ mot: m, n: cibles.length, cibles });
      continue;
    }
    for (const e of cibles) {
      if (!trouve.has(e)) trouve.set(e, []);
      if (!trouve.get(e).includes(m)) trouve.get(e).push(m);
    }
  }

  /*
   * ── DEUX MOTS BANALS ENSEMBLE NE SONT PAS BANALS ────────────────────────────
   *
   * `inventaire_fichiers` n'a que deux mots, « inventaire » et « fichier », tous deux
   * répandus. Prise séparément, aucune de ces deux clés ne désigne quoi que ce soit : la
   * matière était AU REGISTRE ET HORS D'ATTEINTE, introuvable par n'importe quelle phrase.
   * C'est un test qui l'a dit, pas une relecture.
   *
   * Or leur INTERSECTION ne contient qu'elle. On croise donc les mots répandus entre eux
   * avant de renoncer : ce qui survit au croisement est aussi précis qu'un mot rare, et
   * les motifs rendus disent exactement quels mots ont convergé.
   *
   * Le croisement est TOTAL — tous les mots répandus à la fois. Sur une phrase longue il
   * rend souvent le vide, et c'est très bien : on retombe alors sur les pistes, qui
   * demandent. Un croisement partiel « au mieux » rendrait un résultat qu'on ne saurait
   * plus expliquer.
   */
  if (!trouve.size && communs.length > 1) {
    const croix = communs.reduce((acc, x) => acc.filter((e) => x.cibles.includes(e)),
                                 communs[0].cibles);
    if (croix.length && croix.length <= SEUIL_COMMUN) {
      for (const e of croix) trouve.set(e, communs.map((x) => x.mot));
    }
  }

  /*
   * ── UN MOT TROP RÉPANDU NARROWE, IL NE DISPARAÎT PAS ────────────────────────
   *
   * Mesuré : « pourquoi mon pipeline casse » ne rendait RIEN, parce que « pipeline »
   * désigne sept matières. C'est la question la plus fréquente du métier, et la seule
   * réponse était « aucune matière reconnue ». Écarter un mot pour cause d'abondance quand
   * c'est le SEUL qu'on ait est un contresens : il ne tranche pas, mais il restreint.
   *
   * Ces sept-là deviennent donc des PISTES — pas une réponse. La différence tient : une
   * réponse s'affiche, une piste se choisit. L'écran demande « lequel ? » au lieu de
   * décider à la place de quelqu'un, et c'est le seul endroit du parcours où la
   * plateforme a le droit de poser une question.
   *
   * Et elles ne sortent QUE si rien de distinctif n'a été trouvé : quand la phrase désigne
   * quelque chose, un mot passe-partout n'a pas à venir l'élargir.
   */
  const pistes = trouve.size ? [] : [...new Map(communs.flatMap((c) =>
    c.cibles.map((e) => [e, { entree: e, mot: c.mot }]))).values()]
    .sort((a, b) => a.entree.localeCompare(b.entree));

  const motsEcriture = mots.filter((m) => ECRITURE.has(m));

  return {
    pistes,
    phrase: String(phrase || ''),
    /*
     * Classées par NOMBRE DE MOTS QUI LES ONT DÉSIGNÉES — un compte, pas un score. Deux
     * mots valent mieux qu'un pour décider où regarder en premier, et l'ordre se conteste
     * puisque les mots sont là.
     */
    entrees: [...trouve.entries()]
      .map(([entree, motifs]) => ({ entree, motifs }))
      .sort((a, b) => b.motifs.length - a.motifs.length || a.entree.localeCompare(b.entree)),
    droit: motsEcriture.length ? 'write' : 'none',
    motifsDroit: [...new Set(motsEcriture)],
    communs,
    ignores
  };
}

/**
 * Ce qu'on a compris, en toutes lettres — et ce qu'on n'a pas compris, dans la même phrase.
 *
 * Les deux ensemble, toujours. Dire seulement ce qu'on a compris est ce qui fait passer un
 * routeur pour intelligent alors qu'il a lu deux mots sur trente.
 */
export function direLeBesoin(c, { libelle = (e) => e } = {}) {
  const L = [];
  if (!c.entrees.length && c.pistes.length) {
    /*
     * On a un mot, il ne tranche pas, on le DIT et on demande. C'est le seul moment où la
     * plateforme pose une question — et c'est mieux que les deux alternatives : décider à
     * la place de quelqu'un, ou répondre « rien trouvé » alors qu'on a sept pistes.
     */
    L.push(`${c.pistes.length} MATIÈRES POSSIBLES, et je ne peux pas choisir : `
      + `${[...new Set(c.pistes.map((p) => `« ${p.mot} »`))].join(', ')} `
      + 'désigne(nt) plusieurs choses ici. Laquelle ?');
  } else if (!c.entrees.length) {
    L.push('AUCUNE MATIÈRE RECONNUE dans cette phrase.');
    L.push('Ce n\'est pas « il n\'y a rien pour toi » : c\'est que rien ici ne correspond au '
         + 'vocabulaire des matières que la plateforme sait fournir. Choisis-en une '
         + 'directement dans la liste, ou reformule avec ce que tu as sous la main — un '
         + 'diff, un dépôt, une exécution de CI.');
  } else {
    L.push(`MATIÈRE(S) RECONNUE(S) : ${c.entrees.map((e) =>
      `${libelle(e.entree)} (${e.motifs.map((m) => `« ${m} »`).join(', ')})`).join(' · ')}.`);
  }

  if (c.droit === 'write') {
    L.push(`Cette phrase demande d'AGIR sur la forge (${c.motifsDroit.map((m) => `« ${m} »`)
      .join(', ')}), pas seulement de lire. Les capacités qui en sont capables sont donc `
      + 'montrées à part : elles demandent un droit que les autres n\'ont pas.');
  }

  // Quand les pistes sont sorties, ces mots-là sont DÉJÀ la question posée juste au-dessus :
  // les répéter comme « n'ont rien sélectionné » contredirait la ligne précédente.
  if (c.communs.length && !c.pistes.length) {
    L.push(`TROP RÉPANDU POUR DÉSIGNER QUOI QUE CE SOIT : ${c.communs.map((x) =>
      `« ${x.mot} » (${x.n} matières)`).join(', ')}. Ces mots n'ont rien sélectionné, `
      + 'parce que quelque chose de plus précis l\'a fait.');
  }
  if (c.ignores.length) {
    L.push(`PAS COMPRIS : ${c.ignores.map((m) => `« ${m} »`).join(', ')}. `
         + 'Ces mots n\'ont accroché aucune matière — si l\'essentiel de ton besoin est '
         + 'là-dedans, ce qui suit passe à côté.');
  }
  return L.join('\n');
}

/**
 * Le besoin dit-il assez pour qu'on montre un classement ?
 *
 * Sans matière reconnue, `candidats()` rend TOUT le registre — ce qui est correct (on ne
 * devine pas) mais se lit comme une réponse. Cent quarante cartes ne sont pas une réponse,
 * et les présenter comme telle est exactement le mensonge qu'on essaie d'éviter.
 */
export const aDeQuoiRouter = (c) => c.entrees.length > 0;

/** Les matières retenues, prêtes pour `candidats()`. Les pistes n'en font PAS partie. */
export const matieresRetenues = (c) => c.entrees.map((e) => e.entree);

export default { MOTS_VIDES, SEUIL_COMMUN, VERBES_ECRITURE, racine,
                 lexique, comprendre, direLeBesoin, aDeQuoiRouter };
