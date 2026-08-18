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
         MAX_LIGNES, MAX_LARGEUR, MAX_LIGNES_BRANCHE } from '../lib/signaux-code.js';
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
