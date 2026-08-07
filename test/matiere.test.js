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
  /** Un `fetch` de papier : il note ce qu'on lui demande et rend ce qu'on lui dit. */
  const papier = (routes) => {
    const vus = [];
    return { vus, impl: async (url) => {
      vus.push(url);
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
                                 cible: 'main', auteur: 'ivguenyp123', url: 'https://x' });

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
                                 cible: 'main', auteur: 'moi', url: 'https://y' });

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
});
