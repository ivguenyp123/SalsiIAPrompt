/*
 * L'assemblage — composer UN agent à partir de plusieurs prompts.
 *
 * ── LA DISTINCTION QUE CE MODULE EXISTE POUR TENIR ───────────────────────────
 *
 * Le produit sait déjà composer une CHAÎNE : agent + agent + agent, N appels, le contrat
 * de chaque brique évalué entre deux étapes. Ce module fait l'autre chose, et il ne faut
 * jamais les confondre :
 *
 *   CHAÎNE      agent + agent = N appels. Aucun texte neuf. Elle HÉRITE de la validation
 *               de ses briques — c'est pour ça qu'on peut la sauver sans passer par
 *               l'Admin.
 *   ASSEMBLAGE  prompt + prompt = UN appel, UNE consigne. Du texte NEUF. Il n'hérite de
 *               RIEN, et il part en validation comme n'importe quel prompt écrit à la main.
 *
 * Coller deux consignes validées ne donne pas une consigne validée : ça donne une
 * consigne que personne n'a jamais lue. Faire hériter l'assemblage serait la faille par
 * laquelle n'importe quel texte entrerait au registre sans relecture — il suffirait de
 * l'assembler à partir de morceaux bénis.
 *
 * ── ET LES CRITÈRES NE SE COMPOSENT PAS ──────────────────────────────────────
 *
 * C'est le point qu'on rate en premier. Les critères de l'agent A portent sur LA SORTIE
 * DE A. Dans un assemblage, cette sortie n'existe plus en tant que telle : il n'y a
 * qu'une sortie finale. Recopier les critères des morceaux produirait un contrat qui a
 * l'air riche et ne vérifie rien de ce qui sort vraiment.
 *
 * On propose donc des critères DÉDUITS de ce que les morceaux déclarent produire
 * (`sortie: json` ⟹ la sortie doit être du JSON), et l'auteur pose les siens. Ce qui est
 * suggéré est marqué comme tel.
 *
 * ── AUCUN MODÈLE N'EST APPELÉ ICI ────────────────────────────────────────────
 *
 * Assembler du texte est mécanique. C'est ce qui rend ce chemin praticable sans clé, là
 * où la chaîne demande N appels pour tourner : on peut composer un agent, le faire juger
 * par les 25 règles et l'envoyer en validation sans qu'un seul jeton soit dépensé.
 *
 * Module PUR : ni DOM, ni réseau, ni modèle.
 */

import { consigneDeSortie, criteresDuContrat } from './contrats.js';

/**
 * D'où vient chaque entrée déclarée par l'inventaire.
 *
 * Table DÉCLARÉE, et confrontée : `test/assemblage.test.js` échoue si une capacité de
 * `inventaire/hub-devops.yaml` emploie une entrée absente d'ici. Une valeur par défaut
 * silencieuse ferait passer une entrée mal classée pour une entrée classée — et la
 * source décide de qui remplit la valeur au lancement.
 *
 *   repo    lisible dans le dépôt cible
 *   signal  produit par la plateforme (un rapport, une métrique, un log)
 *   user    saisi par la personne qui lance
 */
export const SOURCES_ENTREES = {
  // Ce qui se lit dans le dépôt.
  code: 'repo',
  diff: 'repo',
  stack: 'repo',
  config_ci: 'repo',
  historique_commits: 'repo',
  inventaire_fichiers: 'repo',
  inventaire_branches: 'repo',
  inventaire_dependances: 'repo',
  inventaire_flags: 'repo',
  environnements: 'repo',

  // Ce que la plateforme produit.
  chiffres_dora: 'signal',
  scores_maturite: 'signal',
  historique_pipelines: 'signal',
  pipeline_log: 'signal',
  activite_sprint: 'signal',
  activite_du_jour: 'signal',
  repartition_contributions: 'signal',
  rapport_depot: 'signal',
  rapport_conformite: 'signal',
  rapport_secrets: 'signal',
  rapport_vulnerabilites: 'signal',
  // Le seul signal qui porte sur PLUSIEURS dépôts. Absent de l'inventaire du hub, qui
  // raisonne toujours sur un dépôt : la question « par quelle équipe commencer » n'y est
  // pas posée, et c'est justement celle qu'on tient à répondre.
  parc_securite: 'signal',
  // La merge request choisie dans la liste, diff et contexte assemblés. Le hub la traite
  // comme un `diff` à coller ; ici la plateforme va la chercher.
  revue_mr: 'signal',
  /*
   * Le job de CI en échec, avec l'extrait de son log.
   *
   * Le hub nomme son entrée `pipeline_log` et attend un COLLAGE : quelqu'un ouvre son
   * pipeline, sélectionne, copie. Ici la plateforme va chercher le log elle-même, le
   * nettoie, en CAVIARDE les secrets, puis le découpe autour de l'échec.
   *
   * Ce n'est donc pas la même entrée, et lui donner le même nom aurait laissé croire
   * qu'on peut coller à la main quelque chose qui a subi trois traitements — dont un de
   * sécurité. Un log collé tel quel part chez le fournisseur avec ses jetons dedans.
   */
  job_en_echec: 'signal',
  /*
   * Le plan d'une livraison — le seul signal qui se RÈGLE.
   *
   * Les autres ne dépendent que du dépôt : deux personnes qui les lancent sur le même
   * dépôt obtiennent la même matière, et c'est ce qui les rend contestables. Celui-ci
   * dépend en plus de ce qu'on a décidé de livrer — quelle branche, quel environnement,
   * majeur / mineur / correctif. Le texte produit rappelle donc toujours les réglages
   * utilisés : sans eux, deux plans différents du même dépôt seraient indiscernables.
   */
  plan_de_livraison: 'signal',
  /*
   * Un fichier, scanné avant d'être lu par le modèle.
   *
   * Ce n'est pas `code` sous un autre nom. `code` est un CONTENU — on le colle ou on le
   * va chercher, et il part tel quel. `analyse_fichier` est un RAPPORT : les motifs de
   * secret trouvés avec leur ligne, les contrôles de chaîne d'approvisionnement du
   * manifeste, ce qui n'a pas été cherché, et le fichier caviardé en dessous.
   *
   * Deux noms parce que ce sont deux matières : un agent qui explique du code n'a pas
   * besoin du rapport, un agent qui l'audite ne doit pas s'en passer.
   */
  analyse_fichier: 'signal',
  /*
   * L'état d'une branche AVANT qu'elle devienne une merge request.
   *
   * À ne pas confondre avec `revue_mr`, qui porte le DIFF d'une merge request ouverte.
   * Celui-ci ne contient aucune ligne de code : divergence, dispersion, âge, conventions,
   * état de CI. Deux entrées parce que ce sont deux questions — « où en est cette
   * branche » et « que vaut ce changement » — et qu'un agent qui les confondrait
   * conclurait sur du code qu'il n'a pas lu.
   */
  etat_branche: 'signal',
  /*
   * Le CONTENU des fichiers qu'une branche change, scanné puis caviardé.
   *
   * Trois entrées voisines qu'il ne faut pas confondre, et c'est pour ça qu'elles portent
   * trois noms : `analyse_fichier` (un fichier qu'on désigne), `etat_branche` (une branche,
   * sans une ligne de code), `code_de_la_branche` (le code de cette branche). Un seul nom
   * pour deux d'entre elles ferait conclure sur ce qu'on n'a pas envoyé.
   */
  code_de_la_branche: 'signal',
  /*
   * Le code d'un DÉPÔT — la troisième échelle, et celle qui manquait.
   *
   * `analyse_fichier` porte sur un fichier qu'on désigne, `code_de_la_branche` sur ce
   * qu'une branche change, `code_du_depot` sur le dépôt lui-même : sa carte, sa pile, et
   * les fichiers retenus par une règle écrite. C'est la matière que réclament les
   * capacités qui cartographient un système — et qui, faute de ce nom, se collait à la
   * main, y compris pour les agents importés d'un pack tiers.
   *
   * Il ne remplace pas `rapport_depot`, qui porte vingt-cinq contrôles et pas une ligne
   * de code : « que faut-il corriger ici » et « comment est-ce fait » sont deux questions.
   */
  code_du_depot: 'signal',

  // Ce que quelqu'un tape.
  besoin_metier: 'user',
  requete: 'user',
  story: 'user',
  notes_incident: 'user'
};

/*
 * Les noms de variable qui désignent un DÉPÔT, et méritent donc la liste.
 *
 * Ici plutôt que dans `app/depots.js`, où ils vivaient : le composeur doit savoir, SANS
 * toucher au DOM, si une entrée sera remplissable. Deux listes auraient divergé, et une
 * divergence à cet endroit ferait passer un agent lançable pour un agent bloqué — ou
 * l'inverse, ce qui est pire. `app/depots.js` la réexporte.
 */
export const NOMS_DEPOT = new Set(['repo', 'depot', 'dépôt', 'projet', 'project', 'repository']);

/**
 * Ce qu'il faudra faire, au lancement, pour remplir une entrée.
 *
 * ── LA QUESTION QUE FABRIQUER NE POSAIT PAS ──────────────────────────────────
 *
 * On pouvait assembler un agent à partir de n'importe quel morceau, puis découvrir au
 * lancement qu'une de ses entrées n'était remplissable par personne : le champ restait
 * vide, le pré-vol refusait pour `P003`, et rien n'avait prévenu au moment du montage.
 *
 * Quatre réponses, et elles ne se valent pas :
 *
 *   calculee    la plateforme la calcule depuis le dépôt — rien à faire
 *   choisie     un dépôt à prendre dans une liste
 *   depot       de la matière à aller chercher : un fichier, une PR
 *   ecrite      un texte que quelqu'un tape — et c'est légitime : un besoin métier,
 *               des notes d'incident n'existent nulle part ailleurs
 *
 * Et une cinquième, qui est un défaut :
 *
 *   introuvable l'entrée se dit produite par la plateforme, et la plateforme ne la
 *               produit pas. Personne ne sait quoi coller. C'est le cas de
 *               `chiffres_dora` avant qu'on sache le calculer, et de `pipeline_log`
 *               aujourd'hui. Un nom hors vocabulaire tombe ici aussi : la plateforme ne
 *               sait pas quoi en faire, donc ne saura jamais aller le chercher.
 */
export function etatEntree(nom, { sait = () => false } = {}) {
  const n = String(nom || '').trim();
  if (!n) return 'introuvable';
  if (sait(n)) return 'calculee';
  if (NOMS_DEPOT.has(n.toLowerCase())) return 'choisie';
  const source = SOURCES_ENTREES[n];
  if (source === 'repo') return 'depot';
  if (source === 'user') return 'ecrite';
  // `signal` non calculé, ou nom inconnu : dans les deux cas, personne ne sait le remplir.
  return 'introuvable';
}

/** Ce qu'un morceau demandera, entrée par entrée. */
export function besoinsDe(entrees = [], options = {}) {
  return [...new Set(entrees.filter(Boolean))]
    .map((nom) => ({ nom, etat: etatEntree(nom, options) }));
}

/**
 * Ce morceau peut-il seulement tourner ?
 *
 * Une seule entrée introuvable suffit à bloquer l'agent entier : le pré-vol refuse dès
 * qu'une variable requise n'est pas résolue. Assembler autour d'elle, c'est monter quelque
 * chose qui ne partira jamais.
 */
export function peutTourner(entrees = [], options = {}) {
  return besoinsDe(entrees, options).every((b) => b.etat !== 'introuvable');
}

/*
 * Ce que l'inventaire déclare produire, et le critère que ça permet d'affirmer.
 *
 * Les valeurs sont TYPÉES — un booléen, pas la chaîne « true ». Le formulaire du Studio
 * manipule des chaînes parce qu'un champ HTML n'en connaît pas d'autres ; l'artefact,
 * lui, part au registre et `L009` compare au type déclaré par la cible. Écrire « false »
 * ici produisait un critère refusé à la porte — et refusé pour la bonne raison.
 */
export const CRITERE_PAR_SORTIE = {
  json: { target: 'output.is_json', op: 'eq', value: true },
  yaml: { target: 'output.length', op: 'lte', value: 4000 },
  liste: { target: 'output.sections', op: 'exists', value: true },
  texte: null            // « du texte » n'autorise à affirmer rien de particulier
};

/**
 * La consigne portée par un besoin de l'inventaire.
 *
 * L'inventaire dit « un agent qui explique les 4 métriques DORA ». Une consigne s'adresse
 * au modèle : « Explique les 4 métriques DORA ». La transformation est mécanique et
 * réversible à l'œil — on ne veut pas d'un texte réécrit dont l'auteur ne reconnaîtrait
 * plus le besoin d'origine.
 */
export function consigneDepuisBesoin(besoin) {
  const t = String(besoin || '').trim().replace(/^un\s+agent\s+qui\s+/i, '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Un morceau assemblable, quelle que soit sa provenance.
 *
 * `contrat` est la forme RÉELLE du rapport que le module d'origine produit, extraite de
 * son code. Quand il existe, l'agent ne se contente plus de traiter le sujet : il rend le
 * même rapport, avec les mêmes clés et les mêmes seuils. Sans lui, on retombe sur le
 * besoin — une aide, pas une reproduction.
 */
export function morceauDepuisInventaire(entree, { contrat = null } = {}) {
  if (!entree?.id) return null;
  return {
    ref: entree.id,
    origine: 'inventaire',
    titre: entree.titre || entree.id,
    consigne: consigneDepuisBesoin(entree.besoin),
    entrees: [...(entree.entrees || [])],
    sortie: entree.sortie || 'texte',
    contrat
  };
}

/**
 * Un morceau tiré d'un agent VALIDÉ : sa consigne, telle quelle.
 *
 * C'est la matière la plus solide — du texte qu'un humain a relu. Elle n'apporte pourtant
 * aucune validation à l'assemblage : le tout n'est pas la somme, et personne n'a lu le
 * tout.
 */
export function morceauDepuisArtefact(artefact) {
  if (!artefact?.id || artefact.kind === 'chain') return null;
  return {
    ref: artefact.id,
    origine: 'registre',
    titre: artefact.title || artefact.id,
    consigne: String(artefact.spec || '').trim(),
    entrees: (artefact.variables || []).map((v) => v.name),
    // Les étiquettes de l'agent : elles servent à ranger la boîte à outils du composeur,
    // qui n'a plus les familles de l'inventaire pour le faire.
    tags: [...(artefact.tags || [])],
    sortie: 'texte'
  };
}

/**
 * Les variables de l'assemblage : l'union des entrées de ses morceaux.
 *
 * Union et non concaténation — deux morceaux qui lisent le même diff ne le réclament pas
 * deux fois. L'ordre suit la première apparition, pour que la liste se lise dans l'ordre
 * où l'auteur a monté sa consigne.
 */
export function variablesDeduites(morceaux = []) {
  const vues = new Map();
  for (const m of morceaux) {
    for (const nom of m?.entrees || []) {
      if (!nom || vues.has(nom)) continue;
      vues.set(nom, {
        name: nom,
        source: SOURCES_ENTREES[nom] || 'user',
        required: true,
        // Ce qui est déduit se dit déduit. Un `description` inventé se lirait comme une
        // intention d'auteur.
        deduite: !SOURCES_ENTREES[nom]
      });
    }
  }
  return [...vues.values()];
}

/**
 * Les critères qu'on a le droit d'affirmer, sans rien inventer.
 *
 * `output.contains_secret eq false` est le seul qui vaille pour tout agent : aucun ne
 * doit faire sortir de secret. Le reste vient de ce que les morceaux DÉCLARENT produire.
 */
export function criteresSuggeres(morceaux = []) {
  const out = [{ target: 'output.contains_secret', op: 'eq', value: false, suggere: true }];
  const vus = new Set();

  /*
   * UN CONTRAT EXTRAIT L'EMPORTE SUR TOUT LE RESTE.
   *
   * Quand on connaît la forme réelle du rapport de la plateforme, il n'y a plus rien à
   * suggérer : les critères se DÉDUISENT. `suggere: false` le dit — ce n'est pas une
   * proposition qu'un auteur pèse, c'est la forme à reproduire.
   *
   * Et on ne mélange pas : un contrat impose du JSON, donc `CRITERE_PAR_SORTIE` (qui
   * pense en Markdown pour `liste`) n'a plus voix au chapitre. Les faire cohabiter
   * produirait exactement le contrat impossible que `L026` refuse.
   */
  const avecContrat = morceaux.filter((m) => m?.contrat?.champs?.length);
  if (avecContrat.length) {
    for (const m of avecContrat) {
      for (const c of criteresDuContrat(m.contrat)) {
        const cle = `${c.target}|${c.op}|${JSON.stringify(c.value)}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        out.push({ ...c, suggere: false });
      }
    }
    return out;
  }

  for (const m of morceaux) {
    const c = CRITERE_PAR_SORTIE[m?.sortie];
    if (!c) continue;
    const cle = `${c.target}|${c.op}|${c.value}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push({ ...c, suggere: true });
  }
  return out;
}

/** Le séparateur des morceaux dans la consigne. Visible, pour qu'on voie les coutures. */
export const COUTURE = '\n\n';

/**
 * La consigne assemblée.
 *
 * Les morceaux sont numérotés parce qu'un modèle suit mieux une liste de tâches qu'un
 * bloc de paragraphes collés — et parce qu'un relecteur doit pouvoir dire « le point 3
 * n'a rien à faire là » sans compter les lignes.
 *
 * Un seul morceau ne se numérote pas : « 1. » tout seul est du bruit.
 */
export function consigneAssemblee(morceaux = []) {
  const bouts = morceaux.map((m) => String(m?.consigne || '').trim()).filter(Boolean);
  if (bouts.length === 0) return '';

  const corps = bouts.length === 1 ? bouts[0]
    : bouts.map((b, i) => `${i + 1}. ${b}`).join(COUTURE);

  /*
   * LA MATIÈRE, branchée dans le texte.
   *
   * Les entrées viennent de ce que les morceaux DÉCLARENT lire. Les déclarer sans les
   * interpoler produit un agent qui réclame une matière qu'il ne lit jamais — et `L021`
   * le refuse, à juste titre : « il ne peut pas faire ce qu'il annonce ».
   *
   * On ne liste que celles qui ne sont pas DÉJÀ dans le texte : la consigne d'un agent
   * validé porte ses propres `{{...}}`, et les répéter en bas ferait croire à deux
   * matières différentes.
   */
  const aBrancher = variablesDeduites(morceaux)
    .map((v) => v.name)
    .filter((n) => !corps.includes(`{{${n}}}`));

  const matiere = aBrancher.length
    ? `${COUTURE}Matière fournie :\n` + aBrancher.map((n) => `- ${n} : {{${n}}}`).join('\n')
    : '';

  /*
   * LA FORME DU RAPPORT, quand on la connaît.
   *
   * Elle vient en DERNIER et elle est impérative : c'est la dernière chose que le modèle
   * lit, et c'est celle qui doit gagner. Un agent tiré d'un module de la plateforme doit
   * rendre le MÊME rapport — mêmes clés, mêmes unités, mêmes seuils — sinon il produit
   * une imitation qu'on ne peut ni comparer ni rejouer.
   *
   * Un seul contrat : deux formats de sortie dans une même consigne se contrediraient.
   * C'est le premier morceau qui en porte un qui décide.
   */
  const avecContrat = morceaux.find((m) => m?.contrat?.champs?.length);
  const forme = avecContrat ? `${COUTURE}${consigneDeSortie(avecContrat.contrat)}` : '';

  return `${corps}${matiere}${forme}`;
}

/**
 * L'artefact produit par l'assemblage.
 *
 * `kind: 'prompt'` et non `chain` : c'est UN agent, un appel, une consigne. Et
 * `target_level: 'experimental'`, toujours — un assemblage n'a jamais été mesuré, quelle
 * que soit la maturité des morceaux dont il vient.
 */
export function assembler(morceaux = [], { titre = '', purpose = '', notFor = '',
                                           auteur = '', scope = '', id = '',
                                           modelTier = 'mid' } = {}) {
  const variables = variablesDeduites(morceaux);

  /*
   * Un champ facultatif VIDE ne s'écrit pas.
   *
   * `intent.not_for` exige dix caractères au schéma. Émettre `not_for: ''` produit un
   * refus `L001` qui ne nomme même pas le champ — l'auteur voit « au moins 10 caractères
   * (0 fourni) » sans savoir de quoi on parle. Omettre le champ laisse `L011` faire son
   * travail : un avertissement, lisible, qui dit exactement quoi remplir.
   */
  const intent = { purpose };
  if (String(notFor || '').trim()) intent.not_for = notFor;

  return {
    id: id || identifiant(titre),
    kind: 'prompt',
    title: titre,
    owner: { person: auteur, scope },
    intent,
    model_tier: modelTier,
    target_level: 'experimental',
    variables: variables.map(({ name, source, required }) => ({ name, source, required })),
    criteria: criteresSuggeres(morceaux).map(({ target, op, value }) => ({ target, op, value })),
    spec: consigneAssemblee(morceaux)
    /*
     * Pas de `golden_cases: []`.
     *
     * Une liste vide ne dit rien que son absence ne dise déjà, et elle ne survit pas à un
     * aller-retour par le Studio : la reprise laisse tomber les champs vides, si bien que
     * republier l'agent perdait la clé et faisait diverger le fichier. Même règle que
     * pour `intent.not_for` — un champ facultatif vide ne s'écrit pas.
     */
  };
}

/** L'identifiant tiré du titre — même règle que partout ailleurs. */
export function identifiant(titre) {
  return String(titre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 64).replace(/-+$/, '');
}

/**
 * Ce qui manque pour que l'assemblage soit soumettable, en langage d'auteur.
 *
 * Les 25 règles le diront aussi, dans leur vocabulaire. Celle-ci parle AVANT, et dit
 * quoi faire plutôt que ce qui cloche : devant un écran vide, « L008 : criteria non
 * vide » n'aide personne qui n'a pas encore compris ce qu'est un critère.
 */
export function cequilManque(morceaux = [], { titre = '', purpose = '', notFor = '',
                                              scope = '' } = {}) {
  const manques = [];
  const court = (v, n) => String(v || '').trim().length < n;

  if (morceaux.length === 0) manques.push('Prends au moins un prompt à gauche.');
  if (court(titre, 1)) manques.push('Donne-lui un titre.');

  // Les seuils sont ceux du schéma. Les dire ici en français évite un `L001` qui ne
  // nomme pas son champ — « au moins 10 caractères (0 fourni) » n'apprend rien.
  if (court(purpose, MINI_INTENT)) {
    manques.push(`Dis à quoi il sert, en une phrase (${MINI_INTENT} caractères au moins).`);
  }
  if (court(notFor, MINI_INTENT)) {
    manques.push('Dis quand ne PAS l\'utiliser. C\'est le champ que le relecteur lit en premier.');
  }
  if (court(scope, 1)) manques.push('Choisis un périmètre : c\'est lui qui décide des outils permis.');
  return manques;
}

/** Le minimum qu'exige le schéma sur `intent.purpose` et `intent.not_for`. */
export const MINI_INTENT = 10;

export default { SOURCES_ENTREES, CRITERE_PAR_SORTIE, COUTURE, MINI_INTENT, consigneDepuisBesoin,
                 morceauDepuisInventaire, morceauDepuisArtefact, variablesDeduites,
                 criteresSuggeres, consigneAssemblee, assembler, identifiant, cequilManque };
