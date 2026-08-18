/*
 * Tests de l'atelier — l'état qu'une chaîne accumule entre ses étapes.
 *
 * ── CE QUI EST VÉRIFIÉ, PAR ORDRE D'IMPORTANCE ──────────────────────────────
 *
 * 1. CE QUI N'EST PAS DÉCLARÉ NE S'ÉCRIT PAS. C'est la seule chose qui empêche l'atelier
 *    d'être un système de fichiers, et un système de fichiers est un endroit où la
 *    gouvernance s'arrête.
 * 2. Trois absences, trois textes différents. Une case non déclarée, une case vide et une
 *    case plafonnée n'appellent pas les mêmes conclusions — les rendre toutes trois par
 *    une chaîne vide ferait conclure « rien à signaler » sur « personne n'a cherché ».
 * 3. Le plafond REFUSE, il ne tronque pas. Une case tronquée a l'air pleine.
 * 4. Le caviardage se fait à L'ÉCRITURE. À la lecture, le secret resterait dans l'atelier,
 *    donc dans le journal du passage.
 * 5. Deux étapes qui remplacent la même case sont détectées AVANT le premier appel. C'est
 *    le défaut d'un état mutable partagé qui coûte le plus cher à trouver après coup.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ouvrir, ecrire, lire, resume, conflits, casesCitees, clesDe,
         FORMES, MODES, MAX_OCTETS, MAX_ENTREES, RESERVE } from '../lib/atelier.js';
import { CAVIARDE } from '../lib/signaux-securite.js';
import { derouler } from '../runtime/chaine.js';

const DECLS = [{ cle: 'constats', forme: 'lignes', titre: 'Les constats retenus' },
               { cle: 'notes', forme: 'texte' }];

const neuf = () => ouvrir(DECLS);

/* ── Ce qui n'est pas déclaré n'existe pas ────────────────────────────────── */

describe('l\'atelier n\'est pas un système de fichiers', () => {
  test('UNE CASE NON DÉCLARÉE NE S\'ÉCRIT PAS', () => {
    const a = neuf();
    const r = ecrire(a, { cle: 'ailleurs', texte: 'x', etape: 'e1' });
    assert.equal(r.ecrit, false);
    assert.match(r.refus, /n'est pas déclarée par la chaîne/);
    assert.match(r.refus, /la gouvernance s'arrête/);
    assert.equal(a.cases.has('ailleurs'), false);
  });

  test('il n\'y a pas de chemin, donc pas de traversée à empêcher', () => {
    // `../../etc/passwd` n'est pas un chemin dangereux ici : c'est une clé qui n'existe
    // pas, refusée par la même ligne que `ailleurs`. Un espace de noms plat n'a pas de
    // traversée — pas parce qu'on la bloque, parce qu'elle n'a pas de sens.
    const a = neuf();
    for (const cle of ['../notes', 'notes/../constats', '__proto__', 'constructor']) {
      assert.equal(ecrire(a, { cle, texte: 'x' }).ecrit, false, cle);
    }
    assert.deepEqual(clesDe(a), ['constats', 'notes']);
  });

  test('un mode inconnu est refusé', () => {
    assert.equal(ecrire(neuf(), { cle: 'notes', texte: 'x', mode: 'fusionne' }).ecrit, false);
  });

  test('une déclaration sans clé est ignorée, pas devinée', () => {
    assert.deepEqual(clesDe(ouvrir([{ forme: 'texte' }, { cle: 'a' }])), ['a']);
  });

  test('une forme inconnue retombe sur `texte` plutôt que de casser', () => {
    // `conflits()` le refuse au lint ; à l'exécution, on ne fait pas exploser un passage
    // pour une forme mal tapée — mais on n'invente pas non plus une forme.
    assert.equal(ouvrir([{ cle: 'a', forme: 'jsonl' }]).cases.get('a').forme, 'texte');
  });
});

/* ── L'accumulation ───────────────────────────────────────────────────────── */

describe('accumuler, qui est la raison d\'être', () => {
  test('trois étapes ajoutent, une quatrième lit tout', () => {
    const a = neuf();
    ecrire(a, { cle: 'constats', texte: 'un', etape: 'e1' });
    ecrire(a, { cle: 'constats', texte: 'deux', etape: 'e2' });
    ecrire(a, { cle: 'constats', texte: 'trois', etape: 'e3' });
    const t = lire(a, 'constats');
    assert.match(t, /un\ndeux\ntrois/);
    assert.match(t, /3 écriture\(s\), par : e1, e2, e3/);
  });

  test('la forme décide du joint', () => {
    const a = neuf();
    ecrire(a, { cle: 'notes', texte: 'un', etape: 'e1' });
    ecrire(a, { cle: 'notes', texte: 'deux', etape: 'e2' });
    assert.match(lire(a, 'notes'), /un\n\ndeux/);
  });

  test('`remplace` efface ce qui était là, et le compte repart', () => {
    const a = neuf();
    ecrire(a, { cle: 'notes', texte: 'ancien', etape: 'e1' });
    ecrire(a, { cle: 'notes', texte: 'neuf', etape: 'e2', mode: 'remplace' });
    assert.match(lire(a, 'notes'), /1 écriture\(s\), par : e2/);
    assert.ok(!/ancien/.test(lire(a, 'notes')));
  });

  test('le résumé dit qui a écrit quoi', () => {
    const a = neuf();
    ecrire(a, { cle: 'constats', texte: 'x', etape: 'e1' });
    const r = resume(a).find((c) => c.cle === 'constats');
    assert.deepEqual(r.par, ['e1']);
    assert.equal(r.ecritures, 1);
    assert.equal(r.titre, 'Les constats retenus');
    // Une case jamais écrite se voit AUSSI : elle est déclarée, et son vide est un fait.
    assert.equal(resume(a).find((c) => c.cle === 'notes').ecritures, 0);
  });
});

/* ── Vide, absent, incomplet ──────────────────────────────────────────────── */

describe('trois absences, trois textes — « vide » n\'est pas « absent »', () => {
  test('une case NON DÉCLARÉE dit que c\'est un défaut de câblage', () => {
    const t = lire(neuf(), 'inconnue');
    assert.match(t, /NON DÉCLARÉE/);
    assert.match(t, /Ne conclus rien de cette absence/);
  });

  test('une case DÉCLARÉE ET VIDE dit que personne n\'y a rien mis', () => {
    /*
     * La distinction qui compte. Rendre une chaîne vide ferait lire « aucun constat » —
     * c'est-à-dire « rien à signaler » — là où la vérité est « aucune étape n'a encore
     * cherché ». Le modèle conclurait sur une absence de mesure.
     */
    const t = lire(neuf(), 'constats');
    assert.match(t, /DÉCLARÉE et VIDE/);
    assert.match(t, /personne n'a encore rien mis ici/);
    assert.ok(!/rien à signaler/i.test(t.replace(/« rien à signaler »/, '')));
  });

  test('une case PLAFONNÉE dit qu\'elle est incomplète', () => {
    const a = neuf();
    ecrire(a, { cle: 'notes', texte: 'a'.repeat(MAX_OCTETS - 10), etape: 'e1' });
    ecrire(a, { cle: 'notes', texte: 'b'.repeat(100), etape: 'e2' });
    const t = lire(a, 'notes');
    assert.match(t, /INCOMPLET/);
    assert.match(t, /Ne conclus rien sur ce qui n'y est pas/);
  });
});

/* ── Les plafonds ─────────────────────────────────────────────────────────── */

describe('les plafonds refusent, ils ne tronquent pas', () => {
  test('UNE ÉCRITURE QUI DÉPASSE EST REFUSÉE ENTIÈRE', () => {
    /*
     * Tronquer donnerait une case qui a l'air pleine et qui ment sur ce qu'elle contient.
     * L'étape suivante conclurait sur une liste amputée sans savoir qu'elle l'est — le
     * pire des deux mondes.
     */
    const a = neuf();
    const r = ecrire(a, { cle: 'notes', texte: 'x'.repeat(MAX_OCTETS + 1), etape: 'e1' });
    assert.equal(r.ecrit, false);
    assert.match(r.refus, /REFUSÉE, pas tronquée/);
    assert.equal(a.cases.get('notes').morceaux.length, 0);
  });

  test('le nombre d\'écritures est plafonné aussi', () => {
    const a = ouvrir([{ cle: 'n', forme: 'lignes' }]);
    for (let i = 0; i < MAX_ENTREES; i++) ecrire(a, { cle: 'n', texte: 'x', etape: `e${i}` });
    assert.equal(ecrire(a, { cle: 'n', texte: 'x', etape: 'trop' }).ecrit, false);
    assert.equal(a.cases.get('n').morceaux.length, MAX_ENTREES);
  });

  test('les octets sont comptés en UTF-8, pas en caractères', () => {
    // « é » fait deux octets. Compter des caractères ferait un plafond qui dépend de la
    // langue du texte, ce qui n'a aucun sens pour une limite de taille.
    const a = ouvrir([{ cle: 'n' }]);
    ecrire(a, { cle: 'n', texte: 'é', etape: 'e1' });
    assert.equal(a.cases.get('n').octets, 2);
  });

  test('un refus de plafond marque la case, et le refus suivant la trouve marquée', () => {
    const a = neuf();
    ecrire(a, { cle: 'notes', texte: 'x'.repeat(MAX_OCTETS + 1), etape: 'e1' });
    assert.match(a.cases.get('notes').coupe, /Plafond/);
  });
});

/* ── Le caviardage ────────────────────────────────────────────────────────── */

describe('le caviardage se fait à L\'ÉCRITURE', () => {
  test('un secret n\'entre pas dans l\'atelier', () => {
    /*
     * Le caviarder à la lecture le laisserait DANS l'atelier — donc dans le journal du
     * passage, dans tout écran qui montre l'état, et dans ce qu'on exporterait. On le
     * retire à l'entrée, une fois.
     */
    const a = neuf();
    const r = ecrire(a, { cle: 'notes', etape: 'e1',
      texte: 'jeton ghp_a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3 fin' });
    assert.equal(r.ecrit, true);
    assert.ok(r.caviarde.length > 0, 'le retrait est signalé');
    assert.ok(!/ghp_a1b2c3d4/.test(a.cases.get('notes').morceaux[0].texte));
    assert.match(lire(a, 'notes'), new RegExp(CAVIARDE.replace(/[[\]]/g, '\\$&')));
  });

  test('ce qui a été retiré est INSCRIT au journal, jamais silencieux', () => {
    const a = neuf();
    ecrire(a, { cle: 'notes', etape: 'e1',
      texte: 'ghp_a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3' });
    assert.ok(a.journal[0].caviarde.length > 0);
  });
});

/* ── Le journal ───────────────────────────────────────────────────────────── */

describe('le journal de l\'atelier', () => {
  test('chaque écriture y laisse une ligne, refus compris', () => {
    const a = neuf();
    ecrire(a, { cle: 'notes', texte: 'ok', etape: 'e1' });
    ecrire(a, { cle: 'ailleurs', texte: 'non', etape: 'e2' });
    assert.equal(a.journal.length, 2);
    assert.equal(a.journal[0].refus, '');
    assert.match(a.journal[1].refus, /n'est pas déclarée/);
  });

  test('un atelier neuf naît vide — il ne survit pas au passage précédent', () => {
    // Pas de persistance, et ce n'est pas une simplification : un atelier partagé entre
    // deux passages rendrait le résultat d'une chaîne dépendant de ce qu'une autre y a
    // laissé la veille. « Qu'est-ce que l'agent a vu ce jour-là ? » n'aurait plus de
    // réponse.
    const a = neuf();
    ecrire(a, { cle: 'notes', texte: 'x', etape: 'e1' });
    assert.equal(neuf().journal.length, 0);
    assert.equal(neuf().cases.get('notes').morceaux.length, 0);
  });
});

/* ── Les contrôles statiques ──────────────────────────────────────────────── */

const chaine = (steps, atelier = DECLS) => ({ kind: 'chain', atelier, steps });
const messages = (c) => conflits(c).map((x) => x.message);

describe('ce qui se voit AVANT de dépenser un jeton', () => {
  test('DEUX ÉTAPES QUI REMPLACENT LA MÊME CASE', () => {
    /*
     * Le défaut d'un état mutable partagé qui coûte le plus cher à trouver après coup :
     * la seconde efface le travail de la première, la chaîne ne rate rien, et le résultat
     * est incomplet sans que rien ne le dise. Vérifiable sans exécuter quoi que ce soit.
     */
    const m = messages(chaine([
      { id: 'e1', artefact: 'a', ecrit: { cle: 'notes', mode: 'remplace' } },
      { id: 'e2', artefact: 'b', ecrit: { cle: 'notes', mode: 'remplace' } },
      { id: 'e3', artefact: 'c', entrees: { x: '{{atelier.notes}}' } }
    ], [{ cle: 'notes' }]));
    assert.ok(m.some((x) => /remplacent toutes deux la case `notes`/.test(x)));
    assert.ok(m.some((x) => /efface le travail de la première/.test(x)));
  });

  test('deux étapes qui AJOUTENT à la même case ne posent aucun problème', () => {
    // C'est le cas normal, et le but du module. Il ne doit surtout pas se signaler.
    const m = messages(chaine([
      { id: 'e1', artefact: 'a', ecrit: { cle: 'notes' } },
      { id: 'e2', artefact: 'b', ecrit: { cle: 'notes', mode: 'ajoute' } },
      { id: 'e3', artefact: 'c', entrees: { x: '{{atelier.notes}}' } }
    ], [{ cle: 'notes' }]));
    assert.deepEqual(m, []);
  });

  test('LIRE UNE CASE AVANT QUE QUICONQUE Y AIT ÉCRIT', () => {
    const m = messages(chaine([
      { id: 'e1', artefact: 'a', entrees: { x: '{{atelier.notes}}' } },
      { id: 'e2', artefact: 'b', ecrit: { cle: 'notes' } }
    ], [{ cle: 'notes' }]));
    assert.ok(m.some((x) => /avant qu'aucune étape antérieure n'y ait écrit/.test(x)));
  });

  test('écrire ou lire une case non déclarée', () => {
    const m = messages(chaine([
      { id: 'e1', artefact: 'a', ecrit: { cle: 'fantome' } },
      { id: 'e2', artefact: 'b', entrees: { x: '{{atelier.autre}}' } }
    ], [{ cle: 'notes' }]));
    assert.ok(m.some((x) => /écrit dans la case `fantome`, que la chaîne ne déclare pas/.test(x)));
    assert.ok(m.some((x) => /lit la case `autre`, que la chaîne ne déclare pas/.test(x)));
  });

  test('UNE ÉTAPE NE PEUT PAS S\'APPELER `atelier`', () => {
    // Sinon `{{atelier.sortie}}` et `{{atelier.notes}}` désignent deux choses différentes
    // avec la même écriture, et le câblage devient ambigu au lieu d'être faux.
    const m = messages(chaine([{ id: RESERVE, artefact: 'a', ecrit: { cle: 'notes' } },
                               { id: 'e2', artefact: 'b', entrees: { x: '{{atelier.notes}}' } }],
                              [{ cle: 'notes' }]));
    assert.ok(m.some((x) => new RegExp(`ne peut pas s'appeler \`${RESERVE}\``).test(x)));
  });

  test('une case déclarée que personne n\'écrit', () => {
    assert.ok(messages(chaine([{ id: 'e1', artefact: 'a' }], [{ cle: 'notes' }]))
      .some((x) => /aucune étape n'y écrit/.test(x)));
  });

  test('une case écrite que personne ne lit — de l\'état accumulé pour rien', () => {
    assert.ok(messages(chaine([{ id: 'e1', artefact: 'a', ecrit: { cle: 'notes' } }],
                              [{ cle: 'notes' }]))
      .some((x) => /aucune étape ne la lit/.test(x)));
  });

  test('une case déclarée deux fois, et une forme inconnue', () => {
    const m = messages(chaine([], [{ cle: 'n' }, { cle: 'n' }, { cle: 'z', forme: 'jsonl' }]));
    assert.ok(m.some((x) => /déclarée deux fois/.test(x)));
    assert.ok(m.some((x) => /forme inconnue/.test(x)));
  });

  test('une chaîne SANS atelier ne produit aucun conflit', () => {
    // Rien n'oblige une chaîne à en avoir un. Le module ne doit pas se rappeler à
    // l'existence des chaînes qui ne l'utilisent pas.
    assert.deepEqual(conflits({ kind: 'chain', steps: [{ id: 'e1', artefact: 'a' }] }), []);
    assert.deepEqual(conflits({}), []);
  });
});

/* ── Le renvoi ────────────────────────────────────────────────────────────── */

describe('la syntaxe du renvoi', () => {
  test('elle relève les cases citées, espaces compris', () => {
    assert.deepEqual(casesCitees('a {{atelier.x}} b {{ atelier.y_2 }} c'), ['x', 'y_2']);
  });

  test('elle ne confond pas avec une sortie d\'étape', () => {
    assert.deepEqual(casesCitees('{{e1.sortie}} {{code}}'), []);
  });
});

describe('le vocabulaire est fermé', () => {
  test('deux formes, deux modes, et ils sont nommés', () => {
    assert.deepEqual(Object.keys(FORMES), ['texte', 'lignes']);
    assert.deepEqual(MODES, ['ajoute', 'remplace']);
    for (const f of Object.values(FORMES)) assert.ok(f.titre && f.joint);
  });
});

/* ── De bout en bout : une vraie chaîne qui accumule ──────────────────────── */

describe('une chaîne qui accumule, déroulée pour de vrai', () => {
  const brique = (id) => ({
    id, kind: 'prompt', title: id,
    variables: [{ name: 'x', source: 'user', required: true }],
    criteria: [], spec: 'fais quelque chose avec {{x}}'
  });

  const CHAINE = {
    id: 'revue', kind: 'chain', title: 'Revue',
    atelier: [{ cle: 'constats', forme: 'lignes', titre: 'Ce qui a été trouvé' }],
    steps: [
      { id: 'e1', artefact: 'scanne_a', entrees: { x: 'module A' },
        ecrit: { cle: 'constats' } },
      { id: 'e2', artefact: 'scanne_b', entrees: { x: 'module B' },
        ecrit: { cle: 'constats', mode: 'ajoute' } },
      { id: 'e3', artefact: 'synthese', entrees: { x: 'Voici tout :\n{{atelier.constats}}' } }
    ]
  };

  const parId = new Map([['scanne_a', brique('scanne_a')], ['scanne_b', brique('scanne_b')],
                         ['synthese', brique('synthese')]]);

  test('LES DEUX PREMIÈRES ÉTAPES ALIMENTENT, LA TROISIÈME REÇOIT TOUT', async () => {
    /*
     * Le test qui justifie le module. Sans atelier, `e3` devrait citer `{{e1.sortie}}` et
     * `{{e2.sortie}}` une par une — ce qui marche à trois étapes et cesse de marcher dès
     * que leur nombre varie.
     */
    const sorties = { e1: 'A : deux soucis', e2: 'B : rien de visible' };
    const passage = await derouler(CHAINE, {
      parId, jouer: async (cible, entrees, etape) => ({ sortie: sorties[etape.id] ?? '' })
    });

    const recu = passage.etapes.find((e) => e.etape === 'e3').entrees.x;
    assert.match(recu, /A : deux soucis\nB : rien de visible/);
    assert.match(recu, /2 écriture\(s\), par : e1, e2/);
    assert.equal(passage.conforme, true);
  });

  test('le passage rend l\'état de l\'atelier, et qui l\'a rempli', () => {
    // C'est la réponse à « qu'est-ce que les étapes se sont passé ». Sans elle, l'atelier
    // serait un couloir noir entre deux briques.
    return derouler(CHAINE, { parId, jouer: async () => ({ sortie: 'x' }) })
      .then((p) => {
        const c = p.atelier.find((x) => x.cle === 'constats');
        assert.deepEqual(c.par, ['e1', 'e2']);
        assert.equal(c.ecritures, 2);
        assert.equal(p.atelierJournal.length, 2);
      });
  });

  test('SANS ATELIER OUVERT, LE RENVOI RESTE VISIBLE', () => {
    /*
     * Une chaîne qui cite `{{atelier.constats}}` sans déclarer la case reçoit le texte
     * « case NON DÉCLARÉE », pas une chaîne vide. C'est la règle de `rendre()` : un trou
     * non résolu se voit, sinon un prompt troué part en ayant l'air complet.
     */
    const sansCase = { ...CHAINE, atelier: [] };
    return derouler(sansCase, { parId, jouer: async () => ({ sortie: 'x' }) })
      .then((p) => {
        assert.match(p.etapes.find((e) => e.etape === 'e3').entrees.x, /NON DÉCLARÉE/);
        // Et l'écriture a été refusée, en le disant.
        assert.match(p.etapes[0].atelier.refus, /n'est pas déclarée/);
      });
  });

  test('une étape qui écrit APRÈS avoir violé son contrat laisse quand même sa trace', () => {
    /*
     * L'atelier montre ce qui s'est RÉELLEMENT passé, arrêt compris. Effacer l'écriture
     * d'une étape non conforme ferait mentir le journal du passage : elle a bien produit
     * ce texte, et c'est ce qu'on veut relire pour comprendre l'arrêt.
     */
    const dure = { ...CHAINE, steps: [
      { ...CHAINE.steps[0] },
      { id: 'e2', artefact: 'strict', entrees: { x: 'y' }, ecrit: { cle: 'constats' } }
    ] };
    const strict = { ...brique('strict'),
                     criteria: [{ target: 'output.length', op: 'gte', value: 5000 }] };
    return derouler(dure, { parId: new Map([...parId, ['strict', strict]]),
                            jouer: async () => ({ sortie: 'court' }) })
      .then((p) => {
        assert.ok(p.arretee, 'la chaîne s\'arrête sur le contrat violé');
        assert.equal(p.atelier.find((c) => c.cle === 'constats').ecritures, 2);
      });
  });
});
