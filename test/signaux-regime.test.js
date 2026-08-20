import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { familleDe, analyseRegime, resumeRegime, FAMILLES, GRAVITES }
  from '../lib/signaux-regime.js';
import { SIGNAUX, sait, reglagesDe } from '../lib/signaux-matiere.js';

const M = new Date('2026-08-20T12:00:00Z');
const DEPOT = 'lcl/paiement';

const sur = (arbre, gitignore = '') => analyseRegime({
  depot: DEPOT, ref: 'main', arbre, gitignore, maintenant: M });

/* ══ LE CLASSEMENT, QUI DOIT ÊTRE LE MÊME POUR TOUT LE MONDE ══════════════════ */

describe('un chemin tombe dans une famille, et toujours la même', () => {
  test('les extensions les plus coûteuses sont reconnues', () => {
    assert.equal(familleDe('libs/app.jar').id, 'binaires');
    assert.equal(familleDe('archive/old.zip').id, 'archives');
    assert.equal(familleDe('demo/intro.mp4').id, 'medias');
    assert.equal(familleDe('dump/prod.sql').id, 'donnees');
    assert.equal(familleDe('var/app.log').id, 'journaux');
  });

  test('un dossier compte, à n\'importe quelle profondeur', () => {
    assert.equal(familleDe('node_modules/left-pad/index.js').id, 'dependances');
    assert.equal(familleDe('front/app/node_modules/x/y.js').id, 'dependances');
    assert.equal(familleDe('service/target/app-1.0/README').id, 'build');
    /*
     * `target/classes/A.class` est une SORTIE DE BUILD, pas un binaire livré — et la
     * distinction porte le geste : un `.gitignore` pour l'une, un dépôt d'artefacts pour
     * l'autre. L'ordre des familles tranche, et il est écrit une seule fois.
     */
    assert.equal(familleDe('service/target/classes/A.class').id, 'build');
    assert.equal(familleDe('libs/sdk.jar').id, 'binaires');
    assert.equal(familleDe('.idea/workspace.xml').id, 'poste');
  });

  test('un dossier ne matche que sur un SEGMENT entier', () => {
    /*
     * `node_modules` est un segment de chemin, pas une sous-chaîne. Sans cette règle,
     * `src/build-tools/index.js` tomberait dans « sorties de build » — et un rapport qui
     * classe du code source en déchet perd toute sa crédibilité d'un coup.
     */
    assert.equal(familleDe('src/build-tools/index.js'), null);
    assert.equal(familleDe('src/distribution/envoi.js'), null);
    assert.equal(familleDe('lib/binaire-parser.js'), null);
  });

  test('LE PIRE PASSE DEVANT : une clé sous un dossier de build reste une clé', () => {
    /*
     * L'ordre des familles est une décision, pas un hasard. Un `.pem` sous `build/` est
     * un secret avant d'être une sortie de build : le premier se révoque, le second
     * s'ignore. Les confondre ferait disparaître le seul constat urgent du rapport.
     */
    assert.equal(familleDe('build/certs/server.key').id, 'cles');
    assert.equal(familleDe('node_modules/pkg/test/fixture.pem').id, 'cles');
  });

  test('du code ordinaire n\'appartient à aucune famille', () => {
    for (const c of ['src/index.js', 'README.md', 'pom.xml', 'lib/paiement.py',
                     'jobs/deploy.yaml', 'Dockerfile']) {
      assert.equal(familleDe(c), null, `${c} ne doit pas être signalé`);
    }
  });

  test('chaque famille déclare une gravité du vocabulaire fermé, et un geste', () => {
    for (const f of FAMILLES) {
      assert.ok(GRAVITES.includes(f.gravite), `${f.id} : gravité hors vocabulaire`);
      assert.ok(f.geste && f.geste.length > 10, `${f.id} : un constat sans geste ne sert à rien`);
    }
  });
});

/* ══ LA MATIÈRE ═══════════════════════════════════════════════════════════════ */

describe('le régime dit ce qu\'il a compté, et surtout ce qu\'il n\'a pas mesuré', () => {
  const ARBRE = [
    'src/index.js', 'src/paiement.js', 'pom.xml', 'README.md',
    'libs/sdk.jar', 'libs/tools.jar', 'target/app.war',
    'node_modules/a/index.js', 'node_modules/b/index.js', 'node_modules/c/index.js',
    'certs/prod.pem', 'var/app.log', '.idea/workspace.xml'
  ];

  test('AUCUNE TAILLE n\'est annoncée, et l\'interdit est EN TÊTE', () => {
    /*
     * Le piège du genre. « Ce dépôt pèse 400 Mo » est la première phrase qu'un modèle
     * écrit devant un rapport de régime — et aucun octet n'a été lu. `listTree` rend des
     * chemins sur les deux forges ; l'interdit passe donc avant les chiffres, pas en note.
     */
    const r = sur(ARBRE);
    const tete = r.texte.slice(0, r.texte.indexOf('CE QUI N\'A RIEN À FAIRE'));
    assert.match(tete, /CE QUI N'A PAS ÉTÉ MESURÉ/);
    assert.match(tete, /AUCUNE TAILLE/);
    assert.match(tete, /Ne parle donc ni de Mo, ni de Go/);
    assert.ok(!/\d+\s?(Mo|Go|Ko|MB|GB)/.test(r.texte), 'aucune unité de taille nulle part');
  });

  test('les familles sortent par GRAVITÉ, la clé en tête', () => {
    const r = sur(ARBRE);
    assert.equal(r.familles[0].famille.id, 'cles',
                 'un fichier irréversible passe devant trois mille encombrants');
    assert.equal(r.familles[0].fichiers, 1);
    const ids = r.familles.map((f) => f.famille.id);
    assert.ok(ids.indexOf('cles') < ids.indexOf('dependances'));
    assert.ok(ids.indexOf('dependances') < ids.indexOf('journaux'),
              'lourd avant friction');
  });

  test('les comptes tiennent : superflus + propres = l\'arbre', () => {
    const r = sur(ARBRE);
    assert.equal(r.arbre, ARBRE.length);
    assert.equal(r.superflus + r.propres, r.arbre);
    assert.equal(r.propres, 4, 'src/index.js, src/paiement.js, pom.xml, README.md');
  });

  test('chaque famille est NOMMÉE avec des exemples, jamais un total nu', () => {
    const r = sur(ARBRE);
    assert.match(r.texte, /BLOQUANT.*Clés et certificats — 1 fichier\(s\)/);
    assert.match(r.texte, /certs\/prod\.pem/);
    assert.match(r.texte, /geste : à retirer ET à révoquer/);
  });

  test('un .gitignore absent est dit, et c\'est un constat', () => {
    assert.match(sur(ARBRE).texte, /LE \.gitignore : ABSENT/);
  });

  test('un .gitignore présent ne vaut pas absolution, et le texte l\'explique', () => {
    /*
     * Le piège que le hub ne relevait pas : un `.gitignore` correct n'enlève RIEN de ce
     * que git suit déjà. C'est le cas le plus fréquent — la règle a été ajoutée après. Un
     * modèle qui l'ignore conclut « c'est couvert » et ne propose jamais le `git rm --cached`
     * qui est le seul geste utile.
     */
    const r = sur(ARBRE, '# deps\nnode_modules/\ntarget/\n\n*.log\n');
    assert.match(r.texte, /présent, 3 règle\(s\)/);
    assert.match(r.texte, /n'enlève PAS ce que git suit déjà/);
  });

  test('rien trouvé ne veut pas dire propre, et le texte refuse le mot', () => {
    const r = sur(['src/a.js', 'README.md', 'pom.xml']);
    assert.equal(r.superflus, 0);
    assert.match(r.texte, /Ce n'est PAS « ce dépôt est propre »/);
    assert.match(r.texte, /échappe entièrement à ce relevé/);
  });

  test('ce qui n\'a pas été cherché est listé, parce que le relevé est un plancher', () => {
    const r = sur(ARBRE);
    assert.match(r.texte, /LES FAMILLES CHERCHÉES, ET RIEN D'AUTRE/);
    assert.match(r.texte, /Le relevé est un plancher, pas un verdict/);
    assert.match(r.texte, /ni le contenu, ni l'historique/i);
  });

  test('les zones disent OÙ ça se concentre', () => {
    const r = sur(ARBRE);
    assert.equal(r.zones[0].zone, 'node_modules');
    assert.equal(r.zones[0].fichiers, 3);
    assert.match(r.texte, /OÙ ÇA SE CONCENTRE/);
  });

  test('les exemples sont bornés, et le reste est COMPTÉ et non tu', () => {
    const gros = Array.from({ length: 20 }, (_, i) => `node_modules/p${i}/index.js`);
    const r = sur(gros);
    assert.match(r.texte, /\(\+14\)/, 'ce qui n\'est pas montré reste annoncé');
    assert.equal(r.familles[0].fichiers, 20);
  });

  test('le résumé dit la part, jamais un total rassurant', () => {
    const r = sur(ARBRE);
    assert.match(resumeRegime(r), /9\/13 fichier\(s\) de trop/);
    assert.match(resumeRegime(r), /1 clé\(s\) ou certificat\(s\)/);
    assert.match(resumeRegime(r), /pas de \.gitignore/);
  });
});

/* ══ LE SIGNAL EST DÉCLARÉ ════════════════════════════════════════════════════ */

describe('`regime_du_depot` est un signal de plein droit', () => {
  test('il est au registre, et sa branche est facultative', () => {
    assert.ok(sait('regime_du_depot'));
    const r = reglagesDe('regime_du_depot');
    assert.equal(r.length, 1);
    assert.equal(r[0].nom, 'branche');
    assert.equal(r[0].requis, false,
                 'sans branche choisie, la branche par défaut : ne rien choisir est une valeur');
  });

  test('il dit d\'où il vient — un signal sans provenance ne se conteste pas', () => {
    assert.equal(SIGNAUX.regime_du_depot.source, 'js/repo-diet.js');
  });
});
