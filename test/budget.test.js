/*
 * Le plafond de dépense.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. UN APPEL SANS TARIF N'EST PAS UN APPEL GRATUIT. C'est la porte la plus bête qu'un
 *    plafond puisse laisser ouverte : le contourner en choisissant le palier dont on
 *    ignore le prix. Tout le reste du module en découle.
 * 2. Les deux plafonds s'appliquent — global ET périmètre. En évaluer un aurait laissé
 *    l'autre déclaré et inappliqué, ce qui est pire que pas de plafond : ça rassure.
 * 3. Sans plafond déclaré, ou sans journal à lire, le contrôle se TAIT. On n'invente pas
 *    une limite, et on ne refuse pas sur une ignorance.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { depense, etat, argent, plafondsDe, FENETRES, SEUIL_ALERTE } from '../lib/budget.js';
import { prevol } from '../preflight/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = yaml.load(readFileSync(join(ROOT, 'registries/budget.yaml'), 'utf8'));

const MAINTENANT = new Date('2026-08-18T12:00:00Z');
const ilYA = (heures) => new Date(MAINTENANT.getTime() - heures * 3600_000).toISOString();

/** Une ligne de journal minimale. `cout: null` = appel non tarifé. */
const ligne = (cout, { h = 1, scope = 'Plateforme', entree = 100, sortie = 50 } = {}) =>
  ({ le: ilYA(h), cout, scope, entree, sortie });

/* ── Le comptage ──────────────────────────────────────────────────────────── */

describe('ce qui a été dépensé sur la fenêtre', () => {
  test('additionne les coûts connus', () => {
    const d = depense([ligne(0.01), ligne(0.02), ligne(0.03)], { fenetre: 'jour', jusqua: MAINTENANT });
    assert.equal(Number(d.connu.toFixed(4)), 0.06);
    assert.equal(d.appels, 3);
    assert.equal(d.inconnus, 0);
  });

  test('UN APPEL SANS TARIF EST COMPTÉ À PART, jamais à zéro', () => {
    /*
     * Le test qui porte tout le module. `large` chez DeepSeek n'a pas de tarif relevé :
     * son coût vaut `null`. Le compter pour zéro ouvrirait la porte la plus bête qui
     * soit — dépenser sans limite en choisissant le palier le plus cher, celui dont on
     * ignore justement le prix.
     */
    const d = depense([ligne(0.01), ligne(null), ligne(undefined)],
                      { fenetre: 'jour', jusqua: MAINTENANT });
    assert.equal(d.connu, 0.01);
    assert.equal(d.inconnus, 2);
    assert.equal(d.appels, 3, 'ils comptent quand même comme des appels');
  });

  test('UN REFUS N\'EST PAS UN APPEL NON TARIFÉ', () => {
    /*
     * Vu en éprouvant le plafond pour de vrai. Le premier appel refusé par P008 entrait au
     * journal avec `cout: null`, comme une exécution sans tarif : la fenêtre passait donc
     * définitivement en « minorant », et P008 exigeait une confirmation humaine sur TOUT.
     * Le plafond se dégradait lui-même en le franchissant une fois.
     *
     * Un refus de pré-vol tombe AVANT le premier jeton : le coût est zéro, et il est
     * connu.
     */
    const d = depense([ligne(0.01), { ...ligne(null), issue: 'refus' }],
                      { fenetre: 'jour', jusqua: MAINTENANT });
    assert.equal(d.inconnus, 0, 'le refus ne rend pas la fenêtre incertaine');
    assert.equal(d.appels, 1, 'un refus n\'est pas un appel de modèle');
    assert.equal(d.connu, 0.01);
  });

  test('ne compte que ce qui tombe DANS la fenêtre', () => {
    const d = depense([ligne(1, { h: 2 }), ligne(1, { h: 48 })],
                      { fenetre: 'jour', jusqua: MAINTENANT });
    assert.equal(d.connu, 1);
    assert.equal(d.appels, 1);
  });

  test('une date illisible n\'est pas comptée pour aujourd\'hui', () => {
    // Une ligne corrompue ferait sinon gonfler la fenêtre courante — et un plafond
    // franchi par une date cassée serait impossible à comprendre.
    const d = depense([{ le: 'jamais', cout: 99 }], { fenetre: 'jour', jusqua: MAINTENANT });
    assert.equal(d.appels, 0);
  });

  test('filtre par périmètre quand on le demande', () => {
    const lignes = [ligne(1, { scope: 'Data' }), ligne(2, { scope: 'Plateforme' })];
    assert.equal(depense(lignes, { fenetre: 'jour', jusqua: MAINTENANT, scope: 'Data' }).connu, 1);
    assert.equal(depense(lignes, { fenetre: 'jour', jusqua: MAINTENANT }).connu, 3);
  });

  test('le mois est trente jours, et c\'est dit', () => {
    assert.equal(FENETRES.mois, 30 * FENETRES.jour);
  });
});

/* ── Le verdict ───────────────────────────────────────────────────────────── */

describe('où en est-on du plafond', () => {
  test('sans plafond déclaré, aucun verdict', () => {
    // On n'invente pas une limite. Le contrôle se tait, comme L023 sans la banque.
    for (const p of [null, undefined, 0, -1]) {
      assert.equal(etat(p, { connu: 999 }).declare, false);
    }
  });

  test('franchi quand la dépense CONNUE atteint le plafond', () => {
    const e = etat(1, { connu: 1, inconnus: 0 });
    assert.equal(e.franchi, true);
    assert.match(e.raison, /Plafond atteint/);
  });

  test('des appels non tarifés alertent MÊME loin du plafond', () => {
    /*
     * 10 centimes sur 10 dollars, c'est 1 % — rien. Mais si trois appels de la fenêtre
     * n'ont pas de prix, ce 1 % est un plancher et le vrai chiffre est inconnu. Se taire
     * afficherait « tout va bien » sur une mesure qui ne mesure pas tout.
     */
    const e = etat(10, { connu: 0.1, inconnus: 3 });
    assert.equal(e.franchi, false);
    assert.equal(e.alerte, true);
    assert.match(e.raison, /MINORANT/);
    assert.match(e.raison, /AU-DESSUS/);
  });

  test('alerte au-delà du seuil, silence en dessous', () => {
    // Refuser à 100 % et se taire à 99 % ferait découvrir la limite au moment où elle
    // tombe — en pleine démonstration.
    assert.equal(etat(10, { connu: 10 * SEUIL_ALERTE, inconnus: 0 }).alerte, true);
    assert.equal(etat(10, { connu: 1, inconnus: 0 }).alerte, false);
    assert.equal(etat(10, { connu: 1, inconnus: 0 }).raison, '');
  });

  test('un montant sous le centime se lit en centimes', () => {
    // « 0.00 $ » se lit « gratuit ». Ce n'est pas la même information.
    assert.equal(argent(0.0035), '0.35 ¢');
    assert.equal(argent(1.5), '1.50 $');
    assert.equal(argent(null), '—');
  });
});

/* ── Les plafonds qui s'appliquent ────────────────────────────────────────── */

describe('les deux plafonds s\'appliquent, jamais un seul', () => {
  test('le global et celui du périmètre sortent ENSEMBLE', () => {
    /*
     * L'équipe Data ne dépasse pas son enveloppe même si le global a de la marge, et
     * personne ne dépasse le global même si son équipe en a. En choisir un aurait laissé
     * l'autre déclaré et inappliqué — pire que pas de plafond, parce que ça rassure.
     */
    const p = plafondsDe(config, { scope: 'Data' });
    assert.deepEqual(p.map((x) => [x.portee, x.fenetre]).sort(),
      [['global', 'jour'], ['global', 'mois'], ['scope', 'jour'], ['scope', 'mois']].sort());
  });

  test('un périmètre sans enveloppe propre ne reçoit que le global', () => {
    const p = plafondsDe(config, { scope: 'Inconnu' });
    assert.deepEqual([...new Set(p.map((x) => x.portee))], ['global']);
  });

  test('sans configuration, aucun plafond — et donc aucun contrôle', () => {
    assert.deepEqual(plafondsDe({}, { scope: 'Data' }), []);
  });
});

/* ── P008 ─────────────────────────────────────────────────────────────────── */

describe('P008 tranche avant le premier jeton', () => {
  const artefact = yaml.load(readFileSync(join(ROOT, 'artifacts/bus-factor.yaml'), 'utf8'));
  const registres = {
    tools: yaml.load(readFileSync(join(ROOT, 'registries/tools.yaml'), 'utf8')).tools,
    targets: yaml.load(readFileSync(join(ROOT, 'registries/targets.yaml'), 'utf8')).targets
  };
  const ctx = (budget) => ({
    registres, budget,
    depot: { path: 'x/y', scope: artefact.owner?.scope, sensibilite: 'interne' },
    criticite: 'test',
    valeurs: Object.fromEntries((artefact.variables || []).map((v) => [v.name, 'x']))
  });
  const codes = (r, sev) => r.constats.filter((c) => c.severity === sev).map((c) => c.code);

  const avec = (etatBudget) => ({ etats: [{ portee: 'global', nom: '', fenetre: 'jour',
                                            montant: 5, etat: etatBudget }] });

  test('sans budget fourni, il se TAIT', () => {
    // Le pré-vol est pur : il ne lit pas le journal. Un appelant qui n'a rien à lui
    // donner — le banc, un test — ne doit pas se faire refuser pour autant.
    const r = prevol(artefact, ctx(null));
    assert.ok(!codes(r, 'error').includes('P008'));
    assert.ok(!codes(r, 'warn').includes('P008'));
  });

  test('plafond franchi : REFUS, avant le premier jeton', () => {
    const r = prevol(artefact, ctx(avec(etat(5, { connu: 5.2, inconnus: 0 }))));
    assert.ok(codes(r, 'error').includes('P008'));
    assert.equal(r.bloque, true);
  });

  test('appels non tarifés : CONFIRMATION, pas refus', () => {
    /*
     * La règle du pré-vol, appliquée telle quelle : on refuse ce qu'on SAIT, on demande
     * ce qu'on IGNORE. Une dépense qui pourrait être au-dessus du plafond n'est pas une
     * dépense au-dessus du plafond.
     */
    const r = prevol(artefact, ctx(avec(etat(5, { connu: 1, inconnus: 4 }))));
    assert.ok(!codes(r, 'error').includes('P008'), 'un doute ne refuse pas');
    assert.equal(r.confirmationRequise, true);
    assert.ok(r.raisons.some((c) => c.code === 'P008'));
  });

  test('approche du plafond : un avertissement qui ne bloque pas', () => {
    const r = prevol(artefact, ctx(avec(etat(5, { connu: 4.5, inconnus: 0 }))));
    assert.ok(codes(r, 'warn').includes('P008'));
    assert.equal(r.bloque, false);
  });

  test('loin du plafond : silence complet', () => {
    const r = prevol(artefact, ctx(avec(etat(5, { connu: 0.1, inconnus: 0 }))));
    assert.ok(!codes(r, 'warn').includes('P008'));
    assert.ok(!codes(r, 'error').includes('P008'));
  });

  test('le périmètre refuse même quand le global a de la marge', () => {
    // La propriété qui fait qu'une enveloppe d'équipe veut dire quelque chose.
    const r = prevol(artefact, ctx({ etats: [
      { portee: 'global', nom: '', fenetre: 'mois', montant: 50, etat: etat(50, { connu: 2 }) },
      { portee: 'scope', nom: 'Plateforme', fenetre: 'mois', montant: 3, etat: etat(3, { connu: 3.1 }) }
    ] }));
    assert.ok(codes(r, 'error').includes('P008'));
    assert.match(r.constats.find((c) => c.code === 'P008').message, /périmètre `Plateforme`/);
  });
});
