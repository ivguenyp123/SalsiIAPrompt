/*
 * Le banc d'essai — testé sans dépenser un jeton.
 *
 * `jouer()` est injecté : on lui fait rendre des sorties écrites à la main, et tout le
 * reste — le jugement, le k/n, la dérivation du niveau, la certification — se vérifie
 * pour de bon. C'est la propriété qui compte : un banc qu'on ne peut essayer qu'en
 * appelant un modèle payant ne serait jamais essayé.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../lib/yaml.js';

import { attente, jugerRun, agregerCas, deriverNiveau, certifier, passer, plan,
         depense, runsDe, JOURS_DE_VALIDITE } from '../runtime/banc.js';
import { carte, entree, fusionner, oublier, VIDE } from '../runtime/etat-derive.js';
import { niveau } from '../lib/niveau.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = yaml.load(readFileSync(join(ROOT, 'registries/targets.yaml'), 'utf8')).targets;

/* ── L'opérateur implicite ────────────────────────────────────────────────── */

describe('l\'attente d\'un cas d\'or', () => {
  test('l\'opérateur implicite est le PREMIER déclaré au registre', () => {
    // Ce n'est pas une convention du banc : c'est une lecture du référentiel. Le registre
    // en garde donc la main, en ordonnant sa liste `ops`.
    assert.equal(attente('output.length', 900, TARGETS).op, 'lte');
    assert.equal(attente('output.contains_secret', false, TARGETS).op, 'eq');
    assert.equal(attente('output.sections', 'Risques', TARGETS).op, 'contains');
  });

  test('UN BOOLÉEN veut dire `exists`, parce qu\'on ne « contient » pas `true`', () => {
    /*
     * Le défaut le plus coûteux trouvé au premier passage du banc, et il était
     * IRRATTRAPABLE : `expect: { output.sections: true }` se lisait « la liste des
     * sections contient `true` ». Aucune sortie ne peut satisfaire ça, jamais. Deux cas
     * d'or de `expliquer-un-code` étaient rouges par construction, cinq fois sur cinq —
     * l'agent ne pouvait donc jamais atteindre le niveau qu'il visait.
     *
     * Le lint ne pouvait pas le voir : il contrôle qu'une cible existe et qu'un opérateur
     * est autorisé, jamais qu'une attente est ATTEIGNABLE. Il fallait jouer.
     */
    assert.equal(attente('output.sections', true, TARGETS).op, 'exists');
    assert.equal(attente('output.sections', 'Risques', TARGETS).op, 'contains');

    const cas = { id: 'gc', expect: { 'output.sections': true } };
    assert.equal(jugerRun(cas, '## Résumé\ndu texte', { targets: TARGETS }).reussi, true);
    assert.equal(jugerRun(cas, 'du texte sans aucun titre', { targets: TARGETS }).reussi, false);
  });

  test('un booléen sur une cible qui ne sait PAS `exists` garde son opérateur', () => {
    // `output.contains_secret` déclare `ops: [eq]`. Le rattrapage ne doit pas déborder
    // sur elle : `eq false` est exactement ce que `false` veut dire là-bas.
    assert.equal(attente('output.contains_secret', false, TARGETS).op, 'eq');
  });

  test('« 900 » sur output.length veut dire « tient en 900 caractères »', () => {
    const cas = { id: 'gc', expect: { 'output.length': 900 } };
    assert.equal(jugerRun(cas, 'x'.repeat(500), { targets: TARGETS }).reussi, true);
    assert.equal(jugerRun(cas, 'x'.repeat(1200), { targets: TARGETS }).reussi, false);
  });

  test('un auteur peut écrire l\'opérateur, et il l\'emporte', () => {
    const a = attente('output.length', { op: 'gte', value: 300 }, TARGETS);
    assert.deepEqual([a.op, a.attendu, a.implicite], ['gte', 300, false]);

    const cas = { id: 'gc', expect: { 'output.length': { op: 'gte', value: 300 } } };
    assert.equal(jugerRun(cas, 'x'.repeat(500), { targets: TARGETS }).reussi, true);
    assert.equal(jugerRun(cas, 'x'.repeat(100), { targets: TARGETS }).reussi, false);
  });

  test('l\'attente porte toujours si son opérateur était implicite', () => {
    // Une règle tacite qui décide d'un verdict doit être lisible DANS le verdict.
    const c = jugerRun({ id: 'gc', expect: { 'output.length': 900 } }, 'court',
                       { targets: TARGETS }).constats[0];
    assert.equal(c.implicite, true);
  });
});

/* ── Ce qui n'a pas été mesuré ne compte pas comme mesuré ─────────────────── */

describe('les attentes non résolues', () => {
  test('une cible `state` n\'est ni satisfaite ni violée', () => {
    const r = jugerRun({ id: 'gc', expect: { 'pipeline.status': 'success' } }, 'peu importe',
                       { targets: TARGETS });
    assert.equal(r.constats[0].verdict, 'non résolu');
    assert.equal(r.reussi, false, 'un état du monde non vérifié ne vaut pas une réussite');
    assert.equal(r.echoue, false, 'et ce n\'est pas un échec non plus');
    assert.equal(r.jugeable, false);
  });

  test('une cible absente du registre est signalée, pas devinée', () => {
    const r = jugerRun({ id: 'gc', expect: { 'output.lenght': 100 } }, 'x', { targets: TARGETS });
    assert.equal(r.constats[0].verdict, 'non résolu');
    assert.match(r.constats[0].pourquoi, /absente du registre/);
  });

  test('une attente violée fait échouer même si une autre reste ouverte', () => {
    const r = jugerRun({ id: 'gc', expect: { 'output.length': 10, 'pipeline.status': 'success' } },
                       'x'.repeat(500), { targets: TARGETS });
    assert.equal(r.echoue, true);
    assert.equal(r.reussi, false);
  });
});

/* ── k/n ──────────────────────────────────────────────────────────────────── */

describe('le seuil k/n', () => {
  const R = (n, reussi) => Array.from({ length: n }, () => ({ reussi, echoue: !reussi }));

  test('applique le seuil DÉCLARÉ par l\'auteur', () => {
    const cas = { id: 'gc', runs: 5, pass_at_least: 4 };
    assert.equal(agregerCas(cas, [...R(4, true), ...R(1, false)]).passe, true);
    assert.equal(agregerCas(cas, [...R(3, true), ...R(2, false)]).passe, false);
  });

  test('sans pass_at_least, le seuil implicite est TOUTES', () => {
    // Le plus strict, volontairement : choisir le plus permissif transformerait
    // l'oubli que L017 signale en cadeau.
    const cas = { id: 'gc', runs: 3 };
    const a = agregerCas(cas, [...R(2, true), ...R(1, false)]);
    assert.equal(a.seuil, 3);
    assert.equal(a.seuilImplicite, true);
    assert.equal(a.passe, false);
  });

  test('runs par défaut vaut celui du schéma, et --runs le réduit', () => {
    assert.equal(runsDe({ id: 'gc' }), 3);
    assert.equal(runsDe({ id: 'gc', runs: 5 }), 5);
    assert.equal(runsDe({ id: 'gc', runs: 5 }, 1), 1);
  });
});

/* ── Le niveau, dérivé ────────────────────────────────────────────────────── */

describe('la dérivation du niveau', () => {
  const cas = (n, passe) => Array.from({ length: n }, (_, i) => ({ id: `gc-${i}`, passe }));

  test('se dérive du nombre de cas qui PASSENT, pas de ceux qui sont déclarés', () => {
    const a = { id: 'x', target_level: 'officiel' };
    // Cinq déclarés, deux qui tiennent : L010 avait autorisé l'ambition, le banc mesure.
    const n = deriverNiveau(a, [...cas(2, true), ...cas(3, false)]);
    assert.equal(n.level, 'experimental');
    assert.equal(n.passants, 2);
  });

  test('trois cas qui passent valent `team`', () => {
    const n = deriverNiveau({ id: 'x', target_level: 'officiel' },
                            [...cas(3, true), ...cas(2, false)]);
    assert.equal(n.level, 'team');
  });

  test('cinq cas qui passent valent `officiel` — si l\'auteur le visait', () => {
    assert.equal(deriverNiveau({ id: 'x', target_level: 'officiel' }, cas(5, true)).level, 'officiel');
  });

  test('le niveau visé PLAFONNE le niveau atteint', () => {
    // Un artefact qui vise `équipe` n'est pas promu dans le dos de son auteur : le
    // niveau l'engage, il ne s'attribue pas tout seul.
    const n = deriverNiveau({ id: 'x', target_level: 'team' }, cas(6, true));
    assert.equal(n.level, 'team');
    assert.equal(n.plafonne, true);
  });

  test('un seul cas en échec interdit `officiel`', () => {
    const n = deriverNiveau({ id: 'x', target_level: 'officiel' },
                            [...cas(5, true), ...cas(1, false)]);
    assert.equal(n.level, 'team');
    assert.equal(n.freine, true);
    assert.match(n.pourquoi, /ouvre la production/);
  });

  test('sans aucun cas, le niveau atteint est `expérimental`', () => {
    assert.equal(deriverNiveau({ id: 'x', target_level: 'officiel' }, []).level, 'experimental');
  });
});

/* ── La certification ─────────────────────────────────────────────────────── */

describe('la certification', () => {
  const bon = { id: 'gc-1', passe: true, runs: 3, indecis: 0, erreurs: 0 };

  test('UN CAS NON JUGÉ n\'est pas accusé d\'être un cas raté', () => {
    /*
     * Vu au premier passage du banc, sur `prep-delivery` : « 1 cas d'or en échec
     * (gc-03-conflits) », alors que la ligne du dessus affichait « 3 non concluant(s) ».
     * Le cas porte des cibles de classe `state` — `branch.mergeable`, `pipeline.status` —
     * que rien ne résout hors d'un dépôt jetable. L'agent n'avait rien raté : personne ne
     * l'avait mesuré.
     *
     * Les deux refusent la certification, et c'est juste dans les deux cas. Mais accuser
     * un agent d'un échec qu'il n'a pas commis est la faute que ce dépôt combat, retournée
     * contre lui : `non évalué` ne vaut pas `satisfait`, et ne vaut pas `violé` non plus.
     */
    const r = certifier({ artifact: { id: 'x' },
      cas: [bon, { id: 'gc-2', passe: false, runs: 3, indecis: 3, erreurs: 0 }],
      modele: 'm', fournisseur: 'f', date: '2026-08-07' });

    assert.equal(r.certification, null, 'un doute ne se certifie pas');
    assert.match(r.raison, /non concluant/);
    assert.match(r.raison, /pas un échec de l'agent/);
    assert.doesNotMatch(r.raison, /cas d'or en échec/);
  });

  test('un VRAI échec reste annoncé comme un échec', () => {
    // Le rattrapage ne doit pas adoucir le cas qu'il faut vraiment voir : un agent qui a
    // répondu, et mal.
    const r = certifier({ artifact: { id: 'x' },
      cas: [{ id: 'gc-2', passe: false, runs: 3, indecis: 0, erreurs: 0 }],
      modele: 'm', fournisseur: 'f', date: '2026-08-07' });
    assert.match(r.raison, /1 cas d'or en échec \(gc-2\)/);
  });

  test('n\'est décernée qu\'à un passage complet et sans échec', () => {
    const { certification } = certifier({ artifact: { id: 'x' }, cas: [bon, { ...bon, id: 'gc-2' }],
                                          modele: 'deepseek-chat', fournisseur: 'deepseek',
                                          date: '2026-08-07' });
    assert.equal(certification.model_version, 'deepseek-chat');
    assert.equal(certification.cas, '2/2');
    assert.equal(certification.certified_on, '2026-08-07');
  });

  test('la date de fin est à 90 jours, et il y en a une', () => {
    // Sans péremption, L016 et P005 n'auraient jamais rien à refuser : un agent se périme
    // sans qu'on y touche, parce que le modèle bouge sous le prompt.
    const { certification } = certifier({ artifact: { id: 'x' }, cas: [bon], modele: 'm',
                                          fournisseur: 'f', date: '2026-08-07' });
    const jours = (new Date(certification.expires_on) - new Date(certification.certified_on)) / 86_400_000;
    assert.equal(jours, JOURS_DE_VALIDITE);
  });

  test('refuse sur zéro cas — certifier sur rien serait certifier sur rien', () => {
    const r = certifier({ artifact: { id: 'x' }, cas: [], modele: 'm', fournisseur: 'f', date: '2026-08-07' });
    assert.equal(r.certification, null);
    assert.match(r.raison, /Aucun cas/);
  });

  test('refuse sur un cas en échec', () => {
    const r = certifier({ artifact: { id: 'x' }, cas: [bon, { ...bon, id: 'gc-2', passe: false }],
                          modele: 'm', fournisseur: 'f', date: '2026-08-07' });
    assert.equal(r.certification, null);
    assert.match(r.raison, /gc-2/);
  });

  test('refuse sur un cas non concluant — un doute n\'est pas une mesure', () => {
    const r = certifier({ artifact: { id: 'x' }, cas: [{ ...bon, indecis: 1 }],
                          modele: 'm', fournisseur: 'f', date: '2026-08-07' });
    assert.equal(r.certification, null);
    assert.match(r.raison, /non concluant/);
  });
});

/* ── Le passage complet, sans réseau ──────────────────────────────────────── */

describe('un passage de bout en bout', () => {
  const artifact = {
    id: 'demo', target_level: 'team', model_tier: 'small',
    spec: 'Explique {{code}}.',
    criteria: [{ target: 'output.length', op: 'lte', value: 1000 }],
    golden_cases: [
      { id: 'gc-01', context: {}, expect: { 'output.length': 100 }, runs: 3, pass_at_least: 2 },
      { id: 'gc-02', context: {}, expect: { 'output.length': 100 }, runs: 2, pass_at_least: 2 },
      { id: 'gc-03', context: {}, expect: { 'output.length': 100 }, runs: 1, pass_at_least: 1 }
    ]
  };

  test('joue chaque cas le nombre de fois déclaré et agrège', async () => {
    const appels = [];
    // gc-01 : un tour trop long sur trois — le seuil 2/3 tient quand même.
    const jouer = async (cas, i) => {
      appels.push(`${cas.id}#${i}`);
      const trop = cas.id === 'gc-01' && i === 1;
      return { sortie: 'x'.repeat(trop ? 500 : 50), jetons: { entree: 10, sortie: 5 }, cout: 0.001 };
    };

    const p = await passer(artifact, { jouer, targets: TARGETS });
    assert.equal(appels.length, 6);
    assert.deepEqual(p.cas.map((c) => c.passe), [true, true, true]);
    assert.equal(p.cas[0].reussites, 2);
    assert.equal(p.niveau.level, 'team');

    const d = depense(p.cas);
    assert.equal(d.appels, 6);
    assert.deepEqual(d.jetons, { entree: 60, sortie: 30 });
    assert.equal(Math.round(d.euros * 1000), 6);
  });

  test('un appel qui n\'aboutit pas n\'est PAS compté comme un échec de l\'agent', async () => {
    // Sinon un niveau chuterait sur une coupure réseau. Ce n'est pas une mesure ratée de
    // l'agent, c'est une mesure qui n'a pas eu lieu — et ça se dit autrement.
    const jouer = async (cas, i) => (i === 0 ? { erreur: 'HTTP 429' }
                                             : { sortie: 'x'.repeat(50) });
    const p = await passer(artifact, { jouer, targets: TARGETS, cas: 'gc-01' });
    const c = p.cas[0];
    assert.equal(c.erreurs, 1);
    assert.equal(c.echecs, 0);
    assert.equal(c.indecis, 1);
    assert.equal(c.passe, true, '2 réussites sur 3 avec un seuil à 2');

    const { certification, raison } = certifier({ artifact, cas: p.cas, modele: 'm',
                                                  fournisseur: 'f', date: '2026-08-07' });
    assert.equal(certification, null, 'mais rien ne se certifie sur un passage troué');
    assert.match(raison, /non concluant/);
  });

  test('une exception de `jouer` ne fait pas tomber le passage', async () => {
    const jouer = async () => { throw new Error('boum'); };
    const p = await passer(artifact, { jouer, targets: TARGETS, cas: 'gc-03' });
    assert.equal(p.cas[0].erreurs, 1);
    assert.equal(p.cas[0].passe, false);
  });

  test('--cas et --runs restreignent le passage', async () => {
    const jouer = async () => ({ sortie: 'court' });
    const p = await passer(artifact, { jouer, targets: TARGETS, cas: 'gc-01', runs: 1 });
    assert.equal(p.cas.length, 1);
    assert.equal(p.cas[0].runs, 1);
  });
});

/* ── Le plan : on annonce avant de dépenser ───────────────────────────────── */

describe('le plan', () => {
  const artifact = {
    id: 'demo', criteria: [{ target: 'output.length', op: 'lte', value: 1500 }],
    golden_cases: [{ id: 'a', runs: 5 }, { id: 'b', runs: 5 }, { id: 'c', runs: 3 }]
  };

  test('compte les appels avant d\'en faire un seul', () => {
    assert.equal(plan(artifact).appels, 13);
    assert.equal(plan(artifact, { cas: 'a' }).appels, 5);
    assert.equal(plan(artifact, { runs: 1 }).appels, 3);
  });

  test('majore la sortie par le plafond de output.length du contrat', () => {
    const p = plan(artifact, { runs: 1, longueurPrompt: 4000 });
    assert.equal(p.jetons.entree, 1000 * 3);
    assert.equal(p.jetons.sortie, Math.ceil(1500 / 4) * 3);
  });
});

/* ── L'état dérivé ────────────────────────────────────────────────────────── */

describe('l\'état dérivé', () => {
  const passage = {
    artifact: 'demo',
    niveau: { level: 'team', vise: 'officiel', pourquoi: 'parce que' },
    cas: [{ id: 'gc-01', passe: true, reussites: 3, runs: 3, seuil: 3, indecis: 0, erreurs: 0 }]
  };
  const valeur = entree(passage, { certification: { model_version: 'm' }, raison: '',
                                   modele: 'm', fournisseur: 'f', date: '2026-08-07',
                                   depense: { appels: 3, jetons: { entree: 1, sortie: 2 }, euros: null } });

  test('la carte est celle que les écrans et le pré-vol attendent', () => {
    const etat = fusionner(null, 'demo', valeur, '2026-08-07');
    const c = carte(etat);
    assert.equal(c.demo.level, 'team');
    assert.equal(c.demo.certification.model_version, 'm');
    // Et c'est bien ce que `lib/niveau.js` sait lire — la boucle est fermée.
    const n = niveau({ id: 'demo', target_level: 'officiel' }, c);
    assert.equal(n.mesure, true);
    assert.equal(n.texte, 'équipe · visait officiel');
  });

  test('sans fichier, la carte est `null` — pas un objet vide', () => {
    // `null` fait taire L016, P005 et P006. Un objet vide leur ferait dire « jamais
    // certifié » sur tout le catalogue : une plateforme sans banc ne doit pas ressembler
    // à une plateforme dont tout échoue.
    assert.equal(carte(null), null);
    assert.equal(carte(VIDE), null, 'un état vide n\'a rien mesuré');
  });

  test('un passage ciblé n\'efface pas la mesure des autres', () => {
    const un = fusionner(null, 'a', valeur, '2026-08-07');
    const deux = fusionner(un, 'b', valeur, '2026-08-08');
    assert.deepEqual(Object.keys(carte(deux)).sort(), ['a', 'b']);
    assert.equal(deux.genere_le, '2026-08-08');
  });

  test('oublier retire un artefact et laisse le reste', () => {
    const deux = fusionner(fusionner(null, 'a', valeur, 'd'), 'b', valeur, 'd');
    assert.deepEqual(Object.keys(carte(oublier(deux, 'a', 'd'))), ['b']);
  });

  test('ne conserve aucune sortie de modèle', () => {
    // Une sortie peut contenir ce qu'on lui a donné à lire — un extrait de dépôt, un
    // journal de pipeline. Le dépôt du registre n'est pas l'endroit où ça se stocke : on
    // garde le VERDICT, pas la matière.
    const avecSorties = {
      ...passage,
      cas: [{ ...passage.cas[0],
              resultats: [{ sortie: 'SECRET-DU-DEPOT', constats: [{ valeur: 'AUSSI-SECRET' }] }] }]
    };
    const v = entree(avecSorties, { certification: null, raison: 'r', modele: 'm',
                                    fournisseur: 'f', date: '2026-08-07', depense: null });
    const texte = JSON.stringify(v);
    assert.ok(!texte.includes('SECRET-DU-DEPOT'), texte);
    assert.ok(!texte.includes('AUSSI-SECRET'), texte);
  });
});

/* ── Ce que le navigateur doit pouvoir charger ────────────────────────────── */

describe('les modules partagés avec les écrans', () => {
  test('`runtime/etat-derive.js` n\'importe rien de Node', async () => {
    /*
     * Le Catalogue et l'Admin l'importent pour lire `derive/etat.json`. Un seul
     * `import … from 'node:fs'` le rendrait inchargeable dans l'onglet — et l'écran
     * tomberait entièrement, pas seulement la pastille de niveau. Le reste de
     * `runtime/` n'a pas cette contrainte : il ne tourne que côté serveur.
     */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(ROOT, 'runtime/etat-derive.js'), 'utf8');
    assert.equal(/from\s+'node:/.test(src), false, src.match(/from\s+'node:[^']+'/g)?.join(', '));
  });
});
