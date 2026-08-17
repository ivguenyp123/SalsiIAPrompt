/*
 * L'application publiée en fichiers statiques — ce qui part, et ce qui manquerait.
 *
 * ── POURQUOI CE TEST EXISTE ──────────────────────────────────────────────────
 *
 * Le job `pages` copie une liste ÉCRITE À LA MAIN de dossiers. Une liste écrite à la main
 * dans un dépôt vivant se désynchronise — c'est une loi. Ici la désynchronisation ne se
 * verrait pas au pipeline : `cp` réussirait, l'artefact partirait, et l'écran tomberait en
 * panne dans le navigateur de quelqu'un d'autre. Typiquement pendant une démonstration,
 * puisque c'est là qu'on regarde.
 *
 * On confronte donc la liste déclarée à ce que le front-end IMPORTE réellement. Un dossier
 * ajouté et non copié devient un test rouge, pas une page blanche.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI = readFileSync(join(ROOT, '.gitlab-ci.yml'), 'utf8');

/** Les écrans : un dossier avec un `index.html` ou une page de connexion. */
const ECRANS = ['app', 'admin', 'catalogue', 'composer', 'demande', 'guide', 'studio'];

/** Ce que le job déclare copier, lu dans ses lignes `cp -r`. */
const COPIES = new Set(
  [...CI.matchAll(/^\s*-\s*cp -r (.+) public\/$/gm)]
    .flatMap((m) => m[1].trim().split(/\s+/))
);

/** Les dossiers de premier niveau importés par le front-end, relevés dans son code. */
function importesParLeFront() {
  const vus = new Set();
  for (const ecran of ECRANS) {
    for (const f of readdirSync(join(ROOT, ecran)).filter((x) => /\.(js|html)$/.test(x))) {
      const src = readFileSync(join(ROOT, ecran, f), 'utf8');
      // `import … from '../lib/x.js'` comme `fetch('../registries/tools.yaml')`.
      for (const m of src.matchAll(/['"`]\.\.\/([a-z][a-z-]*)\//g)) vus.add(m[1]);
    }
  }
  return vus;
}

describe('l\'application servie en statique', () => {
  test('le job `pages` copie TOUT ce que le front-end va chercher', () => {
    for (const dossier of importesParLeFront()) {
      // `api` n'est pas un dossier : c'est la route du moteur, absente par construction
      // d'un hébergement statique, et les écrans le disent d'eux-mêmes.
      if (dossier === 'api') continue;
      /*
       * `derive/etat.json` est produit par le banc d'essai ; tant qu'il n'a rien mesuré,
       * il n'existe pas. Ne pas le copier est juste — l'inventer serait mentir sur une
       * mesure.
       *
       * LA CONDITION PORTE SUR LE FICHIER, PAS SUR LE DOSSIER, et la nuance vient de se
       * payer. Le journal des exécutions écrit lui aussi dans `derive/` : il suffit
       * désormais de lancer UN agent en local pour que le dossier existe, sans qu'aucune
       * mesure de banc n'ait eu lieu. Testé sur le dossier, ce test virait au rouge pour
       * une raison sans aucun rapport avec ce qu'il surveille — et un test rouge dont le
       * message ne décrit pas la cause est la meilleure façon de désapprendre à le lire.
       *
       * Ce qui doit encore alerter le jour venu : `etat.json` publié et non copié.
       */
      if (dossier === 'derive' && !existsSync(join(ROOT, 'derive/etat.json'))) continue;
      assert.ok(COPIES.has(dossier),
        `« ${dossier} » est importé par un écran et le job \`pages\` ne le copie pas`);
    }
  });

  test('chaque écran part en ligne', () => {
    for (const ecran of ECRANS) assert.ok(COPIES.has(ecran), `${ecran} n'est pas publié`);
  });

  test('la page d\'entrée du dépôt part aussi', () => {
    /*
     * Un hébergement statique n'a personne pour rediriger `/` vers `/app/`. Sans cette
     * page, l'adresse qu'on donne à quelqu'un rend un 404 — la première chose qu'il voit.
     */
    assert.ok(COPIES.has('index.html'));
    assert.match(readFileSync(join(ROOT, 'index.html'), 'utf8'), /url=\.\/app\//);
  });

  test('rien n\'est copié qui n\'existe pas', () => {
    // `cp` échouerait au pipeline. Autant le savoir avant de pousser.
    for (const chemin of COPIES) {
      assert.ok(existsSync(join(ROOT, chemin)), `le job copie « ${chemin} », qui n'existe pas`);
    }
  });

  test('ni les tests, ni les dépendances, ni le serveur ne sont publiés', () => {
    // Le job nomme ce qu'il publie plutôt que d'exclure ce qu'il cache : ce qui n'est pas
    // nommé ne part pas, et la liste se relit en une fois.
    for (const interdit of ['test', 'node_modules', 'serve.js', 'fixtures']) {
      assert.ok(!COPIES.has(interdit), `« ${interdit} » ne doit pas être publié`);
    }
  });

  test('la publication ne part QUE de la branche par défaut', () => {
    // Une branche de travail qui publierait remplacerait le site par un état non relu.
    assert.match(CI, /\$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH/);
  });
});
