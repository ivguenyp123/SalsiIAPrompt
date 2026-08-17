/*
 * Le rendu Markdown.
 *
 * Deux choses s'y vérifient, et la seconde est la vraie raison de ce fichier :
 *
 *   1. que la syntaxe employée par `docs/` s'affiche correctement ;
 *   2. qu'AUCUN contenu ne puisse devenir du balisage. C'est un rendu qu'on injecte en
 *      `innerHTML` : si l'échappement lâche quelque part, la page devient exécutable.
 *      Un test qui ne couvrirait que le premier point laisserait passer exactement ça.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rendre, enLigne, echapper, plan, ancre, titre, lienSur,
         ressembleADuMarkdown } from '../lib/md.js';

describe('l\'échappement', () => {
  test('aucun contenu ne devient du balisage', () => {
    const html = rendre('Voici <script>alert(1)</script> dans un paragraphe.');
    assert.ok(!html.includes('<script>'), html);
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('même dans un titre, un tableau, une citation ou une liste', () => {
    for (const source of ['# <img onerror=x>', '| <b>a</b> |\n| --- |\n| <i>b</i> |',
                          '> <svg onload=x>', '- <script>x</script>']) {
      const html = rendre(source);
      assert.ok(!/<(script|img|svg)\b/.test(html), `${source} → ${html}`);
    }
  });

  test('le bloc de code est rendu littéralement', () => {
    const html = rendre('```\n<b>pas gras</b>\n**pas gras non plus**\n```');
    assert.ok(html.includes('&lt;b&gt;pas gras&lt;/b&gt;'));
    assert.ok(html.includes('**pas gras non plus**'), 'pas de mise en forme dans un bloc');
  });

  test('un guillemet dans un lien ne casse pas l\'attribut', () => {
    const html = enLigne('[x](a"onmouseover=y)');
    assert.ok(!/href="a"onmouseover/.test(html), html);
    assert.ok(html.includes('&quot;') || html.includes('&amp;quot;'), html);
  });

  test('une URL avec `&` n\'est pas échappée deux fois', () => {
    // `&amp;amp;` dans un href donne un lien mort — et le genre de lien mort qu'on ne
    // voit pas, puisqu'il s'affiche correctement.
    const html = enLigne('[x](https://h.test/a?b=1&c=2)');
    assert.ok(html.includes('href="https://h.test/a?b=1&amp;c=2"'), html);
    assert.ok(!html.includes('&amp;amp;'), html);
  });
});

describe('le rendu en ligne', () => {
  test('gras, italique, code', () => {
    assert.equal(enLigne('**gras**'), '<b>gras</b>');
    assert.equal(enLigne('du *penché* ici'), 'du <i>penché</i> ici');
    assert.equal(enLigne('`du code`'), '<code>du code</code>');
  });

  test('du gras peut contenir de l\'italique', () => {
    // `**a *b*.**` — insister sur un mot au milieu d'une phrase déjà en gras. Deux pages
    // de la doc l'emploient, et la version gourmande laissait traîner les astérisques.
    assert.equal(enLigne('**retombe à *zero*.**'), '<b>retombe à <i>zero</i>.</b>');
  });

  test('le code en ligne échappe à la mise en forme', () => {
    /*
     * Le cas qui a imposé l'extraction préalable : `**` dans un extrait de code est du
     * code, pas du gras. Se tromper là est se tromper précisément à l'endroit où la
     * fidélité compte le plus.
     */
    assert.equal(enLigne('`a ** b`'), '<code>a ** b</code>');
    assert.equal(enLigne('`_x_`'), '<code>_x_</code>');
  });

  test('un nombre entouré d\'espaces n\'est pas pris pour un code', () => {
    // La sentinelle interne est un caractère nul, pas ` 0 ` : sinon ce texte se ferait
    // dévorer par sa propre mécanique.
    assert.equal(enLigne('il en reste 0 sur 3'), 'il en reste 0 sur 3');
    assert.equal(enLigne('`a` puis 0 puis `b`'), '<code>a</code> puis 0 puis <code>b</code>');
  });

  test('les liens sont réécrits par la fonction fournie', () => {
    const html = enLigne('voir [ici](refus.md)', { lien: (h) => `?p=${h.replace('.md', '')}` });
    assert.ok(html.includes('href="?p=refus"'), html);
    assert.ok(html.includes('>ici</a>'));
  });

  test('une URL laissée telle quelle le reste', () => {
    assert.ok(enLigne('[a](https://x.test/y)').includes('href="https://x.test/y"'));
  });
});

describe('les blocs', () => {
  test('les titres portent une ancre', () => {
    assert.equal(rendre('## Le pré-vol'), '<h2 id="le-pre-vol">Le pré-vol</h2>');
  });

  test('une liste à puces, y compris sur plusieurs lignes', () => {
    const html = rendre('- un\n- deux qui continue\n  sur la ligne suivante');
    assert.ok(html.startsWith('<ul>'));
    assert.equal((html.match(/<li>/g) || []).length, 2);
    assert.ok(html.includes('deux qui continue sur la ligne suivante'));
  });

  test('une liste numérotée', () => {
    const html = rendre('1. un\n2. deux');
    assert.ok(html.startsWith('<ol>'));
    assert.equal((html.match(/<li>/g) || []).length, 2);
  });

  test('un tableau demande sa ligne de séparation', () => {
    const vrai = rendre('| a | b |\n| --- | --- |\n| 1 | 2 |');
    assert.ok(vrai.includes('<th>a</th>') && vrai.includes('<td>2</td>'));

    // Sans séparateur, ce sont des barres verticales dans une phrase — pas un tableau.
    assert.ok(!rendre('un | deux | trois').includes('<table>'));
  });

  test('une citation sur plusieurs paragraphes', () => {
    const html = rendre('> une phrase\n>\n> une autre');
    assert.equal((html.match(/<p>/g) || []).length, 2);
    assert.ok(html.startsWith('<blockquote>'));
  });

  test('un filet', () => {
    assert.equal(rendre('---'), '<hr>');
  });

  test('un paragraphe sur plusieurs lignes n\'est qu\'un paragraphe', () => {
    assert.equal(rendre('une phrase\ncoupée en deux'), '<p>une phrase coupée en deux</p>');
  });

  test('une liste qui suit un paragraphe sans ligne vide reste une liste', () => {
    const html = rendre('Voici :\n- un\n- deux');
    assert.ok(html.includes('<p>Voici :</p>'));
    assert.ok(html.includes('<ul>'));
  });
});

describe('le plan', () => {
  const SOURCE = '# Titre\n\n## Un\n\ntexte\n\n### Un.a\n\n#### trop profond\n\n## Deux';

  test('retient les niveaux 2 et 3, pas le titre de la page', () => {
    const p = plan(SOURCE);
    assert.deepEqual(p.map((x) => x.texte), ['Un', 'Un.a', 'Deux']);
    assert.deepEqual(p.map((x) => x.niveau), [2, 3, 2]);
  });

  test('ignore un dièse à l\'intérieur d\'un bloc de code', () => {
    // Sinon un exemple de commande shell commenté remplirait le sommaire de faux titres.
    assert.deepEqual(plan('## Vrai\n\n```bash\n# commentaire\n```').map((x) => x.texte),
                     ['Vrai']);
  });

  test('l\'ancre survit aux accents et au balisage', () => {
    assert.equal(ancre('Le pré-vol — les 7 contrôles'), 'le-pre-vol-les-7-controles');
    assert.equal(ancre('`L025` et la suite'), 'l025-et-la-suite');
    assert.equal(ancre('???'), 'titre', 'jamais une ancre vide');
  });

  test('le titre de la page est son premier dièse', () => {
    assert.equal(titre(SOURCE), 'Titre');
    assert.equal(titre('pas de titre'), '');
  });
});

describe('les entrées limites', () => {
  test('rien ne jette', () => {
    for (const x of [null, undefined, '', '   ', '#', '```', '|', '>']) {
      assert.doesNotThrow(() => rendre(x), String(x));
    }
    assert.equal(echapper(null), '');
  });
});

describe('ce qui gagne à être rendu', () => {
  test('un titre, une puce, du gras : oui', () => {
    assert.equal(ressembleADuMarkdown('## Ton bus factor\n\ndu texte'), true);
    assert.equal(ressembleADuMarkdown('- une zone\n- une autre'), true);
    assert.equal(ressembleADuMarkdown('la zone **lib** est tenue par une personne'), true);
    assert.equal(ressembleADuMarkdown('1. faire ceci\n2. puis cela'), true);
  });

  test('du JSON reste du JSON — le rendre effacerait sa structure', () => {
    assert.equal(ressembleADuMarkdown('{"score": 2, "zones": []}'), false);
    assert.equal(ressembleADuMarkdown('```json\n{"a": 1}\n```'), false);
  });

  test('du texte nu n\'a rien à rendre', () => {
    assert.equal(ressembleADuMarkdown('Une phrase toute simple.'), false);
    assert.equal(ressembleADuMarkdown(''), false);
    assert.equal(ressembleADuMarkdown(null), false);
  });
});

describe('les liens d\'un texte qu\'on n\'a pas écrit', () => {
  test('http, mailto et les chemins passent', () => {
    assert.equal(lienSur('https://exemple.fr/a'), 'https://exemple.fr/a');
    assert.equal(lienSur('mailto:a@b.fr'), 'mailto:a@b.fr');
    assert.equal(lienSur('#section'), '#section');
    assert.equal(lienSur('./page.md'), './page.md');
  });

  test('`javascript:` et `data:` deviennent inertes', () => {
    /*
     * La doc est écrite par nous ; la sortie d'un modèle ne l'est pas. Rendue telle
     * quelle, elle donnerait à un texte généré le pouvoir d'exécuter du code dans la page.
     * Le libellé du lien reste visible — seule sa destination est neutralisée.
     */
    assert.equal(lienSur('javascript:alert(1)'), '#');
    assert.equal(lienSur('JavaScript:alert(1)'), '#');
    assert.equal(lienSur('data:text/html,<script>'), '#');
    assert.equal(lienSur(''), '#');
  });
});
