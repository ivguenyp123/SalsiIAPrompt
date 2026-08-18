/*
 * Tests de l'exécuteur — ce qu'il faudrait pour qu'un isolement soit tenu.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. `non_verifiable` N'EST NI `applicable` NI `non_applicable`, et ne se lance pas. Si
 *    ce test tombe, la plateforme accorde un droit sur une ignorance — c'est la seule
 *    faille de ce fichier, les autres sont des défauts.
 * 2. Une preuve `par: attestation` sans attestation vaut INCONNU, jamais FAUX ni VRAI.
 * 3. Une attestation PÉRIME. Un runner se reconfigure.
 * 4. Le registre ne déclare plus `applicable` : le jour où quelqu'un le remet, ce test
 *    rougit.
 * 5. Sur le registre RÉEL et le dossier d'attestations RÉEL, les deux isolements
 *    conteneurisés sortent non vérifiables. C'est le fait du jour, pas une opinion.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { verdict, phrase, preuvesPlateforme, attestationValide, attestationsPar,
         tenable, APPLICABLE, NON_APPLICABLE, NON_VERIFIABLE,
         JOURS_ATTESTATION } from '../lib/executeur.js';
import yaml from '../lib/yaml.js';

const lireYaml = (p) => yaml.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const REGISTRE = lireYaml('../registries/isolements.yaml');
const ISOLEMENTS = REGISTRE.isolements;
const OUTILS = lireYaml('../registries/tools.yaml').tools;
const ATTESTATIONS = lireYaml('../attestations/index.yaml');

const par = (id) => ISOLEMENTS.find((i) => i.id === id);
const M = new Date('2026-08-18T12:00:00Z');
const ilYA = (j) => new Date(M.getTime() - j * 86400000).toISOString().slice(0, 10);

/* ── La troisième issue ───────────────────────────────────────────────────── */

describe('« non vérifiable » n\'est ni tenu ni non tenu', () => {
  test('SANS ATTESTATION, UN ISOLEMENT CONTENEURISÉ EST NON VÉRIFIABLE', () => {
    /*
     * Le test qui porte tout. Le collapser vers `applicable` accorderait un droit sur une
     * ignorance ; vers `non_applicable`, ça ferait croire qu'on a mesuré une absence.
     * Ni l'un ni l'autre — et ça ne se lance pas.
     */
    const v = verdict(par('conteneur-sans-reseau'), {
      etablies: preuvesPlateforme({ outils: OUTILS, ci: { 'salsi-isole': {
        image: 'debian@sha256:' + 'a'.repeat(64) } } })
    });
    assert.equal(v.issue, NON_VERIFIABLE);
    assert.equal(v.tenable, false);
  });

  test('SEUL `applicable` est lançable', () => {
    assert.equal(tenable(APPLICABLE), true);
    assert.equal(tenable(NON_VERIFIABLE), false);
    assert.equal(tenable(NON_APPLICABLE), false);
    // Et rien d'autre ne l'est, quoi qu'on passe.
    for (const x of ['', null, undefined, true, 'oui']) assert.equal(tenable(x), false);
  });

  test('une preuve FAUSSE l\'emporte sur une preuve inconnue', () => {
    // Sinon un isolement dont une preuve est démontrée fausse se présenterait comme
    // « on ne sait pas », ce qui est plus doux que la vérité.
    const v = verdict(par('conteneur-sans-reseau'), {
      etablies: preuvesPlateforme({ outils: OUTILS, ci: null })
    });
    assert.equal(v.issue, NON_APPLICABLE);
    assert.match(phrase(par('conteneur-sans-reseau'), v), /n'est PAS tenu/);
  });

  test('toutes les preuves établies : applicable', () => {
    const v = verdict(par('aucune-execution'), {
      etablies: preuvesPlateforme({ artefact: { tools: [] }, outils: OUTILS })
    });
    assert.equal(v.issue, APPLICABLE);
    assert.equal(v.tenable, true);
  });

  test('un isolement sans preuves déclarées est applicable — et c\'est cohérent', () => {
    // Rien à établir, rien qui manque. Le cas ne se présente pas au registre réel, mais
    // le module ne doit pas inventer une preuve qu'on ne lui a pas donnée.
    assert.equal(verdict({ id: 'x', titre: 'X' }).issue, APPLICABLE);
  });
});

/* ── Ce que la plateforme établit elle-même ───────────────────────────────── */

describe('les preuves que la plateforme lit', () => {
  test('un outil qui écrit rend `aucun_outil_write` FAUX, et le nomme', () => {
    const p = preuvesPlateforme({ artefact: { tools: [{ id: 'write_file' }] }, outils: OUTILS });
    assert.equal(p.get('aucun_outil_write').etabli, false);
    assert.match(p.get('aucun_outil_write').detail, /`write_file`/);
  });

  test('« on n\'a pas regardé » N\'EST PAS « il n\'y en a pas »', () => {
    /*
     * `ci: undefined` = la plateforme n'a pas lu le fichier de CI. `ci: null` = elle l'a
     * lu et il n'existe pas. La première rend INCONNU, la seconde rend FAUX. Les
     * confondre ferait déclarer « pas de CI » sur un dépôt qu'on n'a jamais interrogé.
     */
    assert.equal(preuvesPlateforme({ outils: OUTILS }).get('job_ci_declare').etabli, null);
    assert.equal(preuvesPlateforme({ outils: OUTILS, ci: null }).get('job_ci_declare').etabli,
      false);
  });

  test('UNE IMAGE PAR TAG NE VAUT PAS UNE IMAGE PAR DIGEST', () => {
    // Un tag se réécrit : ce qui tournerait demain n'est pas ce qui a été relu
    // aujourd'hui. C'est le même raisonnement que le pinning des dépendances.
    const tag = preuvesPlateforme({ outils: OUTILS, ci: { 'salsi-isole': { image: 'debian:12' } } });
    assert.equal(tag.get('job_ci_declare').etabli, false);
    assert.match(tag.get('job_ci_declare').detail, /Un tag se réécrit/);

    const dig = preuvesPlateforme({ outils: OUTILS,
      ci: { 'salsi-isole': { image: `debian@sha256:${'b'.repeat(64)}` } } });
    assert.equal(dig.get('job_ci_declare').etabli, true);
  });

  test('l\'image en forme longue est lue aussi', () => {
    const p = preuvesPlateforme({ outils: OUTILS,
      ci: { 'salsi-isole': { image: { name: `x@sha256:${'c'.repeat(64)}` } } } });
    assert.equal(p.get('job_ci_declare').etabli, true);
  });

  test('un fichier de CI sans le job attendu rend FAUX et dit lequel', () => {
    const p = preuvesPlateforme({ outils: OUTILS, ci: { build: {} }, jobIsole: 'salsi-isole' });
    assert.equal(p.get('job_ci_declare').etabli, false);
    assert.match(p.get('job_ci_declare').detail, /aucun job `salsi-isole`/);
  });
});

/* ── Les attestations ─────────────────────────────────────────────────────── */

describe('une attestation est un engagement, pas une mesure', () => {
  const bonne = { id: 'r', par: 'prenom.nom', le: ilYA(10), preuves: ['reseau_coupe'] };

  test('elle doit dire QUI s\'engage', () => {
    // Un fichier signé « l'équipe » n'a personne à qui parler le jour où le runner
    // s'avère mal configuré.
    assert.equal(attestationValide({ le: ilYA(1) }, M).valide, false);
    assert.match(attestationValide({ le: ilYA(1) }, M).raison, /qui s'engage/);
  });

  test('elle doit être datée', () => {
    assert.equal(attestationValide({ par: 'x' }, M).valide, false);
    assert.equal(attestationValide({ par: 'x', le: 'jamais' }, M).valide, false);
  });

  test('ELLE PÉRIME', () => {
    // Le même délai qu'une certification au banc, et pour la même raison : un runner se
    // reconfigure, et une attestation de l'an dernier décrit une machine disparue.
    assert.equal(attestationValide({ ...bonne, le: ilYA(JOURS_ATTESTATION) }, M).valide, true);
    const vieille = attestationValide({ ...bonne, le: ilYA(JOURS_ATTESTATION + 1) }, M);
    assert.equal(vieille.valide, false);
    assert.match(vieille.raison, /une machine qui n'existe peut-être plus/);
  });

  test('une attestation datée du futur est refusée', () => {
    assert.equal(attestationValide({ ...bonne, le: '2030-01-01' }, M).valide, false);
  });

  test('une attestation valide établit SA preuve, et elle seule', () => {
    const att = attestationsPar([bonne], M);
    const v = verdict(par('conteneur-sans-reseau'), {
      etablies: preuvesPlateforme({ outils: OUTILS,
        ci: { 'salsi-isole': { image: `d@sha256:${'e'.repeat(64)}` } } }),
      attestations: att
    });
    // `reseau_coupe` est couvert ; `executeur_jetable` ne l'est pas.
    assert.equal(v.preuves.find((p) => p.id === 'reseau_coupe').etabli, true);
    assert.equal(v.preuves.find((p) => p.id === 'executeur_jetable').etabli, null);
    assert.equal(v.issue, NON_VERIFIABLE);
  });

  test('TOUTES attestées et la CI lue : applicable, et la phrase NOMME l\'engagement', () => {
    /*
     * Le seul chemin vers `applicable` pour un conteneur. Et la phrase doit dire que deux
     * de ses preuves reposent sur une signature : une plateforme qui affiche « isolé »
     * sur la foi d'un engagement humain sans le nommer ment par omission.
     */
    const att = attestationsPar([{ id: 'r', par: 'prenom.nom', le: ilYA(3),
                                   preuves: ['reseau_coupe', 'executeur_jetable'] }], M);
    const iso = par('conteneur-sans-reseau');
    const v = verdict(iso, {
      etablies: preuvesPlateforme({ outils: OUTILS,
        ci: { 'salsi-isole': { image: `d@sha256:${'f'.repeat(64)}` } } }),
      attestations: att
    });
    assert.equal(v.issue, APPLICABLE);
    const t = phrase(iso, v);
    assert.match(t, /2 preuve\(s\) sur attestation de prenom\.nom/);
    assert.match(t, /un engagement humain, pas une mesure/);
  });

  test('une attestation PÉRIMÉE ne masque pas une fraîche sur la même preuve', () => {
    const att = attestationsPar([
      { id: 'vieille', par: 'a', le: ilYA(200), preuves: ['reseau_coupe'] },
      { id: 'fraiche', par: 'b', le: ilYA(2), preuves: ['reseau_coupe'] }
    ], M);
    assert.equal(att.get('reseau_coupe').valide, true);
    assert.equal(att.get('reseau_coupe').par, 'b');
  });

  test('une attestation périmée seule laisse la preuve INCONNUE, pas fausse', () => {
    // Elle a été vraie ; on ne sait plus. Pas la même chose que « c'est faux ».
    const att = attestationsPar([{ id: 'v', par: 'a', le: ilYA(200),
                                   preuves: ['reseau_coupe'] }], M);
    const v = verdict(par('conteneur-sans-reseau'), {
      etablies: preuvesPlateforme({ outils: OUTILS,
        ci: { 'salsi-isole': { image: `d@sha256:${'0'.repeat(64)}` } } }),
      attestations: att
    });
    assert.equal(v.preuves.find((p) => p.id === 'reseau_coupe').etabli, null);
    assert.equal(v.issue, NON_VERIFIABLE);
  });
});

/* ── Le registre réel ─────────────────────────────────────────────────────── */

describe('le registre des isolements, tel qu\'il est', () => {
  test('IL NE DÉCLARE PLUS `applicable` — c\'est calculé, pas écrit', () => {
    /*
     * Le jour où quelqu'un remet un booléen ici, ce test rougit. Un `applicable: true`
     * mal tapé accorderait un droit d'exécution d'un caractère, et rien d'autre ne
     * l'attraperait.
     */
    for (const i of ISOLEMENTS) {
      assert.equal(i.applicable, undefined,
        `${i.id} déclare \`applicable\` : l'applicabilité se CALCULE depuis les preuves`);
    }
  });

  test('chaque isolement déclare au moins une preuve, et chaque preuve son porteur', () => {
    for (const i of ISOLEMENTS) {
      assert.ok(i.preuves?.length, `${i.id} : aucune preuve déclarée`);
      for (const p of i.preuves) {
        assert.ok(['plateforme', 'attestation'].includes(p.par), `${i.id}/${p.id} : \`par\``);
        assert.ok(p.quoi?.length > 20, `${i.id}/${p.id} : \`quoi\``);
        // Une preuve non lisible doit dire POURQUOI. Sans ça, « non vérifiable » se lit
        // comme une paresse au lieu d'une limite.
        if (p.par === 'attestation') {
          assert.ok(p.pourquoi_pas_lisible?.length > 30,
            `${i.id}/${p.id} : une preuve attestée doit dire pourquoi elle n'est pas lisible`);
        }
      }
    }
  });

  test('AUCUNE ATTESTATION N\'EXISTE — et c\'est le fait du jour, pas une opinion', () => {
    assert.deepEqual(ATTESTATIONS.attestations, []);
  });

  test('donc les deux formes conteneurisées ne sont PAS tenues aujourd\'hui', () => {
    const att = attestationsPar(ATTESTATIONS.attestations, M);
    for (const id of ['conteneur-sans-reseau', 'conteneur-avec-reseau']) {
      const v = verdict(par(id), { etablies: preuvesPlateforme({ outils: OUTILS }), attestations: att });
      assert.equal(v.tenable, false, id);
      assert.match(phrase(par(id), v), /NON VÉRIFIABLE|n'est PAS tenu/);
    }
  });

  test('la phrase nomme QUI pourrait fournir ce qui manque', () => {
    // « Non vérifiable » tout seul se lit comme une panne. Nommer l'administrateur des
    // runners en fait une action.
    const v = verdict(par('conteneur-sans-reseau'), {
      etablies: preuvesPlateforme({ outils: OUTILS,
        ci: { 'salsi-isole': { image: `d@sha256:${'1'.repeat(64)}` } } })
    });
    assert.match(phrase(par('conteneur-sans-reseau'), v), /qui administre les runners/);
    assert.match(phrase(par('conteneur-sans-reseau'), v), /Ce qu'on ne sait pas ne se lance pas/);
  });

  test('les trois isolements non conteneurisés sont tenus par la plateforme SEULE', () => {
    // Aucun d'eux ne doit dépendre d'une attestation : ce sont ceux qui décrivent ce que
    // la plateforme fait déjà, et ils doivent tenir sans que personne ne signe.
    for (const id of ['aucune-execution', 'lecture-seule', 'ecriture-confirmee']) {
      assert.ok(par(id).preuves.every((p) => p.par === 'plateforme'), id);
    }
  });
});
