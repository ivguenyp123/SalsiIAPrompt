/*
 * L'inventaire — le catalogue de ce qu'on peut demander.
 *
 * Deux familles de vérifications, et la seconde est la seule qui empêche vraiment un
 * dégât :
 *
 *   1. le fichier est bien formé — identifiants uniques et valides, deux parseurs
 *      d'accord, chaque entrée porte une phrase envoyable telle quelle
 *   2. l'ÉTAT n'est jamais écrit, toujours confronté. Un catalogue qui mentirait sur ce
 *      qui existe déjà ferait créer deux fois le même agent — et ce jour-là personne ne
 *      soupçonnerait le fichier d'inventaire.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { aplatir, confronter, familles, filtrer, compter, ETATS } from '../lib/inventaire.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRUT = yaml.load(readFileSync(join(ROOT, 'inventaire/hub-devops.yaml'), 'utf8'));
const TOUS = aplatir(BRUT);

const AU_REGISTRE = readdirSync(join(ROOT, 'artifacts'))
  .filter((f) => /\.ya?ml$/.test(f)).map((f) => f.replace(/\.ya?ml$/, ''));

/* ── Le fichier ───────────────────────────────────────────────────────────── */

describe('l\'inventaire du hub', () => {
  test('couvre les familles et les modules du hub', () => {
    assert.ok(BRUT.familles.length >= 4, 'les 4 familles du hub, au moins');
    assert.ok(TOUS.length >= 50, `${TOUS.length} capacités — la surface du hub est large`);
  });

  test('chaque entrée porte un identifiant valide et unique', () => {
    // Le même motif que le schéma d'artefact : une entrée d'inventaire DEVIENT un
    // artefact, et son identifiant devient un nom de fichier.
    const ids = TOUS.map((p) => p.id);
    for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]{0,63}$/, id);
    assert.equal(new Set(ids).size, ids.length, 'aucun doublon');
  });

  test('chaque entrée porte une phrase ENVOYABLE telle quelle', () => {
    /*
     * C'est tout l'intérêt du format : un clic pose la phrase dans le champ et le
     * bouton part. `runtime/api.js` refuse en dessous de 10 caractères — une entrée plus
     * courte serait une ligne cliquable qui échoue, c'est-à-dire pire que rien.
     */
    for (const p of TOUS) {
      assert.ok(p.besoin && p.besoin.length >= 10, `${p.id} : besoin trop court`);
      assert.ok(p.besoin.length <= 2000, `${p.id} : besoin trop long`);
      assert.ok(p.titre, `${p.id} : sans titre`);
      assert.ok(Array.isArray(p.entrees), `${p.id} : entrees doit être une liste`);
    }
  });

  test('les deux parseurs YAML le lisent pareil', async () => {
    // Le même piège que la banque d'entrées : mon parseur accepte un `: ` dans un
    // scalaire nu, js-yaml le refuse. Le fichier doit être du YAML pour tout le monde.
    const texte = readFileSync(join(ROOT, 'inventaire/hub-devops.yaml'), 'utf8');
    const js = (await import('js-yaml')).default.load(texte);
    assert.deepEqual(yaml.load(texte), js);
  });

  test('chaque entrée se rattache à un module nommé', () => {
    // Un inventaire de capacités flottantes ne se maintient pas : on ne sait plus d'où
    // elles viennent ni quoi en faire quand le module disparaît.
    for (const p of TOUS) {
      assert.ok(p.module, `${p.id} : sans module`);
      assert.ok(p.famille, `${p.id} : sans famille`);
    }
  });
});

/* ── L'état, confronté et jamais écrit ────────────────────────────────────── */

describe('l\'état d\'une entrée', () => {
  test('n\'est PAS écrit dans le fichier', () => {
    // La règle du dépôt : déclaré d'un côté, dérivé de l'autre, jamais les deux dans le
    // même champ. Un `etat: au-registre` écrit à la main divergerait à la première
    // validation en Admin.
    for (const p of TOUS) assert.equal('etat' in p, false, `${p.id} porte un état écrit`);
  });

  test('se calcule en confrontant l\'inventaire au registre', () => {
    const vus = confronter(TOUS, ['expliquer-un-code']);
    const un = vus.find((p) => p.id === 'expliquer-un-code');
    assert.equal(un.etat, 'au-registre');
    assert.ok(vus.filter((p) => p.etat === 'a-creer').length > 0);
    assert.deepEqual(Object.keys(ETATS).sort(), ['a-creer', 'au-registre']);
  });

  test('tout artefact PUBLIÉ figure à l\'inventaire', () => {
    /*
     * Le sens inverse, et il compte autant : un agent validé qui n'apparaît nulle part au
     * catalogue est invisible pour qui cherche ce qui est possible — il se fera
     * redemander, et la file de validation recevra un doublon.
     */
    const ids = new Set(TOUS.map((p) => p.id));
    const absents = AU_REGISTRE.filter((id) => !ids.has(id));
    assert.deepEqual(absents, [],
      `ces artefacts publiés manquent à l'inventaire :\n  ${absents.join('\n  ')}`);
  });

  test('les entrées « au registre » correspondent à de vrais fichiers', () => {
    const vus = confronter(TOUS, AU_REGISTRE);
    const faits = vus.filter((p) => p.etat === 'au-registre');
    assert.equal(faits.length, AU_REGISTRE.length);
    for (const p of faits) assert.ok(AU_REGISTRE.includes(p.id));
  });
});

/* ── La recherche et les filtres ──────────────────────────────────────────── */

describe('chercher dans le catalogue', () => {
  const VUS = confronter(TOUS, AU_REGISTRE);

  test('cherche dans le titre, le besoin et le module — pas dans l\'identifiant', () => {
    // Quelqu'un qui cherche « flag » pense à ce qu'il veut obtenir, pas à
    // `proposer-un-plan-de-decommission-de-flag`.
    const r = filtrer(VUS, { q: 'flag' });
    assert.ok(r.length >= 3, `${r.length} résultats sur « flag »`);
    assert.ok(r.every((p) => /flag/i.test(`${p.titre} ${p.besoin} ${p.module}`)));
  });

  test('les fragments se cumulent', () => {
    const r = filtrer(VUS, { q: 'pipeline echec' });
    assert.ok(r.length >= 1);
    assert.ok(r.some((p) => p.id === 'expliquer-un-pipeline-en-echec'));
  });

  test('les accents ne comptent pas', () => {
    assert.deepEqual(filtrer(VUS, { q: 'securite' }).map((p) => p.id),
                     filtrer(VUS, { q: 'sécurité' }).map((p) => p.id));
  });

  test('le filtre par famille et par état se combinent avec la recherche', () => {
    const une = familles(VUS)[0];
    const r = filtrer(VUS, { famille: une.cle });
    assert.equal(r.length, une.total);
    assert.ok(r.every((p) => p.famille === une.cle));

    const restants = filtrer(VUS, { etat: 'a-creer' });
    assert.ok(restants.every((p) => p.etat === 'a-creer'));
  });

  test('une recherche vide rend tout', () => {
    assert.equal(filtrer(VUS, { q: '   ' }).length, VUS.length);
  });
});

describe('les compteurs', () => {
  test('disent ce qui existe sur ce qui est possible', () => {
    const c = compter(confronter(TOUS, AU_REGISTRE));
    assert.equal(c.total, TOUS.length);
    assert.equal(c.faits, AU_REGISTRE.length);
    assert.equal(c.restants, TOUS.length - AU_REGISTRE.length);
  });

  test('chaque famille compte ses faits et son total', () => {
    const fs = familles(confronter(TOUS, AU_REGISTRE));
    assert.equal(fs.reduce((s, f) => s + f.total, 0), TOUS.length);
    assert.ok(fs.every((f) => f.faits <= f.total));
    assert.ok(fs.every((f) => f.titre && f.icone));
  });
});
