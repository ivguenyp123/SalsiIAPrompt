/*
 * Le journal des exécutions sur disque.
 *
 * Une ligne JSON par exécution, ajoutée en fin de fichier. Rien de plus.
 *
 * ── POURQUOI DU JSONL, ET PAS UN JSON ────────────────────────────────────────
 *
 * Un tableau JSON se relit et se réécrit ENTIER à chaque ajout. Au bout de quelques
 * milliers d'exécutions, chaque lancement paierait la relecture de tout l'historique — et
 * surtout, deux lancements simultanés se marcheraient dessus : le second réécrirait le
 * fichier qu'il a lu avant que le premier n'y écrive, et une exécution disparaîtrait sans
 * bruit. Un `appendFileSync` d'une ligne, lui, est atomique en pratique tant que la ligne
 * tient sous la taille d'un bloc — et une ligne de journal fait quelques centaines
 * d'octets.
 *
 * C'est aussi le format qui se réimporte tel quel dans à peu près n'importe quoi le jour
 * où ça bascule en base, ce qui est le sens de l'histoire : ce fichier est le magasin d'un
 * serveur de développement, pas d'une banque.
 *
 * ── LA RÈGLE ABSOLUE DE CE FICHIER ───────────────────────────────────────────
 *
 * JOURNALISER NE DOIT JAMAIS FAIRE ÉCHOUER UNE EXÉCUTION. Un disque plein, un dossier en
 * lecture seule, un montage réseau qui a disparu : aucun de ces cas ne justifie de perdre
 * une réponse que l'utilisateur a attendue et payée. Toutes les écritures sont donc
 * avalées, et le seul signal est `dernierEchec` — visible par l'écran, pour que la panne
 * du journal ne soit pas silencieuse non plus.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Le chemin, connu des deux côtés — écriture ici, lecture par la route. */
export const CHEMIN = 'derive/executions.jsonl';

/*
 * Le plafond de lecture.
 *
 * L'Admin agrège en mémoire. Sans plafond, un journal d'un an mettrait le serveur à
 * genoux au premier rafraîchissement de l'écran. On garde les DERNIÈRES lignes, jamais
 * les premières : personne n'ouvre un journal pour lire le mois de janvier.
 *
 * Et surtout : quand ça coupe, ÇA SE DIT. Un plafond silencieux ferait afficher « 5 000
 * exécutions » à une plateforme qui en a fait 40 000, et le total serait faux sans que
 * rien ne le signale.
 */
export const MAX_LIGNES = 20000;

/** La dernière erreur d'écriture, pour que la panne du journal soit visible. */
let dernierEchec = null;
export const echec = () => dernierEchec;

/**
 * Ajoute une ligne. Ne jette jamais.
 * @returns {boolean} vrai si la ligne est bien partie sur le disque
 */
export function ajouter(ligne, { root = ROOT, chemin = CHEMIN } = {}) {
  try {
    const cible = join(root, chemin);
    mkdirSync(dirname(cible), { recursive: true });
    // Le saut de ligne EN FIN, jamais en tête : un fichier qui commence par une ligne
    // vide se relit très bien, mais un fichier tronqué au milieu d'une écriture laisse
    // une ligne incomplète que la lecture doit savoir jeter. Elle sait.
    appendFileSync(cible, `${JSON.stringify(ligne)}\n`, 'utf8');
    dernierEchec = null;
    return true;
  } catch (error) {
    dernierEchec = { le: new Date().toISOString(), message: String(error?.message || error) };
    return false;
  }
}

/**
 * Relit le journal.
 *
 * Une ligne illisible est SAUTÉE, pas fatale. Un journal en append n'a aucune garantie
 * d'être entier : une coupure de courant au milieu d'un `appendFileSync` laisse une
 * dernière ligne tronquée. Refuser tout le fichier pour ça reviendrait à perdre
 * l'historique complet à cause de son dernier octet.
 *
 * @returns {{lignes, total, tronque, illisibles}}
 */
export function lire({ root = ROOT, chemin = CHEMIN, max = MAX_LIGNES } = {}) {
  const cible = join(root, chemin);
  if (!existsSync(cible)) {
    return { lignes: [], total: 0, tronque: false, illisibles: 0, octets: 0 };
  }

  let brut = '';
  try { brut = readFileSync(cible, 'utf8'); }
  catch (error) {
    return { lignes: [], total: 0, tronque: false, illisibles: 0, octets: 0,
             erreur: String(error?.message || error) };
  }

  const toutes = brut.split('\n').filter((l) => l.trim());
  const gardees = toutes.slice(-max);

  let illisibles = 0;
  const lignes = [];
  for (const l of gardees) {
    try { lignes.push(JSON.parse(l)); }
    catch { illisibles += 1; }
  }

  // Trié par date : l'ordre d'ajout suffit en pratique, mais deux serveurs qui écrivent
  // le même fichier ne le garantissent pas, et les agrégats supposent l'ordre.
  lignes.sort((a, b) => String(a.le).localeCompare(String(b.le)));

  let octets = 0;
  try { octets = statSync(cible).size; } catch { /* la taille n'est qu'un confort */ }

  return { lignes, total: toutes.length, tronque: toutes.length > gardees.length,
           illisibles, octets };
}

export default { CHEMIN, MAX_LIGNES, ajouter, lire, echec };
