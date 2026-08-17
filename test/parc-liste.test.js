/*
 * La liste du parc.
 *
 * Ce qui est protégé ici n'est pas « le filtre filtre » — c'est deux décisions de fond
 * que la maquette ne pouvait pas prendre, parce qu'une maquette n'a pas de données :
 *
 *   1. un identifiant présent dans DEUX dossiers fait DEUX lignes. C'est une correction
 *      en revue sur une capacité publiée : la publiée continue de servir. Les fusionner
 *      ferait croire à l'auteur que sa correction est en ligne.
 *   2. `usages` reste `null`, jamais 0. Zéro serait une mesure, et rien ne mesure. Toute
 *      la thèse du produit tient à la séparation entre le déclaré et le dérivé — c'est
 *      ici, sur une colonne de tableau, qu'elle se perdrait le plus facilement.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { STATUTS, DOSSIERS, dossiersDe, inventaireParc, compter, filtrer, plier } from '../admin/parc.js';

const f = (path, id, extra = {}) => ({
  path,
  artifact: { id, title: extra.titre || id, kind: extra.kind || 'agent',
              owner: { person: extra.owner || 'ivguenyp123', scope: extra.scope || 'Plateforme' },
              target_level: extra.niveau || 'experimental' },
  report: extra.report || { blocked: false, errors: 0 }
});

describe('les trois dossiers font une seule liste', () => {
  test('chaque dossier porte son statut', () => {
    const l = inventaireParc({
      actif: [f('artifacts/a.yaml', 'a')],
      revue: [f('artifacts/pending/b.yaml', 'b')],
      retire: [f('artifacts/retires/c.yaml', 'c')]
    });
    assert.deepEqual(l.map((e) => [e.id, e.statut]), [['b', 'revue'], ['a', 'actif'], ['c', 'retire']]);
  });

  test('ce qui attend une décision passe devant', () => {
    // L'ordre est une hiérarchie d'attention, pas un alphabet : ce qui demande une
    // action humaine est en haut, quel que soit son titre.
    const l = inventaireParc({
      actif: [f('artifacts/aaa.yaml', 'aaa')],
      revue: [f('artifacts/pending/zzz.yaml', 'zzz')]
    });
    assert.deepEqual(l.map((e) => e.id), ['zzz', 'aaa']);
  });

  test('à statut égal, l\'ordre est alphabétique et français', () => {
    const l = inventaireParc({ actif: [
      f('artifacts/z.yaml', 'z', { titre: 'Zèbre' }),
      f('artifacts/e.yaml', 'e', { titre: 'Éditer' }),
      f('artifacts/a.yaml', 'a', { titre: 'Analyser' })] });
    assert.deepEqual(l.map((e) => e.titre), ['Analyser', 'Éditer', 'Zèbre']);
  });

  test('un même identifiant dans deux dossiers fait DEUX lignes', () => {
    // Une correction en revue sur une capacité publiée. Fusionner ferait croire que la
    // correction est en ligne — elle ne l'est pas, la version publiée sert toujours.
    const l = inventaireParc({
      actif: [f('artifacts/prep.yaml', 'prep')],
      revue: [f('artifacts/pending/prep.yaml', 'prep')]
    });
    assert.equal(l.length, 2);
    assert.deepEqual(l.map((e) => e.statut), ['revue', 'actif']);
  });

  test('un fichier illisible garde sa ligne', () => {
    // C'est justement celui qu'on veut pouvoir retirer : le cacher derrière son erreur
    // de lecture le rendrait introuvable dans le seul écran qui sait le supprimer.
    const [e] = inventaireParc({ actif: [{ path: 'artifacts/casse.yaml', artifact: null, error: 'YAML illisible' }] });
    assert.equal(e.lisible, false);
    assert.equal(e.id, 'casse');
    assert.equal(e.titre, 'casse.yaml');
    assert.match(e.erreur, /illisible/);
  });

  test('les dossiers d\'une personne couvrent tous les statuts, et l\'inverse', () => {
    /*
     * Ajouter un statut sans son dossier — ou l'inverse — donnerait une colonne que rien
     * ne peut remplir, ou un dossier que rien n'affiche.
     *
     * La confrontation porte sur `dossiersDe(qui)` et non sur `DOSSIERS` : le statut
     * « mien » vit dans DEUX dossiers, `mes-agents/<qui>` et `mes-chaines/<qui>`, dont le
     * chemin dépend de la personne connectée. C'est ce qui manquait — le parc ne voyait
     * que les trois dossiers gouvernés, et un agent sauvé chez soi restait au catalogue
     * sans qu'aucun écran ne sache l'effacer.
     */
    const vus = new Set(dossiersDe('daniel').map(([s]) => s));
    assert.deepEqual([...vus].sort(), Object.keys(STATUTS).sort());
  });

  test('sans personne connectée, aucun dossier personnel n\'est lu', () => {
    // Le parc de quelqu'un d'autre ne se devine pas : `mes-agents/` porte un dossier par
    // personne, et administrer ne donne pas le droit d'y entrer.
    assert.deepEqual(dossiersDe('').map(([, d]) => d), DOSSIERS.map(([, d]) => d));
  });

  test('les deux dossiers personnels portent le MÊME statut', () => {
    // Agents et chaînes gardés chez soi se gèrent pareil : les séparer en deux statuts
    // obligerait à savoir lequel on cherche avant de chercher.
    const miens = dossiersDe('daniel').filter(([, d]) => /^mes-/.test(d));
    assert.deepEqual(miens.map(([s]) => s), ['mien', 'mien']);
    assert.deepEqual(miens.map(([, d]) => d),
      ['mes-agents/daniel', 'mes-chaines/daniel']);
  });

  test('un artefact personnel prend le statut « à moi »', () => {
    const [e] = inventaireParc({ mien: [f('mes-agents/daniel/x.yaml', 'x')] });
    assert.equal(e.statut, 'mien');
    assert.equal(STATUTS.mien.label, 'à moi');
  });
});

describe('ce que le tableau refuse d\'inventer', () => {
  test('`usages` est null, jamais zéro', () => {
    // Zéro serait une mesure. `null` dit « on ne sait pas », et l'écran l'écrit.
    const [e] = inventaireParc({ actif: [f('artifacts/a.yaml', 'a')] });
    assert.equal(e.usages, null);
  });

  test('la seule santé affichée est celle qu\'on calcule vraiment', () => {
    const [ok] = inventaireParc({ actif: [f('artifacts/a.yaml', 'a')] });
    assert.equal(ok.porte, 'conforme');

    const [ko] = inventaireParc({ actif: [f('artifacts/b.yaml', 'b', { report: { blocked: true, errors: 3 } })] });
    assert.equal(ko.porte, 'refuse');
    assert.equal(ko.erreurs, 3);
  });

  test('sans rapport de lint, la colonne reste vide au lieu de dire « conforme »', () => {
    const [e] = inventaireParc({ actif: [{ path: 'artifacts/a.yaml', artifact: { id: 'a' } }] });
    assert.equal(e.porte, null);
  });
});

describe('les compteurs', () => {
  test('toutes les clés sont là, y compris à zéro', () => {
    // Un compteur absent laisserait croire qu'il n'y a rien à voir de ce côté.
    assert.deepEqual(compter([]), { revue: 0, actif: 0, mien: 0, retire: 0 });
  });

  test('ils comptent tout, indépendamment des filtres', () => {
    const l = inventaireParc({
      actif: [f('artifacts/a.yaml', 'a'), f('artifacts/b.yaml', 'b')],
      retire: [f('artifacts/retires/c.yaml', 'c')]
    });
    assert.deepEqual(compter(l), { revue: 0, actif: 2, mien: 0, retire: 1 });
    // Le filtre change ce qu'on voit, pas ce qu'on compte : sinon filtrer changerait
    // les chiffres, et un chiffre qui bouge selon la vue ne prouve rien.
    assert.deepEqual(compter(l), compter(inventaireParc({
      actif: [f('artifacts/a.yaml', 'a'), f('artifacts/b.yaml', 'b')],
      retire: [f('artifacts/retires/c.yaml', 'c')] })));
  });
});

describe('la recherche', () => {
  const liste = inventaireParc({ actif: [
    f('artifacts/mig.yaml', 'verifier-les-migrations', { titre: 'Vérifier les migrations Flyway', kind: 'agent' }),
    f('artifacts/msg.yaml', 'commit-message', { titre: 'Rédiger un message de commit', kind: 'prompt', owner: 'marie.d', scope: 'Data' })] });

  test('elle ignore les accents et la casse', () => {
    // Personne ne tape « Vérifier » avec l'accent dans une barre de recherche.
    assert.deepEqual(filtrer(liste, { q: 'verifier' }).map((e) => e.id), ['verifier-les-migrations']);
    assert.deepEqual(filtrer(liste, { q: 'FLYWAY' }).map((e) => e.id), ['verifier-les-migrations']);
    assert.equal(plier('Migrations — Été'), 'migrations — ete');
  });

  test('elle porte sur ce qu\'on a en tête : titre, identifiant, owner, périmètre', () => {
    assert.deepEqual(filtrer(liste, { q: 'marie' }).map((e) => e.id), ['commit-message']);
    assert.deepEqual(filtrer(liste, { q: 'Data' }).map((e) => e.id), ['commit-message']);
    assert.deepEqual(filtrer(liste, { q: 'commit-message' }).map((e) => e.id), ['commit-message']);
  });

  test('elle ne porte PAS sur le chemin du fichier', () => {
    // Personne ne retient un chemin, et le faire matcher ferait remonter des résultats
    // qu'on ne sait pas expliquer.
    assert.deepEqual(filtrer(liste, { q: 'artifacts' }), []);
  });

  test('les filtres se combinent', () => {
    assert.deepEqual(filtrer(liste, { kind: 'prompt' }).map((e) => e.id), ['commit-message']);
    assert.deepEqual(filtrer(liste, { kind: 'agent', q: 'marie' }), []);
    assert.equal(filtrer(liste, {}).length, 2);
  });

  test('un statut filtre sans toucher au reste', () => {
    const l = inventaireParc({
      actif: [f('artifacts/a.yaml', 'a')],
      retire: [f('artifacts/retires/b.yaml', 'b')]
    });
    assert.deepEqual(filtrer(l, { statut: 'retire' }).map((e) => e.id), ['b']);
  });

  test('rien n\'explose sur une entrée vide', () => {
    assert.deepEqual(inventaireParc(), []);
    assert.deepEqual(filtrer(), []);
    assert.deepEqual(compter(), { revue: 0, actif: 0, mien: 0, retire: 0 });
  });
});
