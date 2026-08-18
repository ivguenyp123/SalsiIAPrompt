/*
 * L'exécution d'une livraison — moment 5.
 *
 * Deux fonctions, et la séparation entre les deux EST la garantie :
 *
 *   preparer(...)  lit le dépôt, calcule le plan, n'écrit RIEN
 *   executer(...)  écrit, sur la foi d'un plan déjà vu par un humain
 *
 * Tant qu'on n'a pas appelé la seconde, rien n'a bougé dans le dépôt. C'est ce qui rend
 * la confirmation de `P007` réelle au lieu d'être une boîte de dialogue de politesse :
 * l'humain voit exactement les fichiers, les lignes et le message avant que quoi que ce
 * soit parte.
 *
 * Aucun LLM ici. La version cible se calcule, les overlays se découvrent, la merge
 * request s'ouvre — tout est déterministe. Le LLM, lui, aura sa place à côté : rédiger
 * l'explication des changements pour la revue. Il ne décide de rien.
 */
import { planifier, resumer, environnements, FICHIERS_CI, KUSTOMIZATION_RX } from './livraison.js';

/**
 * LA LECTURE, séparée du plan — et cette séparation a un second usage.
 *
 * Elle servait déjà à `preparer`. Elle sert désormais aussi au signal `plan_de_livraison`,
 * qui construit la matière de l'agent : mêmes emplacements sondés, mêmes overlays
 * découverts, même branche cible. Deux lecteurs différents auraient fini par diverger, et
 * l'agent aurait alors décrit une livraison que le module n'exécute pas — le pire des
 * défauts possibles ici, parce qu'il est invisible jusqu'au déploiement.
 *
 * @returns {{ci, overlays, brancheCible}}
 */
export async function lireLivraison(forge, repo, { branche, brancheCible } = {}) {
  const info = brancheCible ? { defaultBranch: brancheCible } : await forge.projectInfo(repo);
  const cible = brancheCible || info.defaultBranch || 'main';

  // Le fichier de CI : on sonde les emplacements connus, on ne devine pas.
  let ci = null;
  for (const chemin of FICHIERS_CI) {
    const f = await forge.getFile(repo, chemin, branche);
    if (f) { ci = { path: chemin, content: f.content }; break; }
  }

  /*
   * Les overlays sont DÉCOUVERTS, jamais supposés. Une liste en dur vieillirait au
   * premier overlay ajouté par une équipe, et l'agent bumperait la CI en laissant un
   * overlay derrière — l'incohérence la plus coûteuse, parce qu'elle ne se voit qu'au
   * déploiement.
   */
  const overlays = [];
  if (ci) {
    for (const chemin of (await forge.listTree(repo, branche)).filter((p) => KUSTOMIZATION_RX.test(p))) {
      const f = await forge.getFile(repo, chemin, branche);
      if (f) overlays.push({ path: chemin, content: f.content });
    }
  }

  return { ci, overlays, brancheCible: cible };
}

/**
 * Lit le dépôt et calcule le plan. N'écrit rien.
 *
 * @param {object} forge   client de forge (voir app/forge.js)
 * @param {string} repo    identifiant du projet
 * @param {object} choix   { branche, bump, environnement, brancheCible }
 */
export async function preparer(forge, repo, { branche, bump = 'patch', environnement = '',
                                              brancheCible } = {}) {
  const { ci, overlays, brancheCible: cible } =
    await lireLivraison(forge, repo, { branche, brancheCible });

  const plan = planifier({ branche, brancheCible: cible, bump, environnement, ci, overlays });
  return { plan, brancheCible: cible, resume: resumer(plan, { branche, brancheCible: cible }),
           overlaysLus: overlays.length,
           /*
            * Les environnements RÉELLEMENT trouvés, rendus même quand le plan échoue.
            * L'écran s'en sert pour proposer un choix qui existe : une liste écrite à la
            * main proposerait `preprod` à un dépôt qui n'en a pas, et le filtre écarterait
            * alors tous les overlays sans que ce soit une erreur visible.
            */
           environnementsTrouves: environnements(overlays.map((o) => o.path)) };
}

/**
 * Écrit : commit atomique puis merge request.
 *
 * @param {object} plan  celui rendu par `preparer` — et vu par un humain entre-temps
 * @returns {{commit, mr, avertissement}}
 */
export async function executer(forge, repo, plan, { branche, brancheCible, auteur = '' } = {}) {
  if (!plan?.ok) throw new Error(plan?.raison || 'Plan invalide : rien à exécuter.');

  const commit = await forge.commitFiles(repo, {
    branch: branche,
    message: plan.message,
    files: plan.fichiers.map(({ path, content }) => ({ path, content }))
  });

  /*
   * La merge request peut échouer alors que le commit est passé — le cas le plus
   * fréquent étant qu'une MR existe déjà pour ce couple de branches. Ce n'est pas une
   * raison de présenter l'opération comme un échec : le travail utile a eu lieu, et le
   * cacher enverrait l'auteur relancer une livraison déjà faite.
   */
  try {
    const mr = await forge.createMergeRequest(repo, {
      source: branche,
      target: brancheCible,
      title: plan.titreMR,
      description: descriptionMR(plan, { branche, brancheCible, auteur })
    });
    return { commit, mr, avertissement: '' };
  } catch (error) {
    return { commit, mr: null,
             avertissement: `Le commit est passé (${commit.sha?.slice(0, 8)}), mais la merge request n'a pas été créée : ${error.message}` };
  }
}

/** Le corps de la MR : ce qu'un relecteur a besoin de savoir, sans ouvrir le diff. */
export function descriptionMR(plan, { branche, brancheCible, auteur = '' }) {
  const lignes = [
    `Bump \`IMAGE_TAG\` **${plan.courante} → ${plan.cible}**`,
    '',
    `- branche : \`${branche}\` → \`${brancheCible}\``,
    `- ${plan.fichiers.length} fichier(s) modifié(s), dont ${plan.overlaysTouches} overlay(s) :`,
    ...plan.fichiers.map((f) => `  - \`${f.path}\``),
    '',
    '---',
    'Préparé par l\'agent `prep-delivery` du registre de capacités IA.',
    'Les écritures ont été faites par un module déterministe, pas par un modèle : ',
    'la version cible est calculée, les overlays sont découverts dans l\'arbre du dépôt.',
    auteur ? `Déclenché par ${auteur}, après confirmation.` : 'Déclenché après confirmation humaine.'
  ];
  return lignes.join('\n');
}

export default { preparer, executer, descriptionMR };
