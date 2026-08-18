/*
 * Les vingt-cinq contrôles d'un dépôt.
 *
 * ── CE QUE CES TESTS DÉFENDENT ───────────────────────────────────────────────
 *
 * Un constat qui apparaît à tort coûte plus cher qu'un constat manquant : il envoie
 * quelqu'un corriger quelque chose qui va bien, et au deuxième faux positif l'équipe cesse
 * de lire la liste entière. La plupart des tests ci-dessous vérifient donc des ABSENCES —
 * qu'un dépôt sain ne déclenche rien — autant que des présences.
 *
 * Et les seuils sont testés À LA BORNE. « Plus de 90 jours » n'est pas « 90 jours ou
 * plus » : un écart d'un jour avec l'écran de la plateforme est la divergence la plus
 * longue à croire, parce qu'elle a l'air d'un détail.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rapportDepot, resumeDepot, busFactor, flowDetecte,
         NIVEAUX, SEUILS, CONVENTIONNEL } from '../lib/signaux-depot.js';

const M = '2026-08-17T18:00:00Z';
const ilYA = (j) => new Date(new Date(M).getTime() - j * 86400000).toISOString();

/** Un dépôt SAIN : aucun des vingt-cinq contrôles ne doit se déclencher. */
const sain = (sur = {}) => rapportDepot({
  depot: 'lcl/paiement',
  info: { defaut: 'main', visibilite: 'private' },
  branches: [{ name: 'main', default: true, protectee: true, quand: ilYA(1) },
             { name: 'feat/x', quand: ilYA(3) }],
  chemins: ['README.md', '.gitignore', 'CONTRIBUTING.md', 'CODEOWNERS',
            '.gitlab-ci.yml', '.gitlab/merge_request_templates/defaut.md', 'src/a.js'],
  commits: Array.from({ length: 20 }, (_, i) => ({
    message: 'feat: quelque chose', author: i % 2 ? 'a.martin' : 'b.durand',
    // Un mardi à 10 h UTC : ni le soir, ni le week-end.
    date: '2026-08-11T10:00:00Z' })),
  mrsOuvertes: [{ numero: 1, titre: 'Un correctif', auteur: 'a.martin', ouvert: ilYA(1),
                  description: 'Corrige un arrondi au centime près.',
                  relecteurs: ['b.durand'], etiquettes: ['fix'], conflits: false }],
  // Un dépôt sain FUSIONNE des merge requests : sans elles, « du travail arrive sur le
  // tronc sans aucune revue » est un constat juste, et le jeu d'essai décrirait un dépôt
  // qui n'a rien de sain.
  mrsFusionnees: [{ numero: 2, titre: 'Précédent', cible: 'main',
                    ouvert: ilYA(4), fusionne: ilYA(2) }],
  pipelines: Array.from({ length: 10 }, () => ({ statut: 'succes' })),
  maintenant: M, ...sur
});

const cles = (r) => r.constats.map((c) => c.cle);

/* ── Le dépôt sain ────────────────────────────────────────────────────────── */

describe('un dépôt sain ne déclenche rien', () => {
  test('aucun constat', () => {
    /*
     * LE test du fichier. Un contrôle qui se déclenche à tort coûte plus cher qu'un
     * contrôle manquant : au deuxième faux positif, l'équipe cesse de lire la liste
     * entière — y compris les constats justes.
     */
    const r = sain();
    assert.deepEqual(cles(r), [], `constats à tort : ${cles(r).join(', ')}`);
    assert.equal(r.compte.total, 0);
    assert.match(resumeDepot(r), /aucun constat/);
  });

  test('et le texte le dit sans se féliciter', () => {
    // « Aucun constat » ne veut pas dire « dépôt parfait ». Le laisser croire ferait
    // prendre vingt-cinq contrôles pour un audit complet.
    assert.match(sain().texte, /ces vingt-cinq\s+contrôles-là ne trouvent rien/);
  });
});

/* ── Les seuils, à la borne ───────────────────────────────────────────────── */

describe('les seuils sont ceux du module, à la borne près', () => {
  const avecBranche = (jours) => sain({ branches: [
    { name: 'main', default: true, protectee: true, quand: ilYA(1) },
    { name: 'feat/vieille', quand: ilYA(jours) }] });

  test('une branche à 90 jours n\'est pas morte, à 91 elle l\'est', () => {
    assert.ok(!cles(avecBranche(90)).includes('branches_mortes'));
    assert.ok(cles(avecBranche(91)).includes('branches_mortes'));
  });

  test('une branche à 30 jours ne dort pas encore, à 31 si', () => {
    assert.ok(!cles(avecBranche(30)).includes('branches_stale'));
    assert.ok(cles(avecBranche(31)).includes('branches_stale'));
  });

  test('une branche est morte OU stale, jamais les deux', () => {
    // Les deux constats proposent des gestes différents — supprimer, ou reprendre. Les
    // faire tomber ensemble sur la même branche rendrait la liste incohérente.
    const c = cles(avecBranche(120));
    assert.ok(c.includes('branches_mortes'));
    assert.ok(!c.includes('branches_stale'));
  });

  const avecMr = (jours) => sain({ mrsOuvertes: [{ numero: 9, titre: 'X', auteur: 'a',
    ouvert: ilYA(jours), description: 'Une description assez longue.',
    relecteurs: ['b'], etiquettes: ['fix'], conflits: false }] });

  test('une MR à 7 jours n\'est pas en attente, à 8 si', () => {
    assert.ok(!cles(avecMr(7)).includes('mr_en_attente'));
    assert.ok(cles(avecMr(8)).includes('mr_en_attente'));
  });

  test('à 31 jours elle devient abandonnée, et cesse d\'être « en attente »', () => {
    const c = cles(avecMr(31));
    assert.ok(c.includes('mr_abandonnees'));
    assert.ok(!c.includes('mr_en_attente'), 'une MR ne peut pas être dans les deux files');
  });

  test('le bus factor bascule à 90, pas avant', () => {
    const avecPart = (n, total) => sain({ commits: [
      ...Array.from({ length: n }, () => ({ message: 'feat: x', author: 'seul', date: '2026-08-11T10:00:00Z' })),
      ...Array.from({ length: total - n }, () => ({ message: 'feat: x', author: 'autre', date: '2026-08-11T10:00:00Z' }))] });
    assert.ok(cles(avecPart(89, 100)).includes('bus_factor_eleve'));
    assert.ok(!cles(avecPart(89, 100)).includes('bus_factor_critique'));
    assert.ok(cles(avecPart(90, 100)).includes('bus_factor_critique'));
    assert.ok(!cles(avecPart(90, 100)).includes('bus_factor_eleve'), 'jamais les deux');
  });

  test('la CI n\'est signalée qu\'à partir de 30 % d\'échecs', () => {
    const avecEchecs = (n) => sain({ pipelines: [
      ...Array.from({ length: n }, () => ({ statut: 'echec' })),
      ...Array.from({ length: 10 - n }, () => ({ statut: 'succes' }))] });
    assert.ok(!cles(avecEchecs(2)).includes('pipelines_en_echec'));
    assert.ok(cles(avecEchecs(3)).includes('pipelines_en_echec'));
  });
});

/* ── Ce qui n'est jamais jugé ─────────────────────────────────────────────── */

describe('ce que le module ne juge jamais', () => {
  test('les branches de tronc échappent au nommage ET à l\'âge', () => {
    // `develop` sans commit depuis un an n'est pas une branche morte : c'est une branche
    // de tronc. La supprimer serait un très mauvais conseil.
    const r = sain({ branches: [
      { name: 'main', default: true, protectee: true, quand: ilYA(1) },
      { name: 'develop', quand: ilYA(400) }, { name: 'master', quand: ilYA(400) }] });
    /*
     * L'assertion porte sur les CONTRÔLES DE BRANCHE, pas sur l'absence totale de constat.
     *
     * Elle était `deepEqual(cles(r), [])`, et l'ajout du flow observé l'a fait rougir — à
     * raison : cette fixture crée un `develop` vieux d'un an que personne ne cible, ce qui
     * est exactement la situation que le nouveau constat existe pour signaler. Un test
     * trop large finit par interdire d'ajouter ce qu'il n'avait pas prévu.
     */
    for (const interdit of ['branches_mortes', 'branches_stale', 'nommage_branches']) {
      assert.ok(!cles(r).includes(interdit), `\`${interdit}\` ne doit pas juger un tronc`);
    }
  });

  test('les branches de robots échappent au nommage', () => {
    // Renovate et Dependabot nomment leurs branches comme ils veulent. Demander à une
    // équipe de renommer des branches qu'elle ne crée pas est un conseil inapplicable.
    const r = sain({ branches: [
      { name: 'main', default: true, protectee: true, quand: ilYA(1) },
      { name: 'renovate/lodash-4.x', quand: ilYA(2) },
      { name: 'dependabot/npm_and_yarn/axios', quand: ilYA(2) }] });
    assert.ok(!cles(r).includes('nommage_branches'));
  });

  test('la branche par DÉFAUT est contrôlée, même si elle ne s\'appelle pas main', () => {
    /*
     * Le module d'origine cherche `main` ou `master` dans une liste écrite en dur : un
     * dépôt dont le tronc s'appelle `production` passait au travers du contrôle le plus
     * important de tous. On regarde ce que la forge DÉCLARE comme branche par défaut.
     */
    const r = sain({ branches: [{ name: 'production', default: true, protectee: false,
                                  quand: ilYA(1) }] });
    assert.ok(cles(r).includes('main_non_protegee'));
    assert.match(r.constats[0].titre, /production/);
  });
});

/* ── Les constats nommés ──────────────────────────────────────────────────── */

describe('un constat porte de quoi agir', () => {
  test('les merge requests sont citées par numéro, âge et auteur', () => {
    // « Trancher 3 MR abandonnées » n'est pas actionnable ; « fermer les #12, #18 et #24 »
    // l'est. Sans les éléments, l'agent produit une consigne qu'il faut aller instruire.
    const r = sain({ mrsOuvertes: [
      { numero: 12, titre: 'Refonte', auteur: 'm.dupont', ouvert: ilYA(45),
        description: 'assez longue pour passer', relecteurs: ['x'], etiquettes: ['a'], conflits: false }] });
    const c = r.constats.find((x) => x.cle === 'mr_abandonnees');
    assert.equal(c.elements[0].numero, 12);
    assert.equal(c.elements[0].auteur, 'm.dupont');
    assert.equal(c.elements[0].jours, 45);
  });

  test('chaque constat porte un GESTE, pas seulement un reproche', () => {
    const r = sain({ branches: [{ name: 'main', default: true, protectee: false, quand: ilYA(1) }] });
    for (const c of r.constats) {
      assert.ok(c.geste && c.geste.length > 15, `\`${c.cle}\` n'a pas de geste utilisable`);
    }
  });

  test('les constats sortent triés par gravité', () => {
    const r = sain({ branches: [{ name: 'main', default: true, protectee: false, quand: ilYA(1) },
                                { name: 'sans-prefixe', quand: ilYA(2) }],
                     chemins: ['src/a.js'] });
    const rangs = r.constats.map((c) => NIVEAUX[c.niveau].rang);
    assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b));
    assert.equal(r.constats[0].niveau, 'critique');
  });
});

/* ── Le bus factor et le flow ─────────────────────────────────────────────── */

describe('le bus factor, tel qu\'on peut le calculer', () => {
  test('c\'est la part du plus gros contributeur', () => {
    const b = busFactor([...Array.from({ length: 8 }, () => ({ author: 'a' })),
                         ...Array.from({ length: 2 }, () => ({ author: 'b' }))]);
    assert.equal(b.nom, 'a');
    assert.equal(b.part, 80);
    assert.equal(b.auteurs, 2);
  });

  test('sans commit, il vaut 0 et ne nomme personne', () => {
    // Et surtout il ne déclenche pas « bus factor critique » : personne à 0 % n'est pas
    // une concentration de connaissance, c'est une absence de mesure.
    assert.deepEqual(busFactor([]), { nom: '', part: 0, auteurs: 0, commits: 0 });
    assert.ok(!cles(sain({ commits: [] })).includes('bus_factor_critique'));
  });

  test('l\'assise est ANNONCÉE — les commits lus, pas tout l\'historique', () => {
    /*
     * Divergence assumée avec le module, qui lit `/repository/contributors` et couvre tout
     * l'historique. Notre fenêtre est récente. Ce n'est pas moins vrai — c'est souvent plus
     * utile — mais deux écrans donneraient deux pourcentages sans explication.
     */
    assert.match(sain().texte, /commits lus, pas tout l'historique/);
  });

  test('le flow se détecte sur la présence de `develop`, comme le module', () => {
    assert.equal(flowDetecte([{ name: 'main' }, { name: 'develop' }]), 'gitflow');
    assert.equal(flowDetecte([{ name: 'main' }, { name: 'feat/x' }]), 'feature-branching');
  });
});

/* ── Les deux Health Score ────────────────────────────────────────────────── */

describe('le score de ce module n\'est pas celui du daily', () => {
  test('il est nommé, et sa différence est écrite', () => {
    /*
     * Le même dépôt peut afficher 65 sur un écran et 100 sur l'autre. Les publier tous
     * deux sous le mot « Health Score » sans les distinguer est la meilleure façon de
     * faire perdre confiance aux deux.
     */
    const r = sain();
    assert.match(r.sante.nom, /Repo Analyzer/);
    assert.match(r.sante.attention, /PAS celui du Daily Report/);
    assert.match(r.texte, /Repo Analyzer/);
  });

  test('ses trois pénalités sont celles du module', () => {
    assert.equal(sain({ commits: [] }).sante.score, 60, '−40 sans commit');
    assert.equal(sain({ mrsOuvertes: Array.from({ length: 10 }, (_, i) => ({
      numero: i, titre: 'x', ouvert: ilYA(1), description: 'assez longue pour passer',
      relecteurs: ['b'], etiquettes: ['fix'], conflits: false })) }).sante.score, 90,
      '−10 à partir de 10 MR ouvertes');
  });
});

/* ── Ce qu'on ne mesure pas ───────────────────────────────────────────────── */

describe('ce qui n\'est pas mesuré est déclaré', () => {
  test('les approbations sont ABSENTES, et jamais présumées satisfaites', () => {
    // Une revue qu'on n'a pas vue n'est pas une revue qui a eu lieu. Le silence sur ce
    // contrôle se lirait comme « tout va bien ».
    assert.match(sain().angles_morts.join(' '), /ne pas conclure qu'il est satisfait/);
  });

  test('les branches sans date sont comptées à part', () => {
    const r = sain({ branches: [{ name: 'main', default: true, protectee: true, quand: ilYA(1) },
                                { name: 'sans-date', quand: '' }] });
    assert.match(r.angles_morts.join(' '), /sans date de dernier commit/);
    assert.ok(!cles(r).includes('branches_mortes'), 'une branche sans date n\'est pas morte');
  });

  test('une troncature rend les comptes minorants, et le dit', () => {
    assert.match(sain({ tronque: { commits: true } }).angles_morts.join(' '), /minimums/);
  });
});

/* ── Le motif des commits ─────────────────────────────────────────────────── */

describe('les messages de commit', () => {
  test('le motif conventionnel est celui du module', () => {
    assert.ok(CONVENTIONNEL.test('feat: ajoute le virement'));
    assert.ok(CONVENTIONNEL.test('fix(paiement): arrondi'));
    assert.ok(!CONVENTIONNEL.test('wip'));
    assert.ok(!CONVENTIONNEL.test('Correction du bug'));
  });

  test('en dessous de 10 commits, on ne conclut rien', () => {
    // Trois commits « wip » ne disent rien d'une pratique d'équipe. Le seuil évite de
    // faire un constat sur un échantillon qui n'en est pas un.
    const r = sain({ commits: Array.from({ length: 9 }, () => ({
      message: 'wip', author: 'a', date: '2026-08-11T10:00:00Z' })) });
    assert.ok(!cles(r).includes('commits_non_standards'));
    assert.equal(SEUILS.commits_min, 10);
  });
});

/* ── Le flow observé ──────────────────────────────────────────────────────── */

describe('le flow déclaré et le flow pratiqué', () => {
  test('une `develop` que personne ne cible est signalée', () => {
    /*
     * LE constat que la plateforme ne peut pas faire. `detectFlow()` regarde une seule
     * chose — l'existence de la branche — et affiche « GitFlow bien appliqué ». Une équipe
     * qui a cessé de la cibler depuis six mois voit donc un garde-fou qu'elle n'a plus.
     */
    const r = sain({
      branches: [{ name: 'main', default: true, protectee: true, quand: ilYA(1) },
                 { name: 'develop', quand: ilYA(200) }],
      mrsFusionnees: Array.from({ length: 8 }, (_, i) => ({
        numero: i, titre: 'x', cible: 'main', ouvert: ilYA(4), fusionne: ilYA(3) })) });
    assert.ok(cles(r).includes('flow_declare_non_pratique'));
    assert.equal(r.flow_observe.declare, 'gitflow');
    assert.equal(r.flow_observe.pratique, 'feature-branching');
    assert.equal(r.flow_observe.accord, false);
  });

  test('une `develop` réellement ciblée ne déclenche rien', () => {
    const r = sain({
      branches: [{ name: 'main', default: true, protectee: true, quand: ilYA(1) },
                 { name: 'develop', quand: ilYA(2) }],
      mrsFusionnees: Array.from({ length: 8 }, (_, i) => ({
        numero: i, titre: 'x', cible: 'develop', ouvert: ilYA(4), fusionne: ilYA(3) })) });
    assert.ok(!cles(r).includes('flow_declare_non_pratique'));
    assert.equal(r.flow_observe.accord, true);
  });

  test('sans merge request du tout, on ne conclut RIEN sur le flow', () => {
    // Un dépôt neuf n'a pas un mauvais flow : il n'a pas encore de flow. `null` plutôt
    // qu'un verdict évite de conseiller sur une observation qui n'a pas eu lieu.
    const r = sain({ mrsFusionnees: [], mrsOuvertes: [], commits: [] });
    assert.equal(r.flow_observe.pratique, null);
    assert.equal(r.flow_observe.accord, null);
    assert.ok(!cles(r).includes('flow_declare_non_pratique'));
  });

  test('du travail sur le tronc SANS aucune fusion est un constat, le reste non', () => {
    /*
     * Ce constat a remplacé un premier, trop bruyant : « plus de la moitié des commits du
     * tronc sans trace de fusion ». Il se déclenchait sur la configuration par défaut de
     * GitLab, qui écrase les commits à la fusion sans référencer la merge request — donc
     * sur des dépôts parfaitement sains.
     *
     * Celui-ci n'a pas d'ambiguïté : aucune merge request fusionnée du tout.
     */
    const sansRevue = sain({ mrsFusionnees: [] });
    assert.ok(cles(sansRevue).includes('travail_sans_revue'));

    // Avec des fusions, le mode de fusion peut tout expliquer : on se tait.
    assert.ok(!cles(sain()).includes('travail_sans_revue'));
  });

  test('le pourcentage de traces reste une INFORMATION, avec son avertissement', () => {
    const r = sain();
    assert.equal(typeof r.flow_observe.tronc.part, 'number');
    assert.match(r.texte, /MAJORANT/);
    assert.match(r.texte, /mode de fusion/);
  });

  test('les constats ajoutés sont MARQUÉS, pas mêlés aux vingt-cinq', () => {
    /*
     * Sans la marque, un rapport mélangerait ce que la plateforme constate et ce que le
     * registre observe en plus, sous la même autorité. Quelqu'un qui irait vérifier sur
     * l'écran du Repo Analyzer ne retrouverait pas la moitié des constats et conclurait
     * que le registre invente.
     */
    const r = sain({ mrsFusionnees: [] });
    const ajoute = r.constats.find((c) => c.cle === 'travail_sans_revue');
    assert.equal(ajoute.origine, 'observation');
    assert.match(r.texte, /\[observé en plus\]/);

    const extrait = sain({ branches: [{ name: 'main', default: true, protectee: false,
                                        quand: ilYA(1) }] })
      .constats.find((c) => c.cle === 'main_non_protegee');
    assert.equal(extrait.origine, 'repo-analyzer');
  });

  test('la durée de vie d\'une branche est une MÉDIANE, sur au moins cinq fusions', () => {
    // Une moyenne sur trois merge requests dont une de quarante jours décrirait une
    // pratique qui n'existe pas.
    const court = sain({ mrsFusionnees: Array.from({ length: 3 }, (_, i) => ({
      numero: i, titre: 'x', cible: 'main', ouvert: ilYA(40), fusionne: ilYA(1) })) });
    assert.ok(!cles(court).includes('branches_qui_vivent_trop'), 'trois fusions ne suffisent pas');

    const long = sain({ mrsFusionnees: Array.from({ length: 6 }, (_, i) => ({
      numero: i, titre: 'x', cible: 'main', ouvert: ilYA(40), fusionne: ilYA(1) })) });
    assert.ok(cles(long).includes('branches_qui_vivent_trop'));
    assert.equal(long.flow_observe.duree_vie_mediane_j, 39);
  });
});
