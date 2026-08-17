/*
 * La matière de sécurité — le chiffre au code, l'explication à l'agent.
 *
 * Ce qui se vérifie ici tient en trois idées, et ce sont les trois façons qu'un rapport de
 * sécurité a de mentir :
 *
 *   IL INVENTE      — un constat qui ne vient d'aucun fichier lu ;
 *   IL SE TAIT      — un scan partiel qui se présente comme complet ;
 *   IL RASSURE      — un contrôle qu'on n'a pas pu faire, compté comme réussi.
 *
 * Un test rouge ici vaut mieux qu'un dépôt déclaré propre à tort.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fichierSuspect, apercuDe, scannerSecrets, rapportSecrets, resumeSecrets,
         ecosysteme, verifierManifeste, inventaireDependances, resumeDependances,
         rapportConformite, resumeConformite, versionsMavenMouvantes,
         POIDS_CIS, NON_VERIFIABLES, MOTIFS_SECRET } from '../lib/signaux-securite.js';
import { sait, SIGNAUX } from '../lib/signaux-matiere.js';

/*
 * Les valeurs d'essai sont FABRIQUÉES pour ressembler à un secret sans en être un : elles
 * respectent la forme du motif et rien d'autre. Aucun secret réel n'entre dans ce dépôt,
 * et surtout pas dans un fichier que tout le monde lit.
 */
const FAUX_AWS = `AKIA${'Q'.repeat(16)}`;
const FAUX_GHP = `ghp_${'b'.repeat(36)}`;

describe('les trois signaux sont au registre', () => {
  test('la plateforme sait les calculer, donc l\'écran ne les demandera pas', () => {
    for (const nom of ['rapport_secrets', 'inventaire_dependances', 'rapport_conformite']) {
      assert.equal(sait(nom), true, `${nom} devrait être calculable`);
      assert.ok(SIGNAUX[nom].libelle, `${nom} doit dire ce qu'il est`);
    }
  });
});

describe('quels fichiers on lit', () => {
  test('les fichiers à risque sont retenus', () => {
    for (const f of ['.env', 'config/credentials.json', 'deploy/id_rsa', 'terraform.tfvars',
                     'src/application-prod.yml', 'certs/server.pem', '.npmrc']) {
      assert.equal(fichierSuspect(f), true, `${f} devrait être lu`);
    }
  });

  test('un exemple n\'est pas un secret, et un binaire non plus', () => {
    for (const f of ['.env.example', 'docs/credentials.md', 'logo.png']) {
      assert.equal(fichierSuspect(f), false, `${f} ne devrait pas être lu`);
    }
  });

  test('les dépendances installées sont hors périmètre', () => {
    // Sans ça, un seul `node_modules` versionné ferait des milliers d'appels et autant de
    // constats qui n'appartiennent pas à l'équipe.
    assert.equal(fichierSuspect('node_modules/paquet/.env'), false);
    assert.equal(fichierSuspect('vendor/lib/config.json'), false);
  });

  test('le code ordinaire n\'est pas lu', () => {
    assert.equal(fichierSuspect('src/index.js'), false);
  });
});

describe('le scan des secrets', () => {
  test('un secret trouvé porte son fichier, sa ligne et sa nature', () => {
    const [c] = scannerSecrets(`ligne\nkey = ${FAUX_AWS}\n`, '.env');
    assert.equal(c.fichier, '.env');
    assert.equal(c.ligne, 2);
    assert.equal(c.type, 'AWS Access Key');
  });

  test('la valeur ne sort jamais entière', () => {
    const [c] = scannerSecrets(`token=${FAUX_GHP}`, '.env');
    assert.ok(c.apercu.endsWith('***'));
    assert.ok(c.apercu.length <= 11);
    assert.equal(c.apercu.includes(FAUX_GHP), false);
  });

  test('un aperçu ne redéclenche aucun motif — sinon le rapport republierait le secret', () => {
    // C'est le contrat qui lie ce module au critère `output.contains_secret`. S'il tombait,
    // un rapport de secrets échouerait sa propre porte, et pour une bonne raison.
    for (const valeur of [FAUX_AWS, FAUX_GHP, `sk-ant-${'c'.repeat(40)}`]) {
      const apercu = apercuDe(valeur);
      for (const m of MOTIFS_SECRET) {
        const re = new RegExp(m.re.source, m.re.flags.replace('g', ''));
        assert.equal(re.test(apercu), false, `${m.nom} rematche l'aperçu « ${apercu} »`);
      }
    }
  });

  test('une valeur manifestement factice est écartée', () => {
    assert.equal(scannerSecrets('token=${GITHUB_TOKEN}\nkey=CHANGE_ME', '.env').length, 0);
  });

  test('une ligne minifiée est sautée, pas scannée', () => {
    const longue = `${'x'.repeat(600)}${FAUX_AWS}`;
    assert.equal(scannerSecrets(longue, 'config.json').length, 0);
  });
});

describe('le rapport de secrets', () => {
  const avec = (fichiers, reste = {}) =>
    rapportSecrets({ depot: 'eq/dep', fichiers, candidats: fichiers.length, total: 10, ...reste });

  test('aucun fichier lu n\'est PAS un dépôt propre', () => {
    // La distinction qui compte : « rien trouvé » et « rien cherché » ne se disent pas
    // pareil. Les confondre transformerait une panne en feu vert.
    const r = avec([], { candidats: 0 });
    assert.match(r.texte, /absence de mesure/);
    assert.equal(r.presentation.entete.ton, 'na');
    assert.match(resumeSecrets(r), /pas de mesure/);
  });

  test('des fichiers lus sans constat se disent sans constat', () => {
    const r = avec([{ chemin: '.env', contenu: 'PORT=8080' }]);
    assert.equal(r.comptes.constats, 0);
    assert.match(r.texte, /Aucun secret détecté/);
    assert.equal(r.presentation.entete.ton, 'ok');
  });

  test('ce qui n\'a pas été lu est compté et dit', () => {
    const r = avec([{ chemin: '.env', contenu: 'PORT=1' }], { candidats: 9 });
    assert.equal(r.comptes.nonLus, 8);
    assert.match(r.texte, /8 fichier\(s\) à risque n'ont PAS été lus/);
  });

  test('le texte rappelle que l\'historique n\'est pas vu', () => {
    // Un rapport qui ne le dirait pas ferait croire qu'un secret supprimé est un secret
    // révoqué. C'est l'erreur la plus coûteuse du sujet.
    const r = avec([{ chemin: '.env', contenu: `k=${FAUX_AWS}` }]);
    assert.match(r.texte, /historique git/);
    assert.match(r.texte, /ne le révoque pas/);
  });

  test('la matière envoyée ne porte aucun secret entier', () => {
    const r = avec([{ chemin: '.env', contenu: `k=${FAUX_AWS}\nt=${FAUX_GHP}` }]);
    assert.equal(r.texte.includes(FAUX_AWS), false);
    assert.equal(r.texte.includes(FAUX_GHP), false);
    /*
     * TROIS constats pour deux valeurs, et c'est voulu : un jeton `ghp_` répond à la fois
     * au motif « GitHub PAT (classic) » et au motif « GitHub Token (oauth/server/refresh) ».
     * Les motifs de la plateforme se recouvrent, et on les reprend tels quels — dédoublonner
     * ici ferait diverger notre compte du sien sans que personne ne sache lequel croire.
     * Ça ne change rien à l'action : c'est la même ligne à révoquer.
     */
    assert.equal(r.comptes.constats, 3);
    assert.equal(r.comptes.fichiersTouches, 1);
  });
});

describe('la chaîne d\'approvisionnement', () => {
  test('les manifestes sont reconnus, le reste non', () => {
    assert.equal(ecosysteme('package.json'), 'npm');
    assert.equal(ecosysteme('back/pom.xml'), 'maven');
    assert.equal(ecosysteme('Dockerfile'), 'docker');
    assert.equal(ecosysteme('node_modules/x/package.json'), null);
    assert.equal(ecosysteme('src/index.js'), null);
  });

  test('un script d\'installation est ROUGE : il s\'exécute sur chaque poste', () => {
    const c = verifierManifeste('npm',
      JSON.stringify({ scripts: { postinstall: 'node build.js' } }), 'package.json');
    assert.equal(c.length, 1);
    assert.equal(c[0].severite, 'rouge');
  });

  test('une version figée ne produit aucun constat', () => {
    const c = verifierManifeste('npm',
      JSON.stringify({ dependencies: { gauche: '1.2.3' } }), 'package.json');
    assert.equal(c.length, 0);
  });

  test('`latest` est rouge, un intervalle est orange', () => {
    const c = verifierManifeste('npm',
      JSON.stringify({ dependencies: { a: 'latest', b: '^1.0.0' } }), 'package.json');
    assert.deepEqual(c.map((x) => x.severite).sort(), ['orange', 'rouge']);
  });

  test('un manifeste illisible ne fait pas tomber le scan', () => {
    assert.deepEqual(verifierManifeste('npm', '{ pas du json', 'package.json'), []);
  });

  test('un `curl | sh` dans un Dockerfile est rouge', () => {
    const c = verifierManifeste('docker', 'RUN curl https://x.sh | bash\n', 'Dockerfile');
    assert.equal(c[0].severite, 'rouge');
  });

  test('l\'inventaire sépare les rouges des oranges', () => {
    const r = inventaireDependances({
      depot: 'eq/dep', candidats: 2,
      fichiers: [
        { chemin: 'package.json', eco: 'npm',
          contenu: JSON.stringify({ scripts: { install: 'x' }, dependencies: { a: '^1.0.0' } }) },
        { chemin: 'Dockerfile', eco: 'docker', contenu: 'FROM node\n' }
      ]
    });
    assert.equal(r.comptes.rouges, 1);
    assert.equal(r.comptes.oranges, 2);
    assert.equal(r.presentation.entete.ton, 'ko');
    assert.match(resumeDependances(r), /1 rouge/);
  });

  test('aucun manifeste ne se lit pas « aucune dépendance »', () => {
    const r = inventaireDependances({ depot: 'eq/dep', fichiers: [], candidats: 0 });
    assert.match(r.texte, /pas la preuve qu'il n'en a pas/);
    assert.equal(r.presentation.entete.ton, 'na');
  });

  test('sans rouge mais avec des oranges, l\'en-tête est jaune et non vert', () => {
    const r = inventaireDependances({
      depot: 'eq/dep', candidats: 1,
      fichiers: [{ chemin: 'Dockerfile', eco: 'docker', contenu: 'FROM node:latest\n' }]
    });
    assert.equal(r.comptes.rouges, 0);
    assert.equal(r.presentation.entete.ton, 'moyen');
  });
});

describe('la conformité CIS', () => {
  const base = {
    depot: 'eq/dep', defaut: 'main',
    branches: [{ name: 'main', protectee: true, default: true }],
    chemins: ['README.md'],
    maintenant: '2026-08-17T00:00:00Z',
    derniereActivite: '2026-08-10T00:00:00Z'
  };

  test('une branche par défaut non protégée est un écart certain', () => {
    const r = rapportConformite({ ...base,
      branches: [{ name: 'main', protectee: false, default: true }] });
    const c = r.controles.find((x) => x.id === 'branch');
    assert.equal(c.etat, 'ko');
    assert.equal(c.poids, POIDS_CIS.branch);
  });

  /*
   * Le cas qui décide de l'honnêteté du rapport. Le hub exige protégée ET force push
   * interdit ; notre couche ne voit que le premier. Compter ça comme un succès ferait
   * passer pour conforme un dépôt où l'historique peut être effacé.
   */
  test('protégée sans savoir pour le force push : non vérifiable, jamais conforme', () => {
    const r = rapportConformite(base);
    const c = r.controles.find((x) => x.id === 'branch');
    assert.equal(c.etat, 'unverif');
    assert.match(c.detail, /force push/);
  });

  test('les quatre contrôles hors de portée sont listés, pas oubliés', () => {
    const r = rapportConformite(base);
    for (const n of NON_VERIFIABLES) {
      const c = r.controles.find((x) => x.id === n.id);
      assert.equal(c.etat, 'unverif', `${n.id} devrait être non vérifiable`);
      assert.match(r.texte, new RegExp(`CIS ${n.cis.replace(/\./g, '\\.')}`));
    }
  });

  test('le non vérifiable est retiré du dénominateur, pas compté comme réussi', () => {
    // CODEOWNERS et SECURITY.md absents (5 + 5), inactivité bonne (5) : 5 / 15 = 33.
    // Si les non vérifiables comptaient pour des succès, la note dépasserait 80.
    const r = rapportConformite(base);
    assert.equal(r.comptes.poidsNote, 15);
    assert.equal(r.note, 33);
  });

  test('le verdict est binaire : un seul écart et c\'est non conforme', () => {
    const r = rapportConformite({ ...base, chemins: ['CODEOWNERS'] });
    assert.equal(r.controles.find((x) => x.id === 'codeowners').etat, 'ok');
    assert.equal(r.verdict, 'non conforme');   // SECURITY.md manque encore
    assert.ok(r.note > 0);
  });

  test('CODEOWNERS est aussi cherché là où GitHub le range', () => {
    // Sans ce chemin, tout dépôt GitHub correctement outillé serait déclaré en écart.
    const r = rapportConformite({ ...base, chemins: ['.github/CODEOWNERS'] });
    assert.equal(r.controles.find((x) => x.id === 'codeowners').etat, 'ok');
  });

  test('un dépôt sans commit depuis plus de six mois est un écart', () => {
    const r = rapportConformite({ ...base, derniereActivite: '2025-01-01T00:00:00Z' });
    assert.equal(r.controles.find((x) => x.id === 'inactive').etat, 'ko');
  });

  test('sans date de dernier commit, on ne tranche pas', () => {
    const r = rapportConformite({ ...base, derniereActivite: '' });
    assert.equal(r.controles.find((x) => x.id === 'inactive').etat, 'unverif');
  });

  test('un manifeste sans verrou est un écart, un dépôt sans manifeste n\'a pas le contrôle', () => {
    const sans = rapportConformite({ ...base, chemins: ['package.json'] });
    assert.equal(sans.controles.find((x) => x.id === 'lockfiles').etat, 'ko');

    const avec = rapportConformite({ ...base, chemins: ['package.json', 'package-lock.json'] });
    assert.equal(avec.controles.find((x) => x.id === 'lockfiles').etat, 'ok');

    assert.equal(rapportConformite(base).controles.some((x) => x.id === 'lockfiles'), false);
  });

  test('un pom.xml présent mais non lu ne vaut pas « toutes figées »', () => {
    const r = rapportConformite({ ...base, chemins: ['pom.xml'], pom: null });
    assert.equal(r.controles.find((x) => x.id === 'maven').etat, 'unverif');
  });

  test('les versions Maven mouvantes sont celles que la plateforme repère', () => {
    const pom = '<version>[1.0,2.0)</version><version>LATEST</version><version>3.1.4</version>';
    assert.equal(versionsMavenMouvantes(pom).length, 2);
    const r = rapportConformite({ ...base, chemins: ['pom.xml'], pom });
    assert.equal(r.controles.find((x) => x.id === 'maven').etat, 'ko');
  });

  /*
   * Ce qu'on n'a pas lu ne devient pas un constat. Une liste de branches vide veut dire
   * qu'on n'a pas vu les branches — pas que la branche par défaut est ouverte à tous.
   *
   * L'arborescence, elle, se comporte autrement, et il faut le dire : `arbre()` remonte
   * son erreur au lieu de rendre une liste vide, donc une liste vide signifie bien un
   * dépôt sans ces fichiers. `CODEOWNERS` absent est alors un écart réel, pas une
   * ignorance déguisée.
   */
  test('aucune branche lue : le contrôle n\'est pas tranché, ni dans un sens ni dans l\'autre', () => {
    const r = rapportConformite({ depot: 'eq/dep', branches: [], chemins: [],
                                  maintenant: null });
    assert.equal(r.controles.find((x) => x.id === 'branch').etat, 'unverif');
    assert.equal(r.controles.find((x) => x.id === 'inactive').etat, 'unverif');
    // Le poids 25 de la protection de branche ne pèse ni pour ni contre.
    assert.equal(r.comptes.poidsNote, 10);
    assert.match(r.texte, /n'ont PAS pu être vérifiés/);
  });

  test('sans aucun contrôle tranché, la note reste vide plutôt que nulle', () => {
    // Ce plancher n'est pas atteignable depuis un dépôt réel — CODEOWNERS et SECURITY.md
    // se tranchent toujours. Il tient quand même : une note de 0 se lit comme un dépôt
    // catastrophique, là où l'absence de mesure ne se lit pas du tout.
    const r = rapportConformite({ depot: 'eq/dep', branches: [], chemins: [],
                                  maintenant: null });
    const nu = { ...r, note: null, verdict: 'non mesuré' };
    assert.match(resumeConformite(nu), /pas de note/);
  });

  test('les écarts remontent en tête du tableau du rapport', () => {
    const lignes = rapportConformite(base).presentation.tableaux[0].lignes;
    assert.equal(lignes[0].ton, 'ko');
  });
});
