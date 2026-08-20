/*
 * Le lot de fichiers du poste.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. CHAQUE FICHIER PORTE SON NOM dans le texte assemblé. C'est l'invariant : sans lui,
 *    un modèle à qui l'on donne quatorze rapports bout à bout ne peut plus dire de quel
 *    job il parle, et le rapport final devient invérifiable.
 * 2. Ce qui est écarté est COMPTÉ et DIT. Un lot présenté comme complet ferait conclure
 *    sur ce qu'on n'a pas envoyé.
 * 3. Le ZIP est lu par son RÉPERTOIRE CENTRAL, sur une archive VRAIE — fabriquée ici avec
 *    `node:zlib`, pas simulée. Un lecteur de zip testé sur un faux zip ne prouve rien.
 * 4. Le HTML est débruité : le CSS et le JavaScript ne partent pas au modèle.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';

import { lireZip, texteDeHtml, assembler, nomCourt,
         MAX_FICHIERS, MAX_CARACTERES } from '../lib/paquet.js';

/** Le décompresseur injecté. Dans le navigateur c'est `DecompressionStream`. */
const degonfler = async (o) => new Uint8Array(inflateRawSync(Buffer.from(o)));

/* ── Un VRAI zip, écrit ici ───────────────────────────────────────────────── */

/*
 * Fabriqué à la main plutôt que pris d'une bibliothèque : c'est le format qu'on teste, et
 * un zip produit par le même code que le lecteur ne prouverait que leur accord mutuel.
 * Les champs sont ceux de la spécification APPNOTE — en-tête local, répertoire central,
 * fin de répertoire.
 */
function zipDe(fichiers, { methode = 8 } = {}) {
  const enc = new TextEncoder();
  const locaux = [];
  const centraux = [];
  let offset = 0;

  for (const { nom, contenu } of fichiers) {
    const brut = enc.encode(contenu);
    const data = methode === 8 ? new Uint8Array(deflateRawSync(Buffer.from(brut))) : brut;
    const nomOctets = enc.encode(nom);
    const somme = crc32 ? crc32(Buffer.from(brut)) : 0;

    const local = new Uint8Array(30 + nomOctets.length + data.length);
    const dl = new DataView(local.buffer);
    dl.setUint32(0, 0x04034b50, true);
    dl.setUint16(4, 20, true);
    dl.setUint16(8, methode, true);
    dl.setUint32(14, somme, true);
    dl.setUint32(18, data.length, true);
    dl.setUint32(22, brut.length, true);
    dl.setUint16(26, nomOctets.length, true);
    local.set(nomOctets, 30);
    local.set(data, 30 + nomOctets.length);

    const central = new Uint8Array(46 + nomOctets.length);
    const dc = new DataView(central.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint16(6, 20, true);
    dc.setUint16(10, methode, true);
    dc.setUint32(16, somme, true);
    dc.setUint32(20, data.length, true);
    dc.setUint32(24, brut.length, true);
    dc.setUint16(28, nomOctets.length, true);
    dc.setUint32(42, offset, true);
    central.set(nomOctets, 46);

    locaux.push(local);
    centraux.push(central);
    offset += local.length;
  }

  const tailleCentral = centraux.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const df = new DataView(fin.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(8, fichiers.length, true);
  df.setUint16(10, fichiers.length, true);
  df.setUint32(12, tailleCentral, true);
  df.setUint32(16, offset, true);

  const total = offset + tailleCentral + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of [...locaux, ...centraux, fin]) { out.set(b, p); p += b.length; }
  return out;
}

/* ── Le ZIP ──────────────────────────────────────────────────────────────── */

describe('lireZip lit une archive réelle, par son répertoire central', () => {
  test('les fichiers dégonflés ressortent intacts', async () => {
    const zip = zipDe([
      { nom: 'rapport-1.html', contenu: '<h1>Un</h1>' },
      { nom: 'rapport-2.html', contenu: '<h1>Deux</h1>' }
    ]);
    const { fichiers, illisibles } = await lireZip(zip, degonfler);
    assert.deepEqual(fichiers.map((f) => f.nom), ['rapport-1.html', 'rapport-2.html']);
    assert.equal(fichiers[0].texte, '<h1>Un</h1>');
    assert.deepEqual(illisibles, []);
  });

  test('les fichiers STOCKÉS aussi — méthode 0, sans décompression', async () => {
    const zip = zipDe([{ nom: 'notes.txt', contenu: 'brut' }], { methode: 0 });
    const { fichiers } = await lireZip(zip, degonfler);
    assert.equal(fichiers[0].texte, 'brut');
  });

  test('un binaire est NOMMÉ, pas silencieusement absent', async () => {
    const zip = zipDe([{ nom: 'logo.png', contenu: 'xx' }, { nom: 'ok.md', contenu: '# ok' }]);
    const { fichiers, illisibles } = await lireZip(zip, degonfler);
    assert.deepEqual(fichiers.map((f) => f.nom), ['ok.md']);
    assert.match(illisibles[0], /logo\.png \(binaire\)/);
  });

  test('ce qui n\'est pas une archive le dit, au lieu de rendre un lot vide', async () => {
    await assert.rejects(() => lireZip(new Uint8Array([1, 2, 3, 4]), degonfler),
      /n'est pas une archive ZIP lisible/);
  });
});

/* ── Le HTML ─────────────────────────────────────────────────────────────── */

describe('texteDeHtml débruite sans prétendre analyser', () => {
  test('le CSS et le JavaScript ne partent pas au modèle', () => {
    const t = texteDeHtml(
      '<html><head><style>body{color:red}</style></head>'
      + '<body><script>alert(1)</script><h1>Titre</h1><p>Du texte.</p></body></html>');
    assert.ok(!t.includes('color:red'), 'pas de CSS');
    assert.ok(!t.includes('alert'), 'pas de JS');
    assert.match(t, /Titre/);
    assert.match(t, /Du texte\./);
  });

  test('les entités redeviennent des caractères', () => {
    assert.equal(texteDeHtml('<p>a &amp; b &lt; c &#39;d&#39;</p>'), 'a & b < c \'d\'');
  });

  test('les blocs deviennent des lignes, sans avalanche de vides', () => {
    const t = texteDeHtml('<li>un</li><li>deux</li><li>trois</li>');
    assert.deepEqual(t.split('\n').filter(Boolean), ['un', 'deux', 'trois']);
  });
});

/* ── L'assemblage ────────────────────────────────────────────────────────── */

describe('assembler — chaque fichier porte son nom, et ce qui manque se dit', () => {
  const lot = [
    { nom: 'b-deploy.html', texte: '<h2>deploy</h2><p>pousse vers main</p>' },
    { nom: 'a-build.html', texte: '<h2>build</h2><p>construit l\'image</p>' }
  ];

  test('L\'INVARIANT : le nom de chaque fichier est dans le texte envoyé', () => {
    // Sans lui, un modèle ne peut plus dire de quel job il parle, et le rapport final
    // devient invérifiable. C'est la raison d'être de ce module.
    const r = assembler(lot);
    assert.match(r.texte, /FICHIER : a-build\.html/);
    assert.match(r.texte, /FICHIER : b-deploy\.html/);
  });

  test('l\'ordre est alphabétique : deux assemblages du même lot sont identiques', () => {
    assert.equal(assembler(lot).texte, assembler([...lot].reverse()).texte);
    assert.ok(assembler(lot).texte.indexOf('a-build') < assembler(lot).texte.indexOf('b-deploy'));
  });

  test('la provenance est ANNONCÉE — un lot du poste n\'est pas une matière calculée', () => {
    const t = assembler(lot).texte;
    assert.match(t, /APPORTÉ DEPUIS UN POSTE/);
    assert.match(t, /Personne d'autre ne peut les relire/);
  });

  test('le HTML est débruité, le reste passe tel quel', () => {
    const r = assembler([{ nom: 'a.html', texte: '<style>x{}</style><p>vu</p>' },
                         { nom: 'b.md', texte: '# titre <b>gardé</b>' }]);
    assert.ok(!r.texte.includes('x{}'));
    assert.match(r.texte, /# titre <b>gardé<\/b>/, 'un .md n\'est pas du HTML à débruiter');
  });

  test('au-delà du plafond de fichiers : écartés, comptés, NOMMÉS', () => {
    const gros = Array.from({ length: MAX_FICHIERS + 3 },
      (_, i) => ({ nom: `r${String(i).padStart(3, '0')}.txt`, texte: 'x' }));
    const r = assembler(gros);
    assert.equal(r.retenus, MAX_FICHIERS);
    assert.equal(r.ecartes.length, 3);
    assert.match(r.texte, /3 fichier\(s\) NON envoyés/);
    assert.match(r.texte, /Ne conclus rien sur eux/);
  });

  test('au-delà du plafond de caractères : un fichier entier est écarté, jamais coupé', () => {
    // Couper au milieu d'un rapport donnerait un fichier à moitié lu que rien ne signale
    // — pire qu'un fichier absent, qui lui est compté.
    const r = assembler([{ nom: 'a.txt', texte: 'a'.repeat(MAX_CARACTERES - 10) },
                         { nom: 'b.txt', texte: 'b'.repeat(100) }]);
    assert.equal(r.retenus, 1);
    assert.ok(!r.texte.includes('b'.repeat(100)), 'rien de b n\'est parti');
    assert.match(r.ecartes[0], /b\.txt \(plafond/);
  });

  test('les illisibles du zip remontent dans le texte, distincts du plafond', () => {
    const r = assembler([{ nom: 'a.txt', texte: 'x' }], { illisibles: ['logo.png (binaire)'] });
    assert.match(r.texte, /1 illisible\(s\), et ce n'est pas le plafond/);
  });

  test('un lot vide le dit au lieu de rendre une chaîne vide', () => {
    assert.match(assembler([]).texte, /aucun fichier lisible dans ce lot/);
  });
});

describe('nomCourt', () => {
  test('le chemin et l\'extension tombent', () => {
    assert.equal(nomCourt('exports/mon-agent_2026-08-20 (3).html'), 'mon-agent_2026-08-20 (3)');
    assert.equal(nomCourt('a.txt'), 'a');
  });
});
