/*
 * La dictée — une phrase en français, un artefact qui franchit la porte.
 *
 * ── LA PHRASE DU PRODUIT, APPLIQUÉE AU PRODUIT ───────────────────────────────
 *
 *   « L'IA traduit l'intention, le noyau gouverne, l'humain valide. »
 *
 * Elle est écrite en tête du dépôt depuis le premier jour, et c'est exactement ce
 * fichier. L'IA TRADUIT : une phrase devient un artefact YAML. Le noyau GOUVERNE : le
 * lint le juge, et ce qu'il refuse repart en correction — la machine ne décide pas si son
 * travail est bon, les 25 règles le décident. L'humain VALIDE : rien n'est soumis sans un
 * clic, et le brouillon atterrit dans le formulaire du Studio, pas dans la file.
 *
 * ── POURQUOI CE N'EST PAS « SALSI » EN PLUS BAVARD ───────────────────────────
 *
 * `studio/assistant.js` compose à partir du registre, sans LLM, et garantit que TOUT
 * chemin produit un artefact conforme. C'est sa force et sa limite : il ne peut pas
 * écrire le spec, parce qu'écrire le métier de quelqu'un demande de comprendre sa phrase.
 * Il laisse donc une charpente et le vrai travail à faire.
 *
 * Ici, l'inverse : le modèle écrit tout, y compris le spec — et n'a AUCUNE garantie.
 * D'où la boucle. Le résultat est linté, et s'il est bloqué, les constats repartent au
 * modèle comme consignes. Ce n'est pas une politesse : c'est la seule raison pour
 * laquelle on peut laisser un LLM écrire dans un registre gouverné. La porte ne bouge
 * pas, c'est le brouillon qui s'y plie.
 *
 * ── CE QUE LE MODÈLE N'A PAS LE DROIT DE DÉCIDER ─────────────────────────────
 *
 * `normaliser()` reprend la main sur trois choses, quoi qu'il ait écrit :
 *
 *   owner.person    l'auteur est la personne connectée. Un artefact engage quelqu'un ;
 *                   laisser une machine désigner un responsable serait absurde.
 *   target_level    plafonné à `équipe`. Le niveau est un engagement, et `officiel` se
 *                   dérive maintenant du banc d'essai — un brouillon ne le vise pas.
 *   derived         retiré. L015 le refuse déjà, mais mieux vaut ne pas compter sur une
 *                   règle pour effacer ce qu'on peut ne pas écrire.
 *
 * Module PUR : ni réseau, ni système de fichiers, ni DOM.
 */

import { narrer, variablesDeduites, criteresHerites } from '../lib/chaine.js';
import { SOURCES_ENTREES } from '../lib/assemblage.js';
import { SIGNAUX } from '../lib/signaux-matiere.js';

/** Celles que la plateforme sait remplir seule — l'agent devient utilisable sans saisie. */
const SIGNAUX_CALCULES = new Set(Object.keys(SIGNAUX));

/* ── L'identifiant ────────────────────────────────────────────────────────── */

/**
 * Un identifiant conforme au schéma (`^[a-z][a-z0-9-]*$`), tiré du titre.
 *
 * Le modèle en propose un ; on ne le reprend que s'il est valide. Un `id` est une clé de
 * fichier et d'URL — la seule valeur de l'artefact qu'on ne peut pas corriger après coup
 * sans casser les liens.
 */
export function identifiant(propose, titre) {
  const propre = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

  const a = propre(propose);
  if (/^[a-z][a-z0-9-]*$/.test(a)) return a;
  const b = propre(titre);
  return /^[a-z][a-z0-9-]*$/.test(b) ? b : 'artefact-sans-nom';
}

/* ── La consigne ──────────────────────────────────────────────────────────── */

/**
 * Le vocabulaire des entrées, tel qu'on le donne au rédacteur.
 *
 * Sans lui, il invente. Sur un besoin de bus factor il a produit `{{repo_metadata}}` et
 * `{{contribution_data}}` : deux noms parfaitement lisibles, et parfaitement inutiles —
 * la plateforme sait calculer la répartition des contributions, mais elle se branche sur
 * le NOM `repartition_contributions`. Sous un autre nom, elle ne reconnaît rien et
 * redemande une saisie à la main.
 *
 * Les entrées CALCULÉES sont signalées comme telles : ce sont celles qui rendent un agent
 * utilisable sans rien taper, et c'est vers elles qu'il faut le pousser.
 */
const listeEntrees = () => {
  const groupes = { repo: [], signal: [], user: [] };
  for (const [nom, source] of Object.entries(SOURCES_ENTREES)) {
    if (groupes[source]) groupes[source].push(nom);
  }
  const marque = (n) => `${n}${SIGNAUX_CALCULES.has(n) ? '   ✔ calculée' : ''}`;
  const bloc = (titre, noms) => (noms.length
    ? `  ${titre}\n${noms.map((n) => `    ${marque(n)}`).join('\n')}`
    : '');

  return [
    bloc('ce qui se lit dans le dépôt :', groupes.repo),
    bloc('ce que la plateforme produit :', groupes.signal),
    bloc('ce que quelqu\'un tape :', groupes.user)
  ].filter(Boolean).join('\n');
};

const listeOutils = (tools = []) => (tools || []).map((t) =>
  `  - ${t.id} · ${t.mode} · executor ${t.executor}`
  + `${t.scopes?.length ? ` · périmètres : ${t.scopes.join(', ')}` : ''}`
  + `${t.description ? `\n      ${t.description}` : ''}`).join('\n');

const listeCibles = (targets = []) => (targets || []).map((t) =>
  `  - ${t.target} · classe ${t.class} · type ${t.type} · opérateurs : ${(t.ops || []).join(', ')}`)
  .join('\n');

const listeBanque = (banque) => (banque?.natures || []).map((n) =>
  `  - ${n.nature} : ${(n.entrees || []).map((e) => e.id).join(', ')}`).join('\n');

/**
 * La consigne de rédaction, ASSEMBLÉE À PARTIR DU RÉFÉRENTIEL.
 *
 * Aucun nom d'outil, aucune cible, aucune entrée n'est écrite en dur ici : tout vient des
 * registres chargés. Le jour où un outil est ajouté, le rédacteur le connaît sans qu'on
 * touche à ce fichier — et il ne peut pas proposer un outil retiré, ce que L004 refuserait
 * de toute façon, mais un tour plus tard et pour un appel de plus.
 */
export function consigne({ phrase, registres = {}, auteur = '', scopes = [] } = {}) {
  const { tools = [], targets = [], entrees = null } = registres;

  return `Tu écris un artefact pour SalsiIAPrompt, un registre gouverné de capacités IA.
Tu reçois UN BESOIN en une phrase. Tu rends UN artefact YAML, et rien d'autre.

BESOIN :
${String(phrase || '').trim()}

RENDS EXACTEMENT ceci — un seul bloc \`\`\`yaml, aucun texte avant ni après :

\`\`\`yaml
id: <minuscules-et-tirets, tiré du titre>
kind: agent | prompt | chain
title: <titre court, en français, sans point final>
owner:
  person: ${auteur || '<personne>'}
  scope: <un périmètre parmi : ${scopes.join(', ') || 'aucun déclaré'}>
intent:
  purpose: <à quoi ça sert, une phrase, en français>
  not_for: <ce pour quoi il NE FAUT PAS l'utiliser, une phrase>
spec: |-
  <la consigne envoyée au modèle, en français, à la 2e personne>
variables:
  - name: <minuscules_avec_underscores>
    source: repo | user | signal
    required: true
    description: <à quoi elle sert>
tools:
  - id: <un identifiant du registre ci-dessous>
    mode: read | write
    executor: llm | module
criteria:
  - target: <une cible du registre ci-dessous>
    op: <un opérateur autorisé pour cette cible>
    value: <du type déclaré pour cette cible>
golden_cases:
  - id: gc-01-<mot-cle>
    context: { <variable>: <valeur> }
    expect: { <cible>: <valeur> }
    runs: 5
    pass_at_least: 4
target_level: experimental | team
model_tier: nano | small | mid | large
\`\`\`

ENTRÉES CONNUES — préfère TOUJOURS un de ces noms à un nom que tu inventerais.

Celles marquées « ✔ calculée » sont remplies TOUTES SEULES par la plateforme au moment
du lancement : l'utilisateur n'a rien à saisir. TOUTES LES AUTRES devront être collées à
la main, à chaque exécution.

Donc : si une entrée « ✔ calculée » suffit à faire le travail, n'en déclare AUCUNE
AUTRE. Un agent qui se lance en un clic sert ; un agent à deux champs à remplir ne sert
à personne.
${listeEntrees()}

OUTILS DISPONIBLES — tu ne peux en citer aucun autre :
${listeOutils(tools) || '  (aucun)'}

CIBLES ASSERTABLES — tu ne peux en viser aucune autre :
${listeCibles(targets) || '  (aucune)'}

BANQUE D'ENTRÉES — pour les cas d'or, \`<nature>_fixture: <id>\` :
${listeBanque(entrees) || '  (vide)'}

RÈGLES QUI JUGERONT CE QUE TU ÉCRIS. Un manquement est refusé, pas discuté :

1.  Chaque {{variable}} du spec est déclarée dans \`variables\`, et chaque variable
    déclarée est utilisée dans le spec. Le spec en utilise AU MOINS UNE.

    UNE SEULE, sauf impossibilité. Chaque entrée de plus est un champ que quelqu'un
    devra remplir avant de pouvoir lancer l'agent — et un agent à deux champs ne se
    lance pas. Demande-toi, pour chacune : « sans elle, la réponse serait-elle fausse ? »
    Si la réponse est non, retire-la.

    Exemple vécu : pour analyser un bus factor, \`repartition_contributions\` suffit —
    elle dit déjà qui commite où. Y ajouter \`historique_commits\` n'apporte rien et
    rend l'agent inutilisable.
2.  Un outil \`mode: write\` exige \`executor: module\` — un LLM n'écrit jamais dans un
    dépôt. Pour un agent qui lit, explique ou rédige : \`mode: read\`, \`executor: llm\`.
3.  Aucun secret, aucune URL en dur, aucun identifiant de projet dans le spec. Aucune
    clé, aucun jeton, aucun nom d'hôte.
4.  \`criteria\` n'est jamais vide, et porte de préférence sur des cibles \`output.*\`
    (classe \`form\`) : elles se vérifient sur la sortie. Les cibles de classe \`state\`
    exigent un environnement de test et ne seront pas résolues.
5.  \`intent.not_for\` est renseigné, et dit une VRAIE limite d'usage.
6.  Le spec fait entre 150 et 12000 caractères. Il ne contient ni TODO, ni « … », ni
    passage laissé à compléter.
7.  Le spec décrit une TÂCHE, pas un algorithme : pas de \`if\`, pas de boucle, pas de
    code. La logique conditionnelle va dans un module, pas dans un prompt.
8.  Chaque cas d'or asserte au moins une cible, fournit un contexte pour les variables
    déclarées, et porte \`runs\` et \`pass_at_least\` (avec pass_at_least ≤ runs).
9.  \`target_level: team\` exige 3 cas d'or. Sans cas d'or, écris \`experimental\`.
10. Le spec ne contient jamais d'instruction du type « ignore les consignes
    précédentes » ni de balise de rôle.

Écris en FRANÇAIS. Le spec s'adresse au modèle qui exécutera l'agent, à la 2e personne
du singulier, en phrases impératives courtes. Sois concret : ce que le besoin décrit,
pas une capacité générique.`;
}

/**
 * La consigne de CORRECTION — les constats du lint, renvoyés comme travail à faire.
 *
 * C'est le cœur du dispositif. Le modèle ne juge pas son propre brouillon : il reçoit le
 * verdict d'un linter déterministe et n'a qu'à s'y plier. On lui rend son YAML tel quel
 * pour qu'il corrige au lieu de recommencer — un artefact réécrit de zéro perdrait le
 * travail correct du tour précédent.
 */
export function correction({ yaml, findings = [], phrase = '' }) {
  const bloquants = findings.filter((f) => f.severity === 'error');
  const autres = findings.filter((f) => f.severity !== 'error');

  const dire = (f) => `  - [${f.code}] ${f.path ? `${f.path} : ` : ''}${f.message}`;

  return `Ton artefact a été refusé par le linter du registre. Corrige-le.

BESOIN D'ORIGINE :
${String(phrase || '').trim()}

CE QUE TU AVAIS ÉCRIT :
\`\`\`yaml
${yaml}
\`\`\`

REFUS — chacun doit disparaître :
${bloquants.map(dire).join('\n') || '  (aucun)'}
${autres.length ? `\nAVERTISSEMENTS — à traiter si tu peux, sans casser le reste :\n${autres.map(dire).join('\n')}` : ''}

Rends l'artefact CORRIGÉ en entier, un seul bloc \`\`\`yaml, aucun texte avant ni après.
Ne repars pas de zéro : garde ce qui n'est pas en cause.`;
}

/* ── L'extraction ─────────────────────────────────────────────────────────── */

/**
 * Le YAML, sorti de la réponse du modèle.
 *
 * On ne fait PAS confiance à la consigne « aucun texte avant ni après » : un modèle
 * s'excuse, commente, encadre. Le bloc clôturé est cherché en premier ; à défaut, on
 * prend la réponse telle quelle, et le parseur tranchera.
 */
export function extraire(sortie) {
  const texte = String(sortie || '');
  const bloc = /```(?:ya?ml)?\s*\n([\s\S]*?)```/.exec(texte);
  if (bloc) return bloc[1].trim();
  // Un bloc ouvert et jamais refermé — le cas d'une réponse coupée par max_tokens.
  const ouvert = /```(?:ya?ml)?\s*\n([\s\S]*)$/.exec(texte);
  return (ouvert ? ouvert[1] : texte).trim();
}

/* ── La normalisation ─────────────────────────────────────────────────────── */

const NIVEAUX_AUTORISES = ['experimental', 'team'];

/**
 * Ce que le modèle ne décide pas.
 *
 * Rien ici n'est une correction de style : ce sont trois choses qu'un brouillon de
 * machine ne peut pas engager. Tout le reste — le titre, le spec, les outils, les
 * critères — lui appartient, et c'est le lint qui tranche, pas cette fonction.
 */
export function normaliser(brut, { auteur = '', scope = '' } = {}) {
  if (!brut || typeof brut !== 'object') return null;

  const { derived, ...artefact } = brut;   // L015 le refuse ; on ne l'écrit simplement pas

  artefact.id = identifiant(artefact.id, artefact.title);

  artefact.owner = {
    ...(artefact.owner && typeof artefact.owner === 'object' ? artefact.owner : {}),
    person: auteur || artefact.owner?.person || ''
  };
  if (scope) artefact.owner.scope = scope;

  if (!NIVEAUX_AUTORISES.includes(artefact.target_level)) {
    artefact.target_level = (artefact.golden_cases || []).length >= 3 ? 'team' : 'experimental';
  }

  return artefact;
}

/* ── La boucle ────────────────────────────────────────────────────────────── */

/** Le nombre de tours par défaut. Trois : un brouillon, deux corrections. */
export const TOURS = 3;

/**
 * Une phrase → un artefact linté.
 *
 * Tout est injecté — le moteur, le linter, le parseur YAML. Ce module ne sait donc ni
 * appeler un modèle, ni lire un fichier : il orchestre, et il se teste avec un moteur
 * de papier qui rend des YAML écrits à la main.
 *
 * @param {object} demande  { phrase, auteur, scope }
 * @param {object} outils
 *   @param {object}   outils.moteur     client de génération (createMoteur)
 *   @param {object}   outils.registres  { tools, targets, entrees, validateArtifact }
 *   @param {Function} outils.lint       (artefact, ctx) => report
 *   @param {Function} outils.parse      (yaml) => objet
 *   @param {Array}    [outils.scopes]   périmètres connus
 *   @param {number}   [outils.tours]
 *   @param {string}   [outils.tier]     palier du modèle rédacteur
 *   @param {Function} [outils.serialiser]  (artefact) => yaml, pour le fichier RENDU
 * @returns {{artefact, rendu, report, tours, jetons, cout, abandon}}
 */
export async function rediger({ phrase, auteur = '', scope = '' } = {},
                              { moteur, registres = {}, lint, parse, scopes = [],
                                tours = TOURS, tier = 'mid', cout = () => null,
                                models = [], serialiser = null } = {}) {
  const journal = [];
  const jetons = { entree: 0, sortie: 0 };
  let euros = 0;
  let tarife = false;

  let invite = consigne({ phrase, registres, auteur, scopes });
  let dernier = null;

  for (let tour = 1; tour <= Math.max(1, tours); tour++) {
    const reponse = await moteur.generer({ prompt: invite, tier });

    jetons.entree += reponse.jetons?.entree || 0;
    jetons.sortie += reponse.jetons?.sortie || 0;
    const c = cout(reponse, models);
    if (typeof c === 'number') { euros += c; tarife = true; }

    const yamlBrut = extraire(reponse.texte);

    let artefact = null;
    let erreurLecture = '';
    try { artefact = normaliser(parse(yamlBrut), { auteur, scope }); }
    catch (error) { erreurLecture = error.message; }

    if (!artefact) {
      /*
       * Un YAML illisible n'est pas un artefact refusé : c'est un tour perdu. On le
       * renvoie comme tel plutôt que de le déguiser en constat de lint — confondre les
       * deux ferait chercher une règle qui n'existe pas.
       */
      journal.push({ tour, yaml: yamlBrut, illisible: erreurLecture || 'YAML vide ou non structuré',
                     report: null });
      invite = `Ta réponse n'était pas un YAML lisible (${erreurLecture || 'vide'}). `
             + `Rends UNIQUEMENT un bloc \`\`\`yaml valide.\n\n${consigne({ phrase, registres, auteur, scopes })}`;
      dernier = null;
      continue;
    }

    const report = lint(artefact, { ...registres, artifacts: [] });
    journal.push({ tour, yaml: yamlBrut, report, illisible: '' });
    dernier = { artefact, yaml: yamlBrut, report };

    if (!report.blocked) break;

    invite = correction({ yaml: yamlBrut, findings: report.findings, phrase });
  }

  /*
   * Le fichier est RE-SÉRIALISÉ depuis l'artefact normalisé, jamais recopié du texte du
   * modèle.
   *
   * Piège vécu en écrivant ce module : `normaliser()` force l'auteur, plafonne le niveau
   * et répare l'identifiant — sur l'OBJET. Écrire le YAML brut aurait donc déposé un
   * fichier dont l'auteur n'est pas celui qu'on a linté. Ce qui est jugé et ce qui est
   * écrit doivent être le même artefact, sinon toute la chaîne ment d'un cran.
   */
  const rendu = dernier?.artefact && serialiser ? serialiser(dernier.artefact) : '';

  return {
    ...(dernier || { artefact: null, yaml: journal.at(-1)?.yaml || '', report: null }),
    rendu,
    tours: journal,
    jetons,
    // `null` et pas `0` : sans tarif déclaré, le coût est inconnu, pas nul.
    cout: tarife ? euros : null,
    // Le mot compte : la boucle n'a pas ÉCHOUÉ, elle a rendu la main. Ce qu'elle a
    // produit reste utile — un brouillon à finir vaut mieux qu'un formulaire vide.
    abandon: !dernier || dernier.report?.blocked === true
  };
}


/* ══════════════════════════════════════════════════════════════════════════════
 * LA COMPOSITION — « pioche dans les prompts » plutôt que d'en écrire un de plus
 * ════════════════════════════════════════════════════════════════════════════ */

/*
 * « Je veux un agent qui mixe le rapport DORA et le rapport journalier. »
 *
 * On pourrait faire écrire un gros prompt de plus. Il serait non testé, non mesuré, et il
 * dupliquerait deux capacités qui existent déjà — le jour où l'une est corrigée, la copie
 * reste fausse.
 *
 * En composition, la surface de sortie du modèle se réduit à DEUX choses : une liste
 * d'identifiants d'artefacts du registre, et des expressions de câblage. Il ne peut pas
 * écrire une ligne de prompt, même s'il essaie : `normaliserChaine()` jette tout le reste
 * et RECALCULE le spec, les variables et les critères depuis les briques choisies.
 *
 * C'est la contrainte la plus forte qu'on ait posée à un modèle dans ce dépôt, et elle ne
 * coûte rien en qualité : ce qu'on lui demande — comprendre une intention et choisir les
 * bonnes briques — est précisément ce qu'il fait bien.
 */

const listeBriques = (briques = []) => briques.map((a) =>
  `  - ${a.id} · ${a.title}\n`
  + `      ${a.intent?.purpose || ''}\n`
  + `      entrées : ${(a.variables || []).map((v) => `${v.name} (${v.source})`).join(', ') || 'aucune'}`
).join('\n');

/** La consigne de composition, assemblée depuis le REGISTRE des artefacts validés. */
export function consigneComposition({ phrase, briques = [], auteur = '', scopes = [] } = {}) {
  return `Tu composes une CHAÎNE pour SalsiIAPrompt : une séquence d'artefacts existants.

Tu n'écris AUCUN prompt. Tu choisis des briques déjà validées et tu les branches.

BESOIN :
${String(phrase || '').trim()}

BRIQUES DISPONIBLES — tu ne peux en citer aucune autre :
${listeBriques(briques) || '  (aucune)'}

RENDS EXACTEMENT ceci — un seul bloc \`\`\`yaml, aucun texte avant ni après :

\`\`\`yaml
kind: chain
title: <titre court, en français, sans point final>
owner:
  person: ${auteur || '<personne>'}
  scope: <un périmètre parmi : ${scopes.join(', ') || 'aucun déclaré'}>
intent:
  purpose: <à quoi sert la chaîne entière, une phrase>
  not_for: <ce pour quoi il NE FAUT PAS l'utiliser, une phrase>
steps:
  - id: e1
    artefact: <un identifiant de la liste ci-dessus>
    entrees:
      <variable de cette brique>: "{{<variable de la chaîne>}}"
  - id: e2
    artefact: <un autre identifiant de la liste>
    entrees:
      <variable de cette brique>: "{{e1.sortie}}"
\`\`\`

RÈGLES DU CÂBLAGE :

1. \`{{e1.sortie}}\` désigne ce que l'étape \`e1\` a produit. Une étape ne peut citer que
   des étapes ANTÉRIEURES, jamais elle-même ni une suivante.
2. \`{{quelque_chose}}\` sans point désigne une entrée de la chaîne, fournie par
   l'utilisateur au lancement. Nomme-la comme la variable de la brique.
3. Une expression peut mêler texte et renvois, et c'est souvent mieux qu'un passe-plat :
   \`entrees: { notes: "Chiffres DORA :\\n{{e1.sortie}}\\n\\nJournée :\\n{{e2.sortie}}" }\`
4. CHAQUE variable de la brique doit être câblée, sinon son prompt partira troué.
5. Deux étapes ne portent jamais le même \`id\`.

CHOISIS LE MOINS D'ÉTAPES POSSIBLE. Une chaîne de deux briques bien branchées vaut mieux
qu'une de cinq qui se repassent le même texte.

SI AUCUNE COMBINAISON DE CES BRIQUES NE RÉPOND AU BESOIN, ne compose rien et réponds
exactement : AUCUNE_BRIQUE

N'invente pas d'identifiant. Écris les titres et l'intention en français.`;
}

/** Le modèle a-t-il déclaré forfait ? */
export const forfait = (texte) => /\bAUCUNE_BRIQUE\b/.test(String(texte || ''));

/**
 * Ce que le modèle ne décide PAS, dans une chaîne.
 *
 * Presque tout. Il choisit des étapes et un câblage ; le reste est RECALCULÉ depuis les
 * briques qu'il a choisies :
 *
 *   spec        la narration de la séquence — réordonner deux étapes la réécrit, donc
 *               elle ne peut pas mentir sur ce que la chaîne fait
 *   variables   déduites du câblage : l'auteur branche, la liste en découle
 *   criteria    hérités de la DERNIÈRE étape — la chaîne rend ce qu'elle rend
 *
 * Un modèle qui écrirait ces trois champs pourrait décrire une chaîne qui n'est pas celle
 * qu'il a composée. En les recalculant, la description et la séquence ne peuvent pas
 * diverger — pas « ne divergeront pas si tout va bien » : ne PEUVENT pas.
 */
export function normaliserChaine(brut, { auteur = '', scope = '', parId = new Map() } = {}) {
  if (!brut || typeof brut !== 'object') return null;

  const { derived, spec, variables, criteria, golden_cases, ...reste } = brut;
  const artefact = { ...reste, kind: 'chain' };

  artefact.id = identifiant(artefact.id, artefact.title);
  artefact.owner = {
    ...(artefact.owner && typeof artefact.owner === 'object' ? artefact.owner : {}),
    person: auteur || artefact.owner?.person || ''
  };
  if (scope) artefact.owner.scope = scope;

  artefact.steps = (artefact.steps || []).map((e, i) => ({
    id: e?.id || `e${i + 1}`,
    artefact: e?.artefact,
    ...(e?.titre ? { titre: e.titre } : {}),
    entrees: e?.entrees && typeof e.entrees === 'object' ? e.entrees : {}
  }));

  artefact.variables = variablesDeduites(artefact, parId);
  artefact.criteria = criteresHerites(artefact, parId);
  artefact.spec = narrer(artefact, parId);

  // Une chaîne neuve n'a jamais été jouée : elle ne vise pas plus haut qu'expérimental.
  artefact.target_level = 'experimental';

  return artefact;
}

/**
 * Une phrase → une chaîne d'artefacts existants.
 *
 * Même boucle que `rediger()` : le linter juge, ses constats repartent au modèle. La
 * différence est ce que le modèle a le droit d'écrire.
 *
 * @returns {{artefact, rendu, report, tours, jetons, cout, abandon, forfait}}
 */
export async function composer({ phrase, auteur = '', scope = '' } = {},
                               { moteur, registres = {}, briques = [], lint, parse,
                                 scopes = [], tours = TOURS, tier = 'mid',
                                 cout = () => null, models = [], serialiser = null } = {}) {
  const parId = new Map(briques.map((a) => [a.id, a]));
  const journal = [];
  const jetons = { entree: 0, sortie: 0 };
  let euros = 0;
  let tarife = false;

  let invite = consigneComposition({ phrase, briques, auteur, scopes });
  let dernier = null;
  let aRenonce = false;

  for (let tour = 1; tour <= Math.max(1, tours); tour++) {
    const reponse = await moteur.generer({ prompt: invite, tier });
    jetons.entree += reponse.jetons?.entree || 0;
    jetons.sortie += reponse.jetons?.sortie || 0;
    const c = cout(reponse, models);
    if (typeof c === 'number') { euros += c; tarife = true; }

    /*
     * Le forfait est une RÉPONSE, pas un échec. Le registre n'a pas toujours de quoi
     * répondre, et forcer une composition avec des briques qui ne conviennent pas
     * produirait une chaîne conforme au lint et absurde à l'usage — le pire des deux
     * mondes. L'appelant retombera sur la rédaction.
     */
    if (forfait(reponse.texte)) {
      journal.push({ tour, yaml: '', forfait: true, report: null, illisible: '' });
      aRenonce = true;
      break;
    }

    const yamlBrut = extraire(reponse.texte);
    let artefact = null;
    let erreurLecture = '';
    try { artefact = normaliserChaine(parse(yamlBrut), { auteur, scope, parId }); }
    catch (error) { erreurLecture = error.message; }

    if (!artefact) {
      journal.push({ tour, yaml: yamlBrut, report: null,
                     illisible: erreurLecture || 'YAML vide ou non structuré' });
      invite = `Ta réponse n'était pas un YAML lisible (${erreurLecture || 'vide'}). `
             + `Rends UNIQUEMENT un bloc \`\`\`yaml valide.\n\n`
             + consigneComposition({ phrase, briques, auteur, scopes });
      dernier = null;
      continue;
    }

    // `artifacts: briques` — sans elles, L024 et L025 se taisent, et une chaîne cassée
    // passerait pour conforme.
    const report = lint(artefact, { ...registres, artifacts: briques });
    journal.push({ tour, yaml: yamlBrut, report, illisible: '' });
    dernier = { artefact, yaml: yamlBrut, report };

    if (!report.blocked) break;
    invite = correction({ yaml: yamlBrut, findings: report.findings, phrase });
  }

  return {
    ...(dernier || { artefact: null, yaml: '', report: null }),
    rendu: dernier?.artefact && serialiser ? serialiser(dernier.artefact) : '',
    tours: journal,
    jetons,
    cout: tarife ? euros : null,
    forfait: aRenonce,
    abandon: aRenonce || !dernier || dernier.report?.blocked === true
  };
}

export default { rediger, composer, consigne, consigneComposition, correction, extraire,
                 normaliser, normaliserChaine, identifiant, forfait, TOURS };
