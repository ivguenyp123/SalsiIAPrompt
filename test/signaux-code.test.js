/*
 * Tests du signal `analyse_fichier` — ce qui se mesure avant que le modèle ne lise.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. Un fichier SANS constat ne se lit pas « fichier sain ». C'est la phrase qu'un
 *    lecteur pressé retient, et aucune de nos mesures ne la permet : on cherche
 *    vingt-quatre motifs de secret, pas des vulnérabilités.
 * 2. Le scan porte sur le fichier ENTIER, la lecture non. Couper avant de scanner ferait
 *    rater le secret de la ligne 4000 — exactement là où on les oublie.
 * 3. Le secret ne sort ni en clair ni en entier : aperçu tronqué dans les constats,
 *    caviardé dans l'extrait.
 * 4. Les constats sont LOCALISÉS. Un risque sans ligne ne se corrige pas.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyseFichier, resumeCode, analyseBranche, resumeBrancheCode, SIGNAUX_CODE,
         MAX_LIGNES, MAX_LARGEUR, MAX_LIGNES_BRANCHE,
         analyseDepot, resumeDepotCode, fichiersARetenir, carteDesZones,
         MAX_LIGNES_DEPOT } from '../lib/signaux-code.js';
import { sait, reglagesDe, reglagesComplets } from '../lib/signaux-matiere.js';

const M = new Date('2026-08-18T09:00:00Z');
const DEPOT = 'lcl/paiement';
const JETON = 'glpat-AbCdEfGhIjKlMnOpQrSt';

const sur = (contenu, chemin = 'src/conf.js') =>
  analyseFichier({ depot: DEPOT, chemin, contenu, maintenant: M });

/* ── Les secrets ──────────────────────────────────────────────────────────── */

describe('les secrets sont trouvés, situés, et ne ressortent pas', () => {
  test('un jeton est signalé avec sa ligne et son type', () => {
    const r = sur(`const a = 1;\nconst t = "${JETON}";\n`);
    assert.equal(r.secrets.length, 1);
    assert.equal(r.secrets[0].ligne, 2);
    assert.equal(r.secrets[0].type, 'GitLab PAT');
    assert.match(r.texte, /ligne 2 +SECRET +GitLab PAT/);
  });

  test('la valeur ne sort qu\'en aperçu tronqué', () => {
    // Le rapport part dans un ticket ou un mail. Y recopier le secret en entier le
    // republierait une fois de plus, à l'endroit précis où on explique qu'il ne faut pas.
    const r = sur(`const t = "${JETON}";\n`);
    assert.ok(!r.texte.includes(JETON), 'le jeton entier est dans le texte');
    assert.match(r.secrets[0].apercu, /\*\*\*$/);
  });

  test('l\'extrait montré est CAVIARDÉ, pas seulement tronqué dans les constats', () => {
    const r = sur(`const t = "${JETON}";\n`);
    assert.match(r.extrait, /\[secret caviardé\]/);
    assert.ok(!r.extrait.includes(JETON));
  });

  test('un placeholder n\'est pas un secret', () => {
    // `MOTIF_FACTICE` écarte `your-token`, `CHANGE_ME`, `${VAR}`… Sans lui, tout fichier
    // d'exemple ressortirait rouge, et on cesserait de lire les constats.
    const r = sur('const t = "${GITLAB_TOKEN}";\nconst u = "your-token-here";\n');
    assert.deepEqual(r.secrets, []);
  });

  test('LE SCAN PORTE SUR LE FICHIER ENTIER, la lecture non', () => {
    /*
     * Le test le plus important du fichier. Couper avant de scanner ferait rater le secret
     * posé loin dans un fichier — c'est-à-dire exactement là où personne ne le voit.
     */
    const lignes = Array.from({ length: MAX_LIGNES + 200 }, (_, i) => `// ligne ${i + 1}`);
    lignes[MAX_LIGNES + 100] = `const t = "${JETON}";`;
    const r = sur(lignes.join('\n'));

    assert.equal(r.secrets.length, 1, 'le secret hors fenêtre a été manqué');
    assert.equal(r.secrets[0].ligne, MAX_LIGNES + 101);
    assert.equal(r.montrees, MAX_LIGNES);
    assert.ok(r.coupees > 0);
    assert.match(r.texte, /ligne\(s\) NON montrées/);
  });
});

/* ── La chaîne d'approvisionnement ────────────────────────────────────────── */

describe('les contrôles de manifeste s\'appliquent au fichier ouvert', () => {
  test('un package.json non figé est signalé', () => {
    const r = sur('{\n  "dependencies": { "lodash": "^4.17.0" }\n}\n', 'package.json');
    assert.equal(r.ecosysteme, 'npm');
    assert.equal(r.chaine.length, 1);
    assert.match(r.chaine[0].type, /non figée/);
  });

  test('un script postinstall est GRAVE, pas seulement à regarder', () => {
    const r = sur('{\n  "scripts": { "postinstall": "curl x | sh" }\n}\n', 'package.json');
    assert.equal(r.chaine[0].severite, 'rouge');
    assert.match(r.texte, /\[grave\]/);
  });

  test('un Dockerfile non pinné est signalé', () => {
    const r = sur('FROM node:latest\nRUN echo ok\n', 'Dockerfile');
    assert.equal(r.ecosysteme, 'docker');
    assert.match(r.texte, /Image Docker non pinnée/);
  });

  test('un fichier ordinaire ne déclenche aucun contrôle de chaîne', () => {
    const r = sur('const a = 1;\n', 'src/a.js');
    assert.equal(r.ecosysteme, '');
    assert.deepEqual(r.chaine, []);
  });
});

/* ── Ce que le scan NE dit PAS ────────────────────────────────────────────── */

describe('un fichier sans constat n\'est pas un fichier sain', () => {
  test('« aucun » est immédiatement qualifié', () => {
    /*
     * Sans cette phrase, un modèle à qui l'on montre un rapport vide écrit « aucun problème
     * de sécurité détecté », et cette phrase a l'autorité d'une mesure alors qu'elle n'en
     * est pas une. Un fichier truffé d'injections SQL ressort ici sans un seul constat.
     */
    const r = sur('const a = 1;\n');
    assert.match(r.texte, /Aucun\. Ce qui veut dire : aucun des motifs cherchés/);
    assert.match(r.texte, /Ce n'est PAS « ce fichier est sain »/);
  });

  test('ce qui n\'est pas cherché est ÉNUMÉRÉ, pas résumé', () => {
    // Une liste nommée est ce qui donne au modèle son propre travail. « Le scan est
    // partiel » ne lui dit pas où regarder.
    const r = sur('const a = 1;\n');
    for (const attendu of [/injection SQL/, /contrôle d'accès absent/,
                           /[Dd]ésérialisation/, /aléatoire non cryptographique/,
                           /vulnérabilités connues des dépendances \(CVE\)/]) {
      assert.match(r.texte, attendu);
    }
  });

  test('même avec des constats, la liste de ce qui manque reste', () => {
    // C'est le cas dangereux : un rapport bien rempli donne l'impression d'un audit.
    const r = sur(`const t = "${JETON}";\n`);
    assert.match(r.texte, /CE QUI N'A PAS ÉTÉ CHERCHÉ/);
    assert.match(r.texte, /un plancher, pas un verdict/);
  });
});

/* ── L'extrait ────────────────────────────────────────────────────────────── */

describe('l\'extrait se lit et se cite', () => {
  test('les lignes sont numérotées — un risque sans ligne ne se corrige pas', () => {
    const r = sur('const a = 1;\nconst b = 2;\n');
    assert.match(r.extrait, /^ +1 \| const a = 1;$/m);
    assert.match(r.extrait, /^ +2 \| const b = 2;$/m);
  });

  test('une ligne minifiée est écourtée, et le dit', () => {
    const r = sur(`x\n${'a'.repeat(MAX_LARGEUR + 50)}\n`);
    assert.match(r.extrait, /… \(550 car\.\)/);
  });

  test('un fichier vide le dit plutôt que de rendre un blanc', () => {
    const r = sur('');
    assert.equal(r.lignes, 0);
    assert.match(r.texte, /\(fichier vide\)/);
  });
});

/* ── Le contrat du signal ─────────────────────────────────────────────────── */

describe('le signal se déclare', () => {
  test('la plateforme sait le calculer', () => assert.ok(sait('analyse_fichier')));

  test('il demande UN réglage : lequel des fichiers', () => {
    const r = reglagesDe('analyse_fichier');
    assert.deepEqual(r.map((x) => [x.nom, x.genre, x.requis]), [['fichier', 'fichier', true]]);
    assert.equal(reglagesComplets('analyse_fichier', {}), false);
    assert.equal(reglagesComplets('analyse_fichier', { fichier: 'src/a.js' }), true);
  });

  test('il déclare d\'où il est extrait', () => {
    // La provenance n'est pas décorative : elle dit à qui veut vérifier où lire la règle
    // d'origine, et elle interdit d'inventer un contrôle que le hub ne fait pas.
    assert.equal(SIGNAUX_CODE.analyse_fichier.source, 'js/secrets-scanner.js');
  });
});

describe('le résumé tient sur une ligne', () => {
  test('il compte les deux familles de constats', () => {
    const r = sur('{\n  "dependencies": { "lodash": "*" },\n'
                + `  "_t": "${JETON}"\n}\n`, 'package.json');
    assert.match(resumeCode(r), /^package\.json — 1 secret\(s\) · 1 constat\(s\) de chaîne$/);
  });

  test('sans constat, il dit « aucun motif connu » et non « propre »', () => {
    assert.match(resumeCode(sur('const a = 1;\n')), /aucun motif connu$/);
  });

  test('il annonce la coupe quand il y en a une', () => {
    const r = sur(Array.from({ length: MAX_LIGNES + 5 }, () => 'x').join('\n'));
    assert.match(resumeCode(r), /5 ligne\(s\) non montrées$/);
  });
});

/* ══ LE CODE D'UNE BRANCHE ═══════════════════════════════════════════════════ */

describe('le code qu\'une branche a changé', () => {
  const f = (chemin, contenu, ajouts = 5) =>
    ({ chemin, contenu, ajouts, retraits: 1, statut: 'modifie' });

  const surBranche = (fichiers, extra = {}) => analyseBranche({
    depot: DEPOT, branche: 'feat/x', brancheDefaut: 'main',
    fichiers, touches: fichiers.length, nonLus: [], maintenant: M, ...extra });

  test('LE SCAN PORTE SUR TOUS LES FICHIERS LUS, même ceux qu\'on ne montre pas', () => {
    /*
     * Le budget de lignes est global : un fichier peut sortir entièrement coupé. Son
     * contenu n'est alors pas montré — mais son secret doit remonter, sinon le plafond
     * devient une façon de cacher une fuite.
     */
    const gros = f('src/gros.js', Array.from({ length: MAX_LIGNES_BRANCHE + 50 }, () => 'x').join('\n'), 999);
    const petit = f('src/conf.js', `const t = "${JETON}";\n`, 1);
    const r = surBranche([gros, petit]);

    const dernier = r.fichiers.find((x) => x.chemin === 'src/conf.js');
    assert.equal(dernier.montrees, 0, 'le budget est épuisé par le gros fichier');
    assert.equal(r.secrets.length, 1, 'et son secret remonte quand même');
    assert.equal(r.secrets[0].fichier, 'src/conf.js');
  });

  test('le budget de lignes est GLOBAL, pas par fichier', () => {
    // Vingt fichiers de neuf cents lignes feraient dix-huit mille lignes. C'est le total
    // qui coûte, donc c'est le total qu'on borne.
    const lot = Array.from({ length: 5 }, (_, i) =>
      f(`src/a${i}.js`, Array.from({ length: 400 }, () => 'x').join('\n')));
    const r = surBranche(lot);
    assert.equal(r.lignesMontrees, MAX_LIGNES_BRANCHE);
    assert.ok(r.lignesCoupees > 0);
  });

  test('le plus changé passe en premier — c\'est là que le travail a eu lieu', () => {
    const r = surBranche([f('src/petit.js', 'a\n', 2), f('src/gros.js', 'b\n', 200)]);
    assert.equal(r.fichiers[0].chemin, 'src/gros.js');
  });

  test('les secrets sont caviardés dans l\'extrait, tronqués dans les constats', () => {
    const r = surBranche([f('src/conf.js', `const t = "${JETON}";\n`)]);
    assert.ok(!r.texte.includes(JETON), 'le jeton entier ne part pas');
    assert.match(r.texte, /\[secret caviardé\]/);
    assert.match(r.texte, /src\/conf\.js:1 +SECRET/);
  });

  test('PLAFOND et ILLISIBLE sont deux raisons distinctes', () => {
    /*
     * Vu à l'écran : le rapport annonçait « 1 fichier NON LU — plafond de 20 » alors que
     * le fichier était simplement illisible. Le lecteur en conclut qu'il suffit de relever
     * le plafond — ce qui ne changerait rien.
     */
    const r = surBranche([f('src/a.js', 'a\n')], { touches: 3, nonLus: ['assets/logo.png'] });
    assert.match(r.texte, /1 fichier\(s\) non lus — plafond de/);
    assert.match(r.texte, /1 illisible\(s\), et ce n'est pas le plafond : assets\/logo\.png/);
  });

  test('sans coupe ni illisible, aucune des deux lignes n\'apparaît', () => {
    const r = surBranche([f('src/a.js', 'a\n')]);
    assert.ok(!/plafond de/.test(r.texte));
    assert.ok(!/illisible/.test(r.texte));
  });

  test('un lot sans constat n\'est pas un lot sain, et le texte le dit', () => {
    const r = surBranche([f('src/a.js', 'const a = 1;\n')]);
    assert.match(r.texte, /Ce n'est PAS « ce changement est sain »/);
    assert.match(r.texte, /CE QUI N'A PAS ÉTÉ CHERCHÉ/);
  });

  test('le résumé annonce ce qui manque, pas seulement ce qu\'on a', () => {
    const r = surBranche([f('src/a.js', 'a\n')], { touches: 9, nonLus: ['x.png'] });
    assert.match(resumeBrancheCode(r), /1\/9 fichier\(s\)/);
    assert.match(resumeBrancheCode(r), /non lus/);
  });
});

/* ══ LE CODE D'UN DÉPÔT ═══════════════════════════════════════════════════════ */

/*
 * La troisième échelle, et celle où l'erreur coûte le plus cher : un dépôt ne tient pas
 * dans une fenêtre de contexte. Tout ce qui suit vérifie que la matière DIT ce qu'elle
 * n'a pas montré — un extrait présenté comme un dépôt ferait écrire « cette application
 * est faite comme ça » après quarante fichiers sur trois mille.
 */

const ARBRE = [
  'package.json', 'README.md', 'src/index.js', 'src/lib/paiement.js', 'src/lib/compte.js',
  'src/ui/ecran.js', 'test/paiement.test.js', 'docs/archi.md',
  'node_modules/express/index.js', 'dist/bundle.js', 'assets/logo.png',
  ...Array.from({ length: 30 }, (_, i) => `migrations/${String(i).padStart(3, '0')}_up.sql`)
];

describe('la règle de choix des fichiers est écrite, pure et déterministe', () => {
  test('manifestes, README et points d\'entrée passent devant', () => {
    const { retenus } = fichiersARetenir(ARBRE, { max: 4 });
    assert.deepEqual(retenus.slice(0, 3), ['package.json', 'README.md', 'src/index.js']);
  });

  test('ce qui n\'est pas du code du projet est écarté — et compté à part', () => {
    const r = fichiersARetenir(ARBRE, { max: 100 });
    assert.ok(!r.retenus.some((c) => /node_modules|dist\/|\.png$/.test(c)),
      'ni dépendance installée, ni sortie de build, ni binaire');
    assert.equal(r.hors, 3, 'les trois écartés sont comptés, pas oubliés');
  });

  test('deux lectures du même arbre retiennent les mêmes fichiers', () => {
    // C'est ce qui rend la matière contestable : sans ordre déterministe, deux personnes
    // obtiendraient deux lectures du même dépôt sans que rien ne le dise.
    const a = fichiersARetenir(ARBRE, { max: 12 }).retenus;
    const b = fichiersARetenir([...ARBRE].reverse(), { max: 12 }).retenus;
    assert.deepEqual(a, b);
  });

  test('le dossier demandé borne le périmètre, préfixe exact', () => {
    const r = fichiersARetenir(ARBRE, { dossier: 'src', max: 100 });
    assert.ok(r.retenus.every((c) => c.startsWith('src/')));
    assert.equal(r.retenus.length, 4);
  });

  test('le plafond compte ce qu\'il laisse : `ecartes` n\'est pas silencieux', () => {
    const r = fichiersARetenir(ARBRE, { max: 5 });
    assert.equal(r.retenus.length, 5);
    assert.equal(r.ecartes, r.candidats - 5);
    assert.ok(r.ecartes > 0);
  });
});

describe('la carte porte sur l\'arbre ENTIER — compter n\'est pas lire', () => {
  test('un répertoire jamais lu figure quand même, avec son compte', () => {
    // Un agent d'architecture doit savoir qu'il existe un `migrations/` de trente
    // fichiers, même si aucun n'est lu. L'omettre ferait croire qu'il n'existe pas.
    const zones = carteDesZones(ARBRE);
    const mig = zones.find((z) => z.zone === 'migrations');
    assert.equal(mig.fichiers, 30);
    assert.equal(zones[0].zone, 'migrations', 'la plus fournie en tête');
  });

  test('les fichiers de source se comptent séparément du total', () => {
    const nm = carteDesZones(ARBRE).find((z) => z.zone === 'node_modules');
    assert.equal(nm.fichiers, 1);
    assert.equal(nm.source, 0, 'une dépendance installée n\'est pas du code du projet');
  });
});

describe('la matière d\'un dépôt dit d\'abord ce qu\'elle n\'a pas montré', () => {
  const lu = (chemins, contenus = {}) => analyseDepot({
    depot: DEPOT, ref: 'main', arbre: ARBRE,
    fichiers: chemins.map((c) => ({ chemin: c, contenu: contenus[c] ?? `// ${c}\nconst a = 1;\n` })),
    candidats: fichiersARetenir(ARBRE, { max: 1000 }).candidats,
    maintenant: M
  });

  test('« CE QUE TU N\'AS PAS SOUS LES YEUX » vient AVANT le contenu', () => {
    const r = lu(['package.json', 'src/index.js']);
    assert.ok(r.texte.indexOf('CE QUE TU N\'AS PAS SOUS LES YEUX') < r.texte.indexOf('LES FICHIERS'));
    assert.match(r.texte, /Tu vois une PARTIE de ce dépôt/);
    assert.match(r.texte, /dis « non vu » pour le reste — ne le déduis pas/);
  });

  test('la règle de lecture est ANNONCÉE : un fichier absent n\'est pas un fichier sans importance', () => {
    assert.match(lu(['package.json']).texte, /n'est pas un fichier sans importance/);
  });

  test('sans constat, ce n\'est PAS « ce dépôt est sain »', () => {
    const r = lu(['src/index.js']);
    assert.equal(r.secrets.length, 0);
    assert.match(r.texte, /Ce n'est PAS « ce dépôt est sain »/);
    assert.match(r.texte, /CE QUI N'A PAS ÉTÉ CHERCHÉ/);
  });

  test('un secret est trouvé, localisé, et ne sort ni en clair ni dans l\'extrait', () => {
    const r = lu(['src/lib/paiement.js'], { 'src/lib/paiement.js': `const t = '${JETON}';\n` });
    assert.equal(r.secrets.length, 1);
    assert.equal(r.secrets[0].fichier, 'src/lib/paiement.js');
    assert.ok(r.secrets[0].ligne >= 1, 'un risque sans ligne ne se corrige pas');
    assert.ok(!r.texte.includes(JETON), 'le jeton ne part pas au modèle');
  });

  test('le budget de lignes est GLOBAL, et ce qu\'il coupe est dit', () => {
    const gros = 'x\n'.repeat(MAX_LIGNES_DEPOT);
    const r = lu(['src/index.js', 'src/lib/compte.js'],
                 { 'src/index.js': gros, 'src/lib/compte.js': gros });
    assert.equal(r.lignesMontrees, MAX_LIGNES_DEPOT, 'le total est borné, pas chaque fichier');
    assert.ok(r.lignesCoupees > 0);
    assert.match(r.texte, /budget global/);
  });

  test('la pile détectée vient des manifestes LUS, et se dit absente sinon', () => {
    assert.match(lu(['package.json'], { 'package.json': '{"dependencies":{}}' }).texte,
                 /PILE DÉTECTÉE : npm/);
    assert.match(lu(['src/index.js']).texte, /aucun manifeste reconnu/);
  });

  test('un fichier illisible est NOMMÉ, et ne se confond pas avec le plafond', () => {
    const r = analyseDepot({ depot: DEPOT, arbre: ARBRE, fichiers: [], candidats: 10,
                             nonLus: ['src/casse.js'], maintenant: M });
    assert.match(r.texte, /1 illisible\(s\), et ce n'est pas le plafond : src\/casse\.js/);
  });

  test('le résumé dit la part lue, jamais un total rassurant', () => {
    const r = lu(['package.json', 'src/index.js']);
    assert.match(resumeDepotCode(r), /2\/\d+ fichier\(s\) lus/);
  });
});

describe('le signal est déclaré, et son dossier est facultatif', () => {
  test('`code_du_depot` se calcule, et AUCUN de ses réglages n\'est requis', () => {
    /*
     * Deux réglages, et leur absence est une VALEUR : pas de branche = celle par défaut,
     * pas de dossier = tout le dépôt. Les exiger bloquerait le cas le plus courant.
     *
     * `branche` est arrivé après coup, sur un vrai lancement : l'agent de conception,
     * branché sur ce signal, lisait `main` alors qu'on lui demandait une autre branche —
     * une réponse juste à une autre question, ce qui est pire qu'un refus.
     */
    assert.equal(sait('code_du_depot'), true);
    const r = reglagesDe('code_du_depot');
    assert.deepEqual(r.map((x) => x.nom), ['branche', 'dossier']);
    assert.ok(r.every((x) => x.requis === false), 'aucun n\'est requis');
    assert.equal(reglagesComplets('code_du_depot', {}), true);
  });
});
