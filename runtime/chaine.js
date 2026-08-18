/*
 * Dérouler une chaîne — le « manager », et c'est du code.
 *
 * ── LA DÉCISION QUI PORTE TOUT ───────────────────────────────────────────────
 *
 * La mode est à l'agent orchestrateur : un LLM lit l'état, décide de l'étape suivante,
 * recommence. Ça se démontre bien et ça s'audite mal — six mois plus tard, personne ne
 * peut dire pourquoi la chaîne a pris ce chemin-là ce jour-là.
 *
 * Ici la séquence est DÉCLARÉE dans l'artefact, ce module la déroule, et il ne décide de
 * rien. Le seul jugement porté entre deux étapes est celui de `resolveurs.js` : le
 * contrat de l'étape qui vient de finir, évalué par du code, sans LLM.
 *
 * C'est la phrase du dépôt appliquée à l'orchestration : le déterministe décide et
 * bloque, le LLM conseille, l'humain tranche. Un orchestrateur LLM les inverserait toutes
 * les trois d'un coup.
 *
 * ── UNE ÉTAPE QUI VIOLE SON CONTRAT ARRÊTE LA CHAÎNE ─────────────────────────
 *
 * C'est LE point. Sans ça, une chaîne est un tuyau : l'étape 2 reçoit une sortie
 * aberrante de l'étape 1, produit à son tour n'importe quoi, et l'erreur ne se voit qu'au
 * bout — attribuée à la mauvaise étape. Avec ça, on sait quelle brique a lâché, sur quel
 * critère, et on n'a pas payé les étapes suivantes.
 *
 * Chaque brique a déjà son `criteria`, écrit et relu pour elle-même. On ne réinvente
 * rien : on l'applique là où il devient utile.
 *
 * Module PUR : `jouer()` est injecté. Il ne sait pas s'il parle à Vertex, à DeepSeek ou
 * à un tableau de sorties écrites à la main.
 */
import { resoudreEntrees } from '../lib/chaine.js';
import { ouvrir as ouvrirAtelier, ecrire as ecrireAtelier,
         resume as resumeAtelier } from '../lib/atelier.js';
import { postvol } from './resolveurs.js';

/**
 * Déroule une chaîne.
 *
 * @param {object} artefact          la chaîne (`kind: chain`)
 * @param {object} options
 *   @param {Map}      options.parId    artefacts du registre, indexés par identifiant
 *   @param {Function} options.jouer    async (artefactCible, valeurs, etape) => { sortie, … }
 *   @param {object}   [options.valeurs] les entrées de la chaîne
 *   @param {Function} [options.sur]     (evenement) => void, pour l'affichage en direct
 * @returns {{etapes, sortie, conforme, arretee, raison}}
 */
export async function derouler(artefact, { parId = new Map(), jouer, valeurs = {},
                                           sur = () => {} } = {}) {
  const journal = [];
  const sorties = {};
  let arretee = null;

  /*
   * L'ATELIER NAÎT ICI, VIDE, ET MEURT AVEC CE PASSAGE.
   *
   * Pas de persistance, et ce n'est pas une simplification : un atelier partagé entre
   * deux passages rendrait le résultat d'une chaîne dépendant de ce qu'une autre y a
   * laissé la veille. « Qu'est-ce que l'agent a vu ce jour-là ? » est la question à
   * laquelle cette plateforme doit pouvoir répondre, et un état qui survit lui retire
   * sa réponse.
   */
  const atelier = ouvrirAtelier(artefact?.atelier || []);

  for (const etape of artefact?.steps || []) {
    const cible = parId.get(etape.artefact);

    if (!cible) {
      // L024 le refuse au lint. Ici on ne devine pas : on s'arrête en le disant.
      arretee = { etape: etape.id,
                  raison: `L'artefact \`${etape.artefact}\` est introuvable au registre.` };
      journal.push({ ...vide(etape), erreur: arretee.raison });
      break;
    }

    const entrees = resoudreEntrees(etape, valeurs, sorties, atelier);
    sur({ type: 'depart', etape: etape.id, artefact: cible.id, titre: cible.title });

    let reponse;
    try {
      reponse = await jouer(cible, entrees, etape);
    } catch (error) {
      arretee = { etape: etape.id, raison: error?.message || String(error) };
      journal.push({ ...vide(etape), artefactTitre: cible.title, erreur: arretee.raison });
      break;
    }

    /*
     * Le contrat de la brique, évalué ICI. Pas celui de la chaîne : chaque étape répond
     * de ce qu'elle a promis pour elle-même, et c'est ce qui permet de nommer la brique
     * qui a lâché plutôt que de constater un résultat aberrant au bout.
     */
    const verdict = postvol(cible, reponse?.sortie ?? '', { artifact: cible, valeurs: entrees });

    const ligne = {
      etape: etape.id,
      artefact: cible.id,
      artefactTitre: cible.title || cible.id,
      entrees,
      sortie: reponse?.sortie ?? '',
      jetons: reponse?.jetons || null,
      cout: reponse?.cout ?? null,
      modele: reponse?.modele || '',
      postvol: verdict,
      conforme: verdict.conforme,
      erreur: ''
    };
    /*
     * L'ÉCRITURE DANS L'ATELIER SE FAIT AVANT LE VERDICT DE CONTRAT.
     *
     * Une étape qui viole son contrat arrête la chaîne — mais ce qu'elle a produit a bien
     * été produit, et l'effacer de l'atelier ferait mentir le journal du passage sur ce
     * qui s'est réellement passé. On écrit, on inscrit, et c'est le verdict qui arrête.
     * Un écran qui montre l'atelier après un arrêt doit montrer l'état RÉEL.
     */
    if (etape.ecrit?.cle) {
      const w = ecrireAtelier(atelier, { cle: etape.ecrit.cle, texte: ligne.sortie,
                                         etape: etape.id, mode: etape.ecrit.mode || 'ajoute' });
      ligne.atelier = { cle: etape.ecrit.cle, ecrit: w.ecrit, refus: w.refus,
                        octets: w.octets, caviarde: w.caviarde || [] };
    }

    journal.push(ligne);
    sur({ type: 'etape', resultat: ligne });

    if (!verdict.conforme) {
      arretee = {
        etape: etape.id,
        raison: `\`${cible.id}\` viole son propre contrat : `
              + `${verdict.violes.map((v) => `${v.cible} ${v.op} ${JSON.stringify(v.attendu)}`).join(', ')}.`
      };
      break;
    }

    sorties[etape.id] = ligne.sortie;
  }

  const derniere = journal.at(-1);
  return {
    artefact: artefact?.id,
    etapes: journal,
    // La sortie de la chaîne est celle de sa DERNIÈRE étape jouée — et `null` si elle
    // s'est arrêtée, parce qu'une sortie partielle présentée comme un résultat serait
    // exactement le tuyau qu'on refuse.
    sortie: arretee ? null : (derniere?.sortie ?? ''),
    conforme: !arretee,
    // L'atelier tel qu'il est à la fin, arrêt compris : c'est ce que l'écran montre, et
    // c'est la réponse à « qu'est-ce que les étapes se sont passé ».
    atelier: resumeAtelier(atelier),
    atelierJournal: atelier.journal,
    arretee,
    raison: arretee ? `Chaîne arrêtée à l'étape \`${arretee.etape}\` : ${arretee.raison}` : ''
  };
}

const vide = (etape) => ({
  etape: etape.id, artefact: etape.artefact, artefactTitre: etape.artefact,
  entrees: {}, sortie: '', jetons: null, cout: null, modele: '',
  postvol: null, conforme: false
});

/** Ce que le passage a coûté, toutes étapes confondues. */
export function depense(etapes = []) {
  let euros = 0; let connu = false; let entree = 0; let sortie = 0;
  for (const e of etapes) {
    entree += e.jetons?.entree || 0;
    sortie += e.jetons?.sortie || 0;
    if (typeof e.cout === 'number') { euros += e.cout; connu = true; }
  }
  // `null` et pas `0` : sans tarif déclaré, le coût est INCONNU. Zéro serait une mesure.
  return { etapes: etapes.length, jetons: { entree, sortie }, euros: connu ? euros : null };
}

export default { derouler, depense };
