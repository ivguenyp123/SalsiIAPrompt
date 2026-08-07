/*
 * Tests du journal des décisions.
 *
 * Les messages de commit sont écrits par l'application, jamais saisis. Le journal les
 * relit donc comme un format, pas comme de la prose — et ce test est ce qui empêche de
 * changer un message d'un côté sans casser la lecture de l'autre.
 *
 * Les chaînes ci-dessous sont copiées TELLES QUELLES depuis studio/studio.js et
 * admin/admin.js. Si quelqu'un reformule un message là-bas, un test tombe ici.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { depuisCommits, parJour, resume, horsParcours, ACTIONS } from '../admin/journal.js';

/* Les messages réels, à la virgule près. */
const SOUMISSION = {
  sha: 'aaa1', author: 'm.dubois', date: '2026-08-06T10:12:00Z',
  message: 'registre : soumettre Préparer la livraison en préproduction\n\n'
         + 'Artefact prep-delivery soumis depuis le Studio par m.dubois.\n'
         + 'Lint : 0 erreur(s), 1 avertissement(s).\nEn attente de validation humaine.'
};
const VALIDATION = {
  sha: 'bbb2', author: 'a.leroy', date: '2026-08-06T11:30:00Z',
  message: 'registre : valider Préparer la livraison en préproduction\n\n'
         + 'Validé par a.leroy. Publié en artifacts/prep-delivery.yaml.'
};
const REFUS = {
  sha: 'ccc3', author: 'a.leroy', date: '2026-08-05T16:00:00Z',
  message: 'registre : refuser Analyser le code\n\nRefusé par a.leroy. Retiré de la file.'
};
const MAIN_NUE = {
  sha: 'ddd4', author: 'ivguenyp123', date: '2026-08-05T09:00:00Z',
  message: 'Update prep-delivery.yaml'
};

describe('le vocabulaire de l\'application se relit', () => {
  const [e] = depuisCommits([SOUMISSION]);

  test('l\'action est reconnue', () => assert.equal(e.action, 'soumettre'));
  test('la cible est le titre, sans le préfixe', () =>
    assert.equal(e.cible, 'Préparer la livraison en préproduction'));
  test('l\'identifiant est lu dans le corps', () => assert.equal(e.artefactId, 'prep-delivery'));
  test('l\'acteur est celui que l\'application a inscrit', () => {
    assert.equal(e.acteur, 'm.dubois');
    assert.equal(e.acteurDeclare, true);
  });
  test('la référence au commit est conservée', () => assert.equal(e.ref, 'aaa1'));

  test('valider et refuser aussi', () => {
    const [v, r] = depuisCommits([VALIDATION, REFUS]);
    assert.deepEqual([v.action, v.acteur], ['valider', 'a.leroy']);
    assert.deepEqual([r.action, r.acteur, r.cible], ['refuser', 'a.leroy', 'Analyser le code']);
  });
});

describe('ce qui n\'est pas passé par le produit est signalé', () => {
  test('un commit hors vocabulaire devient « hors parcours »', () => {
    // C'est le constat qui vaut le plus pour un auditeur : une modification directe
    // contourne la porte du lint ET la file de validation.
    const [e] = depuisCommits([MAIN_NUE]);
    assert.equal(e.action, 'autre');
    assert.equal(e.cible, 'Update prep-delivery.yaml');
  });

  test('faute d\'acteur déclaré, l\'auteur du commit fait foi', () => {
    const [e] = depuisCommits([MAIN_NUE]);
    assert.equal(e.acteur, 'ivguenyp123');
    assert.equal(e.acteurDeclare, false, 'et on sait que ce n\'est pas l\'application qui l\'a écrit');
  });

  test('horsParcours ne retient que ceux-là', () => {
    const tous = depuisCommits([SOUMISSION, VALIDATION, MAIN_NUE, REFUS]);
    assert.deepEqual(horsParcours(tous).map((e) => e.ref), ['ddd4']);
  });

  test('un préfixe imité mais mal formé ne passe pas pour une décision', () => {
    // « registre : » sans verbe connu reste hors parcours : le journal ne doit pas
    // pouvoir être maquillé en écrivant un message de commit qui y ressemble.
    const [e] = depuisCommits([{ sha: 'x', message: 'registre : bidouiller un truc', author: 'x' }]);
    assert.equal(e.action, 'autre');
  });
});

describe('l\'auteur du commit et l\'acteur déclaré restent distincts', () => {
  test('un jeton de service ne masque pas qui a décidé', () => {
    // Aujourd'hui chacun agit avec son propre jeton, donc les deux coïncident. Le jour
    // où un back écrira avec un compte de service, l'auteur du commit sera ce compte et
    // l'acteur restera la personne : les confondre effacerait la responsabilité.
    const [e] = depuisCommits([{ ...VALIDATION, author: 'svc-salsi-bot' }]);
    assert.equal(e.acteur, 'a.leroy');
    assert.equal(e.auteurCommit, 'svc-salsi-bot');
  });
});

describe('mise en forme', () => {
  const tous = depuisCommits([SOUMISSION, VALIDATION, REFUS, MAIN_NUE]);

  test('le regroupement par jour garde l\'ordre reçu', () => {
    const jours = parJour(tous);
    assert.deepEqual(jours.map((j) => j.jour), ['2026-08-06', '2026-08-05']);
    assert.equal(jours[0].evenements.length, 2);
    assert.equal(jours[1].evenements.length, 2);
  });

  test('une date absente ne casse pas le regroupement', () => {
    const [j] = parJour(depuisCommits([{ sha: 'z', message: 'registre : valider X', author: 'a' }]));
    assert.equal(j.jour, 'date inconnue');
  });

  test('le résumé compte chaque action, y compris à zéro', () => {
    // Le total est DÉRIVÉ de la table des actions, pas d'une liste écrite ici : ajouter
    // un verbe au vocabulaire ne doit pas demander de venir corriger un test.
    const aZero = Object.fromEntries(Object.keys(ACTIONS).map((k) => [k, 0]));
    assert.deepEqual(resume([]), aZero);
    assert.deepEqual(resume(tous), { ...aZero, soumettre: 1, valider: 1, refuser: 1, autre: 1 });
  });

  test('retirer, réactiver et supprimer ne tombent pas en « hors parcours »', () => {
    // Sinon une décision légitime du parc se rangerait au même endroit que ce qui
    // contourne le produit, et l'alerte de contournement ne voudrait plus rien dire.
    const evs = depuisCommits([
      { sha: '1', message: 'registre : retirer Expliquer un pipeline\n\nRetiré par ivguenyp123.', author: 'x', date: '2026-08-07T10:00:00Z' },
      { sha: '2', message: 'registre : reactiver Expliquer un pipeline\n\nRéactivé par ivguenyp123.', author: 'x', date: '2026-08-07T11:00:00Z' },
      { sha: '3', message: 'registre : supprimer test\n\nSupprimé par ivguenyp123.', author: 'x', date: '2026-08-07T12:00:00Z' }
    ]);
    assert.deepEqual(evs.map((e) => e.action), ['retirer', 'reactiver', 'supprimer']);
    assert.ok(evs.every((e) => e.acteurDeclare && e.acteur === 'ivguenyp123'),
      'l\'acteur déclaré se lit sur ces verbes comme sur les autres');
    assert.deepEqual(horsParcours(evs), []);
  });

  test('chaque action a un libellé, un verbe et une icône', () => {
    for (const [nom, def] of Object.entries(ACTIONS)) {
      assert.ok(def.label && def.verbe && def.icone, `${nom} est décrite`);
    }
  });

  test('rien n\'explose sur une entrée vide', () => {
    assert.deepEqual(depuisCommits(), []);
    assert.deepEqual(parJour(), []);
    const [e] = depuisCommits([{}]);
    assert.equal(e.action, 'autre');
    assert.equal(e.acteur, '');
  });
});

describe('la couture vers la base', () => {
  test('chaque événement porte son origine', () => {
    // `source` existe pour que git et la base puissent coexister pendant la bascule,
    // au lieu que l'une remplace l'autre d'un coup.
    for (const e of depuisCommits([SOUMISSION, MAIN_NUE])) assert.equal(e.source, 'git');
  });

  test('le contrat d\'un événement est stable', () => {
    // Ce que `depuisBase()` devra rendre à l'identique le jour venu.
    assert.deepEqual(Object.keys(depuisCommits([SOUMISSION])[0]).sort(),
      ['acteur', 'acteurDeclare', 'action', 'artefactId', 'auteurCommit', 'cible', 'date', 'ref', 'source']);
  });
});
