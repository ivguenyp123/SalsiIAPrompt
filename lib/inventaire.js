/*
 * L'inventaire — le catalogue de ce qu'on PEUT demander.
 *
 * ── LE PROBLÈME QU'IL RÈGLE ──────────────────────────────────────────────────
 *
 * L'écran « Demander » pose une question ouverte : « ce que tu voudrais ». Devant un
 * champ vide, la vraie question n'est pas « comment le formuler » mais **« qu'est-ce qui
 * est possible ? »**. Quatre exemples en dur y répondaient mal : ils montrent le format,
 * pas l'étendue. Quelqu'un qui ne voit que « vérifier mes branches mortes » ne devinera
 * jamais qu'il peut demander un plan de décommission de feature flag.
 *
 * `inventaire/hub-devops.yaml` liste les capacités tirées de la surface RÉELLE du hub
 * DevOps — ses modules, leurs actions, leurs sorties. Ce module les rend utilisables :
 * groupées, cherchables, et confrontées au registre.
 *
 * ── L'ÉTAT N'EST PAS ÉCRIT, IL EST CONFRONTÉ ─────────────────────────────────
 *
 * `au-registre` ou `a-creer` ne figure NULLE PART dans le fichier. Il se calcule en
 * comparant les identifiants de l'inventaire à ceux des artefacts publiés. Un état
 * recopié à la main divergerait à la première validation en Admin — et un catalogue qui
 * ment sur ce qui existe déjà fait créer deux fois le même agent.
 *
 * C'est la même règle que partout ici : déclaré d'un côté, dérivé de l'autre, jamais les
 * deux dans le même champ.
 *
 * ── UNE QUESTION, UN AGENT — MAIS PAS FORCÉMENT LE MÊME NOM ──────────────────
 *
 * La confrontation par identifiant seul a un angle mort, et il s'est refermé sur nous :
 * quatre agents écrits depuis les outils du hub — le régime du dépôt, les feature flags,
 * la rétro, les notes de version — répondent à des questions que l'inventaire listait
 * déjà, sous d'AUTRES identifiants. Résultat : l'inventaire annonçait « à créer » quatre
 * capacités livrées, et le prochain qui les demanderait les ferait écrire une deuxième
 * fois. Exactement le doublon que cet écran existe pour éviter.
 *
 * Une entrée peut donc déclarer `couvert_par: <id d'artefact>` : la question reste
 * formulée comme quelqu'un la pose, et l'agent qui y répond porte le nom qu'il mérite.
 * C'est un lien de couverture, pas un alias — plusieurs questions peuvent pointer vers le
 * même agent, et l'écran dit alors LEQUEL ouvrir, ce qu'un simple « fait » ne dirait pas.
 *
 * `couvert_par` est le SEUL champ manuel de cette mécanique, et il reste vérifiable : un
 * test du dépôt refuse un `couvert_par` qui ne désigne aucun artefact publié.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/** Les états possibles d'une ligne d'inventaire. */
export const ETATS = {
  'au-registre': { label: 'au registre', aide: 'Cet agent existe déjà : ouvre-le au Catalogue.' },
  'a-creer': { label: 'à créer', aide: 'Personne ne l\'a encore demandé. Un clic, et il part en validation.' }
};

/**
 * L'inventaire à plat, chaque ligne portant sa famille et son module.
 *
 * L'arborescence sert à la lecture du fichier ; l'écran, lui, cherche et filtre sur une
 * liste. Reconstruire le chemin à chaque affichage obligerait chaque appelant à connaître
 * la forme du fichier.
 */
export function aplatir(inventaire) {
  const out = [];
  for (const famille of inventaire?.familles || []) {
    for (const mod of famille.modules || []) {
      for (const p of mod.prompts || []) {
        out.push({
          ...p,
          famille: famille.cle,
          familleTitre: famille.titre,
          icone: famille.icone || '•',
          module: mod.module
        });
      }
    }
  }
  return out;
}

/**
 * L'inventaire confronté au registre.
 *
 * Deux façons d'être couvert, et `par` dit toujours PAR QUI — c'est ce qui rend l'écran
 * utile : « ça existe » n'aide personne si on ne sait pas quoi ouvrir.
 *
 * @param {Array} prompts  la liste à plat
 * @param {Array} ids      les identifiants des artefacts PUBLIÉS
 */
export function confronter(prompts = [], ids = []) {
  const publies = new Set(ids);
  return prompts.map((p) => {
    const par = publies.has(p.id) ? p.id
      : (p.couvert_par && publies.has(p.couvert_par) ? p.couvert_par : '');
    return { ...p, par, etat: par ? 'au-registre' : 'a-creer' };
  });
}

/** Les familles, avec leur compte — de quoi dessiner des filtres qui disent quelque chose. */
export function familles(prompts = []) {
  const par = new Map();
  for (const p of prompts) {
    if (!par.has(p.famille)) {
      par.set(p.famille, { cle: p.famille, titre: p.familleTitre, icone: p.icone, total: 0, faits: 0 });
    }
    const f = par.get(p.famille);
    f.total += 1;
    if (p.etat === 'au-registre') f.faits += 1;
  }
  return [...par.values()];
}

const plier = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * La recherche.
 *
 * Elle porte sur le TITRE, le BESOIN et le MODULE — pas sur l'identifiant. Quelqu'un qui
 * cherche « flag » pense à ce qu'il veut obtenir, pas à `proposer-un-plan-de-decommission-de-flag`.
 * Les fragments se cumulent, comme pour la recherche de fichier : « flag mort » trouve
 * l'audit des flags qui ne servent plus.
 */
export function filtrer(prompts = [], { q = '', famille = '', etat = '' } = {}) {
  const mots = plier(q).split(/\s+/).filter(Boolean);
  return prompts.filter((p) => {
    if (famille && p.famille !== famille) return false;
    if (etat && p.etat !== etat) return false;
    if (!mots.length) return true;
    const foin = plier(`${p.titre} ${p.besoin} ${p.module} ${(p.entrees || []).join(' ')}`);
    return mots.every((m) => foin.includes(m));
  });
}

/** Deux chiffres pour le bandeau : ce qui existe, sur ce qui est possible. */
export function compter(prompts = []) {
  const faits = prompts.filter((p) => p.etat === 'au-registre').length;
  return { total: prompts.length, faits, restants: prompts.length - faits };
}

export default { ETATS, aplatir, confronter, familles, filtrer, compter };
