/*
 * La provenance d'un artefact — écrite dans le fichier, lue à l'écran de validation.
 *
 * ── POURQUOI CE N'EST PAS UN CHAMP DE L'ARTEFACT ─────────────────────────────
 *
 * Le schéma refuse les propriétés qu'il ne connaît pas, et c'est bien. Mais surtout : la
 * provenance ne DÉCRIT PAS la capacité. Elle décrit comment le fichier est arrivé là.
 * Deux artefacts identiques, l'un tapé à la main et l'autre dicté, sont la même capacité
 * — ils ne se relisent simplement pas avec le même œil.
 *
 * Elle vit donc en commentaires de tête, à l'endroit exact où un relecteur de merge
 * request la verra sans qu'on lui ait rien dit. Le parseur YAML les jette, donc rien de
 * tout ça n'atteint le linter, l'exécution ou le catalogue.
 *
 * ── POURQUOI DES CLÉS, ET PAS DE LA PROSE ────────────────────────────────────
 *
 * L'écran d'Admin doit pouvoir en faire un bandeau : « rédigé par la dictée, à partir de
 * cette phrase, en 2 tours ». Un paragraphe libre l'obligerait à deviner. Un format à
 * clés se lit par les deux — l'humain dans le diff, l'écran dans le fichier — et ce
 * module est le seul endroit qui le connaît, pour qu'il ne puisse pas diverger.
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers.
 */

/** La ligne qui dit « ce bloc est une provenance » et pas un commentaire d'auteur. */
export const MARQUEUR = 'salsi-provenance';

/** Ce qu'on sait dire de l'origine d'un fichier. */
export const ORIGINES = {
  demande: 'Demandé en une phrase, rédigé par un modèle',
  dictee: 'Dicté au Studio, rédigé par un modèle',
  // Une chaîne ne contient aucun prompt : elle assemble des artefacts déjà validés. Le
  // relecteur doit le savoir — ce qu'il relit est un ORDRE et un câblage, pas un texte.
  composition: 'Composé de briques déjà validées, assemblées à l\'établi',
  // Un fork n'est pas une création : c'est une reprise. Le relecteur doit savoir de quoi
  // il part — et qu'il ne relit pas un travail neuf mais une adaptation.
  fork: 'Forké depuis une chaîne existante',
  /*
   * ÉCRIT À LA MAIN. C'est la provenance la plus forte, et il manquait le mot pour la
   * dire : les quatre autres décrivent toutes un texte produit par un modèle, à des
   * degrés divers d'assistance.
   *
   * Le relecteur doit pouvoir faire la différence. Une fiche rédigée par un modèle se
   * relit en cherchant ce qu'il a pu inventer ; une fiche écrite à la main se relit en
   * cherchant ce que son auteur a pu oublier. Ce ne sont pas les mêmes yeux.
   */
  main: 'Écrit à la main, sans modèle'
};

const echapper = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Le bloc de commentaires à poser en tête du fichier.
 *
 * La dernière ligne n'est pas une clé : c'est un rappel en français, pour le relecteur qui
 * lit le diff et pas l'écran. Elle dit ce que « la porte est franchie » NE dit pas — aucun
 * cas d'or n'a été joué. Sans elle, un artefact conforme et jamais mesuré se relit comme
 * un artefact éprouvé.
 */
export function entete({ origine = 'demande', phrase = '', auteur = '', date = '',
                         tours = 0, modele = '', fournisseur = '' } = {}) {
  const lignes = [
    `${MARQUEUR}: ${origine}`,
    `besoin: ${echapper(phrase)}`,
    auteur ? `demande-par: ${echapper(auteur)}` : '',
    date ? `le: ${echapper(date)}` : '',
    tours ? `tours-de-correction: ${tours}` : '',
    modele ? `modele: ${echapper(modele)}${fournisseur ? ` via ${echapper(fournisseur)}` : ''}` : ''
  ].filter(Boolean);

  return `${lignes.map((l) => `# ${l}`).join('\n')}\n`
       + '#\n'
       + '# Le linter l\'a laissé passer : sa FORME est vérifiée. Aucun cas d\'or n\'a été joué —\n'
       + '# ce qu\'il fait vraiment reste à mesurer au banc d\'essai.\n\n';
}

/**
 * La provenance d'un fichier, ou `null`.
 *
 * Seul le bloc de TÊTE est lu, et il doit porter le marqueur. Un commentaire écrit par un
 * auteur au milieu du fichier n'est pas une provenance, et un fichier qui en contiendrait
 * un par hasard ne doit pas se présenter comme dicté.
 */
export function lire(texte) {
  const out = {};
  let marque = false;

  for (const brute of String(texte || '').split('\n')) {
    const ligne = brute.trim();
    if (ligne === '') { if (marque) break; continue; }
    if (!ligne.startsWith('#')) break;              // fin du bloc de tête

    const corps = ligne.replace(/^#+\s?/, '').trim();
    const sep = corps.indexOf(':');
    if (sep === -1) continue;                        // une phrase libre, pas une clé

    const cle = corps.slice(0, sep).trim().toLowerCase();
    const valeur = corps.slice(sep + 1).trim();
    if (cle === MARQUEUR) { marque = true; out.origine = valeur; continue; }
    if (marque) out[cle] = valeur;
  }

  if (!marque) return null;
  return {
    origine: out.origine || 'demande',
    libelle: ORIGINES[out.origine] || 'Rédigé par un modèle',
    phrase: out.besoin || '',
    auteur: out['demande-par'] || '',
    date: out.le || '',
    tours: Number(out['tours-de-correction'] || 0) || 0,
    modele: out.modele || ''
  };
}

export default { entete, lire, MARQUEUR, ORIGINES };
