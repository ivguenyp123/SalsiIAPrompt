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
import { niveauDeRisque, medianePonderee, MINI_COMMITS_ZONE, MAX_ZONES,
         MAX_CONTRIBUTEURS } from '../lib/signaux-matiere.js';

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

  test('chaque contrat porte le CALCUL de chacun de ses champs', () => {
    /*
     * La leçon des quatre contrats suivants. Le premier n'avait que des clés, des unités
     * et des seuils — une forme. Un agent bâti dessus rendait bien `avgReviewTime`, et le
     * calculait en MÉDIANE là où « Auto Retro » prend une MOYENNE. Même clé, même unité,
     * autre chiffre : le rapport ressemblait sans reproduire.
     *
     * Un champ sans calcul déclaré rend donc le contrat incomplet, quel que soit le module.
     */
    for (const c of CONTRATS) {
      for (const ch of c.champs) {
        assert.ok(ch.methode, `${c.module} : « ${ch.cle} » sans calcul déclaré`);
      }
    }
  });

  test('chaque contrat dit sur QUOI il observe', () => {
    // Le même dépôt sur 7 jours ou sur 30 ne rend pas le même chiffre, et « les 200
    // derniers commits » n'est pas une durée du tout.
    for (const c of CONTRATS) {
      assert.ok(c.fenetre, `${c.module} : aucune fenêtre d'observation`);
      assert.ok(c.perimetre, `${c.module} : aucun périmètre`);
    }
  });

  test('le calcul arrive INTACT jusqu\'à la consigne, pour les cinq', () => {
    // Un contrat riche qui se dilue en chemin ne vaut pas mieux qu'un contrat pauvre.
    for (const c of CONTRATS) {
      const texte = consigneDeSortie(c);
      for (const ch of c.champs) {
        assert.ok(texte.includes(ch.methode.slice(0, 40)),
          `${c.module} : le calcul de « ${ch.cle} » n'arrive pas jusqu'à la consigne`);
      }
      assert.ok(texte.includes(c.fenetre.slice(0, 30)), `${c.module} : fenêtre perdue`);
      assert.ok(texte.includes(c.perimetre.slice(0, 30)), `${c.module} : périmètre perdu`);
    }
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

/* ── Les quatre autres rapports ───────────────────────────────────────────── */

describe('Bus Factor', () => {
  const bf = INDEX.get('Bus Factor');
  const texte = consigneDeSortie(bf);

  test('exige la MÉDIANE PONDÉRÉE, la seule chose qui change le verdict', () => {
    /*
     * Le code de la plateforme donne lui-même le contre-exemple : un module critique
     * (facteur 1) et neuf modules sains (facteur 5) donnaient 4.6/5 en moyenne — « RISQUE
     * FAIBLE » — alors que le module critique pouvait être le cœur du projet. Un agent qui
     * ferait la moyenne rendrait précisément le chiffre rassurant qu'elle a cessé de rendre.
     */
    assert.match(texte, /MÉDIANE PONDÉRÉE/);
    assert.match(texte, /jamais moyenne/);
  });

  test('un champ à forme libre échappe au moule `{ valeur, niveau }`', () => {
    // `zones` est une liste d'objets. Lui imposer la clôture obligerait le modèle à
    // emballer une liste dans un « niveau » qui n'existe pas.
    assert.ok(bf.champs.find((c) => c.cle === 'zones').forme);
    assert.match(texte, /forme   :/);
    assert.match(texte, /suivent la leur/);
  });
});

describe('Daily Report', () => {
  const dr = INDEX.get('Daily Report');
  const texte = consigneDeSortie(dr);

  test('porte le Health Score, le chiffre de tête que la forme seule perdait', () => {
    // Il ouvre le résumé. Absent du contrat, un agent le remplaçait par sa propre
    // appréciation — un nombre sur 100 qui ressemblait à une mesure sans en être une.
    assert.ok(dr.champs.some((c) => c.cle === 'health_score'));
    assert.match(texte, /On part de 100 et on RETIRE/);
  });

  test('ne réclame AUCUN niveau — la plateforme ne classe pas ces chiffres', () => {
    /*
     * Généralisation abusive tirée du premier contrat : la clôture exigeait partout
     * `{ valeur, niveau }`. Ici la plateforme n'en calcule aucun, et le réclamer revient à
     * demander au modèle d'inventer un classement.
     */
    assert.ok(!dr.niveaux);
    assert.match(texte, /un nombre nu, sans enrobage/);
    assert.ok(!/"niveau": "<niveau>"/.test(texte));
  });
});

describe('DevOps Assessment', () => {
  const da = INDEX.get('DevOps Assessment');
  const texte = consigneDeSortie(da);

  test('rend un axe en TROIS chiffres — déclaré, mesuré, final', () => {
    /*
     * Ce que la première lecture avait perdu, et c'est tout le module : l'écart entre ce
     * que l'équipe déclare et ce que le dépôt montre. Réduire un axe à son score final
     * efface exactement ce que le rapport sert à voir.
     */
    for (const cle of ['delivery', 'quality', 'stability']) {
      assert.match(da.champs.find((c) => c.cle === cle).forme, /declaratif.*mesure.*final/);
    }
    assert.match(texte, /déclaré et le mesuré/);
  });

  test('distingue l\'axe purement déclaré de l\'axe purement mesuré', () => {
    // Culture : 10 questions, aucune métrique. Sécurité : 5 métriques, aucune question.
    // Les confondre ferait passer une déclaration pour une mesure.
    assert.match(da.champs.find((c) => c.cle === 'culture').forme, /"mesure": null/);
    assert.match(da.champs.find((c) => c.cle === 'security').forme, /"declaratif": null/);
  });

  test('les niveaux ont leurs NOMS, pas seulement des numéros', () => {
    assert.deepEqual(da.niveaux,
      ['Initial', 'En Progrès', 'Formalisé', 'Sous Contrôle', 'Optimisé']);
  });

  test('ne parle pas de « niveau de chaque champ » quand huit n\'en ont pas', () => {
    assert.match(texte, /des champs qui en portent un/);
  });
});

describe('deux modules, deux façons de dire l\'absence', () => {
  test('« Auto Retro » écrit 0 là où « DORA Insights » écrit N/A — et on ne lisse pas', () => {
    /*
     * Un désaccord RÉEL entre deux modules du même hub. La tentation est de l'harmoniser
     * ici, puisque la règle du registre est « jamais zéro » : ce serait faire diverger
     * l'agent du rapport qu'il reproduit, c'est-à-dire manquer le but.
     *
     * Le contrat porte donc la convention de SON module, et le désaccord est consigné
     * plutôt que corrigé en douce.
     */
    const retro = consigneDeSortie(INDEX.get('Auto Retro'));
    const dora = consigneDeSortie(INDEX.get('DORA Insights'));
    assert.match(retro, /`pipelineSuccess` vaut 0/);
    assert.match(dora, /jamais zéro/);
  });

  test('sans convention déclarée, c\'est la règle du registre qui tient', () => {
    const nu = consigneDeSortie({ champs: [{ cle: 'a', libelle: 'A' }] });
    assert.match(nu, /jamais zéro/);
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

  test('aucun contrat ne s\'impose plus à une capacité, et c\'est le but', () => {
    /*
     * ── LE CONTRAT A CHANGÉ DE RÔLE ──────────────────────────────────────────
     *
     * Il a d'abord servi à faire REPRODUIRE un rapport par un modèle. C'était l'erreur :
     * un modèle sans données invente des données, et la porte disait « contrat satisfait »
     * sur `"élevée"`. Les cinq capacités « reproduire… » qui portaient ces contrats ont été
     * retirées de l'inventaire.
     *
     * Ce que les contrats sont vraiment : le CAHIER DES CHARGES des calculs déterministes.
     * `bus-factor.yaml` a servi à écrire `lib/signaux-matiere.js` — médiane pondérée,
     * plafond à 5, seuil des 80 %. C'est de la spécification, pas de la consigne.
     *
     * Aucune capacité ne déclare plus `sortie: json` sur ces modules : rien ne se lie, et
     * c'est exactement ce qu'on veut. Le jour où quelqu'un en recréerait une, ce test
     * rougirait — et ce serait la bonne alerte.
     */
    const lies = INVENTAIRE.filter((p) => contratDe(p, INDEX));
    assert.deepEqual(lies.map((p) => p.id), [],
      'une capacité se lie encore à un contrat de sortie : est-ce voulu ?');
  });

  test('la provenance se dit, ou ne se dit pas du tout', () => {
    assert.match(provenance(INDEX.get('DORA Insights')), /insights\.js/);
    assert.equal(provenance(null), '');
  });
});

/* ── Le contrat comme CAHIER DES CHARGES d'un calcul ──────────────────────── */

describe('le contrat « Bus Factor » et le calcul qui en est sorti', () => {
  /*
   * La confrontation qui compte désormais. `lib/signaux-matiere.js` a été écrit D'APRÈS
   * ce contrat : si l'un des deux bouge sans l'autre, le calcul cesse de reproduire ce
   * qu'on a lu dans le hub — sans que rien ne le signale.
   */
  const bf = INDEX.get('Bus Factor');
  const texte = JSON.stringify(bf);

  test('les paliers de risque du contrat sont ceux du calcul', () => {
    assert.match(texte, /RISQUE CRITIQUE < 2/);
    assert.equal(niveauDeRisque(1.9), 'RISQUE CRITIQUE');
    assert.equal(niveauDeRisque(2), 'RISQUE MOYEN');
    assert.equal(niveauDeRisque(3), 'RISQUE FAIBLE');
  });

  test('le seuil des 5 commits par zone est le même des deux côtés', () => {
    assert.match(texte, /AU MOINS 5 COMMITS/);
    assert.equal(MINI_COMMITS_ZONE, 5);
  });

  test('les 10 zones et les 3 contributeurs affichés sont ceux du contrat', () => {
    assert.match(texte, /les 10 premières/);
    assert.match(texte, /au plus 3 contributeurs/);
    assert.equal(MAX_ZONES, 10);
    assert.equal(MAX_CONTRIBUTEURS, 3);
  });

  test('la médiane est PONDÉRÉE dans le contrat comme dans le code', () => {
    assert.match(texte, /MÉDIANE PONDÉRÉE/);
    // Le contre-exemple du hub : la moyenne dirait 4,6 et « RISQUE FAIBLE ».
    assert.equal(medianePonderee([{ valeur: 1, poids: 500 }, { valeur: 5, poids: 100 }]), 1);
  });
});
