/*
 * Le parc, et les correctifs qu'on propose aux équipes.
 *
 * ── POURQUOI CES TESTS SONT PLUS SÉRIEUX QUE LES AUTRES ──────────────────────
 *
 * Tout le reste du produit LIT. Ces deux modules-là servent à ÉCRIRE chez quelqu'un
 * d'autre — une branche, deux fichiers, une merge request dans le dépôt d'une équipe qui
 * n'a rien demandé. Trois choses doivent tenir, et elles tiennent ici :
 *
 *   ON NE PROPOSE QUE CE QU'UN COMMIT PEUT RÉPARER. Une MR qui prétendrait protéger une
 *   branche mentirait à l'équipe qui la relit, et elle fusionnerait en se croyant conforme.
 *
 *   CE QUI N'EST PAS CORRIGÉ EST ÉCRIT. C'est la moitié utile de la description.
 *
 *   RIEN N'EST TENU POUR CONFORME FAUTE D'AVOIR ÉTÉ REGARDÉ. Ni un dépôt non coché, ni un
 *   dépôt illisible, ni un contrôle qui demande des droits qu'on n'a pas.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parcSecurite, resumeParc, groupeDe, MAX_DEPOTS } from '../lib/signaux-parc.js';
import { rapportConformite } from '../lib/signaux-securite.js';
import { BRANCHE, CORRIGEABLES, OU_REGLER, securiteMd, codeowners, fichiersAProposer,
         aProposer, descriptionMr, titreMr, messageCommit } from '../lib/correctifs.js';
import { sait, SIGNAUX, surPlusieursDepots } from '../lib/signaux-matiere.js';

const MAINTENANT = '2026-08-17T12:00:00Z';

/** Un audit réel, produit par le même calcul que l'écran — jamais un objet inventé. */
const audit = (depot, { chemins = [], protegee = true } = {}) => rapportConformite({
  depot, defaut: 'main', visibilite: 'private',
  branches: [{ name: 'main', protectee: protegee, default: true }],
  chemins, derniereActivite: '2026-08-14T00:00:00Z', maintenant: MAINTENANT
});

const NU = ['README.md'];                                   // ni CODEOWNERS ni SECURITY.md
const COMPLET = ['CODEOWNERS', 'SECURITY.md', 'README.md']; // les deux fichiers présents

describe('le signal du parc', () => {
  test('la plateforme sait le calculer, et il porte sur PLUSIEURS dépôts', () => {
    assert.equal(sait('parc_securite'), true);
    assert.equal(surPlusieursDepots('parc_securite'), true);
    // Les autres n'en portent qu'un : offrir des cases à cocher à un agent qui n'en lira
    // qu'un ferait croire qu'il compare.
    assert.equal(surPlusieursDepots('rapport_conformite'), false);
    assert.ok(SIGNAUX.parc_securite.libelle);
  });

  test('le groupe d\'un dépôt est son préfixe de chemin', () => {
    assert.equal(groupeDe('lcl/paiement'), 'lcl');
    assert.equal(groupeDe('lcl/back/api'), 'lcl');
    assert.equal(groupeDe('solo'), '—');
  });
});

describe('ce que le parc rend', () => {
  const parc = () => parcSecurite({
    depots: [
      { depot: 'lcl/a', conformite: audit('lcl/a', { chemins: NU }) },
      { depot: 'lcl/b', conformite: audit('lcl/b', { chemins: COMPLET }) },
      { depot: 'bnp/c', conformite: audit('bnp/c', { chemins: NU, protegee: false }) }
    ],
    ignores: 12,
    echoues: [{ depot: 'lcl/archive', pourquoi: 'La forge a répondu 404.' }]
  });

  test('les dépôts les plus en écart passent en tête', () => {
    const r = parc();
    assert.equal(r.lignes[0].depot, 'bnp/c', 'celui qui a aussi sa branche ouverte');
    assert.equal(r.lignes.at(-1).depot, 'lcl/b');
  });

  /*
   * Le chiffre qui change ce qu'on décide. Un écart présent partout n'est pas l'oubli
   * d'une équipe : c'est un défaut de la plateforme, et le corriger dépôt par dépôt coûte
   * N fois plus cher en se redégradant au dépôt suivant.
   */
  test('l\'écart partagé remonte, avec le nombre de dépôts touchés', () => {
    const r = parc();
    const commun = r.ecartsCommuns.find((e) => e.id === 'codeowners');
    assert.equal(commun.depots.length, 2);
    assert.match(r.texte, /LES ÉCARTS PARTAGÉS/);
    assert.match(r.texte, /défaut de la plateforme/);
  });

  test('un groupe se note à la MÉDIANE, jamais à la moyenne', () => {
    // Sinon un dépôt exemplaire rachète cinq dépôts nus, et le groupe paraît sain.
    const r = parcSecurite({ depots: [
      { depot: 'g/parfait', conformite: audit('g/parfait', { chemins: COMPLET }) },
      { depot: 'g/nu1', conformite: audit('g/nu1', { chemins: NU }) },
      { depot: 'g/nu2', conformite: audit('g/nu2', { chemins: NU }) }
    ] });
    const g = r.groupes.find((x) => x.groupe === 'g');
    assert.equal(g.total, 3);
    assert.equal(g.nonConformes, 2);
    const notes = r.lignes.map((l) => l.note).sort((a, b) => a - b);
    assert.equal(g.note, notes[1], 'la médiane, donc la note du milieu');
  });

  test('ce qui n\'a pas été coché et ce qu\'on n\'a pas lu sont DITS', () => {
    const r = parc();
    assert.equal(r.comptes.ignores, 12);
    assert.equal(r.comptes.echoues, 1);
    assert.match(r.texte, /12 dépôt\(s\) visibles n'ont PAS été choisis/);
    assert.match(r.texte, /jamais comptés comme conformes/);
    assert.match(r.texte, /lcl\/archive/);
  });

  test('aucun dépôt audité n\'est pas un parc conforme', () => {
    const r = parcSecurite({ depots: [] });
    assert.match(r.texte, /absence de mesure/);
    assert.equal(r.presentation.entete.ton, 'na');
    assert.match(resumeParc(r), /aucun dépôt/);
  });

  test('le plafond existe, et il est franc', () => {
    // Quatre appels par dépôt : au-delà l'écran se fige plusieurs minutes sans rien dire.
    assert.equal(typeof MAX_DEPOTS, 'number');
    assert.ok(MAX_DEPOTS > 0 && MAX_DEPOTS <= 50);
  });
});

describe('ce qu\'un commit a le droit de réparer', () => {
  test('deux fichiers, et deux seulement', () => {
    assert.deepEqual([...CORRIGEABLES].sort(), ['codeowners', 'securitymd']);
  });

  test('seulement ceux qui manquent VRAIMENT', () => {
    const nu = fichiersAProposer(audit('x/y', { chemins: NU }), 'x/y');
    assert.deepEqual(nu.map((f) => f.chemin).sort(), ['CODEOWNERS', 'SECURITY.md']);

    // Un dépôt qui range son CODEOWNERS dans `.github/` ne doit pas s'en voir proposer un
    // second à la racine : c'est l'audit qui décide, pas une devinette sur le chemin.
    const github = fichiersAProposer(audit('x/y', { chemins: ['.github/CODEOWNERS'] }), 'x/y');
    assert.deepEqual(github.map((f) => f.chemin), ['SECURITY.md']);

    assert.deepEqual(fichiersAProposer(audit('x/y', { chemins: COMPLET }), 'x/y'), []);
  });

  test('un dépôt sans aucun écart n\'a rien à recevoir', () => {
    assert.equal(aProposer(audit('x/y', { chemins: NU })), true);
    // Tout présent ET branche protégée : il reste des `unverif`, jamais des `ko`.
    assert.equal(aProposer(audit('x/y', { chemins: COMPLET })), false);
  });

  test('les fichiers posés se disent squelettes, et le disent DANS le fichier', () => {
    // Un SECURITY.md sans contact ne protège personne : il coche une case. Le fichier
    // doit le dire, sinon il sert d'alibi à l'équipe qui le fusionne.
    assert.match(securiteMd('lcl/paiement'), /à compléter/i);
    assert.match(securiteMd('lcl/paiement'), /lcl\/paiement/);
    assert.match(codeowners('lcl/paiement'), /POINT DE DÉPART/);
    assert.match(codeowners('lcl/paiement'), /\* @lcl/, 'le groupe vient du chemin');
  });
});

describe('la description de la merge request', () => {
  const conformite = audit('lcl/paiement', { chemins: NU, protegee: false });
  const fichiers = fichiersAProposer(conformite, 'lcl/paiement');
  const d = descriptionMr({ depot: 'lcl/paiement', conformite, fichiers });

  test('elle annonce une PROPOSITION, pas une décision', () => {
    assert.match(d, /PROPOSITION/);
    assert.match(d, /fermez/);
  });

  test('elle liste ce que la MR ajoute', () => {
    assert.match(d, /SECURITY\.md/);
    assert.match(d, /CODEOWNERS/);
    assert.match(d, /CIS 1\.2\.1/);
  });

  /*
   * La moitié qui compte. Une équipe qui fusionne en croyant être conforme est plus mal
   * lotie qu'avant : elle a maintenant une preuve écrite qu'on s'en est occupé.
   */
  test('elle dit ce qu\'elle NE corrige PAS, et où le régler à la main', () => {
    assert.match(d, /NE corrige PAS/);
    assert.match(d, /Branche par défaut protégée/);
    assert.match(d, new RegExp(OU_REGLER.branch.replace(/[→]/g, '.')));
  });

  test('elle distingue le non vérifiable du non conforme', () => {
    assert.match(d, /Non vérifiable/);
    assert.match(d, /n'est pas un constat de non-conformité/);
  });

  test('aucun modèle n\'a écrit cette description, et elle le dit', () => {
    assert.match(d, /aucun modèle n'a écrit cette description/);
  });

  test('le titre porte le chiffre, le commit dit que c\'est une proposition', () => {
    assert.match(titreMr(conformite), /écart\(s\)/);
    assert.match(messageCommit(conformite), /proposee/);
    assert.match(messageCommit(conformite), /AUCUN reglage/);
  });

  test('la branche a un nom STABLE — c\'est ce qui rend l\'opération rejouable', () => {
    // Sans nom stable, relancer l'audit trois fois poserait trois MR identiques sur le
    // dos d'équipes qui n'ont rien demandé.
    assert.equal(typeof BRANCHE, 'string');
    assert.ok(BRANCHE.length > 0);
  });

  test('un dépôt sans fichier à poser reçoit quand même le constat', () => {
    // La MR ne porte alors que les réglages à faire à la main — et c'est le contenu utile.
    const c = audit('x/y', { chemins: COMPLET, protegee: false });
    const nu = descriptionMr({ depot: 'x/y', conformite: c, fichiers: [] });
    assert.ok(!/Ce que cette MR ajoute/.test(nu));
    assert.match(nu, /NE corrige PAS/);
  });
});
