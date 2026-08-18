/*
 * Le journal des exécutions.
 *
 * ── CE QUE CES TESTS DÉFENDENT ───────────────────────────────────────────────
 *
 * Un journal est un objet à qui l'on fait confiance sans le vérifier : personne ne
 * recompte à la main mille exécutions pour contrôler un total. Une erreur d'agrégation ne
 * ressemble donc à rien — elle produit un chiffre plausible, affiché avec l'aplomb d'un
 * chiffre mesuré, et on décide dessus.
 *
 * D'où l'insistance, ci-dessous, sur les cas où un compteur MENT plutôt que sur ceux où
 * il plante : le seau vide qu'on n'émet pas, le refus compté comme un échec, le coût
 * inconnu affiché en zéro, la chaîne cassée comptée en réussite.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ISSUES, ORDRE_ISSUES, PAS, issueDe, ligne, cleDe, libelle,
         serie, palmares, resume, partEntree, MAX_RAISON } from '../lib/executions.js';
import { ajouter, lire, CHEMIN } from '../runtime/journal-exec.js';
import { executer } from '../runtime/api.js';

/* ── Une matière d'essai ──────────────────────────────────────────────────── */

const L = (le, sur = {}) => ligne({
  le,
  artifact: { id: 'a', title: 'Agent A', kind: 'prompt', model_tier: 'mid' },
  requete: { depot: 'lcl/paiement' },
  status: 200,
  corps: { jetons: { entree: 100, sortie: 50 }, postvol: { conforme: true },
           modele: 'gemini', cout: 0.01, ...sur },
  fournisseur: 'vertex'
});

/* ── L'issue ──────────────────────────────────────────────────────────────── */

describe('classer une exécution', () => {
  test('un refus au pré-vol n\'est PAS un échec', () => {
    /*
     * Le test le plus important du fichier.
     *
     * Compter un refus comme un échec ferait baisser le taux de réussite chaque fois que
     * la gouvernance fonctionne. La réaction rationnelle d'une équipe serait alors de
     * desserrer ses contrôles pour faire remonter son chiffre — un indicateur qui punit
     * le contrôle finit par le supprimer.
     */
    assert.equal(issueDe(409, { refuse: true, raison: 'P001' }), 'refus');
    assert.equal(ISSUES.refus.jugee, false, 'un refus est hors dénominateur');
    assert.equal(ISSUES.refus.reussie, false);

    // Un 403 — lancer ce qui attend une validation, ou un artefact retiré — est un refus
    // de PORTE, pas une panne. Il ne doit jamais peser dans le taux d'échec.
    assert.equal(issueDe(403, { erreur: 'attend une validation humaine' }), 'refus');
  });

  test('une coupure passe AVANT le contrat', () => {
    // Une réponse coupée est presque toujours aussi non conforme : il lui manque les
    // sections de la fin, forcément. La classer « contrat non tenu » enverrait corriger
    // un contrat irréprochable, alors que le geste est de relever `max_sortie`.
    assert.equal(issueDe(200, { motifArret: 'length', postvol: { conforme: false } }), 'coupe');
    assert.equal(issueDe(200, { motifArret: 'MAX_TOKENS' }), 'coupe');
  });

  test('une CHAÎNE arrêtée en route n\'est pas une réussite', () => {
    /*
     * Défaut réel, trouvé en branchant le journal. Une chaîne ne rend pas `postvol` mais
     * `conforme` : en ne regardant que `postvol`, toute chaîne cassée était comptée
     * réussie. Le taux aurait été d'autant plus flatteur que les chaînes cassaient — soit
     * exactement l'inverse de ce qu'un indicateur doit faire.
     */
    assert.equal(issueDe(200, { chaine: true, conforme: false }), 'contrat');
    assert.equal(issueDe(200, { chaine: true, arretee: true, conforme: true }), 'contrat');
    assert.equal(issueDe(200, { chaine: true, conforme: true }), 'succes');
  });

  test('un contrat non tenu et une erreur technique ne se confondent pas', () => {
    // L'un se corrige dans l'artefact, l'autre chez le fournisseur. Les additionner
    // enverrait relire un prompt parce que le réseau a lâché.
    assert.equal(issueDe(200, { postvol: { conforme: false } }), 'contrat');
    assert.equal(issueDe(502, { erreur: 'timeout' }), 'erreur');
    assert.equal(issueDe(404, { erreur: 'introuvable' }), 'erreur');
    assert.equal(issueDe(503, { erreur: 'pas de clé' }), 'erreur');
  });

  test('toutes les issues sont dans l\'ordre d\'affichage, sans oubli', () => {
    // Une issue ajoutée sans être rangée disparaîtrait de l'écran tout en comptant dans
    // les totaux : les colonnes ne feraient plus la somme, et on chercherait longtemps.
    assert.deepEqual([...ORDRE_ISSUES].sort(), Object.keys(ISSUES).sort());
  });
});

/* ── La ligne ─────────────────────────────────────────────────────────────── */

describe('la ligne de journal', () => {
  test('un artefact INTROUVABLE s\'inscrit quand même', () => {
    /*
     * Défaut réel : `artifact = {}` en valeur par défaut ne s'applique qu'à `undefined`,
     * jamais à `null` — et l'artefact vaut précisément `null` quand le registre ne l'a pas
     * trouvé. La construction jetait, l'appelant avalait, et aucun agent inexistant
     * n'entrait au journal. Un angle mort exactement là où il faut regarder.
     */
    const l = ligne({ le: '2026-08-17T10:00:00Z', artifact: null,
                      requete: { id: 'fantome' }, status: 404,
                      corps: { erreur: 'Artefact `fantome` introuvable au registre.' } });
    assert.equal(l.id, 'fantome');
    assert.equal(l.issue, 'erreur');
    assert.match(l.raison, /introuvable/);
  });

  test('les secrets retirés sont comptés par TYPE, jamais par valeur', () => {
    /*
     * Le journal est le seul endroit qui rende la fuite CHIFFRABLE : sans cette colonne,
     * on saurait que le garde-fou existe, jamais combien de fois il a servi.
     *
     * Mais il écrit sur DISQUE. Y recopier le secret qu'on vient de faire retirer serait
     * pire que de ne rien journaliser : le jeton ne faisait que passer en mémoire, il
     * deviendrait persistant — et dans un fichier que personne ne relit.
     */
    const l = ligne({ le: '2026-08-17T10:00:00Z', artifact: { id: 'x' },
                      requete: {}, status: 200,
                      corps: { caviarde: ['GitLab PAT', 'AWS Access Key'] } });
    assert.deepEqual(l.caviarde, ['GitLab PAT', 'AWS Access Key']);
  });

  test('une exécution sans secret rend une liste vide, pas `undefined`', () => {
    // Le cas courant. Une colonne absente casserait les agrégats de l'écran Admin, qui
    // compte des tableaux — et le compte tomberait sans erreur, donc sans qu'on le voie.
    const l = ligne({ le: '2026-08-17T10:00:00Z', artifact: { id: 'x' },
                      requete: {}, status: 200, corps: {} });
    assert.deepEqual(l.caviarde, []);
  });

  test('ne garde NI le prompt NI la sortie', () => {
    // La règle de fond. Un prompt porte la matière injectée — un diff, un extrait de
    // dépôt. L'écrire sur disque créerait un magasin de données confidentielles là où il
    // n'y en avait pas, qu'il faudrait ensuite protéger, purger et déclarer.
    const l = ligne({ le: '2026-08-17T10:00:00Z',
                      artifact: { id: 'a' }, requete: {}, status: 200,
                      corps: { sortie: 'SECRET-METIER', jetons: { entree: 1, sortie: 1 },
                               postvol: { conforme: true } } });
    assert.ok(!JSON.stringify(l).includes('SECRET-METIER'));
    assert.equal(l.sortie, 1, '`sortie` est un compte de jetons, pas un texte');
  });

  test('la raison est tronquée — un message d\'erreur peut recopier la requête', () => {
    const l = ligne({ le: 'x', artifact: { id: 'a' }, requete: {}, status: 502,
                      corps: { erreur: 'z'.repeat(5000) } });
    assert.equal(l.raison.length, MAX_RAISON);
  });

  test('un coût absent reste `null`, jamais 0', () => {
    // Aucun tarif DeepSeek n'est déclaré au registre, parce qu'on refuse d'en inventer.
    // « 0,00 € » serait un coût faux que personne ne songerait à contester.
    const l = ligne({ le: 'x', artifact: { id: 'a' }, requete: {}, status: 200,
                      corps: { jetons: { entree: 9, sortie: 9 }, cout: null } });
    assert.equal(l.cout, null);
    assert.notEqual(l.cout, 0);
  });
});

/* ── Le temps ─────────────────────────────────────────────────────────────── */

describe('les séries', () => {
  const lignes = [L('2026-08-17T09:12:00Z'), L('2026-08-17T09:40:00Z'),
                  L('2026-08-17T11:05:00Z')];

  test('les seaux VIDES sont émis', () => {
    /*
     * Le piège que ce module évite. Regrouper par clé et rendre les groupes trouvés
     * produit un graphique qui ment : une semaine sans exécution disparaît de l'axe, et
     * la courbe relie le dernier jour actif au suivant comme s'ils se touchaient. On lit
     * « activité stable » là où il faut lire « plus rien pendant huit jours ».
     */
    const s = serie(lignes, { pas: 'heure', jusqua: '2026-08-17T12:00:00Z', combien: 4 });
    assert.equal(s.length, 4);
    assert.deepEqual(s.map((x) => x.n), [2, 0, 1, 0]);
  });

  test('le décalage horaire déplace les seaux, et rien d\'autre', () => {
    // Le journal est écrit en UTC ; « par heure » doit se lire dans l'heure du lecteur,
    // sinon la pointe de 14 h apparaît à 12 h et personne ne comprend son graphique.
    const utc = serie(lignes, { pas: 'heure', jusqua: '2026-08-17T12:00:00Z', combien: 6 });
    const paris = serie(lignes, { pas: 'heure', jusqua: '2026-08-17T12:00:00Z', combien: 6,
                                  decalageMin: 120 });
    assert.equal(utc.reduce((t, s) => t + s.n, 0), paris.reduce((t, s) => t + s.n, 0));
    assert.equal(cleDe('2026-08-17T09:12:00Z', 'heure', 0), '2026-08-17T09');
    assert.equal(cleDe('2026-08-17T09:12:00Z', 'heure', 120), '2026-08-17T11');
  });

  test('une ligne HORS fenêtre est ignorée, pas empilée sur un bord', () => {
    // L'erreur naturelle est de tout garder en la rangeant dans le premier seau. Le
    // graphique montre alors une pointe au début qui n'a jamais eu lieu.
    const s = serie([...lignes, L('2020-01-01T00:00:00Z')],
                    { pas: 'heure', jusqua: '2026-08-17T12:00:00Z', combien: 4 });
    assert.equal(s.reduce((t, x) => t + x.n, 0), 3);
  });

  test('les trois pas existent et savent reculer, y compris à cheval sur un mois', () => {
    assert.deepEqual(Object.keys(PAS).sort(), ['heure', 'jour', 'mois']);
    const m = serie([L('2025-12-15T10:00:00Z'), L('2026-01-15T10:00:00Z')],
                    { pas: 'mois', jusqua: '2026-02-10T00:00:00Z', combien: 4 });
    assert.deepEqual(m.map((s) => s.cle), ['2025-11', '2025-12', '2026-01', '2026-02']);
    assert.deepEqual(m.map((s) => s.n), [0, 1, 1, 0]);
  });

  test('un jour à cheval sur un changement de mois recule correctement', () => {
    const j = serie([], { pas: 'jour', jusqua: '2026-03-02T12:00:00Z', combien: 4 });
    assert.deepEqual(j.map((s) => s.cle), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  test('le libellé reste court — un axe ne doit pas déborder', () => {
    assert.equal(libelle('2026-08-17T14', 'heure'), '14h');
    assert.equal(libelle('2026-08-17', 'jour'), '17/08');
    assert.equal(libelle('2026-08', 'mois'), 'août 26');
  });

  test('un coût inconnu ne devient pas zéro en s\'additionnant', () => {
    const s = serie([L('2026-08-17T09:00:00Z', { cout: null })],
                    { pas: 'heure', jusqua: '2026-08-17T09:00:00Z', combien: 1 });
    assert.equal(s[0].cout, null);
    assert.equal(s[0].n, 1, 'la ligne compte quand même');
  });
});

/* ── Les palmarès ─────────────────────────────────────────────────────────── */

describe('les plus utilisés', () => {
  const mixte = [
    L('2026-08-17T09:00:00Z'),
    L('2026-08-17T10:00:00Z', { postvol: { conforme: false } }),
    L('2026-08-17T11:00:00Z', { refuse: true }),
    ligne({ le: '2026-08-17T12:00:00Z', artifact: { id: 'b', title: 'Agent B' },
            requete: {}, status: 200,
            corps: { jetons: { entree: 10, sortie: 5 }, postvol: { conforme: true } } })
  ];
  // La troisième ligne doit être un vrai refus : `refuse:true` avec un 200 vaut « erreur ».
  const avecRefus = [...mixte.slice(0, 2),
    ligne({ le: '2026-08-17T11:00:00Z', artifact: { id: 'a', title: 'Agent A' },
            requete: {}, status: 409, corps: { refuse: true, raison: 'P001' } }),
    mixte[3]];

  test('le refus sort du DÉNOMINATEUR du taux', () => {
    /*
     * Même règle que `unverif` retiré du dénominateur côté conformité : un dénominateur
     * qui gonfle de tout ce qu'on n'a pas mesuré transforme un taux en opinion.
     *
     * Ici A a 3 lancements — un réussi, un contrat non tenu, un refusé. Le taux est 1/2,
     * pas 1/3.
     */
    const a = palmares(avecRefus).find((x) => x.id === 'a');
    assert.equal(a.n, 3, 'les trois lancements comptent');
    assert.equal(a.jugees, 2, 'seuls deux ont été jugés');
    assert.equal(a.taux, 0.5);
  });

  test('un agent jamais jugé rend `null`, pas 0 %', () => {
    // 0 % dirait « il échoue toujours ». La vérité est « on ne sait pas encore ».
    const p = palmares([ligne({ le: 'x', artifact: { id: 'c' }, requete: {}, status: 409,
                               corps: { refuse: true } })]);
    assert.equal(p[0].taux, null);
    assert.notEqual(p[0].taux, 0);
  });

  test('classe par usage, et l\'ordre est stable', () => {
    const p = palmares(avecRefus);
    assert.equal(p[0].id, 'a');
    assert.equal(p[1].id, 'b');
    assert.deepEqual(palmares(avecRefus).map((x) => x.id), p.map((x) => x.id));
  });

  test('`combien` coupe, et zéro veut dire tout', () => {
    assert.equal(palmares(avecRefus, { combien: 1 }).length, 1);
    assert.equal(palmares(avecRefus, { combien: 0 }).length, 2);
  });
});

/* ── Le résumé ────────────────────────────────────────────────────────────── */

describe('le résumé', () => {
  test('dit sur COMBIEN d\'appels le coût porte', () => {
    // Sans ça, « 0,42 € » sur cent appels dont soixante sans tarif se lit comme le coût
    // des cent — et le budget annoncé est faux d'un facteur deux et demi.
    const r = resume([L('2026-08-17T09:00:00Z'), L('2026-08-17T10:00:00Z', { cout: null })]);
    assert.equal(r.n, 2);
    assert.equal(r.coutSur, 1);
    assert.equal(r.cout, 0.01);
  });

  test('la part d\'entrée est mesurée, pas affirmée', () => {
    /*
     * LE chiffre que le produit défend. « Le chiffre au code, l'explication à l'agent »
     * veut dire qu'on n'envoie pas la matière brute mais son résumé calculé — donc que
     * l'entrée reste petite. Tant qu'il n'était mesuré nulle part, ça tenait sur une
     * parole.
     */
    const r = resume([L('x'), L('y')]);
    assert.equal(r.entree, 200);
    assert.equal(r.sortie, 100);
    assert.equal(partEntree(r).toFixed(4), (200 / 300).toFixed(4));
  });

  test('sans aucune exécution, tout est `null` plutôt que zéro', () => {
    const r = resume([]);
    assert.equal(r.n, 0);
    assert.equal(r.taux, null);
    assert.equal(r.cout, null);
    assert.equal(partEntree(r), null);
  });
});

/* ── Le disque ────────────────────────────────────────────────────────────── */

describe('le journal sur disque', () => {
  const bac = () => mkdtempSync(join(tmpdir(), 'journal-'));

  test('écrit une ligne par exécution, relue dans l\'ordre', () => {
    const root = bac();
    try {
      ajouter({ le: '2026-08-17T10:00:00Z', id: 'b' }, { root });
      ajouter({ le: '2026-08-17T09:00:00Z', id: 'a' }, { root });
      const r = lire({ root });
      assert.deepEqual(r.lignes.map((l) => l.id), ['a', 'b'], 'trié par date, pas par arrivée');
      assert.equal(r.total, 2);
      assert.equal(r.tronque, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('une ligne TRONQUÉE ne fait pas perdre le fichier', () => {
    /*
     * Un journal en append n'a aucune garantie d'être entier : une coupure au milieu d'un
     * `appendFileSync` laisse une dernière ligne incomplète. Refuser tout le fichier pour
     * ça reviendrait à perdre l'historique complet à cause de son dernier octet.
     */
    const root = bac();
    try {
      ajouter({ le: '2026-08-17T09:00:00Z', id: 'a' }, { root });
      writeFileSync(join(root, CHEMIN), `${readFileSync(join(root, CHEMIN), 'utf8')}{"le":"2026`,
        'utf8');
      const r = lire({ root });
      assert.equal(r.lignes.length, 1);
      assert.equal(r.illisibles, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('le plafond garde les DERNIÈRES lignes, et le DIT', () => {
    // Personne n'ouvre un journal pour lire le mois de janvier. Et un plafond silencieux
    // ferait afficher « 3 exécutions » à une plateforme qui en a fait mille.
    const root = bac();
    try {
      for (let i = 0; i < 10; i++) ajouter({ le: `2026-08-17T0${i}:00:00Z`, id: `n${i}` }, { root });
      const r = lire({ root, max: 3 });
      assert.deepEqual(r.lignes.map((l) => l.id), ['n7', 'n8', 'n9']);
      assert.equal(r.total, 10);
      assert.equal(r.tronque, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('un journal absent n\'est pas une erreur', () => {
    // Une plateforme qui n'a rien lancé n'est pas une plateforme cassée.
    const root = bac();
    try {
      const r = lire({ root });
      assert.deepEqual(r.lignes, []);
      assert.equal(r.total, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('une écriture IMPOSSIBLE ne jette pas', () => {
    /*
     * La règle absolue : journaliser ne doit jamais faire échouer une exécution. Un disque
     * plein ne justifie pas de perdre une réponse que l'utilisateur a attendue et payée.
     *
     * L'échec est provoqué par un parent qui est un FICHIER, pas par des droits retirés :
     * la CI tourne en root dans un conteneur, et root ignore les bits de permission. Un
     * `chmod 500` y réussissait l'écriture, donc ce test-là ne testait rien — un test vert
     * pour une raison qui n'a rien à voir avec ce qu'il prétend vérifier.
     */
    const root = bac();
    try {
      writeFileSync(join(root, 'pas-un-dossier'), 'x', 'utf8');
      assert.equal(ajouter({ le: 'x' }, { root, chemin: 'pas-un-dossier/executions.jsonl' }),
        false);
      // Et la lecture au même endroit ne jette pas non plus.
      assert.deepEqual(lire({ root, chemin: 'pas-un-dossier/executions.jsonl' }).lignes, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

/* ── La couture ───────────────────────────────────────────────────────────── */

describe('toute exécution s\'inscrit — quelle qu\'en soit l\'issue', () => {
  const socle = {
    banque: {}, registres: { tools: [], targets: [] }, models: [],
    creerVertex: () => ({ fournisseur: 'deepseek', generer: async () => ({}) })
  };

  test('un artefact introuvable, une clé absente : les deux entrent au journal', async () => {
    const lignes = [];
    const deps = { ...socle, journaliser: (l) => lignes.push(l) };

    await executer({ id: 'fantome' }, { ...deps, charger: async () => null });
    await executer({ id: 'x' }, { ...deps, charger: async () => null,
      creerVertex: () => { throw new Error('clé absente'); } });

    assert.equal(lignes.length, 2, 'les deux échecs sont tracés');
    assert.ok(lignes.every((l) => l.issue === 'erreur'));
  });

  test('sans `journaliser`, le module se comporte exactement comme avant', () => {
    // La compatibilité qui permet aux centaines de tests existants de ne rien savoir de
    // tout ceci — et à une plateforme sans magasin de ne pas être une plateforme cassée.
    return executer({ id: 'fantome' }, { ...socle, charger: async () => null })
      .then((r) => assert.equal(r.status, 404));
  });

  test('un `journaliser` qui JETTE ne fait pas échouer l\'exécution', async () => {
    // Perdre une réponse attendue et payée parce que le disque du journal est plein
    // serait un très mauvais échange.
    const r = await executer({ id: 'fantome' }, {
      ...socle, charger: async () => null,
      journaliser: () => { throw new Error('disque plein'); }
    });
    assert.equal(r.status, 404, 'la réponse passe malgré le journal en panne');
  });
});
