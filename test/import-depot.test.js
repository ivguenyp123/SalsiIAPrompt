/*
 * Normaliser la saisie du dépôt à importer.
 *
 * Défaut trouvé au PREMIER essai réel : `https://github.com/google/mantis` collé tel quel
 * échouait sur « aucun commit lisible sur main » — la forge recevait l'URL entière comme
 * identifiant. Coller l'URL est le geste naturel ; le refuser est un défaut.
 *
 * `normaliserDepot` est pur, mais il vit dans `admin/import.js` qui touche au DOM à
 * l'import. On en teste donc une copie de référence ET on vérifie qu'elle ne diverge pas
 * de la source — le même patron que pour les seuils recopiés dans la doc.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** La référence, ce que le champ doit faire de chaque saisie. */
function normaliserDepot(saisie = '') {
  let s = String(saisie).trim().split('#')[0];
  s = s.replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/^git@[^:]+:/i, '');
  s = s.replace(/\/(?:-\/)?(?:tree|blob|commits?)\/.*$/i, '');
  return s.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
}

describe('la saisie du dépôt accepte le chemin ET l\'URL', () => {
  const cas = [
    ['google/mantis', 'google/mantis'],
    ['https://github.com/google/mantis', 'google/mantis'],
    ['https://github.com/google/mantis.git', 'google/mantis'],
    ['git@github.com:google/mantis.git', 'google/mantis'],
    ['https://github.com/google/mantis/tree/main', 'google/mantis'],
    ['https://github.com/google/mantis#readme', 'google/mantis'],
    ['  google/mantis/  ', 'google/mantis']
  ];
  for (const [entree, attendu] of cas) {
    test(`${JSON.stringify(entree)} → ${attendu}`, () =>
      assert.equal(normaliserDepot(entree), attendu));
  }

  test('LES SOUS-GROUPES GITLAB SONT PRÉSERVÉS', () => {
    // GitLab imbrique les groupes : `lcl/paiement/registre` est un dépôt réel, pas
    // `lcl/paiement` suivi d'un dossier. Tronquer à deux segments le casserait.
    assert.equal(normaliserDepot('lcl/paiement/registre'), 'lcl/paiement/registre');
    assert.equal(normaliserDepot('https://gitlab.com/lcl/paiement/registre'),
      'lcl/paiement/registre');
    assert.equal(normaliserDepot('https://gitlab.com/lcl/paiement/registre/-/tree/main'),
      'lcl/paiement/registre');
  });

  test('une saisie vide reste vide, pas devinée', () => {
    assert.equal(normaliserDepot(''), '');
    assert.equal(normaliserDepot('   '), '');
  });
});

describe('la source ne diverge pas de la référence', () => {
  test('admin/import.js exporte la MÊME normalisation', async () => {
    /*
     * On lit la fonction dans le fichier et on la reconstruit, plutôt que d'importer le
     * module — il touche au DOM à l'import. Si quelqu'un modifie la source sans toucher
     * ce test, les deux corps divergent et l'assertion tombe.
     */
    const src = readFileSync(join(ROOT, 'admin/import.js'), 'utf8');
    const bloc = /export function normaliserDepot\(saisie = ''\) \{([\s\S]*?)\n\}/.exec(src);
    assert.ok(bloc, 'normaliserDepot introuvable dans admin/import.js');
    const recon = new Function('saisie', `saisie = saisie ?? '';${bloc[1]}`);
    for (const entree of ['https://github.com/google/mantis', 'lcl/paiement/registre',
                          'git@github.com:google/mantis.git', 'a/b/tree/x']) {
      assert.equal(recon(entree), normaliserDepot(entree), entree);
    }
  });
});
