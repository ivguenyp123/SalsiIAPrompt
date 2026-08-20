/*
 * Le registre des capacités — l'identité d'un agent est ce qu'il FAIT.
 *
 * Deux familles de vérifications :
 *   1. l'empreinte ne dépend d'aucune formulation, et distingue ce qui doit l'être ;
 *   2. le module REFUSE de produire ce qu'il ne peut pas mesurer — pas de score
 *      d'adéquation, pas de verdict de doublon.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../lib/yaml.js';
import { ficheDe, empreinte, rapprochement, familles, candidats,
         direLeRapprochement, MODES } from '../lib/capacites.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTEFACTS = readdirSync(join(ROOT, 'artifacts')).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => yaml.load(readFileSync(join(ROOT, 'artifacts', f), 'utf8')));
const FICHES = ARTEFACTS.map(ficheDe);

const agent = (o) => ficheDe({
  id: 'x', kind: 'prompt', title: 'X',
  owner: { scope: 'Plateforme' }, model_tier: 'mid', target_level: 'experimental', ...o });

/* ══ L'EMPREINTE NE DÉPEND PAS DU TEXTE ═══════════════════════════════════════ */

describe('l\'identité d\'un agent est ce qu\'il fait', () => {
  test('deux specs entièrement différents, même empreinte', () => {
    /*
     * C'est le faux négatif de `L015` : deux personnes écrivent le même agent avec des
     * mots qui n'ont rien en commun. La similarité de texte ne voit rien ; la matière et
     * les sections sont identiques.
     */
    const a = agent({ id: 'a', variables: [{ name: 'chiffres_dora', source: 'signal' }],
                      criteria: [{ target: 'output.sections', op: 'contains', value: ['Où on en est'] }],
                      spec: 'Tu rédiges le commentaire du comité en cinq lignes.' });
    const b = agent({ id: 'b', variables: [{ name: 'chiffres_dora', source: 'signal' }],
                      criteria: [{ target: 'output.sections', op: 'contains', value: ['Où on en est'] }],
                      spec: 'Écris un paragraphe court destiné à la gouvernance mensuelle.' });
    assert.equal(empreinte(a), empreinte(b));
  });

  test('deux specs presque identiques, empreintes différentes — les DROITS', () => {
    /*
     * Le faux positif symétrique, et le plus dangereux : deux textes qui se ressemblent
     * alors que l'un ÉCRIT dans la forge et l'autre non. Les traiter comme des doublons
     * ferait supprimer celui qui ne demande aucun droit.
     */
    const lecture = agent({ id: 'l', variables: [{ name: 'diff', source: 'repo' }],
                            tools: [{ id: 'read_repo_metadata', mode: 'read' }] });
    const ecriture = agent({ id: 'e', variables: [{ name: 'diff', source: 'repo' }],
                             tools: [{ id: 'create_mr', mode: 'write' }] });
    assert.notEqual(empreinte(lecture), empreinte(ecriture));
    assert.equal(lecture.droit, 'read');
    assert.equal(ecriture.droit, 'write');
  });

  test('la SOURCE d\'une entrée fait partie de l\'identité', () => {
    // Lire `code` depuis le dépôt ou le recevoir en signal calculé ne demande pas le même
    // travail à celui qui lance — et ne donne pas la même matière au modèle.
    const r = agent({ variables: [{ name: 'code', source: 'repo' }] });
    const s = agent({ variables: [{ name: 'code', source: 'signal' }] });
    assert.notEqual(empreinte(r), empreinte(s));
  });

  test('le palier et le niveau ne changent PAS l\'empreinte', () => {
    // Le même travail fait par un modèle plus cher reste le même travail. Ces champs
    // départagent deux candidats ; ils ne les distinguent pas.
    const a = agent({ variables: [{ name: 'diff', source: 'repo' }], model_tier: 'nano' });
    const b = agent({ variables: [{ name: 'diff', source: 'repo' }], model_tier: 'large',
                      target_level: 'certified' });
    assert.equal(empreinte(a), empreinte(b));
  });

  test('le droit retenu est le PLUS PERMISSIF, jamais la moyenne', () => {
    const f = agent({ tools: [{ id: 'a', mode: 'read' }, { id: 'b', mode: 'write' }] });
    assert.equal(f.droit, 'write', 'un seul outil d\'écriture suffit à engager le droit');
    assert.deepEqual(MODES, ['write', 'read', 'none']);
  });

  test('sans outil déclaré, le droit est `none` — pas « inconnu »', () => {
    assert.equal(agent({}).droit, 'none');
  });
});

/* ══ CE QUE LE MODULE REFUSE DE CALCULER ══════════════════════════════════════ */

describe('aucun score, aucun verdict', () => {
  test('un rapprochement rend des COMPOSANTES, jamais un pourcentage', () => {
    /*
     * « Cet agent couvre 94 % de ton besoin » est un chiffre que rien ne mesure, et il
     * serait cru. Pire : il écraserait la seule chose qui permet de choisir — « même
     * matière mais droits différents » et « matière différente mais mêmes droits »
     * donneraient le même nombre.
     */
    const r = rapprochement(
      agent({ id: 'a', variables: [{ name: 'diff', source: 'repo' }],
              criteria: [{ target: 'output.sections', op: 'contains', value: ['Un', 'Deux'] }] }),
      agent({ id: 'b', variables: [{ name: 'diff', source: 'repo' }],
              criteria: [{ target: 'output.sections', op: 'contains', value: ['Un', 'Trois'] }] }));
    assert.equal(r.entrees.commun, 1);
    assert.equal(r.sections.commun, 1);
    assert.equal(r.sections.total, 3);
    for (const v of Object.values(r)) {
      assert.ok(typeof v !== 'number' || Number.isInteger(v),
                'aucune fraction ne sort d\'ici : ce seraient des pourcentages déguisés');
    }
  });

  test('la phrase de rapprochement DIT ce qui n\'est pas établi', () => {
    /*
     * Le meilleur signal de déduplication serait « sur les mêmes cas d'or, A et B rendent
     * la même chose ». Le banc n'a jamais tourné avec une vraie clé. Le module doit donc
     * refuser le verdict, à voix haute, plutôt que de laisser croire qu'il l'a mesuré.
     */
    const p = direLeRapprochement(rapprochement(
      agent({ id: 'a', variables: [{ name: 'diff', source: 'repo' }] }),
      agent({ id: 'b', variables: [{ name: 'diff', source: 'repo' }] })));
    assert.match(p, /CE QUI N'EST PAS ÉTABLI/);
    assert.match(p, /Aucun cas d'or n'a été joué/);
    assert.match(p, /jamais lequel supprimer/);
  });

  test('une même empreinte n\'est pas un verdict de doublon', () => {
    const p = direLeRapprochement(rapprochement(
      agent({ id: 'a', variables: [{ name: 'activite_du_jour', source: 'signal' }] }),
      agent({ id: 'b', variables: [{ name: 'activite_du_jour', source: 'signal' }] })));
    assert.match(p, /MÊME empreinte fonctionnelle/);
    assert.ok(!/supprime|redondant|doublon avéré/i.test(p.split('CE QUI N\'EST PAS')[0]));
  });

  test('deux ensembles vides ne se « ressemblent » pas : ils se taisent', () => {
    // Sans sections déclarées des deux côtés, il n'y a rien à comparer. Rendre 100 % de
    // similarité serait le contresens exact : c'est une absence d'information.
    const r = rapprochement(agent({ id: 'a' }), agent({ id: 'b' }));
    assert.equal(r.sections, null);
  });
});

/* ══ LE ROUTEUR ═══════════════════════════════════════════════════════════════ */

describe('trouver les agents qui savent lire la matière disponible', () => {
  const TROIS = [
    agent({ id: 'lit-diff', variables: [{ name: 'diff', source: 'repo' }],
            criteria: [{ target: 'output.sections', op: 'contains', value: ['Le risque'] }] }),
    agent({ id: 'lit-diff-et-plus',
            variables: [{ name: 'diff', source: 'repo' }, { name: 'story', source: 'user' }],
            criteria: [{ target: 'output.sections', op: 'contains', value: ['Le risque'] }] }),
    agent({ id: 'ecrit', variables: [{ name: 'diff', source: 'repo' }],
            tools: [{ id: 'create_mr', mode: 'write' }],
            criteria: [{ target: 'output.sections', op: 'contains', value: ['Le risque'] }] })
  ];

  test('un agent qui réclame une matière absente est ÉCARTÉ, pas mal classé', () => {
    const c = candidats(TROIS, { entrees: ['diff'], sections: ['Le risque'] });
    assert.deepEqual(c.map((x) => x.id).sort(), ['ecrit', 'lit-diff']);
  });

  test('à couverture égale, celui qui demande LE MOINS DE DROITS passe devant', () => {
    const c = candidats(TROIS, { entrees: ['diff'], sections: ['Le risque'] });
    assert.equal(c[0].id, 'lit-diff');
    assert.equal(c[0].droit, 'none');
    assert.equal(c[1].droit, 'write');
  });

  test('chaque candidat porte de quoi contester son classement', () => {
    const c = candidats(TROIS, { entrees: ['diff'], sections: ['Le risque'] })[0];
    assert.deepEqual(c.entreesManquantes, []);
    assert.deepEqual(c.sectionsCouvertes, ['Le risque']);
    assert.equal(c.sectionsAttendues, 1);
  });

  test('sans besoin exprimé, tout le monde est candidat — on ne devine pas', () => {
    assert.equal(candidats(TROIS, {}).length, 3);
  });
});

/* ══ SUR LE REGISTRE RÉEL ═════════════════════════════════════════════════════ */

describe('le registre tel qu\'il est', () => {
  test('chaque artefact produit une fiche exploitable', () => {
    for (const f of FICHES) {
      assert.ok(f.id, 'un agent sans identifiant ne se route pas');
      assert.ok(MODES.includes(f.droit), `${f.id} : droit hors vocabulaire`);
      assert.ok(Array.isArray(f.entrees));
    }
  });

  test('l\'écrasante majorité des agents ne demande AUCUN droit', () => {
    /*
     * Ce n'est pas une statistique décorative : c'est ce qui rend le classement par
     * permissions minimales utile. Si tout le monde demandait l'écriture, ce critère ne
     * départagerait rien.
     */
    const sansDroit = FICHES.filter((f) => f.droit === 'none').length;
    assert.ok(sansDroit / FICHES.length > 0.8,
              `${sansDroit}/${FICHES.length} sans droit — le critère doit rester discriminant`);
  });

  test('aucune famille d\'empreinte identique ne dépasse deux membres', () => {
    /*
     * Ce test est un GARDE-FOU DE DÉRIVE, pas une vérité éternelle. Le jour où trois
     * agents partagent exactement matière, sections et droits, il faut aller regarder —
     * et c'est précisément ce qu'on veut apprendre avant d'avoir cinq cents agents.
     */
    const grosses = familles(FICHES).filter((g) => g.membres.length > 2);
    assert.deepEqual(grosses, [],
      `familles à surveiller :\n  ${grosses.map((g) => g.membres.join(' · ')).join('\n  ')}`);
  });
});
