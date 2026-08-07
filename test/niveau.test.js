/*
 * Le niveau, et sa provenance.
 *
 * `target_level: officiel` est une ligne que l'AUTEUR écrit. Le catalogue l'affichait
 * telle quelle, en vert, à côté du titre — donc exactement comme un fait. Qui lit
 * « officiel » comprend « ça a été éprouvé ». Rien ne l'a été : aucun banc d'essai ne
 * tourne, aucun cas d'or n'a jamais été joué.
 *
 * C'est la faute la plus grave que ce produit puisse commettre, parce qu'elle porte
 * précisément sur ce qu'il vend. Ces tests la rendent impossible à réintroduire.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { NIVEAUX, niveau, pastille } from '../lib/niveau.js';
import { inventaireParc } from '../admin/parc.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = (target_level, id = 'x') => ({ id, target_level });

describe('sans mesure, le niveau se dit VISÉ', () => {
  test('le libellé porte le mot, il ne le sous-entend pas', () => {
    // « officiel » seul se lit comme un acquis. Le suffixe est la seule chose qui
    // empêche un utilisateur de conclure que la capacité a été éprouvée.
    assert.equal(niveau(a('officiel')).texte, 'officiel — visé');
    assert.equal(niveau(a('team')).texte, 'équipe — visé');
    assert.equal(niveau(a('experimental')).texte, 'expérimental — visé');
  });

  test('et le drapeau `mesure` est faux, pour que l\'écran ne puisse pas se tromper', () => {
    // L'écran ne redécide pas : il lit `mesure` et met la pastille en pointillés.
    const n = niveau(a('officiel'));
    assert.equal(n.mesure, false);
    assert.equal(n.atteint, null);
    assert.equal(n.vise, 'officiel');
  });

  test('l\'aide dit POURQUOI, pas seulement quoi', () => {
    // « visé » sans explication laisse croire à un détail de vocabulaire.
    assert.match(niveau(a('officiel')).aide, /banc d'essai/);
    assert.match(niveau(a('officiel')).aide, /intention, pas un acquis/);
  });

  test('un état dérivé vide ne vaut pas une mesure', () => {
    // `{}` ou une entrée sans `level` : la plateforme est joignable mais n'a rien
    // mesuré. C'est le cas d'aujourd'hui, et il ne doit pas passer pour une preuve.
    for (const derive of [null, undefined, {}, { x: {} }, { x: { level: null } }]) {
      assert.equal(niveau(a('officiel'), derive).mesure, false, JSON.stringify(derive));
    }
  });
});

describe('avec une mesure, le niveau devient un fait', () => {
  test('mesuré et conforme au visé : plus de suffixe', () => {
    const n = niveau(a('officiel'), { x: { level: 'officiel' } });
    assert.equal(n.texte, 'officiel');
    assert.equal(n.mesure, true);
    assert.equal(n.ecart, false);
    assert.match(n.aide, /sur preuve/);
  });

  test('mesuré EN DESSOUS du visé : les deux s\'affichent', () => {
    // Le cas qui compte le jour où le banc tournera. Un artefact qui visait `officiel`
    // et n'atteint qu'`équipe` doit le montrer : c'est là que l'écart entre l'ambition
    // et la preuve devient une information de pilotage, au lieu d'être caché.
    const n = niveau(a('officiel'), { x: { level: 'team' } });
    assert.equal(n.texte, 'équipe · visait officiel');
    assert.equal(n.ecart, true);
    assert.equal(n.cle, 'team', 'la couleur suit ce qui est ATTEINT, pas ce qui est visé');
  });

  test('mesuré AU-DESSUS du visé n\'est pas un écart', () => {
    const n = niveau(a('team'), { x: { level: 'officiel' } });
    assert.equal(n.ecart, false);
    assert.equal(n.texte, 'officiel');
  });

  test('un niveau dérivé inconnu est ignoré plutôt que cru', () => {
    // Mieux vaut retomber sur « visé » que d'afficher une valeur qu'on ne sait pas
    // situer sur l'échelle.
    const n = niveau(a('officiel'), { x: { level: 'platine' } });
    assert.equal(n.mesure, false);
  });
});

describe('la pastille ne peut pas perdre sa provenance', () => {
  test('elle porte toujours `mesure` avec son texte', () => {
    const p = pastille(a('officiel'));
    assert.equal(p.mesure, false);
    assert.equal(p.texte, 'officiel · visé');
    assert.ok(p.aide.length > 40);
  });

  test('mesurée, elle est nue', () => {
    assert.equal(pastille(a('officiel'), { x: { level: 'officiel' } }).texte, 'officiel');
  });
});

describe('robustesse', () => {
  test('un artefact sans niveau retombe sur expérimental', () => {
    assert.equal(niveau({}).cle, 'experimental');
    assert.equal(niveau(null).texte, 'expérimental — visé');
  });

  test('un niveau inconnu ne remonte pas dans l\'échelle', () => {
    // `target_level: dieu` ne doit pas devenir un niveau affiché : le schéma le refuse,
    // mais un fichier écrit à la main dans le dépôt contourne le Studio.
    assert.equal(niveau(a('dieu')).cle, 'experimental');
  });

  test('l\'échelle est ordonnée et complète', () => {
    assert.deepEqual(Object.keys(NIVEAUX), ['experimental', 'team', 'officiel']);
    assert.deepEqual(Object.values(NIVEAUX).map((n) => n.ordre), [0, 1, 2]);
  });
});

describe('aucun écran ne rattrape le mot au passage', () => {
  test('la ligne du parc porte la même provenance', () => {
    // Le parc affiche le niveau dans sa sous-ligne. S'il le recalculait, il referait le
    // bug du catalogue le jour où quelqu'un y toucherait.
    const [e] = inventaireParc({ actif: [{ path: 'artifacts/x.yaml',
      artifact: { id: 'x', title: 'X', target_level: 'officiel' } }] });
    assert.equal(e.niveauTexte, 'officiel — visé');

    const [m] = inventaireParc({ actif: [{ path: 'artifacts/x.yaml',
      artifact: { id: 'x', title: 'X', target_level: 'officiel' } }] }, { x: { level: 'officiel' } });
    assert.equal(m.niveauTexte, 'officiel');
  });

  test('plus aucun écran ne garde sa propre table de libellés', () => {
    // C'est par là que le bug reviendrait : une deuxième table, qui ne connaît pas la
    // provenance et affiche « officiel » tout court.
    for (const f of ['catalogue/catalogue.js', 'admin/admin.js', 'studio/studio.js']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      assert.ok(!/const LEVELS\s*=/.test(src), `${f} redéclare une table de niveaux`);
    }
  });

  test('les artefacts du registre visent sans avoir rien prouvé — et le disent', () => {
    // L'état des lieux, écrit noir sur blanc : ce test tombera le jour où le banc
    // tournera, et c'est exactement à ce moment-là qu'il faudra revenir ici.
    const dossier = join(ROOT, 'artifacts');
    const fichiers = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(fichiers.length > 0);
    for (const f of fichiers) {
      const art = yaml.load(readFileSync(join(dossier, f), 'utf8'));
      assert.equal(niveau(art).mesure, false, `${f} prétend avoir été mesuré`);
      assert.match(niveau(art).texte, /visé$/, f);
    }
  });
});
