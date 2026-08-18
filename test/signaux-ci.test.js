/*
 * Le job de CI qui casse.
 *
 * ── CE QUE CES TESTS DÉFENDENT ───────────────────────────────────────────────
 *
 * Deux choses, et la seconde est une question de sécurité.
 *
 * 1. QU'ON ENVOIE LA BONNE SOIXANTAINE DE LIGNES. Un log de CI est presque entièrement du
 *    bruit ; l'erreur qui compte est une ligne parmi quinze mille. Se tromper de fenêtre
 *    ne produit pas une panne : ça produit une explication plausible et fausse.
 *
 * 2. QU'AUCUN SECRET NE PARTE. Un log de pipeline est l'endroit où les jetons fuient le
 *    plus facilement — un `curl -v`, un `echo` de débogage. Ce log part chez un
 *    fournisseur de modèle, donc hors de la banque. Un caviardage qui rate est un
 *    incident, pas un défaut de confort.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { jobEnEchec, resumeCi, nettoyer, caviarder, extraire,
         CAVIARDE, AVANT, APRES, QUEUE, MAX_LOG } from '../lib/signaux-ci.js';

const ESC = String.fromCharCode(27);
const CR = String.fromCharCode(13);
const lignes = (n, quoi) => Array.from({ length: n }, (_, i) => `${quoi} ${i}`).join('\n');

/* ── Le nettoyage ─────────────────────────────────────────────────────────── */

describe('nettoyer le log', () => {
  test('les codes ANSI disparaissent, le texte reste', () => {
    // Un runner colore sa sortie. Ces séquences pèsent facilement un cinquième des octets
    // d'un log — des octets qui coûtent des jetons et n'apprennent rien.
    assert.equal(nettoyer(`${ESC}[0;32mtout va bien${ESC}[0m`), 'tout va bien');
  });

  test('les marqueurs de section GitLab disparaissent', () => {
    const log = `section_start:1755440000:build${CR}${ESC}[0Kbuild\nla vraie ligne`;
    assert.match(nettoyer(log), /la vraie ligne/);
    assert.ok(!nettoyer(log).includes('section_start'));
  });

  test('l\'horodatage que GitHub met sur CHAQUE ligne disparaît', () => {
    /*
     * Vingt-huit caractères par ligne, identiques d'un bout à l'autre. Sur dix mille
     * lignes c'est un quart de mégaoctet qui ne dit rien de plus que « ça s'est passé
     * pendant le job ».
     */
    const log = '2026-08-17T14:03:11.4123456Z npm ERR! raté';
    assert.equal(nettoyer(log), 'npm ERR! raté');
  });

  test('le nettoyage retire une part importante d\'un log réaliste', () => {
    const brut = Array.from({ length: 300 }, (_, i) =>
      `2026-08-17T14:03:11.4123456Z ${ESC}[0;32mCompiling ${i}${ESC}[0m`).join('\n');
    assert.ok(nettoyer(brut).length < brut.length * 0.5,
      'plus de la moitié d\'un log coloré et horodaté est du décor');
  });
});

/* ── Le caviardage ────────────────────────────────────────────────────────── */

describe('caviarder les secrets AVANT tout', () => {
  test('un jeton lâché par un `curl -v` ne repart pas', () => {
    const log = `+ curl -H "Authorization: Bearer ghp_${'a'.repeat(36)}"`;
    const { texte, trouves } = caviarder(log);
    assert.ok(!texte.includes('ghp_aaa'), 'le jeton est encore là');
    assert.ok(texte.includes(CAVIARDE));
    assert.deepEqual(trouves, ['GitHub PAT (classic)']);
  });

  test('plusieurs types dans le même log sont tous nommés', () => {
    const log = `AKIA${'B'.repeat(16)} et glpat-${'c'.repeat(20)}`;
    const { texte, trouves } = caviarder(log);
    assert.equal(trouves.length, 2);
    assert.ok(!texte.includes('AKIA'));
    assert.ok(!texte.includes('glpat-'));
  });

  test('les TYPES sont nommés, jamais les valeurs', () => {
    // Le rapport dit « un jeton GitHub a été trouvé », pas lequel. Recopier la valeur pour
    // la signaler la republierait à l'endroit même où on prétend la protéger.
    const { trouves } = caviarder(`ghp_${'a'.repeat(36)}`);
    assert.ok(!JSON.stringify(trouves).includes('ghp_'));
  });

  test('deux appels de suite donnent le MÊME résultat', () => {
    /*
     * Les motifs sont des expressions GLOBALES partagées avec le scanner de secrets. Une
     * expression globale garde sa position entre deux appels : sans remise à zéro de
     * `lastIndex`, un même motif saute une occurrence sur deux, et le résultat dépend de
     * l'ordre dans lequel les modules ont tourné. Une fuite parfaitement aléatoire.
     */
    const log = `ghp_${'a'.repeat(36)}`;
    assert.deepEqual(caviarder(log), caviarder(log));
    assert.equal(caviarder(log).trouves.length, 1);
  });

  test('un log sans secret n\'est pas modifié', () => {
    assert.equal(caviarder('npm ERR! test failed').texte, 'npm ERR! test failed');
    assert.deepEqual(caviarder('npm ERR! test failed').trouves, []);
  });
});

/* ── Le découpage ─────────────────────────────────────────────────────────── */

describe('extraire ce qui compte', () => {
  test('un log court passe entier', () => {
    const court = lignes(20, 'ligne');
    const e = extraire(court);
    assert.equal(e.coupe, false);
    assert.equal(e.texte, court);
  });

  test('le DERNIER marqueur gagne, pas le premier', () => {
    /*
     * LE test du fichier. Un build affiche souvent des erreurs bénignes en route — un
     * miroir injoignable, un test réessayé. Le premier `Error:` n'est presque jamais celui
     * qui a fait tomber le job ; le dernier l'est presque toujours, parce que c'est celui
     * après lequel le runner s'arrête.
     */
    const log = [lignes(200, 'bruit'), 'Error: miroir injoignable, on réessaie',
                 lignes(200, 'encore'), 'npm ERR! le test a échoué',
                 lignes(10, 'fin')].join('\n');
    const e = extraire(log);
    assert.match(e.repere, /npm ERR!/);
    assert.ok(!e.texte.includes('miroir injoignable'), 'l\'erreur bénigne est écartée');
  });

  test('la FIN du log est toujours jointe', () => {
    // La ligne de sortie — `ERROR: Job failed: exit code 1` — vit tout à la fin et ne
    // tombe pas forcément dans la fenêtre de l'erreur.
    const log = [lignes(300, 'bruit'), 'npm ERR! cassé',
                 lignes(300, 'nettoyage'), 'ERROR: Job failed: exit code 1'].join('\n');
    const e = extraire(log);
    assert.match(e.texte, /npm ERR! cassé/);
    assert.match(e.texte, /Job failed: exit code 1/);
  });

  test('ce qui est écarté est COMPTÉ dans l\'extrait', () => {
    // Un extrait qui ne dit pas ce qu'il a jeté se lit comme un log complet, et l'agent
    // conclut « rien d'autre dans le log » sur des lignes qu'il n'a jamais vues.
    const e = extraire([lignes(500, 'bruit'), 'npm ERR! cassé'].join('\n'));
    assert.match(e.texte, /ligne\(s\) écartée\(s\)/);
    assert.ok(e.gardees < e.total);
  });

  test('sans aucun marqueur, on garde la fin — et on le DIT', () => {
    // C'est un pari : un job s'arrête là où il casse. Il doit se voir, pour que l'agent
    // se garde d'annoncer une cause avec certitude.
    const e = extraire(lignes(400, 'rien de reconnaissable'));
    assert.equal(e.repere, null);
    assert.equal(e.coupe, true);
    assert.match(e.texte, /rien de reconnaissable 399/);
  });

  test('l\'extrait reste petit même sur un très gros log', () => {
    const e = extraire([lignes(20000, 'bruit'), 'npm ERR! cassé'].join('\n'));
    assert.ok(e.gardees <= AVANT + APRES + QUEUE + 2, `${e.gardees} lignes retenues`);
  });
});

/* ── Le signal ────────────────────────────────────────────────────────────── */

describe('le signal complet', () => {
  const base = {
    depot: 'lcl/paiement',
    run: { id: 7, branche: 'feat/x', quand: '2026-08-17T14:09:00Z', sha: 'abc1234567' },
    jobs: [{ nom: 'lint', etape: 'test', statut: 'succes', secondes: 12 },
           { nom: 'unit', etape: 'test', statut: 'echec', secondes: 184 }],
    job: { nom: 'unit', etape: 'test', statut: 'echec', secondes: 184 },
    configCi: 'unit:\n  script: npm test\n', cheminConfig: '.gitlab-ci.yml'
  };

  test('caviarde AVANT de découper', () => {
    /*
     * L'ordre est la propriété de sécurité. Un secret qui tombe hors de la fenêtre ne
     * serait pas caviardé — et il repartirait au modèle le jour où la fenêtre change de
     * taille, sans que rien n'ait été « cassé ».
     */
    const log = [`+ curl -H "Authorization: Bearer ghp_${'a'.repeat(36)}"`,
                 lignes(500, 'bruit'), 'npm ERR! cassé'].join('\n');
    const r = jobEnEchec({ ...base, log });
    assert.deepEqual(r.secrets_caviardes, ['GitHub PAT (classic)']);
    assert.ok(!JSON.stringify(r).includes('ghp_aaa'), 'le jeton a fuité dans le signal');
    assert.ok(!r.texte.includes('ghp_aaa'), 'le jeton a fuité dans le texte envoyé');
  });

  test('un secret dans le log est signalé comme un INCIDENT, pas comme un détail', () => {
    const r = jobEnEchec({ ...base, log: `token: ghp_${'a'.repeat(36)}\nnpm ERR! cassé` });
    assert.match(r.angles_morts.join(' '), /incident en soi/);
  });

  test('un log illisible interdit d\'inventer une cause', () => {
    // Sans log, un modèle devine à partir du nom du job — et une cause devinée est
    // indiscernable d'une cause trouvée.
    const r = jobEnEchec({ ...base, log: null });
    assert.equal(r.extrait, null);
    assert.match(r.angles_morts.join(' '), /ne pas en proposer une/);
  });

  test('un log VIDE et un log illisible ne disent pas la même chose', () => {
    // L'un envoie chercher une permission de jeton, l'autre une image introuvable ou un
    // runner indisponible. Les confondre fait perdre le premier quart d'heure.
    const vide = jobEnEchec({ ...base, log: '   ' });
    assert.match(vide.angles_morts.join(' '), /avant de démarrer/);
    assert.ok(!vide.angles_morts.join(' ').includes('permission sur les'));
  });

  test('sans configuration CI, on interdit de proposer d\'y toucher', () => {
    const r = jobEnEchec({ ...base, log: 'npm ERR! cassé', configCi: null });
    assert.equal(r.config, null);
    assert.match(r.angles_morts.join(' '), /qu'on n'a pas lu/);
  });

  test('le PREMIER job en échec est retenu, pas le dernier', () => {
    /*
     * Les jobs suivants échouent en général parce que celui-là a échoué. Expliquer le
     * dernier enverrait chercher la cause au mauvais endroit — et le correctif porterait
     * sur une conséquence.
     */
    const r = jobEnEchec({ ...base, job: null, log: 'npm ERR! cassé',
      jobs: [{ nom: 'build', statut: 'echec', secondes: 5 },
             { nom: 'deploy', statut: 'echec', secondes: 1 }] });
    assert.equal(r.job.nom, 'build');
    assert.equal(r.echoues, 2);
    assert.match(r.texte, /2 jobs ont échoué/);
  });

  test('aucun job en échec : le signal le dit au lieu d\'en désigner un', () => {
    const r = jobEnEchec({ ...base, job: null, log: null,
      jobs: [{ nom: 'lint', statut: 'succes', secondes: 3 }] });
    assert.equal(r.job, null);
    assert.match(resumeCi(r), /aucun job en échec/);
    assert.match(r.texte, /rien à expliquer/);
  });

  test('un log gigantesque est coupé, et la coupe est dite', () => {
    const r = jobEnEchec({ ...base, log: `${'x'.repeat(MAX_LOG + 5000)}\nnpm ERR! cassé` });
    assert.match(r.angles_morts.join(' '), new RegExp(String(MAX_LOG)));
  });

  test('le texte envoyé porte le log ET la configuration', () => {
    // Sans la configuration, le correctif ne peut porter que sur le code — et l'agent le
    // proposerait quand même, sur un fichier deviné.
    const r = jobEnEchec({ ...base, log: 'npm ERR! cassé' });
    assert.match(r.texte, /npm ERR! cassé/);
    assert.match(r.texte, /\.gitlab-ci\.yml/);
    assert.match(r.texte, /script: npm test/);
  });

  test('la ligne de résumé dit ce qui a été retenu', () => {
    const r = jobEnEchec({ ...base, log: [lignes(500, 'bruit'), 'npm ERR! cassé'].join('\n') });
    assert.match(resumeCi(r), /unit \(test\)/);
    assert.match(resumeCi(r), /\/50[12] lignes retenues/);
  });
});
