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

  test('tout artefact publié vient de l\'inventaire OU dit d\'où il vient', () => {
    /*
     * Ce test exigeait que TOUT artefact publié figure à l'inventaire. C'était juste tant
     * que le registre n'était semé que depuis lui — et faux dès qu'on se sert du produit :
     * demander un agent en une phrase, ou en composer un, produit légitimement une
     * capacité que l'inventaire ne prévoyait pas. Un test qui échoue à chaque validation
     * d'un agent original punit l'usage normal.
     *
     * L'invariant qui tient, lui, c'est la TRAÇABILITÉ : rien n'atteint le registre sans
     * qu'on puisse dire d'où ça vient. Soit c'est une capacité connue de la plateforme,
     * soit le fichier porte son en-tête de provenance — qui l'a demandé, quand, et avec
     * quelle phrase.
     *
     * L'inventaire reste ce qu'il a toujours prétendu être : ce qu'on PEUT demander, une
     * amorce de l'étendue possible — pas la liste de tout ce qui existe. Et le doublon,
     * qui était l'inquiétude d'origine, est l'affaire de `L015`, pas la sienne.
     */
    const ids = new Set(TOUS.map((p) => p.id));
    const orphelins = AU_REGISTRE
      .filter((id) => !ids.has(id))
      .filter((id) => !/^#\s*salsi-provenance:/
        .test(readFileSync(join(ROOT, 'artifacts', `${id}.yaml`), 'utf8')));

    assert.deepEqual(orphelins, [],
      'ces artefacts publiés ne sont ni à l\'inventaire ni porteurs d\'une provenance :\n'
      + `  ${orphelins.join('\n  ')}`);
  });

  test('les entrées « au registre » correspondent à de vrais fichiers', () => {
    // Le sens qui compte : l'inventaire ne doit pas annoncer « déjà fait » pour quelque
    // chose qui n'existe pas. L'inverse — un fichier hors inventaire — est devenu normal
    // depuis qu'on peut demander et composer.
    //
    // On vérifie `par` et non `id` : une entrée peut être couverte par un agent qui porte
    // un AUTRE nom, et c'est cet agent-là qui doit exister.
    const vus = confronter(TOUS, AU_REGISTRE);
    for (const p of vus.filter((x) => x.etat === 'au-registre')) {
      assert.ok(AU_REGISTRE.includes(p.par), `${p.id} annoncé au registre via `
        + `« ${p.par} » — introuvable`);
    }
  });

  /* ── La couverture par un autre nom ────────────────────────────────────── */

  test('`couvert_par` ne désigne jamais un artefact qui n\'existe pas', () => {
    /*
     * LE SEUL CHAMP MANUEL DE CETTE MÉCANIQUE, DONC LE SEUL QUI PUISSE MENTIR.
     *
     * Tout le reste de l'état est dérivé. `couvert_par` est écrit à la main, et un lien
     * qui pointe vers un agent supprimé ou mal orthographié annoncerait « déjà fait » une
     * capacité que personne n'a. C'est exactement le mensonge que cet écran existe pour
     * empêcher, et il serait invisible sans ce test.
     */
    const morts = TOUS.filter((p) => p.couvert_par && !AU_REGISTRE.includes(p.couvert_par))
      .map((p) => `${p.id} → ${p.couvert_par}`);
    assert.deepEqual(morts, [], `ces liens de couverture ne mènent nulle part :\n  ${morts.join('\n  ')}`);
  });

  test('un lien de couverture ne se déguise pas en identifiant', () => {
    // `couvert_par` dit « un AUTRE agent répond à ça ». Le pointer sur soi-même n'apporte
    // rien et masquerait une entrée dont l'artefact a simplement le même nom.
    for (const p of TOUS) {
      if (p.couvert_par) assert.notEqual(p.couvert_par, p.id, `${p.id} se couvre lui-même`);
    }
  });

  test('l\'écran sait TOUJOURS quel agent ouvrir', () => {
    // « ça existe déjà » n'aide personne si on ne dit pas quoi ouvrir. `par` porte le nom,
    // qu'il vienne de l'identifiant ou du lien de couverture.
    const vus = confronter(TOUS, AU_REGISTRE);
    for (const p of vus) {
      if (p.etat === 'au-registre') assert.ok(p.par, `${p.id} : au registre sans dire par qui`);
      else assert.equal(p.par, '', `${p.id} : à créer mais désigne un agent`);
    }
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
    /*
     * `faits` compte les capacités de L'INVENTAIRE déjà au registre — pas les artefacts
     * du registre. Les deux nombres ont divergé le jour où l'on a pu demander et composer
     * des agents que l'inventaire ne prévoyait pas, et c'est correct : le compteur annonce
     * « x sur 130 possibles », pas « x fichiers ».
     */
    const c = compter(confronter(TOUS, AU_REGISTRE));
    // Une capacité est faite quand un agent y répond — sous son nom, ou sous celui qu'un
    // `couvert_par` désigne. Compter les seuls identifiants identiques sous-estimerait le
    // travail réel, et c'est ce qui nous a fait croire quatre agents « à créer ».
    const attendus = TOUS.filter((p) => AU_REGISTRE.includes(p.id)
                                     || AU_REGISTRE.includes(p.couvert_par)).length;

    assert.equal(c.total, TOUS.length);
    assert.equal(c.faits, attendus);
    assert.equal(c.restants, TOUS.length - attendus);
    assert.ok(c.faits <= AU_REGISTRE.length, 'jamais plus de faits que de fichiers');
  });

  test('chaque famille compte ses faits et son total', () => {
    const fs = familles(confronter(TOUS, AU_REGISTRE));
    assert.equal(fs.reduce((s, f) => s + f.total, 0), TOUS.length);
    assert.ok(fs.every((f) => f.faits <= f.total));
    assert.ok(fs.every((f) => f.titre && f.icone));
  });
});
