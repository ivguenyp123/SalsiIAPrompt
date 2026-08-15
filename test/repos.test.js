/*
 * Le référentiel des dépôts.
 *
 * Ce qui se vérifie ici n'est pas « la lecture d'un YAML » mais une règle de préséance :
 * ce que le référentiel sait ne doit JAMAIS pouvoir être contredit par une saisie. C'est
 * la seule chose qui sépare un référentiel d'un pré-remplissage — et si elle lâche,
 * `P002` recommence à croire sur parole sans que rien ne le signale.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { classer, correspond, contexteDepot, couverture, SENSIBILITES,
         PROVENANCES } from '../lib/repos.js';
import { prevol } from '../preflight/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = yaml.load(readFileSync(join(ROOT, 'registries/repos.yaml'), 'utf8'));

const ENTREES = [
  { depot: 'groupe/*', scope: 'Plateforme', sensibilite: 'interne' },
  { depot: 'groupe/sous/*', scope: 'Data', sensibilite: 'confidentiel' },
  { depot: 'groupe/coffre', scope: 'Securite', sensibilite: 'secret' },
  { depot: 'autre/vitrine', scope: 'Com', sensibilite: 'public' }
];

/* ── Le fichier livré ─────────────────────────────────────────────────────── */

describe('le fichier livré', () => {
  test('se lit, et ne classe RIEN', () => {
    /*
     * Livrer trois entrées plausibles produirait une donnée fabriquée qui a l'aplomb
     * d'une donnée vérifiée — et ici elle servirait à autoriser des lectures. Ce test
     * est là pour qu'on ne « complète » pas ce fichier par confort un jour de fatigue.
     */
    assert.deepEqual(FICHIER.repos, [], 'registries/repos.yaml doit rester vide');
    assert.equal(couverture(FICHIER.repos).entrees, 0);
  });

  test('vide, il ne change rien à ce qui existait', () => {
    // La compatibilité qui compte : tant que personne ne classe, le produit se comporte
    // exactement comme avant l'arrivée de ce fichier.
    const ctx = contexteDepot('groupe/depot', FICHIER.repos, { sensibilite: 'interne' });
    assert.equal(ctx.sensibilite, 'interne');
    assert.equal(ctx.provenance, 'declare');
  });
});

/* ── La correspondance ────────────────────────────────────────────────────── */

describe('la correspondance', () => {
  test('exacte, insensible à la casse et au `.git`', () => {
    assert.ok(correspond('groupe/depot', 'groupe/depot'));
    assert.ok(correspond('Groupe/Depot', 'groupe/depot.git'));
    assert.ok(!correspond('groupe/depot', 'groupe/depot-bis'));
  });

  test('le joker couvre le groupe, pas le groupe lui-même', () => {
    assert.ok(correspond('groupe/*', 'groupe/depot'));
    assert.ok(correspond('groupe/*', 'groupe/sous/depot'));
    assert.ok(!correspond('groupe/*', 'groupe/'), 'un préfixe seul n\'est pas un dépôt');
    assert.ok(!correspond('groupe/*', 'autregroupe/depot'));
  });

  test('rien ne correspond à rien', () => {
    for (const [m, c] of [['', 'a/b'], ['a/b', ''], [null, null], [undefined, 'a/b']]) {
      assert.equal(correspond(m, c), false);
    }
  });
});

/* ── La préséance ─────────────────────────────────────────────────────────── */

describe('la préséance', () => {
  test('l\'entrée exacte l\'emporte sur le joker', () => {
    // Classer un groupe puis en extraire un dépôt est le cas NORMAL. L'ordre du fichier
    // ne doit pas décider à la place de la précision.
    const r = classer('groupe/coffre', ENTREES);
    assert.equal(r.sensibilite, 'secret');
    assert.equal(r.par, 'groupe/coffre');
  });

  test('le joker le plus long l\'emporte sur le plus court', () => {
    const r = classer('groupe/sous/truc', ENTREES);
    assert.equal(r.sensibilite, 'confidentiel');
    assert.equal(r.scope, 'Data');
  });

  test('un dépôt hors référentiel n\'est pas classé', () => {
    const r = classer('inconnu/depot', ENTREES);
    assert.equal(r.connu, false);
    assert.equal(r.provenance, 'inconnu');
    assert.equal(r.sensibilite, null);
  });

  test('une sensibilité hors nomenclature est ignorée, pas recopiée', () => {
    // Recopier `sensibilite: tres-secret` ferait comparer P002 à une valeur qu'il ne
    // sait pas ordonner — c'est-à-dire ne rien comparer du tout.
    const r = classer('x/y', [{ depot: 'x/y', sensibilite: 'tres-secret' }]);
    assert.equal(r.sensibilite, null);
    assert.ok(SENSIBILITES.every((s) => s !== 'tres-secret'));
  });
});

/* ── Le contexte du pré-vol ───────────────────────────────────────────────── */

describe('le contexte passé au pré-vol', () => {
  test('LE référentiel a le dernier mot', () => {
    /*
     * Le test qui justifie tout le module. Si une saisie pouvait déclasser un dépôt
     * confidentiel en « public », le référentiel ne serait qu'un pré-remplissage et
     * P002 continuerait de croire sur parole — en ayant l'air de vérifier.
     */
    const ctx = contexteDepot('groupe/coffre', ENTREES, { sensibilite: 'public', scope: 'Com' });
    assert.equal(ctx.sensibilite, 'secret');
    assert.equal(ctx.scope, 'Securite');
    assert.equal(ctx.provenance, 'referentiel');
  });

  test('ce que le référentiel tait reste saisissable', () => {
    // Une entrée peut ne renseigner que la sensibilité. Refuser la saisie du périmètre
    // au motif que le dépôt « est classé » bloquerait sur une colonne vide.
    const ctx = contexteDepot('x/y', [{ depot: 'x/y', sensibilite: 'interne' }],
                              { scope: 'Data' });
    assert.equal(ctx.sensibilite, 'interne');
    assert.equal(ctx.scope, 'Data');
  });

  test('sans référentiel ni saisie, c\'est `inconnu` — et ça se dit', () => {
    const ctx = contexteDepot('x/y', [], {});
    assert.equal(ctx.provenance, 'inconnu');
    assert.ok(!PROVENANCES[ctx.provenance].ferme, 'l\'écran doit rester saisissable');
  });

  test('les trois provenances sont décrites pour l\'écran', () => {
    for (const p of ['referentiel', 'declare', 'inconnu']) {
      assert.ok(PROVENANCES[p]?.label && PROVENANCES[p]?.aide, p);
      assert.equal(typeof PROVENANCES[p].ferme, 'boolean');
    }
    assert.equal(PROVENANCES.referentiel.ferme, true, 'le classé ne se modifie pas à l\'écran');
  });
});

/* ── L'effet sur P002, qui est la raison d'être du fichier ────────────────── */

describe('l\'effet sur le pré-vol', () => {
  const AGENT = {
    id: 'x', kind: 'prompt', title: 'X', spec: 'lis {{repo}}',
    intent: { purpose: 'p', not_for: 'n' },
    owner: { person: 'moi', scope: 'Plateforme' },
    classification: { max_repo_sensitivity: 'interne' },
    target_level: 'experimental', model_tier: 'mid',
    variables: [{ name: 'repo', source: 'repo_metadata', required: true }],
    criteria: [{ target: 'output.length', op: 'lte', value: 2000 }]
  };
  const lancer = (depot) => prevol(AGENT, { depot, valeurs: { repo: 'x' }, criticite: 'test',
                                            registres: { artifacts: [] } });

  test('classé au-dessus du plafond : REFUS', () => {
    const r = lancer(contexteDepot('groupe/coffre', ENTREES, {}));
    const p002 = r.constats.filter((c) => c.code === 'P002');
    assert.ok(p002.some((c) => c.severity === 'error'),
              'un dépôt classé `secret` doit être refusé à un agent plafonné `interne`');
  });

  test('classé sous le plafond : rien à dire', () => {
    const r = lancer(contexteDepot('autre/vitrine', ENTREES, {}));
    assert.equal(r.constats.filter((c) => c.code === 'P002').length, 0);
  });

  test('non classé : on DEMANDE, on ne refuse pas', () => {
    // Refuser l'inconnu reviendrait à refuser tout, tant que le référentiel est vide.
    const r = lancer(contexteDepot('inconnu/depot', ENTREES, {}));
    const p002 = r.constats.filter((c) => c.code === 'P002');
    assert.ok(p002.length > 0, 'l\'inconnu doit se signaler');
    assert.ok(p002.every((c) => c.severity !== 'error'), 'mais pas bloquer');
  });

  test('une saisie complaisante ne sauve plus personne', () => {
    /*
     * Le comportement qu'on vient acheter : avant ce module, déclarer « public » sur un
     * dépôt confidentiel suffisait à passer. Le contrôle refusait honnêtement ce qu'on
     * lui disait, et on pouvait lui dire n'importe quoi.
     */
    const r = lancer(contexteDepot('groupe/coffre', ENTREES, { sensibilite: 'public' }));
    assert.ok(r.constats.some((c) => c.code === 'P002' && c.severity === 'error'));
  });
});
