/*
 * La doc utilisateur, tenue par des tests.
 *
 * ── POURQUOI TESTER DE LA PROSE ──────────────────────────────────────────────
 *
 * Une documentation ne casse pas : elle ment, en silence, et de plus en plus. C'est la
 * seule partie d'un produit qui se dégrade sans qu'aucun signal ne se déclenche — on ne
 * s'en aperçoit qu'en voyant quelqu'un suivre une instruction qui n'a plus cours.
 *
 * Alors on ne teste pas la prose. On teste les points où elle RECOPIE le code :
 *
 *   · les codes de refus : chaque `L0xx`/`P0xx` du dépôt est expliqué, et aucun code
 *     expliqué n'a disparu du dépôt ;
 *   · les nombres : 90 jours de certification, 0/3/5 cas d'or, le seuil de similarité ;
 *   · les liens entre pages, et le sommaire de l'écran ;
 *   · les écrans : un onglet du produit sans page de doc est un test rouge.
 *
 * Et un dernier, le plus important : que la doc n'affirme pas ce qui n'a pas été mesuré.
 * Voir « l'honnêteté » en bas de fichier.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGES, RACINE, page, lien, liensInternes } from '../lib/guide.js';
import { rendre, titre } from '../lib/md.js';
import { GOLDEN_THRESHOLDS } from '../lint/rules/criteria.js';
import { JOURS_DE_VALIDITE } from '../runtime/banc.js';
import { CHEMIN as ETAT_DERIVE } from '../runtime/etat-derive.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => readFileSync(join(ROOT, p), 'utf8');

const FICHIERS = readdirSync(join(ROOT, RACINE)).filter((f) => f.endsWith('.md')).sort();
const SOURCES = Object.fromEntries(PAGES.map((p) => [p.cle, lire(`${RACINE}/${p.fichier}`)]));
const TOUT = Object.values(SOURCES).join('\n');

/* ── Le sommaire ──────────────────────────────────────────────────────────── */

describe('le sommaire du guide', () => {
  test('liste exactement les pages présentes', () => {
    // Dans les deux sens. Une page non listée est invisible dans l'application ; une
    // page listée mais absente est un lien mort dans la barre de gauche.
    assert.deepEqual(PAGES.map((p) => p.fichier).sort(), FICHIERS);
  });

  test('chaque page a un titre, et c\'est celui du fichier', () => {
    for (const p of PAGES) {
      assert.ok(titre(SOURCES[p.cle]), `${p.fichier} n'a pas de \`# titre\``);
      assert.ok(p.pour && p.pour.length > 12, `${p.cle} : « pour qui » trop court`);
    }
  });

  test('une clé inconnue rend la première page, pas un écran vide', () => {
    assert.equal(page('nexistepas').cle, PAGES[0].cle);
    assert.equal(page(undefined).cle, PAGES[0].cle);
  });

  test('les liens `.md` deviennent de la navigation interne', () => {
    assert.equal(lien('refus.md'), '?p=refus');
    assert.equal(lien('niveaux.md#la-certification'), '?p=niveaux#la-certification');
    // Ce qui n'est pas une page du guide passe intact — une URL reste une URL.
    assert.equal(lien('https://x.test/a.md'), 'https://x.test/a.md');
    assert.equal(lien('inconnue.md'), 'inconnue.md');
  });

  test('tous les liens entre pages mènent quelque part', () => {
    for (const p of PAGES) {
      for (const cible of liensInternes(SOURCES[p.cle])) {
        assert.ok(FICHIERS.includes(cible), `${p.fichier} pointe vers ${cible}, absent`);
      }
    }
  });

  test('aucune page n\'est orpheline — l\'accueil mène à toutes', () => {
    // Le sommaire latéral les liste, mais quelqu'un qui arrive par l'accueil doit
    // pouvoir atteindre chaque page sans deviner qu'une colonne existe.
    const depuisAccueil = new Set(liensInternes(SOURCES.index));
    for (const p of PAGES) {
      if (p.cle === 'index') continue;
      assert.ok(depuisAccueil.has(p.fichier), `${p.fichier} n'est lié depuis aucune page`);
    }
  });
});

/* ── Les codes de refus ───────────────────────────────────────────────────── */

/** Les codes que le dépôt émet RÉELLEMENT, lus dans le code. */
function codesDuDepot() {
  const codes = new Set();
  const scan = (dossier, motif) => {
    for (const f of readdirSync(join(ROOT, dossier)).filter((x) => x.endsWith('.js'))) {
      for (const m of lire(`${dossier}/${f}`).matchAll(motif)) codes.add(m[1]);
    }
  };
  scan('lint/rules', /'(L\d{3})'/g);
  scan('preflight', /'(P\d{3})'/g);
  return [...codes].sort();
}

describe('le catalogue des refus', () => {
  const REFUS = SOURCES.refus;
  const dansDoc = [...new Set([...REFUS.matchAll(/`([LP]\d{3})`/g)].map((m) => m[1]))].sort();

  test('explique CHAQUE code que le dépôt émet', () => {
    /*
     * Le test qui justifie ce fichier. Une règle ajoutée sans sa ligne de doc produit un
     * refus que personne ne sait interpréter — et « ça a refusé, je ne sais pas
     * pourquoi » est le seul retour qu'un utilisateur ne peut pas traiter.
     */
    const manquants = codesDuDepot().filter((c) => !dansDoc.includes(c));
    assert.deepEqual(manquants, [], `codes sans explication dans docs/refus.md : ${manquants}`);
  });

  test('n\'explique aucun code disparu', () => {
    const fantomes = dansDoc.filter((c) => !codesDuDepot().includes(c));
    assert.deepEqual(fantomes, [], `codes documentés mais absents du dépôt : ${fantomes}`);
  });

  test('chaque code documenté dit quoi faire', () => {
    // Une explication sans manœuvre laisse l'utilisateur exactement où il était.
    for (const code of dansDoc) {
      const bloc = new RegExp(`\`${code}\`[\\s\\S]{0,900}?(?=\\n\\*\\*\`|\\n## |$)`).exec(REFUS);
      assert.ok(bloc && /→ \*/.test(bloc[0]), `${code} : pas de « → » disant quoi faire`);
    }
  });

  test('annonce le bon nombre de codes', () => {
    const n = codesDuDepot().length;
    assert.ok(TOUT.includes(`${n} codes`), `la doc devrait dire « ${n} codes »`);
  });
});

/* ── Les nombres recopiés du code ─────────────────────────────────────────── */

describe('les nombres', () => {
  test('les seuils de cas d\'or sont ceux du linter', () => {
    const { experimental, team, officiel } = GOLDEN_THRESHOLDS;

    // Le tableau de `niveaux.md` : une ligne par niveau, le seuil en dernière colonne.
    for (const [cle, label, seuil] of [['experimental', 'expérimental', experimental],
                                       ['team', 'équipe', team],
                                       ['officiel', 'officiel', officiel]]) {
      const ligne = new RegExp(`\\*\\*${label}\\*\\*.*\\| ${seuil} \\|`).test(SOURCES.niveaux);
      assert.ok(ligne, `docs/niveaux.md : ${cle} devrait exiger ${seuil} cas d'or`);
    }

    // Et la même chose redite dans `refus.md`, sous L010, où on la lit en pratique.
    assert.ok(SOURCES.refus.includes(
      `${experimental} pour *expérimental*, **${team}** pour *équipe*, **${officiel}** pour *officiel*`),
    'docs/refus.md : la ligne des seuils sous L010 ne correspond plus');
  });

  test('la durée de certification est celle du banc', () => {
    assert.ok(SOURCES.niveaux.includes(`${JOURS_DE_VALIDITE} jours`),
              `la doc doit dire ${JOURS_DE_VALIDITE} jours`);
  });

  test('le nombre de règles annoncé est le bon', () => {
    const n = codesDuDepot().filter((c) => c.startsWith('L')).length;
    assert.ok(TOUT.includes(`${n} règles`), `la doc devrait dire « ${n} règles »`);
  });

  test('le seuil de similarité est celui de L015', () => {
    const seuil = /const THRESHOLD = ([\d.]+)/.exec(lire('lint/rules/lifecycle.js'));
    assert.ok(seuil, 'THRESHOLD introuvable dans L015');
    assert.ok(SOURCES.refus.includes(`${Number(seuil[1]) * 100} %`),
              `la doc devrait dire ${Number(seuil[1]) * 100} %`);
  });

  test('le nombre de capacités du catalogue des besoins est le bon', () => {
    // Le compte vivait dans « Demander », page retirée avec son écran. Il est désormais
    // dans « Composer », qui est le seul endroit d'où l'on voit encore ces besoins.
    const n = (lire('inventaire/hub-devops.yaml').match(/^ +- id:/gm) || []).length;
    assert.ok(n > 0, 'inventaire illisible');
    assert.ok(SOURCES.composer.includes(`${n} besoins`), `la doc devrait dire ${n} besoins`);
  });
});

/* ── Les écrans ───────────────────────────────────────────────────────────── */

describe('la couverture des écrans', () => {
  test('chaque onglet du produit est documenté', () => {
    /*
     * Un écran livré sans sa page de doc, c'est la façon normale dont une doc devient
     * fausse : elle n'est pas modifiée, elle est simplement dépassée.
     */
    const shell = lire('app/shell.js');
    const onglets = [...shell.matchAll(/\{ id: '([a-z]+)', label: '([^']+)'/g)]
      .map((m) => ({ id: m[1], label: m[2] }))
      // La maquette n'est pas un écran du produit, et le guide est la doc elle-même.
      .filter((o) => !['maquette', 'guide'].includes(o.id));

    assert.ok(onglets.length >= 4, 'les onglets ne se lisent plus');
    for (const o of onglets) {
      const nom = o.label.replace(/^\S+\s/, '');
      assert.ok(TOUT.includes(nom), `l'onglet « ${nom} » n'est mentionné dans aucune page`);
    }
  });

  test('l\'écran du guide existe et charge le sommaire partagé', () => {
    assert.ok(existsSync(join(ROOT, 'guide/index.html')));
    assert.match(lire('guide/guide.js'), /from '\.\.\/lib\/guide\.js'/);
    assert.match(lire('app/shell.js'), /id: 'guide'/);
  });
});

/* ── Le rendu ─────────────────────────────────────────────────────────────── */

describe('chaque page s\'affiche', () => {
  for (const p of PAGES) {
    test(p.fichier, () => {
      const html = rendre(SOURCES[p.cle], { lien });
      assert.ok(html.length > 400, 'page trop courte pour être une page');

      /*
       * Le vrai test : plus aucune syntaxe Markdown ne doit subsister dans la sortie.
       * C'est ce qui attrape une page qui emploierait une syntaxe que le rendu ne
       * couvre pas — elle s'afficherait avec ses astérisques, sans que rien n'échoue.
       */
      const texte = html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '');
      for (const [motif, quoi] of [[/\*\*/, 'gras non rendu'], [/\]\(/, 'lien non rendu'],
                                   [/^#{1,6}\s/m, 'titre non rendu'], [/^\s*\|/m, 'tableau non rendu'],
                                   [/```/, 'bloc de code non rendu']]) {
        assert.ok(!motif.test(texte), `${p.fichier} : ${quoi}`);
      }
    });
  }
});

/* ── L'honnêteté ──────────────────────────────────────────────────────────── */

describe('la doc n\'affirme pas ce qui n\'a pas été mesuré', () => {
  test('elle dit que le banc n\'a rien mesuré — tant que c\'est vrai', () => {
    /*
     * Ce test est auto-resserrant, comme les contrôles du pré-vol.
     *
     * Tant qu'aucun état dérivé n'existe, la doc DOIT dire que tous les niveaux affichés
     * sont des niveaux visés — sinon elle laisse croire à des mesures qui n'ont pas eu
     * lieu, ce qui est exactement le mensonge que ce produit combat.
     *
     * Le jour où le banc tourne et dépose son état, ce test échoue et réclame que la
     * phrase soit retirée. On ne peut donc ni oublier de l'écrire, ni oublier de
     * l'enlever.
     */
    const mesure = existsSync(join(ROOT, ETAT_DERIVE));
    const affirme = /le banc d'essai n'a encore rien mesuré/i.test(SOURCES.niveaux);

    if (mesure) {
      assert.ok(!affirme,
        `${ETAT_DERIVE} existe : retirer de docs/niveaux.md la phrase « le banc n'a encore rien mesuré ».`);
    } else {
      assert.ok(affirme,
        `${ETAT_DERIVE} est absent : docs/niveaux.md doit dire que rien n'a été mesuré.`);
    }
  });

  test('elle ne promet pas une écriture que la forge ne fait pas encore', () => {
    // `commitFiles` lève 501 côté GitHub. Une doc qui décrirait l'écriture comme
    // acquise enverrait les gens buter dessus.
    assert.ok(!/\bfusionne(ra)? (automatiquement|la merge request)\b/i.test(TOUT));
  });

  test('aucun secret ni jeton dans les pages', () => {
    for (const p of PAGES) {
      assert.ok(!/\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,})/
        .test(SOURCES[p.cle]), `${p.fichier} contient ce qui ressemble à un jeton`);
    }
  });
});
