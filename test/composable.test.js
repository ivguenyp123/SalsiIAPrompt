/*
 * Ce qui est assemblable, et ce qui ne l'est pas.
 *
 * ── LE DÉFAUT QUE CES TESTS TIENNENT FERMÉ ───────────────────────────────────
 *
 * Le composeur offrait 130 besoins de l'inventaire en plus des agents du registre, et 48
 * d'entre eux déclaraient une entrée que RIEN ne sait remplir — `rapport_depot`,
 * `activite_sprint`, `scores_maturite`. On montait l'agent, il franchissait les 27 règles,
 * et il échouait au premier lancement sur un champ vide : `P003`. Rien, au moment du
 * montage, ne l'avait laissé prévoir.
 *
 * La règle tient en une phrase : on n'assemble qu'à partir de ce qui tourne. Elle est
 * vérifiée ici parce qu'elle est facile à casser sans s'en rendre compte — il suffit
 * d'ajouter une entrée au vocabulaire sans écrire le calculateur qui va avec.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { etatEntree, besoinsDe, peutTourner, morceauDepuisArtefact,
         NOMS_DEPOT, SOURCES_ENTREES } from '../lib/assemblage.js';
import { sait } from '../lib/signaux-matiere.js';
import { estUnDepot } from '../app/depots.js';

const avec = { sait };

describe('ce qu\'il faudra faire pour remplir une entrée', () => {
  test('ce que la plateforme calcule ne demande rien', () => {
    for (const n of ['repartition_contributions', 'inventaire_branches', 'rapport_secrets',
                     'inventaire_dependances', 'rapport_conformite', 'chiffres_dora']) {
      assert.equal(etatEntree(n, avec), 'calculee', `${n} devrait être calculée`);
    }
  });

  test('un nom de dépôt se choisit dans une liste', () => {
    assert.equal(etatEntree('repo', avec), 'choisie');
    assert.equal(etatEntree('Projet', avec), 'choisie', 'la casse ne doit pas décider');
  });

  test('la matière du dépôt s\'va chercher, le texte d\'un humain s\'écrit', () => {
    assert.equal(etatEntree('diff', avec), 'depot');
    assert.equal(etatEntree('code', avec), 'depot');
    // Légitime, et ça ne doit surtout pas compter comme un défaut : un besoin métier ou
    // des notes d'incident n'existent nulle part ailleurs que dans la tête de quelqu'un.
    assert.equal(etatEntree('besoin_metier', avec), 'ecrite');
    assert.equal(etatEntree('notes_incident', avec), 'ecrite');
  });

  /*
   * Le cas qui compte. Un signal se dit « produit par la plateforme » ; s'il ne l'est pas,
   * le champ arrive vide et PERSONNE ne sait quoi y coller — pas même son auteur.
   */
  test('un signal que la plateforme ne produit pas est introuvable, pas « à écrire »', () => {
    assert.equal(SOURCES_ENTREES.scores_maturite, 'signal');
    assert.equal(sait('scores_maturite'), false);
    assert.equal(etatEntree('scores_maturite', avec), 'introuvable');
    // `rapport_vulnerabilites` était le second exemple ici. Il a cessé d'être introuvable
    // le jour où la plateforme a su le calculer — et ce test l'a signalé, ce qui est
    // exactement son travail. `activite_sprint` prend la place ; il la rendra à son tour.
    assert.equal(etatEntree('activite_sprint', avec), 'introuvable');
  });

  test('un signal qu\'on APPREND à produire cesse d\'être introuvable', () => {
    /*
     * L'autre moitié de la règle, et la raison pour laquelle le test ci-dessus a changé
     * d'exemple.
     *
     * `rapport_depot` y servait d'illustration d'un signal déclaré et non produit. Il est
     * désormais calculé — les vingt-cinq contrôles du Repo Analyzer — et le test est
     * devenu rouge en le disant. C'est le bon sens de la panne : la liste des signaux
     * introuvables doit RÉTRÉCIR, et chaque fois qu'elle rétrécit, un test doit le
     * remarquer plutôt que de laisser un exemple périmé passer pour une vérité.
     */
    assert.equal(SOURCES_ENTREES.rapport_depot, 'signal');
    assert.equal(etatEntree('rapport_depot', avec), 'calculee');
  });

  test('un nom hors vocabulaire est introuvable lui aussi', () => {
    // La plateforme ne sait pas quoi en faire, donc ne saura jamais aller le chercher.
    assert.equal(etatEntree('contexte_equipe', avec), 'introuvable');
    assert.equal(etatEntree('', avec), 'introuvable');
  });

  test('sans calculateur déclaré, rien n\'est réputé calculé', () => {
    // Le module est pur : il ne devine pas ce que la plateforme sait faire, on le lui dit.
    assert.equal(etatEntree('chiffres_dora'), 'introuvable');
  });
});

describe('un morceau peut-il seulement tourner', () => {
  test('une seule entrée introuvable suffit à bloquer l\'agent entier', () => {
    // Le pré-vol refuse dès qu'une variable requise n'est pas résolue : assembler autour
    // d'elle, c'est monter quelque chose qui ne partira jamais.
    assert.equal(peutTourner(['chiffres_dora', 'scores_maturite'], avec), false);
    assert.equal(peutTourner(['chiffres_dora'], avec), true);
  });

  test('aucune entrée du tout se lance tel quel', () => {
    assert.equal(peutTourner([], avec), true);
  });

  test('les besoins sortent dédoublonnés', () => {
    const b = besoinsDe(['diff', 'diff', 'repo'], avec);
    assert.deepEqual(b.map((x) => x.nom), ['diff', 'repo']);
  });
});

describe('les deux listes de noms de dépôt ne peuvent plus diverger', () => {
  test('`estUnDepot` et `etatEntree` disent la même chose', () => {
    /*
     * Elles vivaient dans deux fichiers, avec deux listes recopiées. Une divergence à cet
     * endroit ferait passer un agent lançable pour un agent bloqué — ou l'inverse, ce qui
     * est pire. Il n'y a plus qu'une liste ; ce test tient la porte fermée.
     */
    for (const n of NOMS_DEPOT) {
      assert.equal(estUnDepot({ name: n }), true);
      assert.equal(etatEntree(n, avec), 'choisie');
    }
    assert.equal(estUnDepot({ name: 'diff' }), false);
  });
});

describe('un morceau tiré d\'un agent du registre', () => {
  const agent = { id: 'x', title: 'X', spec: 'fais ceci', tags: ['dora', 'ci'],
                  variables: [{ name: 'chiffres_dora' }] };

  test('porte ses étiquettes — le composeur n\'a plus les familles pour ranger', () => {
    assert.deepEqual(morceauDepuisArtefact(agent).tags, ['dora', 'ci']);
  });

  test('une chaîne n\'est pas un morceau', () => {
    assert.equal(morceauDepuisArtefact({ ...agent, kind: 'chain' }), null);
  });

  test('sans étiquette, une liste vide et non `undefined`', () => {
    // L'appelant fait `m.tags.includes(...)` : `undefined` casserait le filtre.
    assert.deepEqual(morceauDepuisArtefact({ id: 'y', spec: 's' }).tags, []);
  });
});
