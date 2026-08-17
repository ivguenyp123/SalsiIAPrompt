/*
 * La matière — aller chercher ce qu'un agent doit lire, sans jamais l'injecter.
 *
 * Ce qui se vérifie ici est la partie qui décide : quelle source proposer, comment
 * retrouver un fichier dans un dépôt de milliers, et comment recoller en diff unifié les
 * patchs par fichier que les deux forges rendent chacune à leur façon. L'écran, lui, ne
 * fait qu'afficher — et les appels réseau sont vérifiés à part, avec un `fetch` de papier.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCES, sourceProbable, chercher, diffUnifie, resume, grosse, GROS } from '../lib/matiere.js';
import { createForge } from '../app/forge.js';

/* ── La source proposée ───────────────────────────────────────────────────── */

describe('la source proposée', () => {
  test('un diff vient d\'une pull request', () => {
    assert.equal(sourceProbable({ name: 'diff', source: 'signal' }), 'pull');
    assert.equal(sourceProbable({ name: 'changement', source: 'user' }), 'pull');
  });

  test('du code vient d\'un fichier', () => {
    for (const name of ['code', 'requete', 'fichier', 'module_source']) {
      assert.equal(sourceProbable({ name, source: 'signal' }), 'fichier', name);
    }
  });

  test('un journal de pipeline ne se récupère PAS', () => {
    // Il vit dans la CI, pas au dépôt. Proposer « fichier » ferait chercher un fichier
    // qui n'existe pas, et le sélecteur s'ouvrirait sur une impasse.
    assert.equal(sourceProbable({ name: 'pipeline_log', source: 'signal' }), 'colle');
    assert.equal(sourceProbable({ name: 'trace', source: 'signal' }), 'colle');
  });

  test('les trois sources existent, « je colle » comprise', () => {
    assert.deepEqual(SOURCES.map((s) => s.id), ['fichier', 'pull', 'colle']);
  });
});

/* ── La recherche de chemin ───────────────────────────────────────────────── */

describe('chercher un fichier', () => {
  const ARBRE = [
    'src/main/java/com/lcl/FooService.java',
    'src/main/java/com/lcl/BarService.java',
    'src/test/java/com/lcl/FooServiceTest.java',
    'services/config/application.yaml',
    'README.md'
  ];

  test('les fragments se cumulent, dans n\'importe quel ordre', () => {
    // « foo serv » doit trouver FooService : un navigateur d'arborescence demanderait
    // cinq clics pour le même résultat.
    const r = chercher(ARBRE, 'foo serv');
    assert.equal(r.total, 2);
    assert.ok(r.chemins.every((c) => /Foo/.test(c)));
  });

  test('le nom de fichier pèse plus que le dossier', () => {
    const r = chercher(ARBRE, 'service');
    assert.match(r.chemins[0], /Service\.java$/,
                 'FooService.java avant services/config/application.yaml');
  });

  test('les accents et la casse ne comptent pas', () => {
    assert.equal(chercher(['src/Requête.java'], 'requete').total, 1);
    assert.equal(chercher(['src/Foo.java'], 'FOO').total, 1);
  });

  test('une recherche vide ne rend rien plutôt que tout', () => {
    // Afficher 4 000 chemins n'aide pas ; l'écran dit combien il y en a et attend.
    assert.equal(chercher(ARBRE, '').total, ARBRE.length);
  });

  test('la troncature est DITE, jamais silencieuse', () => {
    const gros = Array.from({ length: 120 }, (_, i) => `src/F${i}.java`);
    const r = chercher(gros, 'src', 50);
    assert.equal(r.chemins.length, 50);
    assert.equal(r.total, 120);
    assert.equal(r.tronque, true);
  });
});

/* ── Le diff unifié ───────────────────────────────────────────────────────── */

describe('recoller un diff', () => {
  const CHANGEMENTS = [
    { fichier: 'src/Foo.java', ancien: 'src/Foo.java',
      patch: '@@ -1,3 +1,4 @@\n ligne\n-vieille\n+neuve\n+ajout' },
    { fichier: 'src/Bar.java', ancien: 'src/Bar.java',
      patch: '@@ -10,2 +10,2 @@\n-a\n+b\n c' }
  ];

  test('les en-têtes `diff --git` sont reconstruits', () => {
    // Les deux forges rendent un patch PAR FICHIER, sans en-tête. Or c'est cette forme
    // que les agents attendent : celle de la banque, celle d'un `git diff`.
    const d = diffUnifie(CHANGEMENTS);
    assert.match(d.texte, /^diff --git a\/src\/Foo\.java b\/src\/Foo\.java$/m);
    assert.match(d.texte, /^--- a\/src\/Foo\.java$/m);
    assert.match(d.texte, /^\+\+\+ b\/src\/Foo\.java$/m);
    assert.equal(d.fichiers, 2);
  });

  test('un renommage garde ses deux noms', () => {
    const d = diffUnifie([{ fichier: 'src/Neuf.java', ancien: 'src/Vieux.java', patch: '@@ -1 +1 @@\n-a\n+b' }]);
    assert.match(d.texte, /diff --git a\/src\/Vieux\.java b\/src\/Neuf\.java/);
  });

  test('un binaire est NOMMÉ, pas omis', () => {
    // L'omettre en silence ferait croire à un diff complet. On le dit dans le corps,
    // comme git, et on le compte à part pour que l'écran puisse l'annoncer.
    const d = diffUnifie([...CHANGEMENTS, { fichier: 'logo.png', ancien: 'logo.png', binaire: true }]);
    assert.match(d.texte, /Binary files a\/logo\.png and b\/logo\.png differ/);
    assert.deepEqual(d.ignores, ['logo.png']);
  });

  test('le résultat est un diff que les résolveurs savent lire', async () => {
    // La preuve qui compte : `output.files_touched` doit y compter 2 fichiers. Sans les
    // en-têtes reconstruits, il en compterait zéro.
    const { RESOLVEURS } = await import('../runtime/resolveurs.js');
    assert.equal(RESOLVEURS['output.files_touched'](diffUnifie(CHANGEMENTS).texte), 2);
  });

  test('aucun changement rend un texte vide, pas un faux diff', () => {
    assert.deepEqual(diffUnifie([]), { texte: '', fichiers: 0, ignores: [] });
    assert.equal(diffUnifie(null).texte, '');
  });
});

/* ── Ce que l'écran affiche ───────────────────────────────────────────────── */

describe('le résumé de la matière', () => {
  test('compte les lignes et estime les jetons', () => {
    const r = resume('a\nb\nc', 'depot · src/Foo.java');
    assert.equal(r.lignes, 3);
    assert.equal(r.caracteres, 5);
    assert.equal(r.jetons, 2);
    assert.equal(r.origine, 'depot · src/Foo.java');
  });

  test('rien ne compte pour zéro ligne', () => {
    assert.equal(resume('').lignes, 0);
    assert.equal(resume(null).lignes, 0);
  });

  test('au-delà du seuil, l\'écran prévient — il ne refuse pas', () => {
    // Donner un gros fichier à un agent est légitime ; l'envoyer sans le savoir coûte,
    // et surtout dilue. C'est un avertissement, pas une porte.
    assert.equal(grosse('x'.repeat(GROS + 1)), true);
    assert.equal(grosse('x'.repeat(GROS)), false);
  });
});

/* ── La forge : les deux backends rendent la MÊME forme ───────────────────── */

describe('les pull requests, des deux côtés', () => {
  /**
   * Un `fetch` de papier : il note ce qu'on lui demande et rend ce qu'on lui dit.
   *
   * `appels` garde le VERBE et le CORPS en plus de l'URL. Sur les gestes d'une merge
   * request, l'URL seule ne suffit pas à distinguer une fermeture d'une réouverture :
   * c'est le corps qui porte la décision, et c'est donc lui qu'il faut vérifier.
   */
  const papier = (routes) => {
    const vus = [];
    const appels = [];
    return { vus, appels, impl: async (url, options = {}) => {
      vus.push(url);
      appels.push({ url, methode: options.method || 'GET',
                    corps: options.body ? JSON.parse(options.body) : null });
      for (const [motif, corps] of Object.entries(routes)) {
        if (url.includes(motif)) {
          return { ok: true, status: 200, json: async () => corps };
        }
      }
      return { ok: false, status: 404, json: async () => ({}) };
    } };
  };

  const session = (url) => ({ gitlabUrl: url, token: 'faux', username: 'moi' });

  test('GitHub : la liste et les changements', async () => {
    const f = papier({
      '/pulls?': [{ number: 12, title: 'fix(ff) : la colonne', head: { ref: 'fix/ff' },
                    base: { ref: 'main' }, user: { login: 'ivguenyp123' }, html_url: 'https://x' }],
      '/pulls/12/files': [{ filename: 'src/Foo.java', patch: '@@ -1 +1 @@\n-a\n+b' },
                          { filename: 'logo.png' }]
    });
    const forge = createForge(session('https://github.com'), f.impl);

    const pulls = await forge.listPullRequests('moi/demo');
    assert.deepEqual(pulls[0], { numero: 12, titre: 'fix(ff) : la colonne', branche: 'fix/ff',
                                 cible: 'main', auteur: 'ivguenyp123', url: 'https://x',
                                 ouvert: '', fusionne: '' });

    const ch = await forge.pullRequestChanges('moi/demo', 12);
    assert.equal(ch[0].fichier, 'src/Foo.java');
    assert.equal(ch[0].binaire, false);
    assert.equal(ch[1].binaire, true, 'sans patch, GitHub dit binaire');
  });

  test('GitLab : la même forme, sortie d\'une API différente', async () => {
    // C'est tout l'intérêt de l'abstraction : `lib/matiere.js` ne sait pas à qui il parle,
    // et l'écran non plus. Le jour où LCL bascule sur son GitLab, rien ne bouge au-dessus.
    const f = papier({
      '/merge_requests?': [{ iid: 7, title: 'feat: endpoint', source_branch: 'feat/x',
                             target_branch: 'main', author: { username: 'moi' }, web_url: 'https://y' }],
      '/merge_requests/7/changes': { changes: [{ new_path: 'src/Foo.java', old_path: 'src/Foo.java',
                                                 diff: '@@ -1 +1 @@\n-a\n+b' }] }
    });
    const forge = createForge(session('https://gitlab.example.com'), f.impl);

    const pulls = await forge.listPullRequests('groupe/demo');
    assert.deepEqual(pulls[0], { numero: 7, titre: 'feat: endpoint', branche: 'feat/x',
                                 cible: 'main', auteur: 'moi', url: 'https://y',
                                 ouvert: '', fusionne: '' });

    const ch = await forge.pullRequestChanges('groupe/demo', 7);
    assert.deepEqual(ch, [{ fichier: 'src/Foo.java', ancien: 'src/Foo.java',
                            patch: '@@ -1 +1 @@\n-a\n+b', binaire: false }]);
  });

  test('les deux forges ne demandent QUE les pull requests ouvertes', async () => {
    // On vient chercher ce qui est en cours de relecture, pas de l'archive.
    const gh = papier({ '/pulls?': [] });
    await createForge(session('https://github.com'), gh.impl).listPullRequests('moi/demo');
    assert.match(gh.vus[0], /state=open/);

    const gl = papier({ '/merge_requests?': [] });
    await createForge(session('https://gitlab.example.com'), gl.impl).listPullRequests('g/demo');
    assert.match(gl.vus[0], /state=opened/);
  });

  /*
   * L'archive s'ouvre sur demande, et les deux forges n'y répondent pas de la même façon.
   * C'est le lead time qui l'a rendue nécessaire : il se mesure sur ce qui est PARTI.
   */
  test('les fusionnées se demandent autrement, et GitHub filtre à la main', async () => {
    const gl = papier({ '/merge_requests?': [{ iid: 1, created_at: 'A', merged_at: 'B' }] });
    const mr = await createForge(session('https://gitlab.example.com'), gl.impl)
      .listPullRequests('g/demo', { etat: 'fusionnees', depuis: '2026-07-01T00:00:00Z' });
    assert.match(gl.vus[0], /state=merged/);
    assert.match(gl.vus[0], /updated_after=/);
    assert.deepEqual([mr[0].ouvert, mr[0].fusionne], ['A', 'B']);

    /*
     * GitHub n'a pas d'état « fusionnée » : il rend les CLOSES, dont les abandonnées.
     * Sans le filtre sur `merged_at`, le lead time mesurerait des changements qui ne sont
     * jamais partis — et paraîtrait d'autant meilleur que l'équipe abandonne vite.
     */
    const gh = papier({ '/pulls?': [
      { number: 1, created_at: 'A', merged_at: 'B' },
      { number: 2, created_at: 'C', merged_at: null }
    ] });
    const pr = await createForge(session('https://github.com'), gh.impl)
      .listPullRequests('moi/demo', { etat: 'fusionnees' });
    assert.match(gh.vus[0], /state=closed/);
    assert.deepEqual(pr.map((p) => p.numero), [1]);
  });

  test('un pipeline rend son commit et sa date de création, des deux côtés', async () => {
    // `sha` pour dédupliquer les livraisons, `debut` parce qu'un job relancé plus tard
    // déplace `updated_at` et daterait un incident du jour de sa réparation.
    const gl = papier({ '/pipelines?': [
      { id: 9, status: 'success', ref: 'main', sha: 'abc', created_at: 'A', updated_at: 'Z' }] });
    const p = await createForge(session('https://gitlab.example.com'), gl.impl)
      .listRuns('g/demo', { depuis: '2026-07-01T00:00:00Z' });
    assert.match(gl.vus[0], /updated_after=/);
    assert.deepEqual([p[0].sha, p[0].debut, p[0].quand], ['abc', 'A', 'Z']);

    const gh = papier({ '/actions/runs?': { workflow_runs: [
      { id: 9, status: 'completed', conclusion: 'success', head_branch: 'main',
        head_sha: 'abc', created_at: 'A', updated_at: 'Z' }] } });
    const w = await createForge(session('https://github.com'), gh.impl)
      .listRuns('moi/demo', { depuis: '2026-07-01T00:00:00Z' });
    assert.match(gh.vus[0], /created=%3E%3D2026-07-01/);
    assert.deepEqual([w[0].sha, w[0].debut, w[0].quand], ['abc', 'A', 'Z']);
  });
});

/*
 * ── LES QUATRE GESTES D'UNE MERGE REQUEST ───────────────────────────────────
 *
 * Ils écrivent chez quelqu'un d'autre. Ce qui se vérifie ici est la seule chose qu'un test
 * peut vérifier de ces gestes : qu'ils tapent la BONNE route avec le BON verbe. Se tromper
 * ne rend pas une erreur lisible — GitHub répond 422 sur `/pulls/:n/comments` employée
 * pour un commentaire général, et personne ne devine que la bonne route est celle des
 * issues.
 */
describe('les quatre gestes, des deux côtés', () => {
  const papier = (corps = {}) => {
    const appels = [];
    return { appels, impl: async (url, options = {}) => {
      appels.push({ url, methode: options.method || 'GET',
                    corps: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, json: async () => corps };
    } };
  };
  const gl = (f) => createForge({ gitlabUrl: 'https://gitlab.example.com', token: 't' }, f);
  const gh = (f) => createForge({ gitlabUrl: 'https://github.com', token: 't' }, f);

  test('commenter : GitHub range les commentaires de PR avec ceux des ISSUES', async () => {
    // `/pulls/:n/comments` désigne autre chose — les commentaires attachés à une ligne du
    // diff. Se tromper de route rend un 422 incompréhensible.
    const f = papier({ id: 1 });
    await gh(f.impl).commenterPullRequest('moi/demo', 7, 'mon avis');
    assert.match(f.appels[0].url, /\/issues\/7\/comments$/);
    assert.equal(f.appels[0].methode, 'POST');
    assert.equal(f.appels[0].corps.body, 'mon avis');

    const g = papier({ id: 1 });
    await gl(g.impl).commenterPullRequest('g/demo', 7, 'mon avis');
    assert.match(g.appels[0].url, /\/merge_requests\/7\/notes$/);
  });

  test('approuver : une route dédiée côté GitLab, une « review » côté GitHub', async () => {
    const f = papier({});
    await gh(f.impl).approuverPullRequest('moi/demo', 7);
    assert.match(f.appels[0].url, /\/pulls\/7\/reviews$/);
    assert.equal(f.appels[0].corps.event, 'APPROVE');

    const g = papier({});
    await gl(g.impl).approuverPullRequest('g/demo', 7);
    assert.match(g.appels[0].url, /\/merge_requests\/7\/approve$/);
    assert.equal(g.appels[0].methode, 'POST');
  });

  test('fusionner rend un verdict, et ne le suppose pas', async () => {
    /*
     * La forge peut REFUSER de fusionner — conflit, règle de protection, pipeline en
     * échec — en répondant 200. Traiter le 200 comme un succès annoncerait une fusion qui
     * n'a pas eu lieu, et c'est le pire message possible sur ce bouton-là.
     */
    const ok = papier({ merged: true });
    assert.equal((await gh(ok.impl).fusionnerPullRequest('moi/demo', 7)).fusionne, true);
    assert.equal(ok.appels[0].methode, 'PUT');

    const non = papier({ merged: false });
    assert.equal((await gh(non.impl).fusionnerPullRequest('moi/demo', 7)).fusionne, false);

    const g = papier({ state: 'merged' });
    assert.equal((await gl(g.impl).fusionnerPullRequest('g/demo', 7)).fusionne, true);
    const gnon = papier({ state: 'opened' });
    assert.equal((await gl(gnon.impl).fusionnerPullRequest('g/demo', 7)).fusionne, false);
  });

  test('refuser, c\'est FERMER — aucune des deux forges n\'a d\'état « refusée »', async () => {
    const f = papier({ state: 'closed' });
    await gh(f.impl).fermerPullRequest('moi/demo', 7);
    assert.equal(f.appels[0].methode, 'PATCH');
    assert.equal(f.appels[0].corps.state, 'closed');

    const g = papier({ state: 'closed' });
    await gl(g.impl).fermerPullRequest('g/demo', 7);
    assert.equal(g.appels[0].methode, 'PUT');
    assert.equal(g.appels[0].corps.state_event, 'close');
  });

  test('les quatre existent des DEUX côtés', () => {
    // Un geste présent d'un seul côté ferait un bouton mort sur l'autre forge — et on l'a
    // déjà vécu avec `commitFiles`, qui lève un 501 sur GitHub.
    const rien = async () => ({ ok: true, status: 200, json: async () => ({}) });
    for (const forge of [gh(rien), gl(rien)]) {
      for (const op of ['commenterPullRequest', 'approuverPullRequest',
                        'fusionnerPullRequest', 'fermerPullRequest']) {
        assert.equal(typeof forge[op], 'function', `${forge.kind} : ${op} manque`);
      }
    }
  });
});
