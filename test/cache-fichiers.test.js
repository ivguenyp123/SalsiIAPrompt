/*
 * Le cache de contenus — et surtout ce qu'il refuse de faire.
 *
 * Un cache est dangereux de deux façons opposées :
 *   · il sert du PÉRIMÉ, et on publie une correction que personne ne voit ;
 *   · il TOMBE quand le stockage refuse, et on ne peut plus ouvrir le catalogue du tout.
 *
 * Les deux ont leur test ici. Le second compte plus que le gain d'appels : perdre le cache
 * est une gêne, perdre l'écran est une panne.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cacheFichiers, stockageLocal, BUDGET } from '../lib/cache-fichiers.js';

/** Un stockage de test : une Map, avec de quoi le faire refuser à volonté. */
function stockageFactice({ refuse = false } = {}) {
  const m = new Map();
  return {
    m,
    refuseMaintenant: refuse,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (this.refuseMaintenant) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem(k) { m.delete(k); }
  };
}

/* ══ LA CLÉ EST L'EMPREINTE ═══════════════════════════════════════════════════ */

describe('ce qu\'on sert, et ce qu\'on ne sert pas', () => {
  test('une empreinte connue rend son contenu', () => {
    const c = cacheFichiers(stockageFactice());
    c.range('abc123', 'id: un');
    assert.equal(c.lu('abc123'), 'id: un');
  });

  test('une empreinte inconnue rend `null` — pas une chaîne vide', () => {
    /*
     * La différence décide de tout côté appelant : `null` veut dire « va le chercher »,
     * `''` voudrait dire « le fichier est vide ». Confondre les deux ferait afficher un
     * artefact vide plutôt que de le relire.
     */
    const c = cacheFichiers(stockageFactice());
    assert.equal(c.lu('jamais-vu'), null);
  });

  test('LA CLÉ N\'EST PAS LE CHEMIN : un contenu changé ne se sert pas', () => {
    /*
     * Le bug qu'on n'aura pas. Avec une clé par chemin, publier une correction sur
     * `artifacts/x.yaml` laissait le catalogue afficher l'ancienne version indéfiniment,
     * sans rien pour l'indiquer. L'empreinte change avec le contenu — par construction.
     */
    const c = cacheFichiers(stockageFactice());
    c.range('sha-avant', 'title: ancien');
    assert.equal(c.lu('sha-apres'), null, 'un nouveau sha ne doit RIEN trouver');
  });

  test('sans empreinte, pas de cache — on ne devine pas', () => {
    // Une forge qui ne rend pas de sha nous laisse sans clé fiable. Inventer une clé
    // (le chemin, la taille) ramènerait exactement le service de périmé ci-dessus.
    const c = cacheFichiers(stockageFactice());
    assert.equal(c.range('', 'contenu'), false);
    assert.equal(c.range(undefined, 'contenu'), false);
    assert.equal(c.lu(''), null);
  });

  test('on ne range que du texte', () => {
    const c = cacheFichiers(stockageFactice());
    assert.equal(c.range('s', { objet: true }), false);
    assert.equal(c.range('s', null), false);
    assert.equal(c.lu('s'), null);
  });
});

/* ══ LE STOCKAGE QUI REFUSE ═══════════════════════════════════════════════════ */

describe('un stockage indisponible ne casse rien', () => {
  test('un stockage qui refuse d\'écrire ne LÈVE PAS', () => {
    /*
     * Navigation privée, quota plein, cookies bloqués : trois cas ordinaires. Lever ici
     * ferait échouer l'ouverture du catalogue pour une optimisation — le pire troc
     * possible.
     */
    const s = stockageFactice({ refuse: true });
    const c = cacheFichiers(s);
    assert.equal(c.range('abc', 'contenu'), false, 'il DIT qu\'il n\'a pas rangé');
    assert.equal(c.lu('abc'), null, 'et il ne prétend pas l\'avoir');
  });

  test('un cache illisible se comporte comme un cache vide', () => {
    const s = stockageFactice();
    s.m.set('salsi_cache_fichiers', '{ ceci n\'est pas du JSON');
    const c = cacheFichiers(s);
    assert.equal(c.lu('abc'), null);
    assert.equal(c.range('abc', 'x'), true, 'et il repart proprement');
    assert.equal(c.lu('abc'), 'x');
  });

  test('un cache d\'une AUTRE version se jette, il ne se migre pas', () => {
    const s = stockageFactice();
    s.m.set('salsi_cache_fichiers', JSON.stringify({ v: 99, e: { abc: { c: 'vieux', vu: 1 } } }));
    assert.equal(cacheFichiers(s).lu('abc'), null);
  });

  test('`lu` ne lève pas quand la relecture-pour-marquer échoue', () => {
    // `lu` réécrit l'état pour marquer l'entrée comme servie. Si cette écriture échoue,
    // le contenu doit sortir quand même : on a l'information, la perdre serait absurde.
    const s = stockageFactice();
    const c = cacheFichiers(s);
    c.range('abc', 'contenu');
    s.refuseMaintenant = true;
    assert.equal(c.lu('abc'), 'contenu');
  });

  test('hors navigateur, `stockageLocal` rend un stockage inerte', () => {
    const s = stockageLocal();
    assert.equal(s.getItem('x'), null);
    assert.doesNotThrow(() => s.setItem('x', 'y'));
    const c = cacheFichiers(s);
    c.range('abc', 'contenu');
    assert.equal(c.lu('abc'), null, 'inerte veut dire sans effet, pas en panne');
  });
});

/* ══ LA PURGE ═════════════════════════════════════════════════════════════════ */

describe('le budget se tient, et on jette le bon', () => {
  test('au-delà du budget, on jette — on ne grossit pas indéfiniment', () => {
    /*
     * Le stockage du navigateur est PARTAGÉ avec la session. Le remplir déconnecterait
     * quelqu'un pour lui avoir fait gagner un appel.
     */
    const c = cacheFichiers(stockageFactice(), { budget: 100 });
    for (let i = 0; i < 10; i += 1) c.range(`s${i}`, 'x'.repeat(30));
    const etat = c.etat();
    assert.ok(etat.caracteres <= 100, `${etat.caracteres} caractères pour un budget de 100`);
    assert.ok(etat.entrees > 0, 'et il ne se vide pas entièrement pour autant');
  });

  test('on jette le moins récemment SERVI, pas le moins récemment écrit', () => {
    /*
     * La distinction est tout l'intérêt. Une purge par date d'écriture jetterait
     * exactement les entrées les plus consultées — celles qu'on a rangées en premier et
     * qu'on ressert à chaque visite.
     */
    let t = 0;
    const horloge = () => { t += 1; return t; };
    const c = cacheFichiers(stockageFactice(), { budget: 60, maintenant: horloge });

    c.range('vieux-mais-utile', 'a'.repeat(30));
    c.range('recent-et-oublie', 'b'.repeat(30));
    c.lu('vieux-mais-utile');              // servi → il devient le plus récent
    c.range('nouveau', 'c'.repeat(30));    // force la purge

    assert.equal(c.lu('vieux-mais-utile'), 'a'.repeat(30), 'le consulté survit');
    assert.equal(c.lu('recent-et-oublie'), null, 'l\'oublié part');
  });

  test('`vider` jette tout', () => {
    const c = cacheFichiers(stockageFactice());
    c.range('a', 'x'); c.range('b', 'y');
    assert.equal(c.etat().entrees, 2);
    c.vider();
    assert.deepEqual(c.etat(), { entrees: 0, caracteres: 0 });
  });

  test('`etat` compte ce qui est là — pour l\'afficher, jamais pour décider', () => {
    const c = cacheFichiers(stockageFactice());
    c.range('a', 'x'.repeat(10));
    c.range('b', 'y'.repeat(5));
    assert.deepEqual(c.etat(), { entrees: 2, caracteres: 15 });
  });

  test('le budget par défaut reste petit devant le stockage du navigateur', () => {
    // Cinq mégaoctets est la taille usuelle, et elle est PARTAGÉE. Prendre deux millions
    // de caractères laisse de la place à la session, qui compte plus que ce cache.
    assert.ok(BUDGET <= 2_500_000, 'ne pas monopoliser un stockage partagé');
  });
});
