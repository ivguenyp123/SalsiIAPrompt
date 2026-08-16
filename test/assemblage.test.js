/*
 * L'assemblage — composer UN agent à partir de plusieurs prompts.
 *
 * Ce qui se vérifie ici tient en une phrase : un assemblage n'hérite de RIEN. Le reste du
 * fichier n'est que la déclinaison de cette règle. Si elle lâche, n'importe quel texte
 * entre au registre sans relecture — il suffit de l'assembler à partir de morceaux bénis.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { aplatir } from '../lib/inventaire.js';
import { lint, ERROR } from '../lint/index.js';
import { SOURCES_ENTREES, CRITERE_PAR_SORTIE, consigneDepuisBesoin, morceauDepuisInventaire,
         morceauDepuisArtefact, variablesDeduites, criteresSuggeres, consigneAssemblee,
         assembler, identifiant, cequilManque } from '../lib/assemblage.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTAIRE = aplatir(yaml.load(readFileSync(join(ROOT, 'inventaire/hub-devops.yaml'), 'utf8')));
const SOURCES_VALIDES = ['user', 'signal', 'repo'];

/* ── La table des sources, confrontée à l'inventaire ──────────────────────── */

describe('les sources des entrées', () => {
  test('CHAQUE entrée de l\'inventaire a sa source déclarée', () => {
    /*
     * Le test qui empêche la table de pourrir. Une capacité ajoutée avec une entrée
     * inconnue retomberait sur `user` en silence — et la source décide de QUI remplit la
     * valeur au lancement. Mal classée, elle demande à un humain ce que la plateforme
     * savait produire, ou l'inverse.
     */
    const utilisees = new Set(INVENTAIRE.flatMap((p) => p.entrees || []));
    const orphelines = [...utilisees].filter((n) => !SOURCES_ENTREES[n]).sort();
    assert.deepEqual(orphelines, [],
      `entrées sans source dans lib/assemblage.js : ${orphelines.join(', ')}`);
  });

  test('aucune source déclarée pour une entrée qui n\'existe plus', () => {
    const utilisees = new Set(INVENTAIRE.flatMap((p) => p.entrees || []));
    const fantomes = Object.keys(SOURCES_ENTREES).filter((n) => !utilisees.has(n)).sort();
    assert.deepEqual(fantomes, [], `sources déclarées en trop : ${fantomes.join(', ')}`);
  });

  test('toutes les sources sont dans la nomenclature du schéma', () => {
    for (const [nom, s] of Object.entries(SOURCES_ENTREES)) {
      assert.ok(SOURCES_VALIDES.includes(s), `${nom} : source \`${s}\` inconnue`);
    }
  });

  test('chaque sortie déclarée par l\'inventaire est traitée', () => {
    const sorties = new Set(INVENTAIRE.map((p) => p.sortie).filter(Boolean));
    for (const s of sorties) {
      assert.ok(s in CRITERE_PAR_SORTIE, `sortie \`${s}\` : rien de prévu`);
    }
  });
});

/* ── La consigne ──────────────────────────────────────────────────────────── */

describe('la consigne tirée d\'un besoin', () => {
  test('passe du besoin à l\'instruction', () => {
    assert.equal(consigneDepuisBesoin('un agent qui explique les 4 métriques DORA'),
                 'Explique les 4 métriques DORA');
  });

  test('laisse intact ce qui n\'est pas tourné en « un agent qui »', () => {
    assert.equal(consigneDepuisBesoin('Résume l\'incident'), 'Résume l\'incident');
    assert.equal(consigneDepuisBesoin(''), '');
    assert.equal(consigneDepuisBesoin(null), '');
  });

  test('sur le VRAI inventaire, aucune consigne ne reste vide ni ne garde l\'amorce', () => {
    // Une consigne qui commencerait encore par « un agent qui » se lirait, dans un spec,
    // comme une description au lieu d'un ordre.
    for (const p of INVENTAIRE) {
      const c = consigneDepuisBesoin(p.besoin);
      assert.ok(c.length > 10, `${p.id} : consigne trop courte (« ${c} »)`);
      assert.ok(!/^un agent qui/i.test(c), `${p.id} : amorce non retirée`);
    }
  });
});

describe('l\'assemblage de la consigne', () => {
  const m = (consigne) => ({ consigne, entrees: [], sortie: 'texte' });

  test('un seul morceau ne se numérote pas', () => {
    assert.equal(consigneAssemblee([m('Fais ceci')]), 'Fais ceci');
  });

  test('plusieurs morceaux deviennent une liste numérotée', () => {
    // Un relecteur doit pouvoir dire « le point 3 n'a rien à faire là » sans compter
    // les lignes.
    const s = consigneAssemblee([m('Un'), m('Deux'), m('Trois')]);
    assert.match(s, /^1\. Un/);
    assert.match(s, /3\. Trois$/);
  });

  test('les morceaux vides ne laissent pas de trou dans la numérotation', () => {
    assert.equal(consigneAssemblee([m('Un'), m('   '), m('Deux')]), '1. Un\n\n2. Deux');
  });

  test('rien ne donne rien', () => {
    assert.equal(consigneAssemblee([]), '');
  });

  test('la matière déclarée est BRANCHÉE dans le texte', () => {
    /*
     * Le défaut trouvé à l'usage : les entrées se déduisaient de ce que les morceaux
     * déclarent lire, mais n'apparaissaient nulle part dans la consigne. `L021` refusait,
     * à juste titre — un agent qui réclame une matière qu'il ne lit jamais « ne peut pas
     * faire ce qu'il annonce ».
     */
    const s = consigneAssemblee([{ consigne: 'Explique les métriques', entrees: ['chiffres_dora'] }]);
    assert.ok(s.includes('{{chiffres_dora}}'), s);
  });

  test('une variable DÉJÀ dans le texte n\'est pas répétée en bas', () => {
    // La consigne d'un agent validé porte ses propres `{{...}}`. Les relister ferait
    // croire à deux matières différentes.
    const s = consigneAssemblee([{ consigne: 'Analyse {{code}} du dépôt', entrees: ['code'] }]);
    assert.equal((s.match(/\{\{code\}\}/g) || []).length, 1, s);
    assert.ok(!s.includes('Matière fournie'), s);
  });

  test('sans entrée déclarée, aucun bloc de matière', () => {
    assert.equal(consigneAssemblee([{ consigne: 'Fais ceci', entrees: [] }]), 'Fais ceci');
  });
});

/* ── Les variables ────────────────────────────────────────────────────────── */

describe('les variables déduites', () => {
  test('sont l\'UNION des entrées, pas leur concaténation', () => {
    // Deux morceaux qui lisent le même diff ne le réclament pas deux fois.
    const v = variablesDeduites([{ entrees: ['diff', 'code'] }, { entrees: ['diff', 'stack'] }]);
    assert.deepEqual(v.map((x) => x.name), ['diff', 'code', 'stack']);
  });

  test('portent la source de la table', () => {
    const v = variablesDeduites([{ entrees: ['diff', 'chiffres_dora', 'besoin_metier'] }]);
    assert.deepEqual(v.map((x) => x.source), ['repo', 'signal', 'user']);
  });

  test('une entrée inconnue est marquée comme déduite, pas fondue dans le tas', () => {
    const v = variablesDeduites([{ entrees: ['truc_inconnu'] }]);
    assert.equal(v[0].source, 'user');
    assert.equal(v[0].deduite, true, 'ce qui est deviné doit se dire deviné');
  });
});

/* ── Les critères ─────────────────────────────────────────────────────────── */

describe('les critères', () => {
  test('NE SONT PAS ceux des morceaux', () => {
    /*
     * Le piège qu'on rate en premier. Les critères de l'agent A portent sur LA SORTIE DE
     * A, qui n'existe plus dans un assemblage. Les recopier produirait un contrat qui a
     * l'air riche et ne vérifie rien de ce qui sort vraiment.
     */
    const artefact = { id: 'a', title: 'A', spec: 'Fais A', variables: [],
                       criteria: [{ target: 'output.length', op: 'lte', value: 42 }] };
    const morceau = morceauDepuisArtefact(artefact);
    assert.ok(!('criteria' in morceau), 'un morceau ne transporte pas de contrat');

    const c = criteresSuggeres([morceau]);
    assert.ok(!c.some((x) => x.value === 42 || x.value === '42'),
              'le critère de la brique ne doit pas ressurgir');
  });

  test('le seul qui vaille toujours : aucun secret en sortie', () => {
    const c = criteresSuggeres([]);
    assert.equal(c.length, 1);
    assert.equal(c[0].target, 'output.contains_secret');
    assert.equal(c[0].value, false, 'un booléen, pas la chaîne « false » : L009 compare au type déclaré');
  });

  test('ce que les morceaux DÉCLARENT produire donne un critère', () => {
    const c = criteresSuggeres([{ sortie: 'json' }]);
    assert.ok(c.some((x) => x.target === 'output.is_json'));
  });

  test('« texte » n\'autorise à affirmer rien de particulier', () => {
    // Inventer une borne de longueur sur « du texte » serait un contrat décoratif.
    assert.equal(criteresSuggeres([{ sortie: 'texte' }]).length, 1);
  });

  test('tout ce qui est proposé est marqué comme proposé', () => {
    for (const c of criteresSuggeres([{ sortie: 'json' }, { sortie: 'liste' }])) {
      assert.equal(c.suggere, true);
    }
  });
});

/* ── L'artefact produit ───────────────────────────────────────────────────── */

describe('l\'artefact assemblé', () => {
  const MORCEAUX = [
    morceauDepuisInventaire({ id: 'a', titre: 'A', besoin: 'un agent qui lit le diff du dépôt',
                              entrees: ['diff'], sortie: 'texte' }),
    morceauDepuisInventaire({ id: 'b', titre: 'B', besoin: 'un agent qui rend un rapport en JSON',
                              entrees: ['code'], sortie: 'json' })
  ];
  const fait = () => assembler(MORCEAUX, { titre: 'Relire et rapporter', auteur: 'moi',
                                           scope: 'Plateforme',
                                           purpose: 'Lire un diff et en rendre un rapport JSON.',
                                           notFor: 'Ne pas utiliser pour modifier le dépôt.' });

  test('est UN prompt, pas une chaîne', () => {
    // La confusion qui viderait la distinction de son sens.
    assert.equal(fait().kind, 'prompt');
    assert.ok(!('steps' in fait()));
  });

  test('vise TOUJOURS `experimental`, quelle que soit la maturité des morceaux', () => {
    /*
     * Un assemblage n'a jamais été mesuré. Hériter du niveau de ses morceaux ferait
     * naître un agent « officiel » dont pas un cas d'or n'a été joué.
     */
    assert.equal(fait().target_level, 'experimental');
    /*
     * Et AUCUN `golden_cases`, pas même une liste vide. Elle ne dit rien de plus que son
     * absence, et elle ne survit pas à un aller-retour par le Studio : la reprise laisse
     * tomber les champs vides, donc republier l'agent perdait la clé et faisait diverger
     * le fichier. Attrapé sur un agent réellement composé et validé.
     */
    assert.ok(!('golden_cases' in fait()), 'pas de liste vide écrite');
  });

  test('n\'apporte AUCUNE certification', () => {
    assert.ok(!fait().certification, 'un assemblage n\'est certifié de rien');
  });

  test('porte l\'union des entrées de ses morceaux', () => {
    assert.deepEqual(fait().variables.map((v) => v.name), ['diff', 'code']);
  });

  test('l\'identifiant vient du titre, sans accent ni ponctuation', () => {
    assert.equal(identifiant('Relire & rapporter — en JSON'), 'relire-rapporter-en-json');
    assert.equal(identifiant(''), '');
  });
});

/* ── La porte ─────────────────────────────────────────────────────────────── */

describe('l\'assemblage passe par la porte comme n\'importe quel prompt', () => {
  /*
   * Les VRAIS registres, pas des faux. Un registre inventé pour le test ferait passer
   * l'assemblage sur des cibles qui n'existent pas — c'est-à-dire exactement le défaut
   * que L009 est là pour attraper.
   */
  const CTX = {
    tools: yaml.load(readFileSync(join(ROOT, 'registries/tools.yaml'), 'utf8')).tools,
    targets: yaml.load(readFileSync(join(ROOT, 'registries/targets.yaml'), 'utf8')).targets
  };

  test('un assemblage complet franchit la porte', () => {
    const morceaux = [
      { ref: 'a', titre: 'A', consigne: 'Lis le diff {{diff}} du dépôt et repère les ruptures.',
        entrees: ['diff'], sortie: 'texte' },
      { ref: 'b', titre: 'B', consigne: 'Rends un rapport listant chaque rupture et son risque.',
        entrees: [], sortie: 'liste' }
    ];
    const a = assembler(morceaux, {
      titre: 'Relire un diff', auteur: 'moi', scope: 'Plateforme',
      purpose: 'Lire un diff et signaler les ruptures de compatibilité.',
      notFor: 'Ne pas utiliser pour appliquer un correctif ni pour juger du style.'
    });
    const bloquants = lint(a, CTX).findings.filter((f) => f.severity === ERROR);
    assert.deepEqual(bloquants.map((f) => f.code), [], JSON.stringify(bloquants, null, 2));
  });

  test('le cas réel : deux prompts DORA, identité remplie, porte OUVERTE', () => {
    /*
     * Reproduit exactement ce qui a échoué à l'usage. Deux besoins de l'inventaire qui
     * déclarent tous deux `chiffres_dora`, montés dans l'établi. Ça rendait :
     *
     *   L001  au moins 10 caractères (0 fourni)  — `not_for` vide, écrit quand même
     *   L021  déclare chiffres_dora et n'en interpole aucune
     *
     * Les deux étaient justes, et incompréhensibles à l'écran.
     */
    const morceaux = [
      morceauDepuisInventaire({ id: 'expliquer-les-quatre-metriques-dora',
        titre: 'Expliquer les 4 métriques DORA',
        besoin: 'un agent qui explique les 4 métriques DORA d\'une équipe à quelqu\'un qui ne les connaît pas',
        entrees: ['chiffres_dora'], sortie: 'texte' }),
      morceauDepuisInventaire({ id: 'rediger-le-commentaire-dora-du-comite',
        titre: 'Rédiger le commentaire DORA du comité',
        besoin: 'un agent qui rédige en cinq lignes le commentaire DORA pour le comité mensuel',
        entrees: ['chiffres_dora'], sortie: 'texte' })
    ];
    const a = assembler(morceaux, {
      titre: 'Lire les métriques et commenter', auteur: 'moi', scope: 'Plateforme',
      purpose: 'Expliquer les métriques DORA d\'une équipe et rédiger le commentaire du comité.',
      notFor: 'Ne pas utiliser pour décider d\'une remédiation ni pour juger une personne.'
    });

    assert.ok(a.spec.includes('{{chiffres_dora}}'), 'la matière doit être branchée');
    assert.equal(a.variables.length, 1, 'une seule variable : l\'union, pas la somme');

    const bloquants = lint(a, CTX).findings.filter((f) => f.severity === ERROR);
    assert.deepEqual(bloquants.map((f) => f.code), [], JSON.stringify(bloquants, null, 2));
  });

  test('un assemblage vide est REFUSÉ, comme il se doit', () => {
    // Rien ici ne doit ouvrir un chemin plus court que le Studio.
    const a = assembler([], { titre: '', auteur: '', scope: '' });
    assert.ok(lint(a, CTX).findings.some((f) => f.severity === ERROR));
  });
});

/* ── Ce qui manque, dit à l'auteur ────────────────────────────────────────── */

describe('ce qui manque', () => {
  test('parle avant les règles, et dit quoi faire', () => {
    // Devant un écran vide, « L008 : criteria non vide » n'aide personne qui n'a pas
    // encore compris ce qu'est un critère.
    const m = cequilManque([], {});
    assert.equal(m.length, 5);
    assert.ok(m.every((x) => /[a-z]/.test(x) && !/^L\d/.test(x)));
  });

  test('réclame « quand ne PAS l\'utiliser »', () => {
    /*
     * Le champ oublié à l'usage. Le schéma en exige dix caractères ; sans ce message,
     * l'auteur recevait un `L001 : au moins 10 caractères (0 fourni)` qui ne nomme même
     * pas le champ concerné.
     */
    const m = cequilManque([{ consigne: 'x' }],
                           { titre: 'T', purpose: 'Un but assez long', scope: 'Plateforme' });
    assert.equal(m.length, 1);
    assert.match(m[0], /ne PAS l'utiliser/);
  });

  test('applique les seuils du schéma, pas « non vide »', () => {
    // « ok » est non vide et refusé par le schéma. Dire « c'est rempli » puis se faire
    // refuser est le pire des deux mondes.
    const m = cequilManque([{ consigne: 'x' }],
                           { titre: 'T', purpose: 'ok', notFor: 'ok', scope: 'P' });
    assert.equal(m.length, 2);
  });

  test('se tait quand tout est là', () => {
    assert.deepEqual(cequilManque([{ consigne: 'x' }],
                                  { titre: 'T', purpose: 'Un but assez long',
                                    notFor: 'Une limite assez longue', scope: 'Plateforme' }), []);
  });
});

/* ── Ce que l'assemblage n'écrit pas ──────────────────────────────────────── */

describe('les champs facultatifs vides', () => {
  test('`not_for` absent plutôt que vide', () => {
    /*
     * Le schéma exige dix caractères sur `intent.not_for`. Émettre une chaîne vide
     * produit un `L001` illisible ; omettre le champ laisse `L011` dire, lui,
     * exactement quoi remplir.
     */
    const a = assembler([{ consigne: 'Fais x', entrees: [] }],
                        { titre: 'T', purpose: 'Un but assez long', notFor: '   ' });
    assert.ok(!('not_for' in a.intent), JSON.stringify(a.intent));
    assert.equal(a.intent.purpose, 'Un but assez long');
  });

  test('`not_for` écrit quand il est rempli', () => {
    const a = assembler([{ consigne: 'Fais x', entrees: [] }],
                        { titre: 'T', purpose: 'Un but assez long',
                          notFor: 'Ne pas utiliser pour ceci.' });
    assert.equal(a.intent.not_for, 'Ne pas utiliser pour ceci.');
  });
});
