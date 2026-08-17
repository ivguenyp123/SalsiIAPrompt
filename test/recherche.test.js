/*
 * Le moteur de recherche et le tour.
 *
 * Ce qui se vérifie ici est le CLASSEMENT, pas la correspondance. Trouver était facile ;
 * ce qui casse à cent trente artefacts, c'est l'ordre — et un ordre qui n'est jamais testé
 * dérive au premier champ ajouté sans que personne le voie, parce qu'un mauvais classement
 * ne ressemble pas à un bug.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { plier, indexer, noter, chercher, fragments, etiquettes,
         porteEtiquettes } from '../lib/recherche.js';
import { ETAPES, VU, jouables, placer } from '../lib/tour.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTEFACTS = readdirSync(join(ROOT, 'artifacts'))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => yaml.load(readFileSync(join(ROOT, 'artifacts', f), 'utf8')));

/** La forme que le catalogue manipule : l'artefact et son index. */
const ENTREES = ARTEFACTS.map((a) => ({ artifact: a, index: indexer(a) }));
const ids = (r) => r.map((x) => x.entree.artifact.id);

/* ── Le classement ────────────────────────────────────────────────────────── */

describe('le classement', () => {
  test('le titre pèse plus que les limites d\'usage', () => {
    /*
     * Le cas qui a motivé le moteur : « revue » apparaît dans le titre de l'un et dans le
     * `not_for` de l'autre. L'ancienne recherche les rendait dans l'ordre du dossier,
     * c'est-à-dire l'alphabet.
     */
    const parTitre = { title: 'Revue de code' };
    const parLimite = { title: 'Autre chose', intent: { not_for: 'Pas pour une revue de code.' } };
    const f = fragments('revue');
    assert.ok(noter(indexer(parTitre), f).score > noter(indexer(parLimite), f).score);
    assert.deepEqual(noter(indexer(parTitre), f).pourquoi, ['le titre']);
  });

  test('un mot exact passe devant un préfixe', () => {
    // Sinon taper plus long dégraderait le classement, ce qui est absurde.
    const exact = indexer({ title: 'Test' });
    const prefixe = indexer({ title: 'Tester une migration' });
    const f = fragments('test');
    assert.ok(noter(exact, f).score > noter(prefixe, f).score);
  });

  test('une variable ne pèse pas comme un titre', () => {
    /*
     * TOUS les artefacts déclarent `repo`. Si un nom de variable pesait autant qu'un
     * titre, chercher « repo » remonterait le catalogue entier dans le désordre.
     */
    const parVariable = indexer({ title: 'Sans rapport', variables: [{ name: 'repo' }] });
    const parTitre = indexer({ title: 'Nettoyer un repo' });
    const f = fragments('repo');
    assert.ok(noter(parTitre, f).score > noter(parVariable, f).score);
  });

  test('sur le vrai registre, « secret » remonte l\'agent qui les cherche', () => {
    // `output.contains_secret` est une CIBLE, pas un mot du titre : l'ancienne recherche
    // ne la fouillait pas du tout.
    const r = chercher(ENTREES, 'secret');
    assert.ok(r.length > 0);
  });

  test('sur le vrai registre, « sql » trouve l\'agent SQL en tête', () => {
    assert.equal(ids(chercher(ENTREES, 'sql'))[0], 'optimiser-une-requete-sql');
  });
});

/* ── La correspondance ────────────────────────────────────────────────────── */

describe('la correspondance', () => {
  test('répond pendant qu\'on tape', () => {
    /*
     * « revu » doit déjà trouver « revue » : sinon le champ paraît mort une frappe sur deux.
     *
     * Le fragment est TIRÉ DU CATALOGUE, pas écrit à la main. Il l'était — « migrat » — et
     * le jour où l'agent de migration a été retiré, ce test est devenu rouge pour une
     * raison qui n'avait rien à voir avec la recherche. Un test de propriété ne doit pas
     * dépendre de la présence d'un artefact précis.
     */
    const mot = ENTREES.flatMap((e) => String(e.artifact?.title || '').split(/[\s—]+/))
      .find((m) => m.length > 6);
    assert.ok(mot, 'le catalogue doit bien porter un mot assez long');
    assert.ok(chercher(ENTREES, mot.slice(0, 5)).length > 0,
      `« ${mot.slice(0, 5)} » devrait déjà trouver « ${mot} »`);
  });

  test('TOUS les fragments doivent correspondre', () => {
    const large = chercher(ENTREES, 'code').length;
    const serre = chercher(ENTREES, 'code sql').length;
    assert.ok(serre < large, 'ajouter un mot resserre');
  });

  test('un fragment introuvable rend zéro résultat, pas un à-peu-près', () => {
    assert.equal(chercher(ENTREES, 'code zzzznexistepas').length, 0);
  });

  test('les accents et la casse ne comptent pas', () => {
    assert.deepEqual(ids(chercher(ENTREES, 'requete')), ids(chercher(ENTREES, 'REQUÊTE')));
    assert.equal(plier('Requête SQL'), 'requete sql');
  });

  test('une recherche vide rend tout, dans l\'ordre d\'origine', () => {
    assert.deepEqual(ids(chercher(ENTREES, '')), ARTEFACTS.map((a) => a.id));
  });

  test('le filtre s\'applique AVANT le classement', () => {
    // Mélanger les deux ferait remonter un artefact écarté par un filtre juste parce
    // qu'il a un bon score.
    const r = chercher(ENTREES, '', (e) => e.artifact.kind === 'prompt');
    assert.ok(r.length > 0);
    assert.ok(r.every((x) => x.entree.artifact.kind === 'prompt'));
  });
});

describe('le « pourquoi »', () => {
  test('dit par quel champ le résultat a été trouvé', () => {
    // Sans ça, un classement inattendu ressemble à un bug — et on cesse de faire
    // confiance au champ, ce qui est pire qu'un mauvais ordre.
    const r = chercher(ENTREES, 'sql');
    assert.ok(r[0].pourquoi.length > 0);
    assert.ok(r[0].pourquoi.every((p) => typeof p === 'string' && p.length > 2));
  });

  test('ne dit rien quand on n\'a rien cherché', () => {
    assert.deepEqual(chercher(ENTREES, '')[0].pourquoi, []);
  });
});

/* ── Les étiquettes ───────────────────────────────────────────────────────── */

describe('les étiquettes', () => {
  test('sont dérivées du registre, avec leurs comptes', () => {
    const t = etiquettes(ARTEFACTS);
    assert.ok(t.length > 0);
    const qualite = t.find((x) => x.tag === 'qualite');
    assert.ok(qualite && qualite.n >= 2, 'plusieurs artefacts portent `qualite`');
  });

  test('les plus fréquentes passent devant', () => {
    const t = etiquettes(ARTEFACTS);
    for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].n >= t[i].n);
  });

  test('se cumulent : chaque étiquette resserre', () => {
    const un = ARTEFACTS.filter((a) => porteEtiquettes(a, ['qualite'])).length;
    const deux = ARTEFACTS.filter((a) => porteEtiquettes(a, ['qualite', 'tests'])).length;
    assert.ok(deux <= un);
    assert.equal(ARTEFACTS.filter((a) => porteEtiquettes(a, [])).length, ARTEFACTS.length);
  });

  test('l\'accent ne fait pas rater une étiquette', () => {
    assert.equal(porteEtiquettes({ tags: ['qualité'] }, ['qualite']), true);
  });
});

/* ── Le tour ──────────────────────────────────────────────────────────────── */

describe('la visite guidée', () => {
  test('reste courte — un tour long se passe', () => {
    assert.ok(ETAPES.length <= 6, `${ETAPES.length} étapes`);
    assert.ok(ETAPES.every((e) => e.cible && e.titre && e.texte));
  });

  test('explique la pastille en pointillés', () => {
    // C'est la distinction la plus importante de l'écran : « visé » n'est pas « atteint ».
    const niveau = ETAPES.find((e) => e.cle === 'niveau');
    assert.ok(niveau);
    assert.match(niveau.texte, /VISÉ|visé/);
    assert.match(niveau.texte, /ATTEINT|atteint/);
  });

  test('une étape sans cible à l\'écran est SAUTÉE', () => {
    // Le catalogue vide n'a pas de carte. Un tour qui pointerait le néant apprendrait à
    // se méfier de lui.
    const sansCartes = jouables(ETAPES, (sel) => !sel.startsWith('.item'));
    assert.ok(sansCartes.length < ETAPES.length);
    assert.ok(sansCartes.every((e) => !e.cible.startsWith('.item')));
    assert.deepEqual(jouables(ETAPES, () => false), []);
  });

  test('la clé de mémoire existe — un tour qui se rejoue est une publicité', () => {
    assert.match(VU, /^salsi_ia_/);
  });
});

describe('le placement de la bulle', () => {
  const ecran = { w: 1200, h: 800 };
  const bulle = { w: 340, h: 160 };

  test('respecte le bord demandé quand il tient', () => {
    const r = { gauche: 400, droite: 700, haut: 300, bas: 340, w: 300, h: 40 };
    assert.equal(placer(r, bulle, ecran, 'bas').cote, 'bas');
    assert.equal(placer(r, bulle, ecran, 'droite').cote, 'droite');
  });

  test('bascule quand il ne tient pas', () => {
    // Une bulle à moitié hors de l'écran est pire que pas de tour du tout.
    const enBas = { gauche: 400, droite: 700, haut: 740, bas: 790, w: 300, h: 50 };
    assert.equal(placer(enBas, bulle, ecran, 'bas').cote, 'haut');

    const aDroite = { gauche: 1000, droite: 1180, haut: 300, bas: 340, w: 180, h: 40 };
    assert.equal(placer(aDroite, bulle, ecran, 'droite').cote, 'gauche');
  });

  test('ne sort jamais de l\'écran', () => {
    for (const r of [{ gauche: 0, droite: 60, haut: 0, bas: 40, w: 60, h: 40 },
                     { gauche: 1140, droite: 1200, haut: 760, bas: 800, w: 60, h: 40 }]) {
      for (const bord of ['bas', 'haut', 'droite', 'gauche']) {
        const p = placer(r, bulle, ecran, bord);
        assert.ok(p.x >= 0 && p.x + bulle.w <= ecran.w, `x=${p.x} (${bord})`);
        assert.ok(p.y >= 0 && p.y + bulle.h <= ecran.h, `y=${p.y} (${bord})`);
      }
    }
  });
});
