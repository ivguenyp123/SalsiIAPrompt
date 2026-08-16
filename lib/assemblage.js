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

  // Ce que quelqu'un tape.
  besoin_metier: 'user',
  requete: 'user',
  story: 'user',
  notes_incident: 'user'
};

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

/** Un morceau assemblable, quelle que soit sa provenance. */
export function morceauDepuisInventaire(entree) {
  if (!entree?.id) return null;
  return {
    ref: entree.id,
    origine: 'inventaire',
    titre: entree.titre || entree.id,
    consigne: consigneDepuisBesoin(entree.besoin),
    entrees: [...(entree.entrees || [])],
    sortie: entree.sortie || 'texte'
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

  if (aBrancher.length === 0) return corps;

  return `${corps}${COUTURE}Matière fournie :\n`
       + aBrancher.map((n) => `- ${n} : {{${n}}}`).join('\n');
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
