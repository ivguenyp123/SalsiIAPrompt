/*
 * Le niveau d'un artefact — visé ou atteint, et pourquoi il ne faut jamais confondre.
 *
 * ── LE PROBLÈME ──────────────────────────────────────────────────────────────
 *
 * `target_level: officiel` est une ligne que l'AUTEUR écrit. Le catalogue l'affichait
 * telle quelle, en vert, à côté du titre — donc exactement comme il afficherait un fait.
 * Un utilisateur qui lit « officiel » comprend « ça a été éprouvé ». Rien ne l'a été :
 * aucun banc d'essai ne tourne, aucun cas d'or n'a jamais été joué.
 *
 * C'est la faute la plus grave que ce produit puisse commettre, parce qu'elle porte
 * précisément sur ce qu'il vend : la séparation entre ce qui est DÉCLARÉ et ce qui est
 * DÉRIVÉ. Un registre qui présente une intention comme un acquis ne vaut pas mieux que
 * le tableur qu'il remplace — il est pire, parce qu'il a l'air rigoureux.
 *
 * ── CE QUE FAIT CE MODULE ────────────────────────────────────────────────────
 *
 * Il rend le niveau AVEC sa provenance, et l'écran n'a plus le choix :
 *
 *   pas d'état dérivé   → « officiel — visé »   , marqué `mesure: false`
 *   dérivé, conforme    → « officiel »           , marqué `mesure: true`
 *   dérivé, en dessous  → « équipe · visait officiel »
 *
 * Le troisième cas est celui qui compte le jour où le banc tournera : un artefact qui
 * visait `officiel` et n'atteint qu'`équipe` doit le montrer, pas se taire. C'est là que
 * l'écart entre l'ambition et la preuve devient une information de pilotage.
 *
 * Module PUR : ni DOM, ni réseau. L'état dérivé est INJECTÉ, comme partout ailleurs —
 * c'est ce qui permet au Studio hors ligne, au Catalogue et à l'Admin de dire la même
 * chose sans se recopier.
 */

/** Les niveaux, du moins au plus exigeant. */
export const NIVEAUX = {
  experimental: { label: 'expérimental', ordre: 0 },
  team: { label: 'équipe', ordre: 1 },
  officiel: { label: 'officiel', ordre: 2 }
};

const AIDE_VISE =
  'Niveau VISÉ, écrit par l\'auteur. Aucun banc d\'essai ne l\'a mesuré : ses cas d\'or '
  + 'n\'ont jamais été joués. C\'est une intention, pas un acquis.';

/**
 * Le niveau tel qu'un écran doit l'afficher.
 *
 * @param {object} artifact
 * @param {object} [derive]  état dérivé indexé par identifiant, { <id>: { level } }
 * @returns {{cle, label, vise, atteint, mesure, ecart, texte, suffixe, aide}}
 */
export function niveau(artifact, derive = null) {
  const vise = NIVEAUX[artifact?.target_level] ? artifact.target_level : 'experimental';
  const brut = derive?.[artifact?.id]?.level;
  const atteint = NIVEAUX[brut] ? brut : null;

  if (!atteint) {
    return {
      cle: vise, label: NIVEAUX[vise].label, vise, atteint: null,
      mesure: false, ecart: false,
      suffixe: 'visé',
      texte: `${NIVEAUX[vise].label} — visé`,
      aide: AIDE_VISE
    };
  }

  const ecart = NIVEAUX[atteint].ordre < NIVEAUX[vise].ordre;
  return {
    cle: atteint, label: NIVEAUX[atteint].label, vise, atteint,
    mesure: true, ecart,
    suffixe: ecart ? `visait ${NIVEAUX[vise].label}` : '',
    texte: ecart ? `${NIVEAUX[atteint].label} · visait ${NIVEAUX[vise].label}` : NIVEAUX[atteint].label,
    aide: ecart
      ? `Niveau ATTEINT au banc d'essai : ${NIVEAUX[atteint].label}. L'auteur visait `
        + `${NIVEAUX[vise].label} — l'écart se comble en réussissant les cas d'or manquants.`
      : `Niveau ATTEINT au banc d'essai, sur preuve. L'auteur visait ${NIVEAUX[vise].label}.`
  };
}

/**
 * Le libellé court, pour une pastille.
 * Toujours accompagné de `mesure` : une pastille sans sa provenance est le bug d'origine.
 */
export const pastille = (artifact, derive) => {
  const n = niveau(artifact, derive);
  return { texte: n.mesure ? n.label : `${n.label} · ${n.suffixe}`, mesure: n.mesure,
           cle: n.cle, aide: n.aide, ecart: n.ecart };
};

export default { NIVEAUX, niveau, pastille };
