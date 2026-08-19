/*
 * Le suivi de l'amont — constater qu'un import a bougé, sans jamais le « mettre à jour ».
 *
 * Deux choses se verrouillent ici. D'abord L'ALLER-RETOUR : la provenance est relue
 * depuis l'en-tête que `enteteDe` écrit RÉELLEMENT — pas depuis une copie du format
 * recopiée dans le test. Si quelqu'un renomme `# pack:` en `# source:` dans
 * import-artefact.js, c'est CE fichier qui casse, pas le suivi des utilisateurs six
 * mois plus tard. Ensuite LES ISSUES : « on n'a pas su comparer » n'est ni « à jour »
 * ni « modifié » — c'est un troisième état, et il se voit.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { provenanceDe, verdictAmont,
         IDENTIQUE, MODIFIE, DISPARU, NON_VERIFIABLE } from '../lib/import-suivi.js';
import { lireCapacite } from '../lib/import-pack.js';
import { enteteDe } from '../lib/import-artefact.js';

const sha = (texte) => createHash('sha256').update(texte, 'utf8').digest('hex');

const CORPS = 'USE ONLY IN ISOLATED ENVIRONMENTS.\nRead each finding, keep what you confirm.\n';
const SKILL = `---
name: mantis-review
description: Reviews findings and filters out false positives.
---
${CORPS}`;

const PACK = { source: 'google/mantis@main', commit: 'deadbeefcafe0123' };

const capacite = () => lireCapacite({
  chemin: 'skills/mantis-review/SKILL.md', contenu: SKILL, commit: PACK.commit, hacher: sha
});

describe('provenanceDe relit ce que enteteDe écrit — l\'aller-retour verrouille le format', () => {
  test('dépôt, référence, commit, fichier et empreinte ressortent intacts', () => {
    const entete = enteteDe({ capacite: capacite(), pack: PACK });
    const p = provenanceDe(`${entete}id: mantis-review\nkind: prompt\n`);

    assert.equal(p.depot, 'google/mantis');
    assert.equal(p.ref, 'main');
    assert.equal(p.commit, 'deadbeefcafe0123');
    assert.equal(p.fichier, 'skills/mantis-review/SKILL.md');
    assert.equal(p.sha256, sha(SKILL));
  });

  test('sans hacheur à l\'import, la provenance existe mais l\'empreinte est nulle', () => {
    const nue = lireCapacite({ chemin: 'a/SKILL.md', contenu: SKILL, commit: PACK.commit });
    const p = provenanceDe(enteteDe({ capacite: nue, pack: PACK }));
    assert.equal(p.sha256, null);
    assert.equal(p.fichier, 'a/SKILL.md');
  });

  test('un artefact écrit à la main n\'a pas d\'amont, et ce n\'est pas une erreur', () => {
    assert.equal(provenanceDe('id: commit-message\nkind: prompt\n'), null);
    assert.equal(provenanceDe('# un simple commentaire\nid: x\n'), null);
    assert.equal(provenanceDe(''), null);
  });

  test('un pack ou un commit inconnus (`?`) rendent la provenance inexploitable', () => {
    // enteteDe écrit `?` quand il ne sait pas ; on ne suit pas une adresse inconnue.
    const p = provenanceDe('# salsi-provenance: import\n# pack: ?\n# commit: abc\n# fichier: a\n');
    assert.equal(p, null);
  });

  test('la lecture s\'arrête au premier vrai contenu : un `# pack:` dans le corps ne compte pas', () => {
    // Le spec cite du markdown de l'amont (I004) — qui a le droit de contenir la chaîne
    // `# pack:`. Elle ne doit jamais passer pour de la provenance.
    const texte = '# salsi-provenance: import\n# pack: vrai/depot@main\n# commit: abc\n'
      + '# fichier: a/SKILL.md\n\nid: x\nspec: |\n  # pack: faux/depot@evil\n';
    assert.equal(provenanceDe(texte).depot, 'vrai/depot');
  });
});

describe('verdictAmont — quatre issues, et la troisième ne se maquille pas', () => {
  const PROV = { depot: 'google/mantis', ref: 'main', commit: 'deadbeefcafe0123',
                 fichier: 'skills/mantis-review/SKILL.md', sha256: sha(SKILL) };

  test('la tête n\'a pas bougé : identique, sans même lire le fichier', () => {
    const v = verdictAmont({ provenance: PROV, commitAmont: PROV.commit, contenuAmont: null });
    assert.equal(v.issue, IDENTIQUE);
  });

  test('la tête a bougé mais le fichier cité est le même : identique, par empreinte', () => {
    const v = verdictAmont({ provenance: PROV, commitAmont: 'autrecommit',
                             contenuAmont: SKILL, hacher: sha });
    assert.equal(v.issue, IDENTIQUE);
    assert.match(v.detail, /empreinte/);
  });

  test('le fichier cité a changé : modifié, et le détail nomme le fichier et le commit épinglé', () => {
    const v = verdictAmont({ provenance: PROV, commitAmont: 'autrecommit',
                             contenuAmont: `${SKILL}\nNEW INSTRUCTIONS.\n`, hacher: sha });
    assert.equal(v.issue, MODIFIE);
    assert.match(v.detail, /SKILL\.md/);
    assert.match(v.detail, /deadbeef/);
  });

  test('le fichier n\'existe plus en amont : disparu — le texte cité est le seul qui reste', () => {
    const v = verdictAmont({ provenance: PROV, commitAmont: 'autrecommit', contenuAmont: null });
    assert.equal(v.issue, DISPARU);
    assert.match(v.detail, /seul qui reste/);
  });

  test('sans empreinte, les textes se comparent — épinglé contre tête', () => {
    const sans = { ...PROV, sha256: null };
    assert.equal(verdictAmont({ provenance: sans, commitAmont: 'x', contenuAmont: SKILL,
                                contenuEpingle: SKILL }).issue, IDENTIQUE);
    assert.equal(verdictAmont({ provenance: sans, commitAmont: 'x', contenuAmont: 'autre',
                                contenuEpingle: SKILL }).issue, MODIFIE);
  });

  test('sans empreinte NI texte épinglé relisible : non vérifiable, jamais « à jour »', () => {
    const sans = { ...PROV, sha256: null };
    const v = verdictAmont({ provenance: sans, commitAmont: 'x', contenuAmont: SKILL });
    assert.equal(v.issue, NON_VERIFIABLE);
    assert.match(v.detail, /ne se maquille pas/);
  });

  test('le hacheur qui rend null ne conclut pas : non vérifiable', () => {
    // Même contrat que lireCapacite : une empreinte fausse est pire qu'absente.
    const v = verdictAmont({ provenance: PROV, commitAmont: 'x', contenuAmont: SKILL,
                             hacher: () => null });
    assert.equal(v.issue, NON_VERIFIABLE);
  });
});

describe('le registre des sources amont est lisible et complet', () => {
  test('chaque source porte id, nom, depot et pourquoi', async () => {
    const { readFileSync } = await import('node:fs');
    const yaml = (await import('../lib/yaml.js')).default;
    const doc = yaml.parse(readFileSync(
      new URL('../registries/sources-amont.yaml', import.meta.url), 'utf8'));

    assert.ok(Array.isArray(doc.sources) && doc.sources.length >= 2,
      'au moins deux sources connues');
    for (const s of doc.sources) {
      for (const champ of ['id', 'nom', 'depot', 'pourquoi']) {
        assert.ok(s[champ], `la source ${s.id || '?'} porte \`${champ}\``);
      }
      assert.match(s.depot, /^[\w.-]+(\/[\w.-]+)+$/,
        `\`${s.depot}\` est un chemin owner/repo, pas une URL`);
    }
    const ids = doc.sources.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'les id sont uniques');
  });
});
