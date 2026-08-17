/*
 * La matière d'une revue de merge request — la MR choisie, déjà assemblée.
 *
 * ── CE QUI EXISTAIT, ET POURQUOI ÇA NE SUFFISAIT PAS ─────────────────────────
 *
 * « Relire un changement » savait déjà lire une pull request : le champ de matière offre
 * trois sources — un fichier, une PR ouverte, un collage — et la deuxième mène à la liste.
 * Trois clics, dont le premier demande de choisir un mot, « source », qui n'est le
 * vocabulaire de personne.
 *
 * Or on ne relit pas « une source » : on relit LA merge request de quelqu'un. Quand c'est
 * la seule chose que l'agent fait, le choix de la source est un détour, et un détour
 * suffit à ce qu'on n'utilise pas l'outil.
 *
 * La MR devient donc une matière CALCULÉE, comme le bus factor ou les secrets : on choisit
 * un dépôt, on déroule la liste des MR ouvertes, et le diff est assemblé tout seul.
 *
 * ── LA MATIÈRE PORTE LE CONTEXTE, PAS SEULEMENT LE DIFF ──────────────────────
 *
 * Un diff nu se relit mal. Le titre dit l'intention annoncée, et l'écart entre l'intention
 * et le contenu est le constat le plus utile d'une revue — celui qu'aucun outil ne voit.
 * La branche cible dit si ça part en production. Le nombre de fichiers dit si la MR est
 * relisable du tout : au-delà d'une certaine taille, la seule remarque honnête est
 * « découpe-la ».
 *
 * Module PUR : ni forge, ni DOM, ni réseau, ni horloge.
 */

/** Ce qu'on sait calculer pour une revue. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_REVUE = {
  revue_mr: {
    libelle: 'la merge request à relire',
    besoin: 'une merge request ouverte du dépôt, choisie dans la liste',
    source: 'js/mr-reviewer.js',
    // L'écran doit dérouler les MR ouvertes du dépôt plutôt que de demander un collage.
    parMr: true
  }
};

/*
 * Le plafond du diff envoyé au modèle.
 *
 * Une MR de refonte fait des centaines de milliers de caractères : l'envoyer coûte cher,
 * dépasse la fenêtre du modèle, et ne produit rien d'utile — on ne relit pas une refonte
 * en une passe. Ce qui est coupé est DIT, et le fait d'avoir coupé est lui-même un constat
 * de revue : une MR qu'on ne peut pas lire d'un bloc est une MR à découper.
 */
export const MAX_DIFF = 60000;

/** Au-delà, une merge request n'est plus relisable en une fois. C'est un constat. */
export const TROP_DE_FICHIERS = 20;

/**
 * La matière de `revue_mr`.
 *
 * @param {object} donnees
 *   depot        le dépôt
 *   pr           `{ numero, titre, branche, cible, auteur, url }`
 *   diff         le diff unifié, déjà assemblé par `lib/matiere.js`
 *   fichiers     combien de fichiers il touche
 *   binaires     les fichiers binaires, sans patch lisible
 */
export function revueMr({ depot = '', pr = null, diff = '', fichiers = 0,
                          binaires = [] } = {}) {
  const complet = String(diff || '');
  const coupe = complet.length > MAX_DIFF;
  const corps = coupe ? complet.slice(0, MAX_DIFF) : complet;

  const r = { depot, pr, fichiers, binaires, coupe,
              taille: complet.length, envoye: corps.length, grosse: fichiers > TROP_DE_FICHIERS };
  return { ...r, diff: corps, texte: texteRevue(r, corps),
           presentation: presentationRevue(r) };
}

function texteRevue(r, corps) {
  if (!r.pr) {
    return `Dépôt : ${r.depot}\n\nAucune merge request choisie. Il n'y a rien à relire.`;
  }

  const l = [
    `MERGE REQUEST #${r.pr.numero} — ${r.depot}`,
    `Titre annoncé : ${r.pr.titre}`,
    `${r.pr.branche} → ${r.pr.cible}${r.pr.auteur ? `   ·   par ${r.pr.auteur}` : ''}`,
    `${r.fichiers} fichier(s) touché(s), ${r.taille} caractères de diff.`,
    ''
  ];

  if (r.grosse) {
    l.push(`⚠ ${r.fichiers} fichiers : au-delà de ${TROP_DE_FICHIERS}, une merge request ne `
      + 'se relit plus vraiment. Ce n\'est pas un défaut du code, c\'est un défaut de '
      + 'découpage — et c\'est une remarque de revue à part entière.', '');
  }
  if (r.binaires.length) {
    l.push(`${r.binaires.length} fichier(s) binaire(s) : leur contenu n'est pas lisible, `
      + `seul leur nom apparaît. ${r.binaires.slice(0, 10).join(', ')}`, '');
  }
  if (r.coupe) {
    l.push(`⚠ DIFF TRONQUÉ : ${r.envoye} caractères envoyés sur ${r.taille}. Ce qui suit `
      + 'la coupure n\'a PAS été lu, et rien ne peut en être dit — ni en bien ni en mal.', '');
  }

  l.push('Le diff :', '', corps);
  return l.join('\n');
}

function presentationRevue(r) {
  if (!r.pr) {
    return { sujet: 'La merge request',
             entete: { valeur: '—', libelle: 'aucune MR choisie', ton: 'na' }, tableaux: [] };
  }
  return {
    sujet: `Merge request #${r.pr.numero}`,
    entete: { valeur: String(r.fichiers),
              libelle: r.fichiers > 1 ? 'fichiers touchés' : 'fichier touché',
              sous: `${r.pr.branche} → ${r.pr.cible}`
                  + (r.pr.auteur ? ` · par ${r.pr.auteur}` : ''),
              ton: r.grosse ? 'moyen' : 'ok' },
    tableaux: [{
      titre: 'Ce qui a été lu',
      colonnes: [{ libelle: 'Élément' }, { libelle: 'Valeur' }],
      lignes: [
        { cellules: [{ texte: 'Titre annoncé' }, { texte: r.pr.titre }] },
        { cellules: [{ texte: 'Fichiers touchés' }, { texte: String(r.fichiers) }],
          ton: r.grosse ? 'moyen' : '' },
        { cellules: [{ texte: 'Diff lu' },
                     { texte: r.coupe ? `${r.envoye} / ${r.taille} caractères — TRONQUÉ`
                                      : `${r.taille} caractères` }],
          ton: r.coupe ? 'ko' : '' },
        ...(r.binaires.length
          ? [{ cellules: [{ texte: 'Binaires, non lisibles' },
                          { texte: r.binaires.join(', ') }], ton: 'moyen' }]
          : [])
      ],
      note: r.coupe
        ? 'Ce qui suit la coupure n\'a pas été lu : la revue ne porte que sur la partie envoyée.'
        : ''
    }]
  };
}

/** Le résumé d'une ligne affiché à l'écran. */
export function resumeRevue(r) {
  if (!r?.pr) return 'aucune merge request choisie';
  return `#${r.pr.numero} · ${r.fichiers} fichier(s) · ${r.pr.branche} → ${r.pr.cible}`
       + (r.coupe ? ' · diff tronqué' : '');
}

export default { SIGNAUX_REVUE, MAX_DIFF, TROP_DE_FICHIERS, revueMr, resumeRevue };
