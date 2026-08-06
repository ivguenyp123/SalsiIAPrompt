/*
 * Tests du module de livraison — le code derrière `bump_image_tag`.
 *
 * Ce module écrit dans un dépôt : c'est la partie du produit où une erreur coûte cher.
 * D'où le choix de le rendre PUR — il calcule un plan, il n'écrit rien. L'original, dans
 * le hub DevOps, mélange calcul et appels réseau et n'est donc testable qu'à la main,
 * sur un vrai dépôt. Ici, chaque règle de réécriture est vérifiée hors navigateur.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { bumpVersion, versionCourante, reecrireCI, reecrireOverlay, planifier, resumer }
  from '../runtime/livraison.js';

const CI = `stages: [build, deploy]

variables:
  IMAGE_TAG: "1.4.2"
  REGISTRY: registry.interne.lcl

build:
  script: [docker build -t $REGISTRY/app:$IMAGE_TAG .]
`;

const OVERLAY = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
images:
  - name: app
    newTag: "1.4.2"
configMapGenerator:
  - name: app-config
    literals:
      - APP_VERSION=1.4.2
`;

const BASE = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
`;

describe('le bump SemVer', () => {
  test('patch, minor et major remettent bien à zéro ce qu\'il faut', () => {
    assert.equal(bumpVersion('1.4.2', 'patch'), '1.4.3');
    assert.equal(bumpVersion('1.4.2', 'minor'), '1.5.0');
    assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0');
  });

  test('patch est le défaut', () => assert.equal(bumpVersion('0.0.9'), '0.0.10'));

  test('une version non SemVer rend une chaîne vide au lieu de deviner', () => {
    // Deviner produirait un tag inventé, poussé en préproduction. Mieux vaut refuser.
    for (const v of ['latest', 'v1.4', '', null, undefined, 'main-abc123']) {
      assert.equal(bumpVersion(v, 'patch'), '', `${v} ne doit pas être bumpé`);
    }
  });

  test('un suffixe est toléré à la lecture, pas conservé', () => {
    assert.equal(bumpVersion('1.4.2-rc1', 'patch'), '1.4.3');
  });
});

describe('la lecture et la réécriture du fichier de CI', () => {
  test('la version courante est lue', () => assert.equal(versionCourante(CI), '1.4.2'));

  test('sans le motif, on rend vide', () => {
    assert.equal(versionCourante('stages: [build]\n'), '');
  });

  test('la réécriture conserve les guillemets et l\'indentation', () => {
    const apres = reecrireCI(CI, '1.4.3');
    assert.match(apres, /^ {2}IMAGE_TAG: "1\.4\.3"$/m);
    // Le reste du fichier est intact : on ne reformate pas la CI de quelqu'un d'autre.
    assert.equal(apres.split('\n').length, CI.split('\n').length);
    assert.ok(apres.includes('REGISTRY: registry.interne.lcl'));
  });

  test('sans guillemets, on n\'en ajoute pas', () => {
    const sans = 'variables:\n  IMAGE_TAG: 1.4.2\n';
    assert.equal(reecrireCI(sans, '1.5.0'), 'variables:\n  IMAGE_TAG: 1.5.0\n');
  });
});

describe('la réécriture des overlays', () => {
  test('newTag et APP_VERSION suivent la même version', () => {
    const apres = reecrireOverlay(OVERLAY, '1.4.3');
    assert.match(apres, /newTag: "1\.4\.3"/);
    assert.match(apres, /APP_VERSION=1\.4\.3/);
  });

  test('un kustomization de base ressort intact', () => {
    // Il ne porte pas la version. Le commiter salirait l'historique en laissant croire
    // à une modification.
    assert.equal(reecrireOverlay(BASE, '9.9.9'), BASE);
  });
});

/* ── Le plan, c'est-à-dire la décision ───────────────────────────────────── */

const entree = (extra = {}) => ({
  branche: 'feat/refunds', brancheCible: 'main', bump: 'patch',
  ci: { path: '.gitlab-ci.yml', content: CI },
  overlays: [{ path: 'k8s/overlays/preprod/kustomization.yaml', content: OVERLAY },
             { path: 'k8s/base/kustomization.yaml', content: BASE }],
  ...extra
});

describe('le plan de livraison', () => {
  test('il annonce la version, les fichiers et le message de commit', () => {
    const p = planifier(entree());
    assert.equal(p.ok, true);
    assert.equal(p.courante, '1.4.2');
    assert.equal(p.cible, '1.4.3');
    assert.equal(p.message, '[Livraison] Bump IMAGE_TAG → 1.4.3');
    assert.equal(p.titreMR, 'release 1.4.3');
  });

  test('seuls les fichiers RÉELLEMENT modifiés entrent au commit', () => {
    const p = planifier(entree());
    assert.deepEqual(p.fichiers.map((f) => f.path),
      ['.gitlab-ci.yml', 'k8s/overlays/preprod/kustomization.yaml']);
    assert.equal(p.overlaysTouches, 1, 'le kustomization de base est écarté');
  });

  test('le fichier de CI est toujours du lot — la cible diffère toujours de la courante', () => {
    // La version courante est lue dans le contenu qu'on réécrit, à l'instant : un plan
    // valide modifie donc au minimum la CI. C'est ce qui rend inutile le garde
    // « rien à modifier » que porte l'original du hub, où la courante vient d'un état
    // d'écran qui peut avoir vieilli.
    const p = planifier(entree({ overlays: [] }));
    assert.equal(p.ok, true);
    assert.deepEqual(p.fichiers.map((f) => f.path), ['.gitlab-ci.yml']);
    assert.equal(p.overlaysTouches, 0);
  });

  test('un dépôt sans aucun overlay se livre quand même', () => {
    const p = planifier(entree({ overlays: [] }));
    assert.equal(p.ok, true, 'les overlays sont un plus, pas une condition');
  });
});

describe('ce que le plan refuse, et pourquoi', () => {
  const refus = (extra) => planifier(entree(extra));

  test('livrer une branche sur elle-même : pas de MR, donc pas de revue', () => {
    const p = refus({ branche: 'main' });
    assert.equal(p.ok, false);
    assert.match(p.raison, /pas de revue/);
  });

  test('aucun fichier de CI : on ne devine pas où vit la version', () => {
    const p = refus({ ci: null });
    assert.equal(p.ok, false);
    assert.match(p.raison, /Aucun fichier de CI/);
  });

  test('IMAGE_TAG absent du fichier trouvé', () => {
    const p = refus({ ci: { path: '.gitlab-ci.yml', content: 'stages: [build]\n' } });
    assert.equal(p.ok, false);
    assert.match(p.raison, /introuvable/);
  });

  test('version non SemVer : refus explicite plutôt que tag inventé', () => {
    const p = refus({ ci: { path: '.gitlab-ci.yml', content: 'variables:\n  IMAGE_TAG: latest\n' } });
    assert.equal(p.ok, false);
    assert.match(p.raison, /non SemVer/);
  });

  test('aucune branche choisie', () => {
    assert.equal(planifier({}).ok, false);
  });
});

describe('le résumé lu par l\'humain avant de confirmer', () => {
  test('il dit tout ce qu\'il faut pour décider', () => {
    const p = planifier(entree({ bump: 'minor' }));
    const texte = resumer(p, { branche: 'feat/refunds', brancheCible: 'main' });
    for (const attendu of ['feat/refunds', 'main', '1.4.2', '1.5.0', 'overlay']) {
      assert.ok(texte.includes(attendu), `le résumé mentionne ${attendu} : ${texte}`);
    }
  });

  test('en cas de refus, il donne la raison et pas un résumé creux', () => {
    const p = planifier(entree({ ci: null }));
    assert.equal(resumer(p, {}), p.raison);
  });
});
