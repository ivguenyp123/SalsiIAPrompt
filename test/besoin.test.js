/*
 * Le routeur de besoin — une phrase devient une clé de routage, et rien de plus.
 *
 * Trois familles de vérifications, et la troisième est la plus importante :
 *   1. il reconnaît ce qu'il doit reconnaître ;
 *   2. il n'invente NI matière NI droit ;
 *   3. il DIT ce qu'il n'a pas compris — sans quoi un routeur qui lit deux mots sur
 *      trente a exactement la même tête qu'un routeur qui a tout compris.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNAUX } from '../lib/signaux-matiere.js';
import { SOURCES_ENTREES } from '../lib/assemblage.js';
import { lexique, comprendre, direLeBesoin, aDeQuoiRouter, matieresRetenues,
         racine, SEUIL_COMMUN, VERBES_ECRITURE, MOTS_VIDES } from '../lib/besoin.js';

const LEX = lexique({ signaux: SIGNAUX, sources: SOURCES_ENTREES });
const c = (phrase) => comprendre(phrase, LEX);
const noms = (x) => x.entrees.map((e) => e.entree);

/* ══ CE QU'IL RECONNAÎT ═══════════════════════════════════════════════════════ */

describe('une phrase désigne une matière', () => {
  test('le lexique couvre TOUT le vocabulaire des entrées, pas seulement les signaux', () => {
    /*
     * `diff` et `code` se lisent dans le dépôt et n'ont aucune fiche de signal. Les
     * omettre rendrait le routeur aveugle aux deux matières les plus courantes de la
     * plateforme — et l'aveuglement serait silencieux.
     */
    for (const entree of Object.keys(SOURCES_ENTREES)) {
      assert.ok(LEX.parEntree.has(entree), `${entree} absente du lexique`);
    }
    assert.ok(LEX.parEntree.get('diff')?.size, '`diff` sans aucun mot : introuvable à jamais');
  });

  test('les mots viennent du registre, jamais d\'une table recopiée', () => {
    // Une seconde table de synonymes diverge — on l'a payé aujourd'hui même avec
    // l'émetteur, qui avait sa propre copie du vocabulaire. Le lexique se déduit des
    // `libelle` et `besoin` des signaux, donc il suit quand ils bougent.
    assert.ok(LEX.parEntree.get('rapport_vulnerabilites').has('vulnerabilite'));
    assert.ok(LEX.parEntree.get('chiffres_dora').has('dora'));
  });

  test('le pluriel ne fait pas rater la matière', () => {
    assert.equal(racine('vulnerabilites'), 'vulnerabilite');
    assert.deepEqual(noms(c('les vulnérabilités')), ['rapport_vulnerabilites']);
    assert.deepEqual(noms(c('une vulnérabilité')), ['rapport_vulnerabilites']);
  });

  test('les accents ne changent rien', () => {
    assert.deepEqual(noms(c('sécurité')), noms(c('securite')));
  });

  test('l\'ordre est le NOMBRE DE MOTS qui ont désigné, pas un score', () => {
    const r = c('les métriques dora');
    assert.deepEqual(noms(r), ['chiffres_dora']);
    // Les motifs sont là pour que le classement se conteste : sans eux, l'ordre est
    // une autorité sans preuve.
    assert.deepEqual(r.entrees[0].motifs.sort(), ['dora', 'metrique']);
  });
});

/* ══ CE QU'IL N'INVENTE PAS ═══════════════════════════════════════════════════ */

describe('il n\'invente ni matière ni droit', () => {
  test('une phrase hors sujet ne rend RIEN — pas « le plus proche »', () => {
    /*
     * Le contresens qu'une recherche vectorielle ferait : rendre toujours quelque chose,
     * parce qu'il existe toujours un plus proche voisin. Ici, rien veut dire rien.
     */
    const r = c('je veux faire un gâteau au chocolat');
    assert.deepEqual(r.entrees, []);
    assert.deepEqual(r.pistes, []);
    assert.equal(aDeQuoiRouter(r), false);
    assert.deepEqual(r.ignores, ['gateau', 'chocolat']);
  });

  test('le droit par défaut est `none`, jamais « on verra »', () => {
    assert.equal(c('les métriques dora').droit, 'none');
    assert.equal(c('').droit, 'none');
  });

  test('RELIRE une merge request ne demande PAS le droit d\'écrire', () => {
    /*
     * Mesuré, et corrigé : `merge`, `request`, `mr`, `branche` avaient été mis dans les
     * verbes d'écriture. « relire une merge request » sortait donc classé comme une
     * demande d'action sur la forge — ce qui met en avant des capacités qui ÉCRIVENT pour
     * quelqu'un qui voulait seulement lire. Ce sont des noms, pas des actions.
     */
    const r = c('relire une merge request');
    assert.equal(r.droit, 'none');
    assert.deepEqual(r.motifsDroit, []);
    assert.deepEqual(noms(r), ['revue_mr']);
    for (const nom of ['mr', 'merge', 'request', 'branche', 'ouvrir', 'modifier']) {
      assert.ok(!VERBES_ECRITURE.includes(nom), `« ${nom} » est un nom, pas une action`);
    }
  });

  test('un VERBE d\'action, lui, engage le droit', () => {
    const r = c('propose une MR qui corrige le problème');
    assert.equal(r.droit, 'write');
    assert.ok(r.motifsDroit.includes('propose'));
  });

  test('un verbe d\'écriture n\'est pas listé comme incompris', () => {
    // Il a fixé le droit : le dire aussi « pas compris » ferait tenir deux discours
    // contraires sur le même mot, dans le même écran.
    const r = c('proposer une correction');
    assert.equal(r.droit, 'write');
    assert.ok(!r.ignores.includes('proposer'), 'compris comme action, donc pas ignoré');
  });

  test('les pistes ne sont PAS des matières retenues', () => {
    // La distinction porte tout l'écran : une matière retenue route, une piste se choisit.
    const r = c('mon pipeline');
    assert.deepEqual(matieresRetenues(r), []);
    assert.ok(r.pistes.length > 1);
    assert.equal(aDeQuoiRouter(r), false, 'on ne route pas sur une question non tranchée');
  });
});

/* ══ CE QU'IL DIT DE SON PROPRE ÉCHEC ═════════════════════════════════════════ */

describe('il dit ce qu\'il n\'a pas compris', () => {
  test('un mot trop répandu NARROWE au lieu de disparaître', () => {
    /*
     * « pourquoi mon pipeline casse » est la question la plus fréquente du métier, et elle
     * ne rendait RIEN : « pipeline » désigne sept matières, donc il était écarté pour
     * cause d'abondance. Écarter le seul mot qu'on ait est un contresens — il ne tranche
     * pas, mais il restreint.
     */
    const r = c('mon pipeline');
    assert.deepEqual(r.entrees, [], 'il ne CHOISIT toujours pas à notre place');
    assert.ok(r.pistes.length >= 2, 'mais il propose les possibles');
    assert.ok(r.pistes.every((p) => p.mot === 'pipeline'));
    assert.match(direLeBesoin(r), /je ne peux pas choisir/);
    assert.match(direLeBesoin(r), /Laquelle \?/);
  });

  test('un mot que les gens emploient vraiment évite la question', () => {
    /*
     * « pourquoi mon pipeline casse » PASSAIT par la question ci-dessus : sept matières
     * portent « pipeline », et rien ne portait « casse ». C'est la question la plus
     * fréquente du métier, et elle méritait une réponse directe.
     *
     * Le mot manquant a été ajouté SUR LA FICHE DU SIGNAL, là où le libellé est déjà
     * écrit — pas dans une table de synonymes à part, qui aurait divergé.
     */
    const r = c('je veux savoir pourquoi mon pipeline casse');
    assert.ok(noms(r).includes('job_en_echec'), 'répond directement, sans demander');
    assert.ok(r.entrees.find((e) => e.entree === 'job_en_echec').motifs.includes('casse'));

    assert.ok(noms(c('les failles de mon dépôt')).includes('rapport_vulnerabilites'),
              '« faille » est LE mot français, et la description ne le portait pas');
  });

  test('les pistes ne sortent QUE si rien de distinctif n\'a été trouvé', () => {
    // Quand la phrase désigne quelque chose, un mot passe-partout n'a pas à venir
    // l'élargir : ce serait rendre le résultat pire à mesure qu'on écrit plus.
    const r = c('les vulnérabilités de mon dépôt');
    assert.deepEqual(noms(r), ['rapport_vulnerabilites']);
    assert.deepEqual(r.pistes, []);
    assert.ok(r.communs.some((x) => x.mot === 'depot'), 'il le SAIT, et il le dit');
  });

  test('la phrase ne dit jamais un mot à la fois compris et pas compris', () => {
    for (const p of ['propose une MR qui corrige le pipeline en échec',
                     'relire une merge request',
                     'les vulnérabilités de mon dépôt',
                     'je veux savoir pourquoi mon pipeline casse']) {
      const r = c(p);
      const dits = new Set([...r.entrees.flatMap((e) => e.motifs), ...r.motifsDroit]);
      for (const m of r.ignores) {
        assert.ok(!dits.has(m), `« ${m} » dit compris ET incompris pour « ${p} »`);
      }
    }
  });

  test('les mots incompris sont RENDUS, pas avalés', () => {
    const r = c('vérifier que mon API respecte les règles de sécurité');
    assert.deepEqual(noms(r), ['parc_securite']);
    assert.ok(r.ignores.includes('api'));
    assert.match(direLeBesoin(r), /PAS COMPRIS/);
    assert.match(direLeBesoin(r), /passe à côté/);
  });

  test('une phrase vide ne prétend rien', () => {
    const r = c('');
    assert.deepEqual(r.entrees, []);
    assert.deepEqual(r.ignores, []);
    assert.match(direLeBesoin(r), /AUCUNE MATIÈRE RECONNUE/);
  });

  test('les mots vides ne ressortent pas comme incompris', () => {
    // « je veux » listé comme « pas compris » ferait passer le routeur pour cassé alors
    // qu'il fonctionne — et noierait les mots qui comptent vraiment.
    const r = c('je veux les métriques dora');
    assert.deepEqual(r.ignores, []);
    for (const m of ['je', 'veux', 'les']) assert.ok(MOTS_VIDES.has(m));
  });
});

/* ══ SUR LE VOCABULAIRE RÉEL ══════════════════════════════════════════════════ */

describe('le lexique tel qu\'il est', () => {
  test('aucune matière n\'est INATTEIGNABLE', () => {
    /*
     * Une matière qu'aucune phrase ne peut désigner est au registre et hors d'atteinte.
     * C'est ce test qui a trouvé `inventaire_fichiers` — ses deux seuls mots, « inventaire »
     * et « fichier », sont l'un et l'autre trop répandus, donc elle était introuvable.
     *
     * On vérifie donc l'atteignabilité RÉELLE : soit un mot rare, soit un croisement de
     * mots répandus qui converge sur elle. Le second cas est ce qui la sauve.
     */
    const perdues = [...LEX.parEntree].filter(([entree, mots]) => {
      if (!mots.size) return false;
      return !noms(c([...mots].join(' '))).includes(entree);
    });
    assert.deepEqual(perdues.map(([e]) => e), []);
  });

  test('deux mots banals qui convergent valent un mot rare', () => {
    const r = c('un inventaire des fichiers');
    assert.deepEqual(noms(r), ['inventaire_fichiers']);
    assert.deepEqual(r.entrees[0].motifs.sort(), ['fichier', 'inventaire'],
                     'et il dit QUELS mots ont convergé');
  });

  test('un croisement qui ne converge pas retombe sur la question', () => {
    // Le croisement est total : sur une phrase longue il rend souvent le vide, et c'est
    // très bien — on demande, au lieu de rendre un « au mieux » inexplicable.
    const r = c('mon pipeline et mes branches et mes commits et mes fichiers');
    assert.deepEqual(noms(r), []);
    assert.ok(r.pistes.length > 1);
  });

  test('chaque entrée du vocabulaire porte au moins un mot', () => {
    const muettes = [...LEX.parEntree].filter(([, mots]) => !mots.size).map(([e]) => e);
    assert.deepEqual(muettes, [], 'une entrée sans mot ne se trouve jamais');
  });
});
