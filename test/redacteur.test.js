/*
 * La dictée — une phrase, un artefact, et une porte qui ne bouge pas.
 *
 * Le moteur est de papier : il rend des YAML écrits à la main. Ce qui se vérifie ici
 * n'est donc pas la qualité d'un modèle — elle ne se teste pas — mais tout le reste, qui
 * est justement ce qui rend acceptable de laisser un LLM écrire dans un registre gouverné :
 *
 *   — la consigne ne cite que ce qui existe au référentiel
 *   — un brouillon refusé repart avec les constats du linter, et la boucle converge
 *   — un brouillon qui reste bloqué est rendu COMME TEL, jamais présenté comme conforme
 *   — l'auteur, le niveau visé et l'identifiant ne sont pas laissés au modèle
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { lint } from '../lint/index.js';
import { knownScopes } from '../app/scopes.js';
import { rediger, consigne, correction, extraire, normaliser,
         identifiant } from '../runtime/redacteur.js';
import { rediger as apiRediger, PHRASE_MAX } from '../runtime/api.js';
import { toYaml } from '../studio/to-yaml.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lireYaml = (p) => yaml.load(readFileSync(join(ROOT, p), 'utf8'));

const registres = {
  tools: lireYaml('registries/tools.yaml').tools,
  targets: lireYaml('registries/targets.yaml').targets,
  entrees: lireYaml('entrees/index.yaml'),
  validateArtifact: makeValidator(JSON.parse(readFileSync(join(ROOT, 'schema/artifact.schema.json'), 'utf8')))
};
const scopes = knownScopes(registres.tools);

/** Un artefact réel du registre : il franchit la porte, donc il sert de « bonne réponse ». */
const BON = readFileSync(join(ROOT, 'artifacts/commit-message.yaml'), 'utf8');

/** Le même, amputé de son contrat et pourvu d'un outil qui n'existe pas. */
const MAUVAIS = BON
  .replace(/^criteria:[\s\S]*?(?=^golden_cases:)/m, '')
  .replace('id: read_repo_metadata', 'id: read_the_whole_internet');

/** Un moteur de papier : il rend les textes qu'on lui donne, dans l'ordre, et note ses invites. */
const moteurDePapier = (reponses) => {
  const invites = [];
  let i = 0;
  return {
    invites,
    fournisseur: 'papier',
    ou: 'aucun réseau',
    modele: () => 'modele-de-papier',
    generer: async ({ prompt }) => {
      invites.push(prompt);
      const texte = reponses[Math.min(i, reponses.length - 1)];
      i += 1;
      return { texte, modele: 'modele-de-papier', tier: 'mid',
               jetons: { entree: 100, sortie: 200 }, motifArret: 'stop' };
    }
  };
};

const outils = (moteur, extra = {}) => ({
  moteur, registres, lint, parse: (t) => yaml.parse(t), scopes, ...extra
});

const enBloc = (texte) => `Voilà.\n\n\`\`\`yaml\n${texte}\n\`\`\`\n\nDis-moi si ça convient.`;

/* ── La consigne ──────────────────────────────────────────────────────────── */

describe('la consigne', () => {
  const c = consigne({ phrase: 'un agent qui relit un diff', registres, auteur: 'moi', scopes });

  test('est assemblée à partir du référentiel, pas écrite en dur', () => {
    // Le jour où un outil est ajouté au registre, le rédacteur le connaît sans qu'on
    // touche à son code — et il ne peut pas proposer un outil retiré.
    for (const t of registres.tools) assert.ok(c.includes(t.id), `outil absent : ${t.id}`);
    for (const t of registres.targets) assert.ok(c.includes(t.target), `cible absente : ${t.target}`);
  });

  test('donne les entrées de la banque, pour que les cas d\'or jouent sur du réel', () => {
    for (const n of registres.entrees.natures) {
      assert.ok(c.includes(n.nature));
      for (const e of n.entrees) assert.ok(c.includes(e.id), `entrée absente : ${e.id}`);
    }
  });

  test('porte le besoin et l\'auteur', () => {
    assert.ok(c.includes('un agent qui relit un diff'));
    assert.ok(c.includes('moi'));
  });
});

describe('la consigne de correction', () => {
  test('rend au modèle les constats du linter, codes compris', () => {
    const c = correction({
      yaml: 'id: x',
      phrase: 'un truc',
      findings: [
        { code: 'L008', severity: 'error', message: 'Aucun critère.', path: 'criteria' },
        { code: 'L011', severity: 'warn', message: 'not_for vide.', path: 'intent.not_for' }
      ]
    });
    assert.ok(c.includes('[L008]'));
    assert.ok(c.includes('Aucun critère.'));
    assert.ok(c.includes('id: x'), 'le brouillon repart avec, pour être corrigé et non refait');
    // Les avertissements sont dits, mais rangés à part : les mélanger aux refus ferait
    // réécrire un artefact conforme pour une remarque non bloquante.
    assert.ok(c.indexOf('[L008]') < c.indexOf('[L011]'));
    assert.ok(/AVERTISSEMENTS/.test(c));
  });
});

/* ── L'extraction ─────────────────────────────────────────────────────────── */

describe('l\'extraction du YAML', () => {
  test('sort le bloc clôturé de son bavardage', () => {
    assert.equal(extraire(enBloc('id: x')), 'id: x');
  });

  test('accepte un bloc jamais refermé — une réponse coupée par max_tokens', () => {
    assert.equal(extraire('Voilà :\n```yaml\nid: x\nkind: agent'), 'id: x\nkind: agent');
  });

  test('à défaut de bloc, prend la réponse telle quelle et laisse le parseur trancher', () => {
    assert.equal(extraire('id: x'), 'id: x');
  });
});

/* ── Ce que le modèle ne décide pas ───────────────────────────────────────── */

describe('la normalisation', () => {
  test('l\'auteur est la personne connectée, pas celle que le modèle a écrite', () => {
    // Un artefact engage quelqu'un. Laisser une machine désigner un responsable serait
    // absurde — et c'est la seule ligne du fichier qui n'est pas une opinion.
    const a = normaliser({ id: 'x', title: 'X', owner: { person: 'quelquun', scope: 'Data' } },
                         { auteur: 'ivguenyp123' });
    assert.equal(a.owner.person, 'ivguenyp123');
  });

  test('le niveau visé est plafonné à `équipe`', () => {
    // `officiel` se dérive maintenant du banc d'essai ; un brouillon ne le vise pas.
    const a = normaliser({ id: 'x', title: 'X', target_level: 'officiel',
                           golden_cases: [1, 2, 3] }, { auteur: 'moi' });
    assert.equal(a.target_level, 'team');
  });

  test('sans cas d\'or, le niveau retombe à `expérimental`', () => {
    const a = normaliser({ id: 'x', title: 'X', target_level: 'officiel' }, { auteur: 'moi' });
    assert.equal(a.target_level, 'experimental');
  });

  test('un bloc `derived` n\'est pas écrit du tout', () => {
    // L015 le refuserait ; mieux vaut ne pas compter sur une règle pour effacer ce qu'on
    // peut simplement ne pas produire.
    const a = normaliser({ id: 'x', title: 'X', derived: { level: 'officiel' } }, { auteur: 'moi' });
    assert.equal('derived' in a, false);
  });

  test('l\'identifiant est réparé, jamais laissé invalide', () => {
    assert.equal(identifiant('Relire Un Changement', ''), 'relire-un-changement');
    assert.equal(identifiant('Générer des tests', ''), 'generer-des-tests');
    assert.equal(identifiant('', 'Optimiser une requête SQL'), 'optimiser-une-requete-sql');
    assert.equal(identifiant('', ''), 'artefact-sans-nom');
    assert.equal(identifiant('123-mauvais', 'Un titre'), 'un-titre');
  });
});

/* ── La boucle : le noyau gouverne ────────────────────────────────────────── */

describe('la boucle de correction', () => {
  test('du premier coup : un seul appel, un artefact conforme', async () => {
    const m = moteurDePapier([enBloc(BON)]);
    const r = await rediger({ phrase: 'rédiger un message de commit', auteur: 'moi' }, outils(m));

    assert.equal(m.invites.length, 1);
    assert.equal(r.report.blocked, false);
    assert.equal(r.abandon, false);
    assert.equal(r.artefact.owner.person, 'moi');
    assert.deepEqual(r.jetons, { entree: 100, sortie: 200 });
  });

  test('refusé, il repart avec les constats — et la porte, elle, ne bouge pas', async () => {
    const m = moteurDePapier([enBloc(MAUVAIS), enBloc(BON)]);
    const r = await rediger({ phrase: 'rédiger un message de commit', auteur: 'moi' }, outils(m));

    assert.equal(m.invites.length, 2, 'le refus a déclenché un second tour');

    // LA propriété : la seconde invite est faite des constats du linter. La machine ne
    // juge pas son propre travail — les 23 règles le jugent, et elle s'y plie.
    const seconde = m.invites[1];
    assert.ok(seconde.includes('[L008]'), 'le critère manquant est rendu au modèle');
    assert.ok(seconde.includes('[L004]'), 'l\'outil inventé aussi');
    assert.ok(seconde.includes('read_the_whole_internet'), 'avec son propre brouillon');

    assert.equal(r.report.blocked, false);
    assert.equal(r.abandon, false);
    assert.equal(r.tours.length, 2);
    assert.equal(r.tours[0].report.blocked, true);
  });

  test('jamais conforme : le brouillon est rendu COMME refusé', async () => {
    // Le pire scénario possible serait un rédacteur qui, faute de convergence, rende un
    // brouillon en le présentant comme bon. `abandon` est là pour ça.
    const m = moteurDePapier([enBloc(MAUVAIS)]);
    const r = await rediger({ phrase: 'rédiger un message de commit', auteur: 'moi' },
                            outils(m, { tours: 3 }));

    assert.equal(m.invites.length, 3, 'trois tours, puis la main est rendue');
    assert.equal(r.abandon, true);
    assert.equal(r.report.blocked, true);
    assert.ok(r.artefact, 'le brouillon reste rendu : une charpente vaut mieux qu\'un formulaire vide');
  });

  test('une réponse illisible n\'emporte pas la boucle', async () => {
    const m = moteurDePapier(['je ne peux pas faire ça', enBloc(BON)]);
    const r = await rediger({ phrase: 'un agent', auteur: 'moi' }, outils(m));

    assert.ok(r.tours[0].illisible, 'un YAML illisible est dit comme tel');
    assert.equal(r.tours[0].report, null, 'ce n\'est pas un constat de lint : aucune règle n\'a parlé');
    assert.equal(r.abandon, false);
    assert.equal(r.report.blocked, false);
  });

  test('le fichier RENDU est celui qui a été linté, à la ligne près', async () => {
    /*
     * Piège vécu en écrivant ce module : `normaliser()` force l'auteur, plafonne le
     * niveau et répare l'identifiant — sur l'OBJET. Écrire le YAML brut du modèle aurait
     * donc déposé un fichier dont l'auteur n'est pas celui qu'on a jugé. Ce qui est
     * linté et ce qui est écrit doivent être le même artefact.
     */
    const m = moteurDePapier([enBloc(BON.replace('person: ivguenyp123', 'person: quelquun'))]);
    const r = await rediger({ phrase: 'rédiger un message de commit', auteur: 'moi' },
                            outils(m, { serialiser: toYaml }));

    assert.ok(r.yaml.includes('person: quelquun'), 'le brut du modèle porte bien son auteur à lui');
    assert.ok(!r.rendu.includes('quelquun'), 'le rendu ne le porte plus');
    assert.deepEqual(yaml.parse(r.rendu), r.artefact, 'aller-retour exact');
  });

  test('le rapport rendu vient du VRAI linter, pas d\'une copie assouplie', async () => {
    const m = moteurDePapier([enBloc(BON)]);
    const r = await rediger({ phrase: 'rédiger un message de commit', auteur: 'moi' }, outils(m));
    assert.deepEqual(r.report, lint(r.artefact, { ...registres, artifacts: [] }));
  });
});

/* ── Le point d'entrée ────────────────────────────────────────────────────── */

describe('POST /api/rediger', () => {
  const deps = (moteur) => ({
    registres, models: [], lint, parse: (t) => yaml.parse(t),
    creerVertex: () => moteur
  });

  test('refuse une phrase trop courte, en disant pourquoi', async () => {
    const { status, corps } = await apiRediger({ phrase: 'un agent' }, deps(moteurDePapier([])));
    assert.equal(status, 400);
    assert.match(corps.erreur, /une phrase/);
  });

  test('refuse un cahier des charges déguisé en phrase', async () => {
    const { status } = await apiRediger({ phrase: 'x'.repeat(PHRASE_MAX + 1) },
                                        deps(moteurDePapier([])));
    assert.equal(status, 400);
  });

  test('sans moteur configuré : 503, et le message dit quelle variable poser', async () => {
    const { status, corps } = await apiRediger(
      { phrase: 'un agent qui relit un diff et propose un message de commit' },
      { registres, lint, parse: (t) => yaml.parse(t),
        creerVertex: () => { throw new Error('Aucune clé DeepSeek : renseigne DEEPSEEK_API_KEY.'); } });
    assert.equal(status, 503);
    assert.match(corps.erreur, /DEEPSEEK_API_KEY/);
  });

  test('rend le brouillon, son verdict et le journal des tours', async () => {
    const m = moteurDePapier([enBloc(MAUVAIS), enBloc(BON)]);
    const { status, corps } = await apiRediger(
      { phrase: 'un agent qui rédige un message de commit à partir du diff',
        auteur: 'ivguenyp123', scope: 'Plateforme' }, deps(m));

    assert.equal(status, 200);
    assert.equal(corps.abandon, false);
    assert.equal(corps.artefact.owner.person, 'ivguenyp123');
    assert.equal(corps.artefact.owner.scope, 'Plateforme');
    assert.equal(corps.tours.length, 2);
    assert.equal(corps.tours[0].erreurs > 0, true);
    assert.ok(corps.tours[0].constats.some((c) => c.code === 'L008'));
  });

  test('un périmètre inconnu n\'est pas repris — L006 en dépend', async () => {
    const m = moteurDePapier([enBloc(BON)]);
    const { corps } = await apiRediger(
      { phrase: 'un agent qui rédige un message de commit', scope: 'Plateforme; Data' }, deps(m));
    assert.notEqual(corps.artefact.owner.scope, 'Plateforme; Data');
  });

  test('ne renvoie JAMAIS la consigne envoyée au modèle', async () => {
    /*
     * Même règle que `executer` : la consigne contient le registre entier et la phrase
     * de l'utilisateur. La renvoyer par confort de débogage la ferait fuiter dans la
     * console de tout le monde — et surtout, elle n'apprend rien à qui relit l'artefact.
     */
    const m = moteurDePapier([enBloc(BON)]);
    const { corps } = await apiRediger(
      { phrase: 'un agent qui rédige un message de commit' }, deps(m));
    const texte = JSON.stringify(corps);
    assert.ok(!texte.includes('OUTILS DISPONIBLES'), 'la consigne ne repart pas vers la page');
    assert.ok(!texte.includes('RÈGLES QUI JUGERONT'));
  });

  test('n\'écrit rien : il rend un brouillon, il ne dépose pas', async () => {
    // Le rédacteur ne pousse pas dans `artifacts/pending/`. C'est le Studio qui dépose,
    // sur un clic — sinon la file de validation deviendrait une formalité pour machines.
    const m = moteurDePapier([enBloc(BON)]);
    const { corps } = await apiRediger({ phrase: 'un agent qui rédige un message de commit' },
                                       deps(m));
    assert.equal(corps.depose, undefined);
    assert.ok(corps.artefact, 'juste un brouillon');
  });
});
