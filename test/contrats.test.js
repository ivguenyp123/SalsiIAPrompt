/*
 * Les contrats de sortie — reproduire le rapport de la plateforme, pas l'imiter.
 *
 * L'étape qu'on avait sautée, et qui ne s'est vue qu'à l'usage : un agent bâti sur le
 * seul « besoin » invente son vocabulaire. Il rendait `deployment_frequency: "élevée"`
 * là où la plateforme calcule `df: 4.2 /sem → High`.
 *
 * Ce qui se vérifie ici : que le contrat EXTRAIT arrive intact jusqu'à la consigne et
 * jusqu'aux critères. S'il se dilue en chemin, l'agent recommence à inventer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { indexer, contratDe, sansContrat, consigneDeSortie, criteresDuContrat,
         reglesLisibles, provenance } from '../lib/contrats.js';
import { aplatir } from '../lib/inventaire.js';
import { morceauDepuisInventaire, assembler } from '../lib/assemblage.js';
import { lint, ERROR } from '../lint/index.js';
import { RESOLVABLES } from '../runtime/resolveurs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = join(ROOT, 'inventaire/contrats');

const CONTRATS = existsSync(DOSSIER)
  ? readdirSync(DOSSIER).filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => f !== 'index.yaml')
      .map((f) => yaml.load(readFileSync(join(DOSSIER, f), 'utf8')))
  : [];

const INDEX = indexer(CONTRATS);

/* Le manifeste — la seule liste écrite à la main du dossier, et donc à confronter. */
const MANIFESTE = yaml.load(readFileSync(join(DOSSIER, 'index.yaml'), 'utf8')).contrats || [];
const INVENTAIRE = aplatir(yaml.load(readFileSync(join(ROOT, 'inventaire/hub-devops.yaml'), 'utf8')));

/* ── Ce que les contrats doivent porter ───────────────────────────────────── */

describe('les contrats extraits', () => {
  test('il y en a au moins un, et il porte des champs', () => {
    assert.ok(CONTRATS.length > 0, 'aucun contrat extrait');
    for (const c of CONTRATS) {
      assert.ok(c.champs?.length, `${c.module} : aucun champ`);
    }
  });

  test('chaque contrat DIT D\'OÙ IL VIENT', () => {
    /*
     * Sans la source, un contrat devient une convention interne de plus — et le jour où
     * la plateforme change ses seuils, personne ne sait où aller vérifier.
     */
    for (const c of CONTRATS) {
      assert.ok(c.source, `${c.module} : pas de source`);
      assert.match(c.source, /\.(js|ts|html)$/, `${c.module} : la source doit être un fichier`);
    }
  });

  test('chaque champ a une clé et un libellé', () => {
    for (const c of CONTRATS) {
      for (const ch of c.champs) {
        assert.ok(ch.cle, `${c.module} : champ sans clé`);
        assert.ok(ch.libelle, `${c.module} : ${ch.cle} sans libellé`);
      }
    }
  });

  test('le manifeste liste exactement les fichiers présents', () => {
    /*
     * Un navigateur ne sait pas lister un dossier : l'écran lit ce manifeste. Une liste
     * écrite à la main dans un dépôt vivant se désynchronise — c'est une loi. On la traite
     * donc comme une déclaration à confronter, et l'oubli devient un test rouge plutôt
     * qu'un contrat muet que personne ne voit manquer.
     */
    const surDisque = readdirSync(DOSSIER)
      .filter((x) => /\.ya?ml$/.test(x) && x !== 'index.yaml').sort();
    assert.deepEqual([...MANIFESTE].sort(), surDisque);
  });

  test('chaque contrat vise un module QUI EXISTE à l\'inventaire', () => {
    // Un contrat pour un module inconnu ne servira jamais : c'est du code mort qui a
    // l'air d'une garantie.
    const modules = new Set(INVENTAIRE.map((p) => p.module));
    for (const c of CONTRATS) {
      assert.ok(modules.has(c.module), `« ${c.module} » n'est à l'inventaire d'aucune capacité`);
    }
  });
});

/* ── Le contrat DORA, celui qui a motivé tout ça ──────────────────────────── */

describe('DORA Insights', () => {
  const dora = INDEX.get('DORA Insights');

  test('vient de la page QUI PORTE CE NOM au hub', () => {
    /*
     * Le contrat a d'abord lu `js/dora-workspace.js` — la page « DORA Tribu », absente
     * du catalogue. `MODULE_URLS` dans `js/hub.js` donne la vraie correspondance :
     * 'DORA Insights' → 'insights.html' → `js/insights.js`. Les deux pages ne s'accordent
     * pas sur le Lead Time, donc se tromper de fichier changeait des seuils publiés.
     */
    assert.equal(dora.source, 'js/insights.js');
  });

  test('porte le score global ET les quatre métriques, dans l\'ordre du rapport', () => {
    assert.ok(dora, 'contrat DORA attendu');
    assert.deepEqual(dora.champs.map((c) => c.cle),
      ['score_global', 'df', 'lt', 'cfr', 'mttr']);
  });

  test('porte les unités et les seuils, pas seulement les noms', () => {
    // « Lead Time » sans « h » ni « ≤ 24 » laisse le modèle choisir son échelle, et deux
    // rapports cessent d'être comparables.
    for (const c of dora.champs) {
      assert.ok(c.unite, `${c.cle} sans unité`);
      assert.match(c.seuils, /Elite/, `${c.cle} sans seuils`);
    }
  });

  test('porte le CALCUL de chaque champ, pas seulement sa forme', () => {
    /*
     * Une forme sans calcul donne un rapport qui RESSEMBLE. « Lead time » sans « médiane »
     * laisse le modèle prendre la moyenne : deux chiffres défendables, aucun comparable.
     */
    for (const c of dora.champs) {
      assert.ok(c.methode, `${c.cle} : aucun calcul déclaré`);
    }
    assert.match(dora.champs.find((c) => c.cle === 'lt').methode, /MÉDIANE/);
  });

  test('dit sur QUOI il observe — fenêtre et périmètre', () => {
    // Le même dépôt sur 7 jours ou sur 90 ne rend pas le même chiffre.
    assert.match(dora.fenetre, /30 jours/);
    assert.match(dora.perimetre, /main/);
  });

  test('porte la PÉNALITÉ TTRS — le refus de conclure sans mesure', () => {
    /*
     * C'est la règle qui compte le plus, et elle n'est pas dans la forme : la plateforme
     * plafonne le score à 75 et interdit « Elite » quand le TTRS n'a pas pu être mesuré.
     * Exactement la loi du registre — on n'affiche pas comme un fait ce qu'on n'a pas
     * mesuré — écrite dans `renderGlobalScore()` bien avant nous.
     */
    const regles = reglesLisibles(dora);
    const penalite = regles.find((r) => /TTRS/.test(r));
    assert.ok(penalite, 'la pénalité TTRS doit être déclarée');
    assert.match(penalite, /75/);
    assert.match(penalite, /Elite/);
  });

  test('« N/A » est une valeur admise — l\'absence de mesure se dit', () => {
    // Écrire 0 à la place mentirait sur une mesure qui n'a pas eu lieu.
    assert.ok(dora.niveaux.includes('N/A'));
  });
});

/* ── Du contrat à la consigne ─────────────────────────────────────────────── */

describe('la consigne de sortie', () => {
  const texte = consigneDeSortie(INDEX.get('DORA Insights'));

  test('nomme les clés EXACTES', () => {
    for (const cle of ['score_global', 'df', 'lt', 'cfr', 'mttr']) {
      assert.ok(texte.includes(`"${cle}"`), `la consigne doit exiger "${cle}"`);
    }
  });

  test('transporte les seuils jusqu\'au modèle', () => {
    assert.match(texte, /Elite ≥ 7/);
    assert.match(texte, /Elite ≤ 5/);
  });

  test('transporte les CALCULS, pas seulement les seuils', () => {
    // Sans « médiane » ni « dédupliqués par commit », le modèle refait son propre calcul
    // et rend un chiffre qui a l'air juste sans être le même.
    assert.match(texte, /MÉDIANE/);
    assert.match(texte, /DÉDUPLIQUÉS PAR COMMIT/);
  });

  test('transporte la fenêtre et le périmètre', () => {
    assert.match(texte, /30 jours/);
    assert.match(texte, /branches de production/);
  });

  test('transporte les règles, APRÈS les champs qu\'elles plafonnent', () => {
    /*
     * Un plafond qui se lit avant le calcul qu'il plafonne ne veut rien dire. L'ordre
     * n'est pas cosmétique : c'est ce qui rend la consigne applicable en une lecture.
     */
    assert.match(texte, /PRIMENT sur le calcul/);
    assert.match(texte, /TTRS manquant/);
    assert.ok(texte.indexOf('TTRS manquant') > texte.indexOf('"mttr"'),
      'les règles doivent venir après les champs');
  });

  test('un contrat sans règles n\'invente pas de bloc de règles', () => {
    // Une section « ces règles priment » vide dirait qu'on a cherché et rien trouvé.
    // On n'a pas cherché : le module n'en avait pas.
    const nu = consigneDeSortie({ champs: [{ cle: 'a', libelle: 'A' }] });
    assert.ok(!/PRIMENT sur le calcul/.test(nu));
    assert.ok(!/Fenêtre d'observation/.test(nu));
  });

  test('interdit d\'écrire zéro à la place d\'une mesure absente', () => {
    assert.match(texte, /jamais zéro/);
    assert.match(texte, /"N\/A"/);
  });

  test('sans contrat, elle est vide — on n\'invente pas de forme', () => {
    assert.equal(consigneDeSortie(null), '');
    assert.equal(consigneDeSortie({ champs: [] }), '');
  });
});

/* ── Du contrat aux critères ──────────────────────────────────────────────── */

describe('les critères déduits', () => {
  const crit = criteresDuContrat(INDEX.get('DORA Insights'));

  test('vérifient les VRAIES clés, plus des clés devinées', () => {
    const keys = crit.find((c) => c.target === 'output.json_keys');
    assert.deepEqual(keys.value, ['score_global', 'df', 'lt', 'cfr', 'mttr']);
  });

  test('emploient `output.json_keys` et JAMAIS `output.sections`', () => {
    /*
     * L'erreur exacte qui a rendu l'agent DORA inexécutable : `output.sections` extrait
     * des titres Markdown, donc rend toujours [] sur du JSON. `L026` refuse désormais
     * cette combinaison — les critères déduits ne doivent pas la produire.
     */
    assert.ok(!crit.some((c) => c.target === 'output.sections'));
    assert.ok(crit.some((c) => c.target === 'output.json_keys'));
  });

  test('toutes les cibles sont résolvables', () => {
    for (const c of crit) {
      assert.ok(RESOLVABLES.includes(c.target), `${c.target} n'est pas résolvable`);
    }
  });

  test('sans contrat, aucun critère — on ne garantit pas ce qu\'on ignore', () => {
    assert.deepEqual(criteresDuContrat(null), []);
  });
});

/* ── Ce qu'on ne sait pas reproduire se dit ───────────────────────────────── */

describe('l\'absence de contrat', () => {
  test('se reconnaît, au lieu de se masquer', () => {
    const sans = INVENTAIRE.find((p) => sansContrat(p, INDEX));
    assert.ok(sans, 'toutes les capacités ont un contrat ? vérifier le test');
    assert.equal(contratDe(sans, INDEX), null);
  });

  test('une capacité qui REPRODUIT le rapport trouve son contrat', () => {
    const avec = INVENTAIRE.find((p) => p.id === 'reproduire-le-rapport-dora');
    assert.ok(avec, 'la capacité de reproduction attendue à l\'inventaire');
    assert.equal(contratDe(avec, INDEX).module, 'DORA Insights');
  });

  test('le MÊME module, une capacité qui ne reproduit pas : aucun contrat', () => {
    /*
     * Le défaut que la liaison par module cachait. « DORA Insights » porte six capacités
     * et une seule rend le rapport ; les cinq autres expliquent, diagnostiquent, rédigent.
     * Leur imposer le JSON du rapport donnait un agent qui passait ses critères en faisant
     * le mauvais métier — un contrôle qui dit oui à côté de la plaque est pire que pas de
     * contrôle. La nature de sortie DÉCLARÉE par l'auteur tranche : `texte` et `json`
     * n'ont rien à se dire.
     */
    const expliquer = INVENTAIRE.find((p) => p.id === 'expliquer-les-quatre-metriques-dora');
    assert.equal(expliquer.module, 'DORA Insights');
    assert.equal(expliquer.sortie, 'texte');
    assert.equal(contratDe(expliquer, INDEX), null);
  });

  test('chaque contrat extrait a AU MOINS une capacité qui le porte', () => {
    // Un contrat que plus aucune capacité ne réclame est du code mort déguisé en garantie.
    for (const c of CONTRATS) {
      const porteurs = INVENTAIRE.filter((p) => contratDe(p, INDEX) === c);
      assert.ok(porteurs.length, `« ${c.module} » : contrat extrait, aucune capacité ne le porte`);
    }
  });

  test('la provenance se dit, ou ne se dit pas du tout', () => {
    assert.match(provenance(INDEX.get('DORA Insights')), /insights\.js/);
    assert.equal(provenance(null), '');
  });
});

/* ── Le contrat arrive jusqu'à l'agent assemblé ───────────────────────────── */

describe('un agent assemblé depuis une capacité à contrat', () => {
  const capacite = INVENTAIRE.find((p) => p.id === 'reproduire-le-rapport-dora');
  const morceau = morceauDepuisInventaire(capacite, { contrat: INDEX.get('DORA Insights') });
  const agent = assembler([morceau], {
    titre: 'Rapport DORA', auteur: 'moi', scope: 'Plateforme',
    purpose: 'Reproduire le rapport DORA de la plateforme.',
    notFor: 'Ne pas utiliser pour arbitrer une évaluation individuelle.'
  });

  test('sa consigne exige les clés de la PLATEFORME', () => {
    for (const cle of ['df', 'lt', 'cfr', 'mttr']) {
      assert.ok(agent.spec.includes(`"${cle}"`), `la consigne doit exiger "${cle}"`);
    }
  });

  test('sa consigne porte les seuils, pas seulement les noms', () => {
    assert.match(agent.spec, /Elite ≥ 7/);
  });

  test('ses critères vérifient ces mêmes clés', () => {
    const keys = agent.criteria.find((c) => c.target === 'output.json_keys');
    assert.deepEqual(keys.value, ['score_global', 'df', 'lt', 'cfr', 'mttr']);
  });

  test('AUCUN critère `output.sections` — L026 refuserait l\'artefact', () => {
    /*
     * Le contrat impose du JSON. `CRITERE_PAR_SORTIE` pense en Markdown pour `liste` :
     * les laisser cohabiter reproduirait exactement le contrat impossible qui a rendu le
     * premier agent DORA inexécutable.
     */
    assert.ok(!agent.criteria.some((c) => c.target === 'output.sections'));
  });

  test('il franchit la porte', () => {
    const ctx = {
      tools: yaml.load(readFileSync(join(ROOT, 'registries/tools.yaml'), 'utf8')).tools,
      targets: yaml.load(readFileSync(join(ROOT, 'registries/targets.yaml'), 'utf8')).targets
    };
    const bloquants = lint(agent, ctx).findings.filter((f) => f.severity === ERROR);
    assert.deepEqual(bloquants.map((f) => f.code), [], JSON.stringify(bloquants, null, 2));
  });

  test('sans contrat, on retombe sur le besoin — et ça se voit', () => {
    // Une aide, pas une reproduction. Le dire est plus honnête que de faire semblant.
    const nu = assembler([morceauDepuisInventaire(capacite)], {
      titre: 'T', purpose: 'Un but assez long', notFor: 'Une limite assez longue' });
    assert.ok(!nu.spec.includes('"df"'));
    assert.ok(!nu.criteria.some((c) => c.target === 'output.json_keys'));
  });
});
