/*
 * Tests du signal `etat_branche`.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. La matière ne contient AUCUNE ligne de code, et elle le dit. C'est ce qui empêche
 *    l'agent d'écrire « prête à fusionner » — la phrase la plus dangereuse qu'il puisse
 *    produire ici, parce qu'elle porte sur un contenu qu'il n'a jamais vu.
 * 2. Un retard INCONNU ne vaut pas un retard NUL. La forge peut ne pas rendre la
 *    comparaison inverse ; le risque de conflit est alors indéterminé, pas absent.
 * 3. Aucun constat ne se lit « tout va bien ».
 * 4. Les seuils partagés avec le rapport de dépôt sont les MÊMES. Une branche « morte »
 *    ne doit pas vouloir dire deux choses selon l'écran qui la regarde.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { etatBranche, resumeBranche, SIGNAUX_BRANCHE, SEUILS,
         MAX_FICHIERS_LISTES } from '../lib/signaux-branche.js';
import { SEUILS as SEUILS_DEPOT, PREFIXES_ACCEPTES } from '../lib/signaux-depot.js';
import { sait, reglagesDe, reglagesComplets } from '../lib/signaux-matiere.js';

const M = '2026-08-18T12:00:00Z';
const DEPOT = 'lcl/paiement';
const ilYA = (j) => new Date(new Date(M).getTime() - j * 86400000).toISOString();

const sur = (comparaison = {}, extra = {}) => etatBranche({
  depot: DEPOT, branche: 'feat/x', brancheDefaut: 'main',
  comparaison: { enAvance: 1, enRetard: 0, commits: [], fichiers: [], ...comparaison },
  mrs: [], runs: [], maintenant: M, ...extra
});

const commit = (message, j = 1, author = 'a.b') =>
  ({ sha: 'x', message, author, date: ilYA(j) });
const fichier = (chemin, ajouts = 5, retraits = 1) =>
  ({ chemin, ajouts, retraits, statut: 'modifie' });

const quoi = (r) => r.constats.map((c) => c.quoi);

/* ── La divergence ────────────────────────────────────────────────────────── */

describe('la divergence, qui est le vrai sujet', () => {
  test('l\'avance et le retard sont rendus tels quels', () => {
    const r = sur({ enAvance: 14, enRetard: 31 });
    assert.equal(r.enAvance, 14);
    assert.equal(r.enRetard, 31);
    assert.match(r.texte, /En retard +31 commit\(s\)/);
  });

  test('UN RETARD INCONNU N\'EST PAS UN RETARD NUL', () => {
    /*
     * GitLab ne rend pas le retard d'un seul appel : notre couche en fait deux. Si l'un
     * échoue, le champ vaut `null`. Le rendre à zéro ferait conclure « aucun conflit à
     * craindre » sur une mesure qui n'a pas eu lieu — et c'est justement le chiffre qui
     * prédit le conflit.
     */
    const r = sur({ enRetard: null });
    assert.equal(r.enRetard, null);
    assert.match(r.texte, /En retard +INCONNU/);
    assert.ok(quoi(r).includes('Retard non mesuré'));
    assert.match(r.constats[0].detail, /INCONNU, pas nul/);
  });

  test('au-delà du seuil, le retard devient grave et le seuil est cité', () => {
    const r = sur({ enRetard: SEUILS.retard_gene });
    const c = r.constats.find((x) => /de retard/.test(x.quoi));
    assert.equal(c.niveau, 'grave');
    assert.match(c.detail, new RegExp(`Au-delà de ${SEUILS.retard_gene}`));
  });

  test('un petit retard ne dit rien', () => {
    assert.deepEqual(quoi(sur({ enRetard: 1 })), []);
  });
});

/* ── La dispersion et le temps ────────────────────────────────────────────── */

describe('ce qu\'elle touche, et depuis quand', () => {
  test('les zones sont les deux premiers segments, dédoublonnés', () => {
    const r = sur({ fichiers: [fichier('src/paiement/a.js'), fichier('src/paiement/b.js'),
                               fichier('docs/api/c.md')] });
    assert.deepEqual(r.zones, ['docs/api', 'src/paiement']);
  });

  test('trop de zones se remarque, et les nomme', () => {
    const r = sur({ fichiers: ['a/1', 'b/1', 'c/1', 'd/1'].map((c) => fichier(c)) });
    const c = r.constats.find((x) => /zones touchées/.test(x.quoi));
    assert.equal(c.niveau, 'attention');
    assert.match(c.detail, /a\/1, b\/1, c\/1, d\/1/);
  });

  test('les lignes sont additionnées, jamais estimées', () => {
    const r = sur({ fichiers: [fichier('a/x', 100, 5), fichier('b/y', 20, 30)] });
    assert.equal(r.ajouts, 120);
    assert.equal(r.retraits, 35);
  });

  test('au-delà du plafond, les fichiers sont COMPTÉS et la coupe est dite', () => {
    // Cent lignes de chemins ne se lisent pas — mais les taire ferait croire à une petite
    // branche.
    const r = sur({ fichiers: Array.from({ length: MAX_FICHIERS_LISTES + 7 },
      (_, i) => fichier(`src/z${i}/x.js`)) });
    assert.equal(r.fichiers.length, MAX_FICHIERS_LISTES);
    assert.equal(r.fichiersTotal, MAX_FICHIERS_LISTES + 7);
    assert.match(r.texte, /et 7 autre\(s\), non listés/);
  });

  test('l\'âge et le silence se comptent depuis les commits', () => {
    const r = sur({ commits: [commit('feat: a', 59), commit('feat: b', 35)] });
    assert.equal(r.ageJours, 59);
    assert.equal(r.silenceJours, 35);
  });

  test('une branche muette depuis longtemps reprend le seuil du RAPPORT DE DÉPÔT', () => {
    /*
     * Une branche « morte » ne doit pas vouloir dire deux choses selon l'écran qui la
     * regarde. Le seuil est celui de `signaux-depot.js`, pas un seuil de plus.
     */
    assert.equal(SEUILS.morte_j, SEUILS_DEPOT.branche_morte_j);
    assert.equal(SEUILS.dormante_j, SEUILS_DEPOT.branche_stale_j);
    const c = sur({ commits: [commit('feat: a', SEUILS.morte_j)] })
      .constats.find((x) => /Aucun commit depuis/.test(x.quoi));
    assert.equal(c.niveau, 'grave');
  });
});

/* ── Les conventions ──────────────────────────────────────────────────────── */

describe('les conventions, mesurées avec les règles du dépôt', () => {
  test('un préfixe connu ne dit rien, un préfixe inconnu se remarque', () => {
    assert.ok(!quoi(sur({}, { branche: 'feat/x' })).some((q) => /préfixe/.test(q)));
    const c = sur({}, { branche: 'mon-truc' }).constats.find((x) => /préfixe/.test(x.quoi));
    assert.match(c.detail, new RegExp(PREFIXES_ACCEPTES[0].replace('/', '\\/')));
  });

  test('les messages hors Conventional Commits sont comptés, pas jugés', () => {
    const r = sur({ commits: [commit('feat: bon'), commit('wip'), commit('encore un truc')] });
    const c = r.constats.find((x) => /hors Conventional/.test(x.quoi));
    assert.match(c.quoi, /^2 commit/);
    // La raison est CONCRÈTE — pas « c'est la convention ».
    assert.match(c.detail, /notes de version/);
  });
});

/* ── Ce que la matière refuse de laisser croire ───────────────────────────── */

describe('la matière ne laisse pas conclure sur ce qu\'elle ne contient pas', () => {
  test('AUCUN CONSTAT ne se lit « tout va bien »', () => {
    const r = sur({});
    assert.deepEqual(r.constats, []);
    assert.match(r.texte, /Aucun seuil franchi\. Ce qui veut dire/);
    assert.match(r.texte, /pas que cette branche est prête à fusionner/);
  });

  test('elle interdit nommément de conclure sur le code', () => {
    // La phrase la plus dangereuse que l'agent puisse produire ici. Elle est interdite
    // dans la matière ET dans le spec — deux ceintures, parce qu'une seule se détend.
    const r = sur({});
    assert.match(r.texte, /CE QUI N'A PAS ÉTÉ REGARDÉ/);
    assert.match(r.texte, /ne dis JAMAIS que cette branche est prête à fusionner/);
    assert.match(r.texte, /Aucune ligne de diff/);
  });

  test('elle ne contient AUCUNE ligne de code, même quand les fichiers sont listés', () => {
    const r = sur({ fichiers: [fichier('src/a.js', 120, 8)] });
    assert.match(r.texte, /src\/a\.js/);
    assert.ok(!/^[+-]/m.test(r.texte.replace(/^ *[+-]\d/gm, '')), 'aucun patch ne fuit ici');
  });

  test('aucun pipeline lu ne veut pas dire CI verte', () => {
    assert.match(sur({}).texte, /l'état de CI est INCONNU, pas vert/);
  });
});

/* ── L'état ───────────────────────────────────────────────────────────────── */

describe('l\'état de la branche dans la forge', () => {
  test('la merge request de CETTE branche, s\'il y en a une', () => {
    const r = sur({}, { branche: 'feat/x', mrs: [
      { numero: 7, titre: 'Un titre', branche: 'feat/x', cible: 'main' },
      { numero: 8, titre: 'Autre', branche: 'feat/y', cible: 'main' }] });
    assert.equal(r.mr.numero, 7);
    assert.match(r.texte, /#7 « Un titre » → main/);
  });

  test('un pipeline en échec sur la branche est GRAVE', () => {
    const r = sur({}, { runs: [{ branche: 'feat/x', statut: 'echec', debut: M }] });
    assert.equal(r.constats.find((c) => /pipeline/.test(c.quoi)).niveau, 'grave');
  });

  test('les pipelines des AUTRES branches ne comptent pas', () => {
    const r = sur({}, { runs: [{ branche: 'main', statut: 'echec', debut: M }] });
    assert.equal(r.runsBranche, 0);
    assert.equal(r.dernierRun, null);
  });
});

/* ── Le contrat du signal ─────────────────────────────────────────────────── */

describe('le signal se déclare', () => {
  test('la plateforme sait le calculer', () => assert.ok(sait('etat_branche')));

  test('il demande UN réglage : laquelle des branches', () => {
    assert.deepEqual(reglagesDe('etat_branche').map((r) => [r.nom, r.genre, r.requis]),
      [['branche', 'branche', true]]);
    assert.equal(reglagesComplets('etat_branche', {}), false);
    assert.equal(reglagesComplets('etat_branche', { branche: 'feat/x' }), true);
  });

  test('il déclare d\'où il est extrait', () => {
    assert.match(SIGNAUX_BRANCHE.etat_branche.source, /branch-cleaner/);
  });
});

describe('le résumé tient sur une ligne', () => {
  test('il annonce la divergence, pas un verdict', () => {
    assert.match(resumeBranche(sur({ enAvance: 14, enRetard: 31 })),
      /^feat\/x — 14 d'avance, 31 de retard · 0 fichier\(s\) · 1 point\(s\) grave\(s\)$/);
  });

  test('un retard inconnu se dit dans le résumé aussi', () => {
    assert.match(resumeBranche(sur({ enRetard: null })), /retard inconnu/);
  });
});
