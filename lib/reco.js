/*
 * La recommandation contextuelle — « le plus utile pour toi, maintenant ».
 *
 * ── LA LIGNE, ET ELLE VIENT DE LA MAQUETTE ───────────────────────────────────
 *
 *   « Calculé à partir de tes usages et de ton contexte — PAS D'IA QUI DEVINE :
 *     une reco transparente, que tu peux ignorer. »
 *
 * C'est le même principe que partout ici : le déterministe décide, et il montre sur quoi.
 * Une recommandation produite par un modèle serait invérifiable — on ne pourrait ni la
 * contester, ni comprendre pourquoi elle a changé. Ici, chaque proposition est une
 * conséquence mécanique d'un FAIT observé, et l'écran montre le fait.
 *
 * ── UN FAIT, PAS UNE IMPRESSION ──────────────────────────────────────────────
 *
 * Un signal est quelque chose qu'on a LU chez la forge : un pipeline en échec, une PR
 * ouverte, une branche sans commit depuis six mois. Il porte sa date et son lien. Si rien
 * n'a été observé, on ne propose RIEN — on n'affiche pas un « pour toi » de remplissage.
 *
 * C'est la règle qui coûte le plus cher à tenir et qui rapporte le plus : le jour où la
 * bande apparaît, elle veut dire quelque chose.
 *
 * ── LE LIEN SIGNAL → AGENT EST DÉCLARÉ PAR LA PLATEFORME ─────────────────────
 *
 * Et pas par les artefacts. Un champ `triggers:` dans l'artefact laisserait chaque auteur
 * s'inscrire sur tous les signaux — la bande deviendrait un panneau publicitaire, et on
 * cesserait de la lire en trois jours.
 *
 * La table ci-dessous est donc le seul endroit qui décide. Elle désigne des ÉTIQUETTES et
 * des identifiants ; si aucun agent ne correspond au registre, la proposition disparaît
 * au lieu d'être remplacée par un à-peu-près.
 *
 * Module PUR : ni DOM, ni réseau, ni horloge — la date de référence est injectée.
 */

/** Les natures de fait qu'on sait observer. Rien d'autre n'entre. */
export const SIGNAUX = {
  'ci-echec': {
    titre: (s) => `Ta CI a échoué sur ${s.branche || 'ton dépôt'}`,
    urgence: 100
  },
  'pr-a-moi': {
    titre: (s) => `Tu as ${s.n} changement(s) en attente de relecture`,
    urgence: 70
  },
  'pr-a-relire': {
    titre: (s) => `${s.n} changement(s) attendent TON avis`,
    urgence: 80
  },
  /*
   * « Nombreuses », et surtout PAS « mortes ».
   *
   * On compte les branches non protégées, et rien d'autre : leur date de dernier commit
   * demanderait un appel par branche au chargement de l'accueil. Écrire « sans activité
   * depuis longtemps » serait affirmer une mesure qu'on n'a pas faite — la faute même que
   * ce produit reproche aux niveaux déclarés.
   *
   * La bande pose donc la QUESTION, et c'est l'agent qui ira mesurer.
   */
  'branches-nombreuses': {
    titre: (s) => `Ton dépôt porte ${s.n} branches ouvertes`,
    urgence: 30
  }
};

/**
 * Ce que chaque fait rend utile.
 *
 * `etiquettes` : on cherche un agent qui les porte. `ids` : on nomme un agent précis quand
 * il n'y a pas d'ambiguïté. Les deux sont des SOUHAITS — rien ne garantit que le registre
 * les contienne, et c'est voulu : la table décrit ce qui aiderait, le registre dit ce qui
 * existe, et l'intersection seule s'affiche.
 */
export const REPONSES = {
  'ci-echec': { etiquettes: ['pipeline', 'ci'], ids: ['expliquer-un-pipeline-en-echec'],
                verbe: 'Comprendre pourquoi' },
  'pr-a-moi': { etiquettes: ['revue', 'qualite'], ids: ['relire-un-changement'],
                verbe: 'Faire relire' },
  'pr-a-relire': { etiquettes: ['revue'], ids: ['relire-un-changement'],
                   verbe: 'M\'aider à relire' },
  'branches-nombreuses': { etiquettes: ['nettoyage'], ids: ['identifie-les-branches-mortes'],
                           verbe: 'Voir lesquelles sont mortes' }
};

/** Un fait trop vieux ne dit plus rien du présent. */
export const FRAICHEUR_HEURES = 72;

/** L'âge d'un fait, en heures. `null` s'il ne porte pas de date. */
export function ageHeures(signal, maintenant) {
  if (!signal?.quand) return null;
  const t = Date.parse(signal.quand);
  if (Number.isNaN(t)) return null;
  return (maintenant - t) / 3_600_000;
}

/** « il y a 2 h », « hier » — ce qu'un humain lit sans convertir. */
export function ilYA(heures) {
  if (heures === null || heures === undefined) return '';
  if (heures < 1) return 'à l\'instant';
  if (heures < 2) return 'il y a une heure';
  if (heures < 24) return `il y a ${Math.round(heures)} h`;
  const jours = Math.round(heures / 24);
  return jours === 1 ? 'hier' : `il y a ${jours} jours`;
}

/**
 * Les agents du registre qui répondent à ce fait.
 *
 * L'identifiant nommé passe devant : quand la plateforme sait exactement quoi proposer,
 * proposer « quelque chose d'étiqueté pipeline » à la place serait moins bon.
 */
export function agentsPour(type, agents = []) {
  const r = REPONSES[type];
  if (!r) return [];

  const parId = (r.ids || [])
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean);
  if (parId.length) return parId;

  const veut = new Set(r.etiquettes || []);
  return agents.filter((a) => (a.tags || []).some((t) => veut.has(plier(t))));
}

/** La première lettre en minuscule, et elle seule. */
const minuscule = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : '');

const plier = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Les recommandations, de la plus utile à la moins.
 *
 * @param {Array}  signaux   les faits observés
 * @param {Array}  agents    ce que le registre contient VRAIMENT
 * @param {object} [options] `maintenant` (ms) pour la fraîcheur
 * @returns {Array<{signal, agent, titre, quand, verbe, pourquoi}>}
 */
export function recommander(signaux = [], agents = [], { maintenant = 0 } = {}) {
  const out = [];

  for (const s of signaux) {
    const def = SIGNAUX[s?.type];
    if (!def) continue;

    // Un fait périmé ne parle plus du présent. On ne le montre pas « en plus petit » :
    // on ne le montre pas.
    const age = ageHeures(s, maintenant);
    if (age !== null && age > FRAICHEUR_HEURES) continue;

    const [agent] = agentsPour(s.type, agents);
    if (!agent) continue;          // rien au registre : on se tait plutôt que d'approximer

    out.push({
      signal: s,
      agent,
      titre: def.titre(s),
      quand: ilYA(age),
      verbe: REPONSES[s.type].verbe,
      // La phrase que l'écran affiche sous la proposition. Elle dit d'où ça vient, et
      // c'est ce qui rend la reco contestable — donc utilisable.
      // Seule la PREMIÈRE lettre change de casse. Tout mettre en minuscules écrivait
      // « parce que ta ci a échoué » — et un sigle abîmé fait douter du reste.
      pourquoi: `Parce que ${minuscule(def.titre(s))}${age !== null ? `, ${ilYA(age)}` : ''}.`,
      urgence: def.urgence
    });
  }

  // Le plus urgent d'abord, et à urgence égale le plus frais. Un ordre stable : deux
  // chargements de la même page ne doivent pas proposer deux choses différentes.
  return out.sort((a, b) => b.urgence - a.urgence
    || (ageHeures(a.signal, maintenant) ?? 1e9) - (ageHeures(b.signal, maintenant) ?? 1e9));
}

export default { SIGNAUX, REPONSES, FRAICHEUR_HEURES, ageHeures, ilYA, agentsPour,
                 recommander };
