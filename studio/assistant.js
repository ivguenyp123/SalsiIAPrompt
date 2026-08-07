/*
 * Salsi — l'aide à l'écriture d'un artefact.
 *
 * ── LE PROBLÈME QU'IL RÈGLE ──────────────────────────────────────────────────
 *
 * La page d'identité demande de savoir déjà ce qu'on veut. Elle réclame un titre, une
 * intention, des variables, des outils, des critères — c'est-à-dire le résultat de la
 * réflexion, pas son point de départ. Devant un formulaire vide, on ne sait pas par où
 * commencer, et les 23 règles n'aident pas : elles jugent ce qui est écrit, elles
 * n'aident pas à l'écrire.
 *
 * Salsi renverse l'ordre : quatre questions sur ce qu'on veut OBTENIR, et l'artefact se
 * compose tout seul.
 *
 * ── AUCUN LLM, ET C'EST LE POINT ─────────────────────────────────────────────
 *
 * Salsi ne rédige pas : il COMPOSE à partir du registre. Les outils qu'il propose
 * existent au registre des outils, les critères aux cibles assertables. Il ne peut donc
 * pas inventer un outil qui n'existe pas ni une cible non vérifiable — les deux erreurs
 * les plus fréquentes quand on écrit à la main, et celles que `L004` et `L009` refusent.
 *
 * D'où une propriété qu'un assistant génératif ne pourrait pas offrir : **quel que soit
 * le chemin suivi dans le dialogue, l'artefact produit franchit la porte.** Elle est
 * vérifiée exhaustivement — toutes les combinaisons de réponses sont énumérées et
 * passées au linter.
 *
 * Module PUR : ni DOM, ni réseau.
 */

/*
 * Les questions. Une à la fois, comme le scaffolder du hub — on répond à ce qu'on sait,
 * pas à ce qu'on devrait savoir.
 *
 * Chaque option porte ce qu'elle IMPLIQUE (`apporte`), et la composition n'est qu'une
 * fusion. Ajouter une option ne demande donc pas de toucher au moteur.
 */
export const QUESTIONS = [
  {
    cle: 'but',
    q: 'Qu\'est-ce que tu veux que ça fasse, en une phrase ?',
    options: [
      { id: 'expliquer', icone: '🔍', titre: 'Expliquer quelque chose',
        sous: 'traduire un échec, un journal, un diff en cause probable',
        apporte: { kind: 'prompt', outils: ['read_pipeline_status'], sections: true,
                   verbe: 'Expliquer', notFor: 'Ne pas utiliser pour décider d\'une action : cet artefact explique, il ne tranche pas.' } },
      { id: 'rediger', icone: '✍️', titre: 'Rédiger un texte',
        sous: 'message de commit, note de version, résumé de merge request',
        apporte: { kind: 'prompt', outils: ['read_repo_metadata'], convention: true,
                   verbe: 'Rédiger', notFor: 'Ne pas utiliser pour produire du code ou de la configuration : cet artefact rédige du texte destiné à un humain.' } },
      { id: 'verifier', icone: '🛡️', titre: 'Vérifier / contrôler',
        sous: 'signaler ce qui cloche avant que ça parte',
        apporte: { kind: 'agent', outils: ['read_repo_metadata', 'scan_vulnerabilities'], sections: true,
                   verbe: 'Vérifier', notFor: 'Ne pas utiliser comme unique garde-fou : cet artefact signale, il ne bloque pas.' } },
      { id: 'agir', icone: '🚀', titre: 'Agir sur le dépôt',
        sous: 'préparer une livraison, ouvrir une merge request',
        apporte: { kind: 'agent', outils: ['check_branch', 'create_mr'], ecrit: true,
                   verbe: 'Préparer', notFor: 'Ne pas utiliser sur un dépôt de production sans revue : cet artefact écrit.' } }
    ]
  },
  {
    cle: 'entree',
    q: 'De quoi a-t-il besoin pour travailler ?',
    options: [
      { id: 'depot', icone: '📦', titre: 'Le dépôt et sa stack',
        sous: 'la plateforme les fournit toute seule',
        apporte: { variables: [{ name: 'repo', source: 'repo' }, { name: 'stack', source: 'repo' }] } },
      { id: 'depot_branche', icone: '🌿', titre: 'Le dépôt et une branche',
        sous: 'quand le travail porte sur une branche précise',
        apporte: { variables: [{ name: 'repo', source: 'repo' }, { name: 'branche', source: 'user' }] } },
      { id: 'depot_saisie', icone: '⌨️', titre: 'Le dépôt et une saisie',
        sous: 'un texte que l\'utilisateur colle — journal, diff, message',
        apporte: { variables: [{ name: 'repo', source: 'repo' }, { name: 'entree', source: 'user' }] } }
    ]
  },
  {
    cle: 'preuve',
    q: 'Comment saura-t-on que la sortie est bonne ?',
    aide: 'C\'est le contrat vérifié à chaque exécution. Sans lui, il n\'y a que du jugement.',
    options: [
      { id: 'court', icone: '📏', titre: 'Elle est courte et sans secret',
        sous: 'le minimum défendable, et il tient pour presque tout',
        apporte: { criteres: [{ target: 'output.length', op: 'lte', value: 2000 },
                              { target: 'output.contains_secret', op: 'eq', value: false }] } },
      { id: 'structure', icone: '🧱', titre: 'Elle suit une structure imposée',
        sous: 'des sections attendues, une convention de format',
        apporte: { criteres: [{ target: 'output.sections', op: 'exists', value: true },
                              { target: 'output.contains_secret', op: 'eq', value: false }] } },
      { id: 'monde', icone: '🌍', titre: 'L\'état du dépôt a changé comme prévu',
        sous: 'pipeline vert, branche mergeable, aucune vulnérabilité critique',
        apporte: { criteres: [{ target: 'pipeline.status', op: 'eq', value: 'success' },
                              { target: 'vulnerabilities.critical', op: 'eq', value: 0 }] } }
    ]
  },
  {
    cle: 'niveau',
    q: 'Jusqu\'où veux-tu aller ?',
    aide: 'Le niveau visé fixe le nombre de cas d\'or exigés. On peut viser haut plus tard.',
    options: [
      { id: 'experimental', icone: '🌱', titre: 'J\'essaie',
        sous: 'aucun cas d\'or exigé — pour voir si l\'idée tient',
        apporte: { niveau: 'experimental' } },
      { id: 'team', icone: '👥', titre: 'Pour mon équipe',
        sous: '3 cas d\'or à écrire ensuite',
        apporte: { niveau: 'team' } },
      { id: 'officiel', icone: '🏛️', titre: 'Officiel',
        sous: '5 cas d\'or, et la revue qui va avec',
        apporte: { niveau: 'officiel' } }
    ]
  }
];

/** L'option choisie pour une question, ou la première par défaut. */
const choix = (question, reponses) =>
  question.options.find((o) => o.id === reponses[question.cle]) || question.options[0];

/*
 * Le spec est ASSEMBLÉ, pas rédigé.
 *
 * Chaque variable déclarée y est interpolée — c'est ce qu'exigent `L002` et `L021`, et
 * c'est aussi la seule façon qu'un prompt serve à quelque chose. Le texte reste
 * volontairement squelettique : Salsi donne une charpente correcte, l'auteur y met son
 * métier. Prétendre rédiger à sa place demanderait un modèle, et un modèle ne garantit
 * rien.
 */
function composerSpec({ verbe, variables, ecrit, sections }) {
  const noms = variables.map((v) => v.name);
  const lignes = [`Tu interviens sur le dépôt {{${noms[0]}}}.`, ''];

  if (noms.includes('stack')) lignes.push('Sa stack technique est {{stack}} : adapte tes vérifications en conséquence.');
  if (noms.includes('branche')) lignes.push('Le travail porte sur la branche {{branche}}.');
  if (noms.includes('entree')) lignes.push('Voici ce qui t\'est soumis :', '', '{{entree}}', '');

  lignes.push('', `${verbe} en respectant ces règles :`);
  lignes.push('- va au fait : une personne pressée doit comprendre en dix secondes');
  lignes.push('- n\'invente rien : si une information manque, dis qu\'elle manque');
  if (sections) lignes.push('- structure ta réponse en sections courtes et titrées');
  if (ecrit) {
    lignes.push('- tu NE FAIS PAS les écritures : tu proposes, un module les exécute');
    lignes.push('- explique ce que tu proposes de changer, et pourquoi');
  }
  lignes.push('', '<!-- Précise ici ce qui est propre à ton métier : ce que Salsi ne peut pas deviner. -->');

  return lignes.join('\n');
}

/**
 * Compose un formulaire de Studio à partir des réponses.
 *
 * @param {object} reponses  { but, entree, preuve, niveau }
 * @param {object} ctx       { tools } — le registre, pour n'apporter que des outils réels
 * @returns {object} les champs du formulaire, plus `pourquoi` : le raisonnement à montrer
 */
export function composer(reponses = {}, ctx = {}) {
  const [qBut, qEntree, qPreuve, qNiveau] = QUESTIONS;
  const but = choix(qBut, reponses);
  const entree = choix(qEntree, reponses);
  const preuve = choix(qPreuve, reponses);
  const niveau = choix(qNiveau, reponses);

  const variables = entree.apporte.variables;

  // Le registre filtre : un outil que Salsi proposerait sans qu'il existe serait refusé
  // par L004 — et l'assistant aurait produit un artefact refusé par le produit lui-même.
  const connus = new Set((ctx.tools || []).map((t) => t.id));
  const tools = but.apporte.outils.filter((id) => connus.size === 0 || connus.has(id)).map((id) => ({ id }));

  const form = {
    kind: but.apporte.kind,
    title: '',                              // à l'auteur : c'est ce qu'il sait, lui
    purpose: '',
    notFor: but.apporte.notFor,
    spec: composerSpec({ verbe: but.apporte.verbe, variables,
                         ecrit: but.apporte.ecrit, sections: but.apporte.sections }),
    variables: variables.map((v) => ({ ...v })),
    tools,
    criteria: preuve.apporte.criteres.map((c) => ({ ...c, value: String(c.value) })),
    goldenCases: [],
    targetLevel: niveau.apporte.niveau,

    /*
     * Le raisonnement, montré et non caché. C'est ce que fait le scaffolder du hub, et
     * pour la même raison : un choix qu'on ne comprend pas, on le subit — et on ne
     * saura pas le corriger quand le contexte changera.
     */
    pourquoi: [
      [but.icone, `${but.titre} → type \`${but.apporte.kind}\``,
       `Les outils proposés (${tools.map((t) => t.id).join(', ') || 'aucun'}) viennent du registre : Salsi n'invente pas d'outil.`],
      [entree.icone, `${entree.titre} → ${variables.length} variables`,
       `\`${variables.map((v) => v.name).join('`, `')}\` — chacune est interpolée dans le spec, sinon L002 et L021 refuseraient.`],
      [preuve.icone, `${preuve.titre} → ${preuve.apporte.criteres.length} critères`,
       'Toutes les cibles existent au registre des cibles assertables : L009 est satisfaite par construction.'],
      [niveau.icone, `${niveau.titre} → niveau visé \`${niveau.apporte.niveau}\``,
       niveau.apporte.niveau === 'experimental'
         ? 'L010 n\'exige aucun cas d\'or à ce niveau : la porte s\'ouvrira dès que le reste est rempli.'
         : 'L010 exigera des cas d\'or : ils se saisissent en bas du formulaire.']
    ]
  };

  return form;
}

/** Tous les chemins possibles du dialogue — sert au test d'exhaustivité. */
export function tousLesChemins() {
  const chemins = [{}];
  for (const q of QUESTIONS) {
    const suivants = [];
    for (const partiel of chemins) for (const o of q.options) suivants.push({ ...partiel, [q.cle]: o.id });
    chemins.length = 0;
    chemins.push(...suivants);
  }
  return chemins;
}

export default { QUESTIONS, composer, tousLesChemins };
