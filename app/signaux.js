/*
 * Observer — lire chez la forge les faits qui rendent une recommandation possible.
 *
 * ── UN FAIT SE LIT, IL NE SE DEVINE PAS ──────────────────────────────────────
 *
 * Chaque signal produit ici vient d'un appel réel : une exécution de CI en échec, une
 * demande de fusion ouverte, une branche sans commit depuis longtemps. Rien n'est inféré,
 * rien n'est simulé. C'est ce qui autorise l'écran à écrire « parce que ta CI a échoué
 * il y a 2 h » — la phrase est vérifiable en cliquant.
 *
 * ── CHAQUE OBSERVATION ÉCHOUE SEULE ──────────────────────────────────────────
 *
 * Un jeton sans la permission Actions ne peut pas lire la CI. Ce n'est pas une panne :
 * c'est le jeton qui fait son travail. Chaque source est donc isolée — celle qui échoue
 * rend une liste vide, et les autres continuent. Une bande vide vaut infiniment mieux
 * qu'un écran d'erreur sur une fonction de confort.
 *
 * ── ET SI L'ON NE SAIT PAS, ON N'AFFIRME PAS ─────────────────────────────────
 *
 * `pr-a-relire` demanderait de savoir qui est relecteur désigné. On ne le sait pas
 * partout, donc on ne l'affirme pas : les demandes de fusion des AUTRES sont comptées
 * comme « à relire » et le libellé reste prudent. Le jour où la forge nous dira les
 * relecteurs désignés, la question deviendra exacte sans qu'on change l'écran.
 *
 * Module d'ACCÈS : la forge est injectée, rien n'est écrit.
 */

/** Ce que l'agent ira vraiment mesurer, une fois lancé. Nous, on ne fait que compter. */
const JOURS_BRANCHE_MORTE = 90;

/** Ce qu'on lit au maximum. Une page d'accueil ne doit pas coûter vingt appels. */
const PLAFOND = 20;

/**
 * Tous les faits observables sur ce dépôt, pour cette personne.
 *
 * @param {object} options
 * @param {object} options.forge
 * @param {string} options.repo      le dépôt de travail
 * @param {string} options.moi       l'identifiant de la personne connectée
 * @param {number} [options.maintenant] ms — injecté pour rester testable
 * @returns {Promise<Array>} des signaux au format attendu par `lib/reco.js`
 */
export async function observer({ forge, repo, moi, maintenant = Date.now() } = {}) {
  if (!forge || !repo) return [];

  const sources = [
    () => ciEnEchec(forge, repo),
    () => demandesDeFusion(forge, repo, moi),
    () => branchesOuvertes(forge, repo)
  ];

  // `allSettled` et non `all` : une source refusée par le jeton ne doit pas emporter
  // les autres.
  const lots = await Promise.allSettled(sources.map((f) => f()));
  return lots.flatMap((l) => (l.status === 'fulfilled' ? l.value : []));
}

/* ── La CI ────────────────────────────────────────────────────────────────── */

/*
 * Le dernier échec, et lui seul.
 *
 * Une CI qui casse cinq fois de suite est UN problème, pas cinq. Cinq lignes identiques
 * dans la bande la rendraient illisible et donneraient l'impression que la plateforme
 * compte plutôt qu'elle ne comprend.
 *
 * Et si une exécution PLUS RÉCENTE a réussi sur la même branche, on se tait : c'est déjà
 * réparé, et proposer d'enquêter serait faire perdre du temps.
 */
async function ciEnEchec(forge, repo) {
  if (typeof forge.listRuns !== 'function') return [];
  const runs = await forge.listRuns(repo, { perPage: PLAFOND });

  const parBranche = new Map();
  for (const r of runs) {
    // Les exécutions arrivent de la plus récente à la plus ancienne : la première vue
    // pour une branche est la dernière en date.
    if (!parBranche.has(r.branche)) parBranche.set(r.branche, r);
  }

  const casse = [...parBranche.values()].find((r) => r.statut === 'echec');
  return casse
    ? [{ type: 'ci-echec', branche: casse.branche, quand: casse.quand, url: casse.url,
         ref: String(casse.id) }]
    : [];
}

/* ── Les demandes de fusion ───────────────────────────────────────────────── */

async function demandesDeFusion(forge, repo, moi) {
  if (typeof forge.listPullRequests !== 'function') return [];
  const prs = await forge.listPullRequests(repo);
  if (prs.length === 0) return [];

  const aMoi = prs.filter((p) => p.auteur && moi && p.auteur === moi);
  const desAutres = prs.filter((p) => !p.auteur || !moi || p.auteur !== moi);

  const out = [];
  // `quand` est absent : la forge ne rend pas la date dans cette forme. Une reco sans
  // date reste montrable — elle est indatée, pas périmée.
  if (aMoi.length) out.push({ type: 'pr-a-moi', n: aMoi.length, url: aMoi[0].url });
  if (desAutres.length) out.push({ type: 'pr-a-relire', n: desAutres.length, url: desAutres[0].url });
  return out;
}

/* ── Les branches ─────────────────────────────────────────────────────────── */

/*
* Une branche « morte » demande une date de dernier commit, que `listBranches` ne rend
 * pas. Aller la chercher branche par branche coûterait cent appels au chargement de
 * l'accueil — pour un signal de confort.
 *
 * On s'en tient donc à ce qui est GRATUIT : le nombre de branches non protégées. Au-delà
 * d'un seuil, la question « faut-il faire le ménage ? » se pose d'elle-même, et c'est
 * l'agent qui ira vraiment mesurer. La bande propose d'aller voir ; elle n'affirme pas
 * que douze branches sont mortes.
 */
async function branchesOuvertes(forge, repo) {
  if (typeof forge.listBranches !== 'function') return [];
  const branches = await forge.listBranches(repo);
  const vivantes = branches.filter((b) => !b.protectee && !b.default);

  // Un dépôt à trois branches n'a pas de ménage à faire. Le seuil évite une reco qui
  // s'affiche pour tout le monde, tout le temps — c'est-à-dire une reco qu'on n'écoute plus.
  if (vivantes.length < 8) return [];
  return [{ type: 'branches-nombreuses', n: vivantes.length, seuil: JOURS_BRANCHE_MORTE }];
}

export default { observer, JOURS_BRANCHE_MORTE };
