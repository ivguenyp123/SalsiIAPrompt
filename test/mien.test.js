/*
 * « Le mien » — sauver, partager, forker.
 *
 * Ce qui se vérifie ici est une règle de GOUVERNANCE, pas une mécanique de fichiers :
 * sauver ne passe pas par la validation, partager si. Elle ne tient que si un fork
 * engage vraiment celui qui forke, et si rien de ce qui est sauvé ne peut atteindre le
 * catalogue sans être passé par la file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RACINE, RACINES, proprietaire, chemin, dossier, depuisChemin, estPersonnel,
         forker, estFork, etat, ETATS } from '../lib/mien.js';
import { entete, lire, ORIGINES } from '../lib/provenance.js';
import { lint } from '../lint/index.js';

const CHAINE = {
  id: 'expliquer-puis-resumer', kind: 'chain', title: 'Expliquer puis résumer',
  owner: { person: 'alice', scope: 'Plateforme' },
  intent: { purpose: 'p', not_for: 'n' },
  target_level: 'team',
  steps: [{ id: 'e1', artefact: 'expliquer-un-code', entrees: { code: '{{code}}' } }]
};

/* ── Où vit une chaîne personnelle ────────────────────────────────────────── */

describe('le chemin', () => {
  test('le dossier porte le propriétaire', () => {
    // Le dossier porte l'état, comme `artifacts/pending/` porte « en revue ».
    assert.equal(chemin('ivguenyp123', 'ma-chaine'), `${RACINE}/ivguenyp123/ma-chaine.yaml`);
    assert.equal(dossier('ivguenyp123'), `${RACINE}/ivguenyp123`);
  });

  test('un pseudo devient un nom de dossier sûr', () => {
    // Un identifiant vient d'une forge : il peut porter des accents, des points, pire.
    // Rien de tout ça ne doit atterrir tel quel dans un chemin.
    assert.equal(proprietaire('Élodie.Martin'), 'elodie-martin');
    assert.equal(proprietaire('../../etc/passwd'), 'etc-passwd');
    assert.equal(proprietaire(''), 'anonyme');
    assert.equal(proprietaire(null), 'anonyme');
  });

  test('le chemin se relit — une seule découpe, partout', () => {
    assert.deepEqual(depuisChemin(chemin('moi', 'x-y')),
                     { qui: 'moi', id: 'x-y', kind: 'chain' });
    assert.equal(depuisChemin('artifacts/pending/x.yaml'), null);
    assert.equal(depuisChemin(''), null);
  });

  test('les deux racines se distinguent, et le type se relit', () => {
    // Un agent personnel et une chaîne personnelle ne se rangent pas ensemble : ils ne
    // se gouvernent pas pareil, et l'écran doit savoir lequel il ouvre.
    assert.equal(chemin('moi', 'x', 'prompt'), `${RACINES.prompt}/moi/x.yaml`);
    assert.equal(chemin('moi', 'x', 'chain'), `${RACINES.chain}/moi/x.yaml`);
    assert.equal(dossier('moi', 'prompt'), `${RACINES.prompt}/moi`);
    assert.equal(depuisChemin(`${RACINES.prompt}/moi/x.yaml`).kind, 'prompt');
  });

  test('l\'appel historique reste une chaîne', () => {
    // Changer ce défaut ferait écrire les chaînes existantes ailleurs — c'est-à-dire les
    // perdre, sans que rien ne le signale.
    assert.equal(chemin('moi', 'x'), `${RACINES.chain}/moi/x.yaml`);
    assert.equal(dossier('moi'), `${RACINES.chain}/moi`);
  });

  test('`estPersonnel` reconnaît les deux racines, et rien d\'autre', () => {
    /*
     * La question que les contrôles doivent pouvoir poser. Un artefact personnel n'est
     * PAS au registre : il ne peut pas servir de brique à une chaîne partagée, sinon on
     * composerait en privé et la chaîne « hériterait » d'une validation inexistante.
     */
    assert.equal(estPersonnel(`${RACINES.prompt}/moi/x.yaml`), true);
    assert.equal(estPersonnel(`${RACINES.chain}/moi/x.yaml`), true);
    assert.equal(estPersonnel('artifacts/x.yaml'), false);
    assert.equal(estPersonnel('artifacts/pending/x.yaml'), false);
  });
});

/* ── La blanchisserie, et pourquoi elle est fermée ────────────────────────── */

describe('un agent personnel ne peut pas devenir une brique', () => {
  /*
   * LE trou à fermer quand on autorise la sauvegarde privée d'un agent composé.
   *
   * Sans ça : je compose en privé (aucune relecture), quelqu'un l'enchaîne dans une
   * chaîne qu'il partage, et cette chaîne « hérite de la validation de ses briques » —
   * sauf que l'une d'elles n'a jamais été relue. Du texte quelconque entrerait au
   * registre par la porte de derrière.
   *
   * Ce qui l'empêche n'est pas une intention : `L024` exige que chaque étape désigne un
   * artefact PRÉSENT au registre, et le Composer ne lui passe que `artifacts/`. Un
   * fichier de `mes-agents/` n'y est pas. Le test le fige, plutôt que de compter sur un
   * effet de bord qu'un refactor effacerait sans bruit.
   */
  const PRIVE = {
    id: 'mon-agent-a-moi', kind: 'prompt', title: 'Mon agent',
    owner: { person: 'alice', scope: 'Plateforme' },
    intent: { purpose: 'Un but assez long.', not_for: 'Une limite assez longue.' },
    spec: 'Fais quelque chose avec {{code}}.',
    variables: [{ name: 'code', source: 'repo' }],
    criteria: [{ target: 'output.contains_secret', op: 'eq', value: false }],
    target_level: 'experimental', model_tier: 'mid'
  };

  const CHAINE_QUI_TRICHE = {
    ...CHAINE, id: 'chaine-qui-triche',
    steps: [{ id: 'e1', artefact: 'mon-agent-a-moi', entrees: { code: '{{code}}' } }]
  };

  test('il vit hors du registre, et ça se voit au chemin', () => {
    assert.equal(estPersonnel(chemin('alice', PRIVE.id, 'prompt')), true);
  });

  const l024 = (registre) =>
    lint(CHAINE_QUI_TRICHE, { tools: [], targets: [], artifacts: registre })
      .findings.filter((f) => f.code === 'L024' && f.severity === 'error');

  /** Un registre réaliste : des artefacts validés, et PAS l'agent privé. */
  const REGISTRE = [{ ...PRIVE, id: 'expliquer-un-code' }];

  test('L024 REFUSE une chaîne qui l\'enchaîne', () => {
    assert.ok(l024(REGISTRE).length > 0,
      'une chaîne ne doit pas pouvoir enchaîner un agent que personne n\'a relu');
  });

  test('la même chaîne passe si l\'agent EST au registre', () => {
    // La preuve que c'est bien l'ABSENCE au registre qui refuse, et non la forme.
    assert.deepEqual(l024([...REGISTRE, PRIVE]), []);
  });

  test('registre vide = silence, et ce n\'est PAS une protection', () => {
    /*
     * À noter, parce que c'est contre-intuitif et qu'on pourrait s'y fier à tort : sans
     * registre, `L024` se tait — on ne peut pas dire qu'un artefact n'existe pas quand on
     * ne nous a pas dit ce qui existe. Le Composer, lui, lui passe toujours `artifacts/`,
     * donc la protection est réelle EN SITUATION. Ce test fige la nuance pour que
     * personne ne conclue « c'est bloqué partout ».
     */
    assert.deepEqual(l024([]), []);
  });
});

/* ── Le fork ──────────────────────────────────────────────────────────────── */

describe('forker', () => {
  const f = forker(CHAINE, { qui: 'bob', suffixe: 'bob' });

  test('le fork ENGAGE celui qui forke', () => {
    /*
     * Garder l'auteur d'origine ferait porter à quelqu'un d'autre une chaîne qu'il n'a
     * pas écrite — et qu'il découvrirait le jour où elle casse.
     */
    assert.equal(f.owner.person, 'bob');
    assert.equal(CHAINE.owner.person, 'alice', 'l\'original n\'est pas touché');
  });

  test('l\'identifiant change, sinon la copie écrase l\'original', () => {
    assert.equal(f.id, 'expliquer-puis-resumer-de-bob');
    assert.notEqual(f.id, CHAINE.id);
  });

  test('forker un fork ne cumule pas les suffixes', () => {
    // Sinon `x-de-bob-de-carole-de-bob` au troisième tour, et l'identifiant déborde.
    const g = forker(f, { qui: 'carole', suffixe: 'carole' });
    assert.equal(g.id, 'expliquer-puis-resumer-de-carole');
  });

  test('le niveau retombe à `expérimental`', () => {
    // Un fork n'a jamais été mesuré, même si son original l'avait été : c'est un autre
    // fichier, il refait ses preuves.
    assert.equal(CHAINE.target_level, 'team');
    assert.equal(f.target_level, 'experimental');
  });

  test('les étapes et le câblage sont copiés tels quels', () => {
    // C'est précisément ce qu'on vient chercher.
    assert.deepEqual(f.steps, CHAINE.steps);
    f.steps[0].id = 'modifie';
    assert.equal(CHAINE.steps[0].id, 'e1', 'copie profonde : l\'original ne bouge pas');
  });

  test('on ne forke que des chaînes', () => {
    // Forker un agent recopierait son PROMPT sous un autre nom : deux textes à corriger
    // au lieu d'un. C'est exactement ce que la composition évite.
    assert.equal(forker({ ...CHAINE, kind: 'agent' }, { qui: 'bob' }), null);
    assert.equal(forker(null, { qui: 'bob' }), null);
  });
});

describe('la trace d\'un fork', () => {
  test('vit en provenance, pas dans le YAML', () => {
    /*
     * Deux chaînes identiques, l'une écrite et l'autre forkée, sont la même capacité.
     * L'origine décrit d'où le FICHIER vient — même règle que pour la dictée.
     */
    const p = lire(entete({ origine: 'fork', phrase: 'expliquer-puis-resumer',
                            auteur: 'alice', date: '2026-08-13' }));
    assert.deepEqual(estFork(CHAINE, p), { de: 'alice', quoi: 'expliquer-puis-resumer' });
    assert.equal(estFork(CHAINE, { origine: 'demande' }), null);
    assert.equal(estFork(CHAINE, null), null);
  });

  test('l\'écran d\'Admin sait la nommer', () => {
    assert.ok(ORIGINES.fork);
    assert.match(lire(entete({ origine: 'fork', phrase: 'x' })).libelle, /[Ff]ork/);
  });
});

/* ── Les trois états ──────────────────────────────────────────────────────── */

describe('l\'état d\'une chaîne', () => {
  test('à moi, et pas encore partagée', () => {
    assert.equal(etat({ proprietaire: 'moi', publiee: false }, 'moi'), 'privee');
  });

  test('à moi ET déjà partagée', () => {
    /*
     * L'état qui manquait. Confondre « la mienne » et « privée » ferait disparaître de mon
     * établi ce que je viens de faire valider — c'est-à-dire mon meilleur travail.
     */
    assert.equal(etat({ proprietaire: 'moi', publiee: true }, 'moi'), 'partagee');
  });

  test('celle d\'un autre, selon qu\'elle est validée ou non', () => {
    assert.equal(etat({ proprietaire: 'bob', publiee: true }, 'moi'), 'du-registre');
    assert.equal(etat({ proprietaire: 'bob', publiee: false }, 'moi'), 'a-quelquun-dautre');
  });

  test('chaque état porte un libellé et une explication', () => {
    for (const cle of ['privee', 'partagee', 'du-registre', 'a-quelquun-dautre']) {
      assert.ok(ETATS[cle]?.label && ETATS[cle]?.aide, cle);
    }
  });

  test('la casse du pseudo ne fait pas perdre ce qui est à soi', () => {
    assert.equal(etat({ proprietaire: 'Ivguenyp123', publiee: false }, 'ivguenyp123'), 'privee');
  });
});
