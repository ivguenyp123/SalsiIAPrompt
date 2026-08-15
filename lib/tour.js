/*
 * Le tour guidé du catalogue.
 *
 * ── POURQUOI IL EXISTE, ET CE QU'IL NE FAIT PAS ──────────────────────────────
 *
 * Le catalogue affiche cinq choses qu'on ne devine pas : une pastille de niveau en
 * pointillés, un verdict de porte recalculé à l'instant, des critères, des cas d'or, et
 * deux boutons dont l'un écrit dans un dépôt. Aucune n'est évidente, et toutes portent le
 * sens du produit — celui qui les lit de travers croira que « officiel » veut dire
 * « éprouvé », ce qui est exactement la faute que ce registre existe pour empêcher.
 *
 * Le tour n'apprend pas à se servir des boutons : il dit ce que les mots VEULENT DIRE.
 * D'où sa brièveté — cinq étapes, une idée chacune. Un tour de quinze étapes se passe.
 *
 * ── LES ÉTAPES SONT DES DONNÉES ──────────────────────────────────────────────
 *
 * Chaque étape désigne un élément par un sélecteur et porte son texte. Une étape dont la
 * cible est absente de l'écran est SAUTÉE, pas affichée dans le vide : le catalogue vide
 * n'a pas de carte, et un tour qui pointerait un élément inexistant apprendrait à se
 * méfier de lui.
 *
 * Module PUR : ni DOM, ni réseau — l'écran fait le rendu, celui-ci décide de la séquence.
 */

/** La clé de mémoire. Un tour qui se rejoue à chaque visite est une publicité. */
export const VU = 'salsi_ia_tour_catalogue';

/**
 * Les étapes du tour du catalogue.
 *
 * `cible` est un sélecteur CSS. `bord` dit de quel côté poser la bulle quand la place le
 * permet. Le texte tient en deux phrases : la première dit ce que c'est, la seconde dit
 * ce que ce n'est PAS — c'est la moitié qui compte, et celle qu'aucune interface ne dit
 * jamais.
 */
export const ETAPES = [
  {
    cle: 'recherche',
    cible: '#q',
    bord: 'bas',
    titre: 'Cherche un besoin, pas un nom',
    texte: 'Le moteur fouille le titre, les étiquettes, l\'intention, ce que l\'agent lit et '
         + 'ce qu\'il vérifie — et il classe. Il répond pendant que tu tapes : « revu » '
         + 'trouve déjà « revue ».'
  },
  {
    cle: 'tags',
    cible: '#tags',
    bord: 'bas',
    titre: 'Les étiquettes viennent des artefacts',
    texte: 'Elles ne sont pas une liste tenue à côté : elles sont dérivées de ce qui est '
         + 'publié, avec leur compte. Cumule-les pour resserrer.'
  },
  {
    cle: 'niveau',
    cible: '.item .pill',
    bord: 'droite',
    titre: 'En pointillés, rien n\'a été mesuré',
    texte: 'Une pastille pleine est un niveau ATTEINT au banc d\'essai. En pointillés, c\'est '
         + 'le niveau VISÉ par l\'auteur — une intention, pas un acquis. C\'est la '
         + 'distinction la plus importante de cet écran.'
  },
  {
    cle: 'porte',
    cible: '.item .foot',
    bord: 'haut',
    titre: 'Le verdict est recalculé maintenant',
    texte: 'La porte n\'est pas un tampon posé à la publication : les règles tournent dans '
         + 'ton navigateur, sur le fichier tel qu\'il est aujourd\'hui. Un artefact peut '
         + 'donc cesser d\'être conforme sans que personne y touche.'
  },
  {
    cle: 'fiche',
    cible: '.item',
    bord: 'droite',
    titre: 'Ouvre une fiche',
    texte: 'Tu y verras ce qui sera vérifié à chaque exécution, ses cas de test, et de quoi '
         + 'la lancer. Le prompt, lui, n\'est pas affiché : ce qui engage, c\'est le '
         + 'contrat, pas le texte.'
  }
];

/** Les étapes dont la cible est réellement à l'écran. */
export function jouables(etapes = ETAPES, existe = () => true) {
  return etapes.filter((e) => existe(e.cible));
}

/**
 * Où poser la bulle par rapport à la cible, sans sortir de l'écran.
 *
 * On respecte `bord` quand il tient, sinon on bascule du côté où il y a la place. Une
 * bulle à moitié hors de l'écran est pire que pas de tour du tout.
 */
export function placer(rect, bulle, ecran, bord = 'bas') {
  const M = 12;
  const ordres = { bas: ['bas', 'haut', 'droite', 'gauche'],
                   haut: ['haut', 'bas', 'droite', 'gauche'],
                   droite: ['droite', 'gauche', 'bas', 'haut'],
                   gauche: ['gauche', 'droite', 'bas', 'haut'] };

  const tient = {
    bas: rect.bas + M + bulle.h <= ecran.h,
    haut: rect.haut - M - bulle.h >= 0,
    droite: rect.droite + M + bulle.w <= ecran.w,
    gauche: rect.gauche - M - bulle.w >= 0
  };

  const choisi = (ordres[bord] || ordres.bas).find((c) => tient[c]) || 'bas';
  const borne = (v, min, max) => Math.max(min, Math.min(v, max));

  if (choisi === 'bas' || choisi === 'haut') {
    return { cote: choisi,
             x: borne(rect.gauche + rect.w / 2 - bulle.w / 2, M, ecran.w - bulle.w - M),
             y: choisi === 'bas' ? rect.bas + M : rect.haut - M - bulle.h };
  }
  return { cote: choisi,
           x: choisi === 'droite' ? rect.droite + M : rect.gauche - M - bulle.w,
           y: borne(rect.haut + rect.h / 2 - bulle.h / 2, M, ecran.h - bulle.h - M) };
}

export default { ETAPES, VU, jouables, placer };
