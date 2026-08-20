/*
 * Un LOT de fichiers du poste, devenu une matière nommée.
 *
 * ── LA QUESTION QUI A PRODUIT CE MODULE ──────────────────────────────────────
 *
 * « Un agent où j'importe un zip avec plein de fichiers — les HTML d'analyse par
 * exemple — et qu'il me fasse un rapport complet. »
 *
 * Le cas réel : quatorze analyses d'une chaîne CI, exportées une par une, qu'il faut
 * recoller à la main pour en tirer quoi que ce soit. La plateforme savait aller chercher
 * dans une forge et savait recevoir un collage ; elle ne savait pas recevoir un LOT.
 *
 * ── CE QUE CE MODULE FAIT, ET CE QU'IL REFUSE DE FAIRE ──────────────────────
 *
 * Il transforme N fichiers en UN texte, où chaque fichier est précédé de son nom. C'est
 * tout, et c'est le point : sans le nom, un modèle à qui l'on donne quatorze rapports
 * bout à bout ne peut plus dire de quel job il parle — il rendra une bouillie plausible
 * et impossible à vérifier. Le séparateur n'est pas de la mise en forme, c'est ce qui
 * rend le rapport final traçable.
 *
 * Il ne DÉCIDE rien du contenu : il n'interprète pas, ne trie pas, ne résume pas. Ce qui
 * est coupé — parce qu'un lot peut peser des mégaoctets — est COMPTÉ et DIT, comme
 * partout ailleurs ici. Un extrait présenté comme un lot complet ferait conclure sur ce
 * qu'on n'a pas envoyé.
 *
 * ── LA PROVENANCE EST DIFFÉRENTE, ET ELLE SE DIT ────────────────────────────
 *
 * Tout le reste de la matière vient d'une forge : contestable, rejouable, vérifiable par
 * quelqu'un d'autre. Un lot du poste ne l'est pas — personne d'autre ne peut le relire.
 * L'écran l'annonce donc comme tel, et le texte produit porte son en-tête.
 *
 * Module PUR : ni DOM, ni réseau, ni système de fichiers. Le décompresseur est INJECTÉ —
 * il vit dans le navigateur (`DecompressionStream`) et n'a pas sa place ici.
 */

/** Combien de fichiers d'un lot on retient. Au-delà, le lot n'est plus lu, il est subi. */
export const MAX_FICHIERS = 60;

/** Le plafond de texte, tous fichiers confondus. C'est le total qui coûte et qui dilue. */
export const MAX_CARACTERES = 400_000;

/** Ce qui ne se lit pas comme du texte : l'ouvrir ne donnerait que du binaire. */
export const BINAIRE = /\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|eot|mp[34]|mov|avi|zip|gz|rar|7z|pdf|jar|class|so|dll|exe|bin)$/i;

/* ── Le ZIP ─────────────────────────────────────────────────────────────────── */

const u16 = (d, o) => d.getUint16(o, true);
const u32 = (d, o) => d.getUint32(o, true);

/**
 * Les entrées d'une archive ZIP.
 *
 * On lit le RÉPERTOIRE CENTRAL, pas la suite des en-têtes locaux : c'est la seule table
 * qui fait autorité dans le format, et un en-tête local peut annoncer des tailles nulles
 * quand l'archive a été écrite en flux (le cas des zips faits par un navigateur ou par
 * `zip` en pipe). Lire les en-têtes locaux marcherait sur la plupart des archives et
 * échouerait sur certaines, ce qui est le pire des deux mondes.
 *
 * Seules les méthodes 0 (stocké) et 8 (dégonflé) existent en pratique. Une autre est
 * NOMMÉE dans le résultat plutôt qu'ignorée : un fichier absent sans raison ferait
 * conclure que l'archive ne le contenait pas.
 *
 * @param {ArrayBuffer|Uint8Array} octets
 * @param {(o: Uint8Array) => Promise<Uint8Array>} degonfler  inflate brut, injecté
 * @returns {Promise<{fichiers: Array<{nom, texte}>, illisibles: Array<string>}>}
 */
export async function lireZip(octets, degonfler) {
  const buf = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // La fin du répertoire central : signature PK\x05\x06, cherchée depuis la fin.
  let fin = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66_000; i -= 1) {
    if (u32(d, i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('ce fichier n\'est pas une archive ZIP lisible');

  const nombre = u16(d, fin + 10);
  let p = u32(d, fin + 16);

  const fichiers = [];
  const illisibles = [];
  const dec = new TextDecoder('utf-8');

  for (let i = 0; i < nombre; i += 1) {
    if (u32(d, p) !== 0x02014b50) break;              // répertoire tronqué : on s'arrête là
    const methode = u16(d, p + 10);
    const taille = u32(d, p + 20);
    const nomLong = u16(d, p + 28);
    const extraLong = u16(d, p + 30);
    const commLong = u16(d, p + 32);
    const debutLocal = u32(d, p + 42);
    const nom = dec.decode(buf.subarray(p + 46, p + 46 + nomLong));
    p += 46 + nomLong + extraLong + commLong;

    // Un dossier est une entrée de taille nulle finissant par `/` : rien à lire.
    if (nom.endsWith('/')) continue;
    if (BINAIRE.test(nom)) { illisibles.push(`${nom} (binaire)`); continue; }

    // L'en-tête local ne sert qu'à connaître la longueur de ses propres champs.
    const nomLocal = u16(d, debutLocal + 26);
    const extraLocal = u16(d, debutLocal + 28);
    const debut = debutLocal + 30 + nomLocal + extraLocal;
    const brut = buf.subarray(debut, debut + taille);

    try {
      if (methode === 0) fichiers.push({ nom, texte: dec.decode(brut) });
      else if (methode === 8) fichiers.push({ nom, texte: dec.decode(await degonfler(brut)) });
      else illisibles.push(`${nom} (compression ${methode}, non gérée)`);
    } catch (error) {
      illisibles.push(`${nom} (${error.message})`);
    }
  }
  return { fichiers, illisibles };
}

/* ── Le HTML ────────────────────────────────────────────────────────────────── */

/**
 * Le texte lisible d'une page HTML.
 *
 * Sans ça, un rapport exporté part au modèle avec ses trois cents lignes de CSS : on
 * paierait pour des dégradés et des animations, et la consigne se diluerait dans du bruit
 * que personne ne veut lire. Ce n'est pas un analyseur HTML — c'en serait un mauvais.
 * C'est un DÉBRUITEUR : on retire ce qui n'est jamais du contenu (`script`, `style`), on
 * ouvre les balises, on rend les entités, on écrase les lignes vides.
 *
 * Sur un HTML tordu, il rend un texte imparfait plutôt que rien. C'est le bon compromis
 * ici : la matière est faite pour être LUE par un modèle, pas reparsée par une machine.
 */
export function texteDeHtml(html = '') {
  const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'' };
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (tout, e) => {
      const cle = e.toLowerCase();
      if (ENTITES[cle]) return ENTITES[cle];
      if (cle.startsWith('#x')) return String.fromCodePoint(parseInt(cle.slice(2), 16));
      if (cle.startsWith('#')) return String.fromCodePoint(Number(cle.slice(1)));
      return tout;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Le nom sans son chemin ni son extension — ce qu'un humain appellerait le fichier. */
export const nomCourt = (nom = '') =>
  String(nom).split('/').pop().replace(/\.[a-z0-9]+$/i, '');

/* ── L'assemblage ───────────────────────────────────────────────────────────── */

/*
 * Le séparateur. Il est VOYANT et il porte le nom du fichier, parce que c'est lui qui
 * rend le rapport final traçable : sans lui, un modèle ne peut plus dire de quel fichier
 * vient ce qu'il affirme, et personne ne peut le vérifier.
 */
const barre = (nom) => `\n\n═══════ FICHIER : ${nom} ═══════\n\n`;

/**
 * N fichiers, un texte.
 *
 * Le HTML est débruité, le reste passe tel quel. Ce qui dépasse les plafonds est écarté
 * et COMPTÉ — jamais tronqué en silence au milieu d'un rapport, ce qui donnerait un
 * fichier à moitié lu que rien ne signale.
 *
 * @param {Array<{nom, texte}>} entrees
 * @param {object} e
 *   @param {Array<string>} e.illisibles  ce qu'on n'a pas su ouvrir, déjà nommé
 * @returns {{texte, retenus, ecartes, illisibles, caracteres}}
 */
export function assembler(entrees = [], { illisibles = [] } = {}) {
  // L'ordre du lot est celui du système de fichiers, qui n'a pas de sens pour un lecteur.
  // L'alphabétique en a un : deux assemblages du même lot donnent le même texte.
  const tries = [...entrees].sort((a, b) => String(a.nom).localeCompare(String(b.nom)));

  const retenus = [];
  const ecartes = [];
  let total = 0;

  for (const f of tries) {
    if (retenus.length >= MAX_FICHIERS) { ecartes.push(`${f.nom} (au-delà de ${MAX_FICHIERS} fichiers)`); continue; }
    const texte = /\.html?$/i.test(f.nom) ? texteDeHtml(f.texte) : String(f.texte ?? '');
    if (total + texte.length > MAX_CARACTERES) {
      ecartes.push(`${f.nom} (plafond de ${MAX_CARACTERES} caractères atteint)`);
      continue;
    }
    total += texte.length;
    retenus.push({ nom: f.nom, texte });
  }

  const tete = [];
  tete.push(`LOT DE ${retenus.length} FICHIER(S), APPORTÉ DEPUIS UN POSTE`);
  tete.push('');
  tete.push('Ces fichiers viennent du poste de la personne qui lance — pas d\'un dépôt.');
  tete.push('Personne d\'autre ne peut les relire : ils ne sont ni datés ni rejouables par');
  tete.push('la plateforme. Ce qu\'ils affirment n\'est vrai que si eux le sont.');
  if (ecartes.length) {
    tete.push('');
    tete.push(`${ecartes.length} fichier(s) NON envoyés : ${ecartes.join(', ')}.`);
    tete.push('Ne conclus rien sur eux — leur absence n\'est pas un silence de leur part.');
  }
  if (illisibles.length) {
    tete.push('');
    tete.push(`${illisibles.length} illisible(s), et ce n'est pas le plafond : ${illisibles.join(', ')}.`);
  }

  const texte = retenus.length
    ? tete.join('\n') + retenus.map((f) => barre(f.nom) + f.texte).join('')
    : `${tete.join('\n')}\n\n(aucun fichier lisible dans ce lot)`;

  return { texte, retenus: retenus.length, ecartes, illisibles, caracteres: total };
}

export default { lireZip, texteDeHtml, assembler, nomCourt,
                 MAX_FICHIERS, MAX_CARACTERES, BINAIRE };
