/*
 * Les correctifs PROPOSÉS — deux fichiers, une branche, une merge request, jamais fusionnée.
 *
 * ── CE QU'ON A LE DROIT DE CORRIGER PAR UN COMMIT, ET RIEN D'AUTRE ───────────
 *
 * L'audit CIS rend dix constats. DEUX seulement se réparent en écrivant un fichier :
 * `SECURITY.md` (1.2.1) et `CODEOWNERS` (1.1.6). Le hub le marque lui-même, `fixable`, et
 * c'est la frontière à ne pas franchir. Protéger une branche, exiger deux approbateurs,
 * sécuriser un webhook sont des RÉGLAGES du projet : aucun commit ne les change, et une MR
 * qui prétendrait les corriger mentirait à l'équipe qui la relit.
 *
 * Ce qui n'est pas corrigeable n'est pas passé sous silence pour autant : la description
 * de la MR le liste, avec l'écran exact où aller le régler. C'est la partie qui rend la
 * proposition utile plutôt que cosmétique.
 *
 * ── UNE PROPOSITION, ET LE MOT COMPTE ───────────────────────────────────────
 *
 * On ouvre une merge request. On ne la fusionne jamais. L'équipe qui tient le dépôt la
 * relit, l'ajuste, la fusionne ou la ferme — c'est elle qui décide de ce qui entre chez
 * elle. Un outil de conformité qui écrirait d'autorité dans les dépôts des autres se
 * ferait couper les droits la semaine suivante, et il l'aurait mérité.
 *
 * Les fichiers posés sont d'ailleurs des SQUELETTES à compléter, et ils le disent en
 * clair : un `SECURITY.md` sans contact ne protège personne, il coche une case. Le but est
 * qu'une équipe s'en saisisse, pas que le score monte.
 *
 * Module PUR : ni forge, ni DOM, ni réseau, ni horloge.
 */

/*
 * La branche des correctifs. Un nom stable, et c'est ce qui rend l'opération REJOUABLE :
 * on regarde s'il existe déjà une MR ouverte depuis cette branche avant d'en ouvrir une
 * seconde. Sans ça, relancer le scan trois fois poserait trois MR identiques sur le dos
 * d'équipes qui n'ont rien demandé.
 */
export const BRANCHE = 'salsi/conformite-cis';

/** Ce qu'un commit peut réellement réparer. Le reste relève des réglages du projet. */
export const CORRIGEABLES = new Set(['securitymd', 'codeowners']);

/** Où se règle, à la main, ce qu'aucun commit ne change. */
export const OU_REGLER = {
  branch: 'Settings → Repository → Protected branches',
  approvals: 'Settings → Merge requests → Approvals',
  linear: 'Settings → Merge requests → Merge method',
  maintainers: 'Project information → Members',
  webhooks: 'Settings → Webhooks',
  inactive: 'Archiver le projet (Settings → General → Advanced)',
  lockfiles: 'Commiter le fichier de verrou produit par le gestionnaire de dépendances',
  maven: 'Figer les versions dans `pom.xml`'
};

/** Le squelette de `SECURITY.md`. À compléter par l'équipe — le fichier le dit lui-même. */
export function securiteMd(depot) {
  return `# Politique de sécurité — ${depot}\n\n`
    + '## Signaler une vulnérabilité\n\n'
    + 'Merci de signaler toute vulnérabilité **en privé**, à l\'équipe sécurité, plutôt que '
    + 'par une issue publique : une faille décrite au grand jour est une faille offerte.\n\n'
    + '- Contact : _à compléter — adresse e-mail ou canal sécurité de l\'équipe_\n'
    + '- Délai de réponse visé : sous 72 h ouvrées\n\n'
    + '## Versions supportées\n\n'
    + '| Version | Supportée |\n|---|---|\n| dernière | ✅ |\n\n'
    + '---\n_Fichier PROPOSÉ automatiquement (conformité CIS 1.2.1). Tel quel il ne protège '
    + 'personne : il faut y mettre un vrai contact. À adapter par l\'équipe._\n';
}

/** Le squelette de `CODEOWNERS`. Le groupe est déduit du chemin, et ça se relit. */
export function codeowners(depot) {
  const groupe = String(depot).split('/')[0] || 'votre-groupe';
  return `# CODEOWNERS — ${depot}\n`
    + '# Les propriétaires par défaut, sollicités en revue sur chaque merge request.\n'
    + '# Syntaxe : <motif>  @utilisateur ou @groupe\n'
    + '# Réf. CIS 1.1.6.\n'
    + '#\n'
    + '# La ligne ci-dessous est un POINT DE DÉPART : elle désigne tout le dépôt. Une règle\n'
    + '# par répertoire sensible vaut beaucoup mieux — sinon tout le monde est sollicité sur\n'
    + '# tout, et plus personne ne regarde.\n\n'
    + `* @${groupe}\n`;
}

/**
 * Les fichiers à poser, d'après l'audit — et uniquement ceux qui manquent VRAIMENT.
 *
 * On lit les constats plutôt qu'on ne redevine : un dépôt qui a déjà son `CODEOWNERS`
 * dans `.github/` ne doit pas s'en voir proposer un second à la racine.
 */
export function fichiersAProposer(conformite, depot) {
  const ecarts = new Set((conformite?.controles || [])
    .filter((c) => c.etat === 'ko').map((c) => c.id));
  const out = [];
  if (ecarts.has('securitymd')) {
    out.push({ chemin: 'SECURITY.md', contenu: securiteMd(depot),
               pourquoi: 'SECURITY.md absent (CIS 1.2.1)' });
  }
  if (ecarts.has('codeowners')) {
    out.push({ chemin: 'CODEOWNERS', contenu: codeowners(depot),
               pourquoi: 'CODEOWNERS absent (CIS 1.1.6)' });
  }
  return out;
}

/** Y a-t-il seulement quelque chose à proposer sur ce dépôt ? */
export const aProposer = (conformite) =>
  (conformite?.controles || []).some((c) => c.etat === 'ko');

const echapperTable = (t) => String(t == null ? '' : t).replace(/\|/g, '\\|');

/**
 * La description de la merge request.
 *
 * Elle porte trois choses, et la deuxième est celle qui compte : ce que cette MR NE
 * corrige pas. Une équipe qui fusionne en croyant être conforme est plus mal lotie
 * qu'avant — elle a maintenant une preuve écrite qu'on s'en est occupé.
 */
export function descriptionMr({ depot = '', conformite = null, fichiers = [] } = {}) {
  const controles = conformite?.controles || [];
  const ecarts = controles.filter((c) => c.etat === 'ko');
  const nonVus = controles.filter((c) => c.etat === 'unverif');
  const reglages = ecarts.filter((c) => !CORRIGEABLES.has(c.id));

  const l = [
    `## 🛡️ Conformité CIS — ${conformite?.note ?? '—'}/100`,
    '',
    `Audit automatique de \`${depot}\`. Verdict : **${conformite?.verdict || 'non mesuré'}** — `
      + `${ecarts.length} écart(s).`,
    '',
    '> ⚠️ **C\'est une PROPOSITION.** Relisez, ajustez, fusionnez — ou fermez. Rien n\'est '
      + 'imposé, et personne ne fusionnera à votre place.',
    ''
  ];

  if (fichiers.length) {
    l.push('### 📄 Ce que cette MR ajoute', '',
      'Ces fichiers sont créés par la MR — il suffit de la fusionner. Ce sont des '
      + '**squelettes** : tels quels ils cochent une case, ils ne protègent rien. Prenez '
      + 'cinq minutes pour les compléter avant de fusionner.', '');
    for (const f of fichiers) l.push(`- \`${f.chemin}\` — ${f.pourquoi}`);
    l.push('');
  }

  l.push('### ⚙️ Ce que cette MR NE corrige PAS', '');
  if (reglages.length) {
    l.push('Ces écarts relèvent de la **configuration du projet** : aucun commit ne les '
      + 'change. Fusionner cette MR ne les règle pas.', '',
      '| Contrôle | CIS | Constat | Où le régler |', '|---|---|---|---|');
    for (const c of reglages) {
      l.push(`| ${echapperTable(c.libelle)} | ${c.cis} | ${echapperTable(c.detail)} | `
        + `${OU_REGLER[c.id] || '—'} |`);
    }
    l.push('');
  } else {
    l.push('_Aucun écart de configuration._', '');
  }

  if (nonVus.length) {
    l.push('### 🔒 Non vérifiable', '',
      'Le compte qui a lancé l\'audit n\'a pas les droits de lire ces points, ou notre '
      + 'couche ne les expose pas. **Ce n\'est pas un constat de non-conformité** : ces '
      + 'contrôles sont retirés du calcul de la note, jamais tenus pour conformes.', '');
    for (const c of nonVus) l.push(`- ${echapperTable(c.libelle)} (CIS ${c.cis}) — ${c.detail}`);
    l.push('');
  }

  l.push('---', '_Proposé par SalsiIAPrompt, d\'après le référentiel CIS. Les constats sont '
    + 'calculés par du code ; aucun modèle n\'a écrit cette description._');

  return l.join('\n');
}

/** Le titre de la merge request. Il dit le chiffre, parce que c'est ce qui décide. */
export const titreMr = (conformite) =>
  `🛡️ Conformité CIS — ${(conformite?.controles || []).filter((c) => c.etat === 'ko').length} `
  + `écart(s), note ${conformite?.note ?? '—'}/100`;

/** Le message du commit. Court, et il dit que c'est une proposition. */
export const messageCommit = (conformite) =>
  `chore(securite): conformite CIS proposee (${conformite?.note ?? '—'}/100)\n\n`
  + 'Fichiers squelettes a completer par l\'equipe. Cette MR ne corrige AUCUN reglage\n'
  + 'de projet : voir la description pour ce qui reste a faire a la main.';

export default { BRANCHE, CORRIGEABLES, OU_REGLER, securiteMd, codeowners,
                 fichiersAProposer, aProposer, descriptionMr, titreMr, messageCommit };

/* ══════════════════════════════════════════════════════════════════════════
 *  LES CORRECTIFS DU RAPPORT DE DÉPÔT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Même principe, autre source : les vingt-cinq contrôles du Repo Analyzer plutôt que les
 * dix contrôles CIS. Et la MÊME frontière, qui est le cœur du sujet.
 *
 * ── CE QU'UN COMMIT PEUT RÉPARER, ET CE QU'IL NE PEUT PAS ───────────────────
 *
 * Sur vingt-cinq constats, CINQ se réparent en écrivant un fichier. Les vingt autres
 * demandent autre chose :
 *
 *   un RÉGLAGE de projet    protéger `main` — aucun commit ne le fait
 *   une SUPPRESSION         les branches mortes — destructif, et jamais sans l'équipe
 *   un GESTE sur une MR     relire, assigner, fermer — ça se fait sur la forge
 *   une DÉCISION            découper plus petit, normaliser les messages de commit
 *
 * Une merge request qui prétendrait « corriger » la protection de branche mentirait à
 * l'équipe qui la relit — et cette équipe cesserait de relire les suivantes.
 */

/** La branche des correctifs de dépôt. Distincte de celle de la conformité CIS. */
export const BRANCHE_DEPOT = 'salsi/hygiene-depot';

/** Les cinq constats qu'un fichier répare. Les vingt autres sont listés, jamais touchés. */
export const CORRIGEABLES_DEPOT = new Set([
  'pas_de_readme', 'pas_de_contributing', 'pas_de_gitignore',
  'pas_de_codeowners', 'pas_de_modele_mr'
]);

/** Le squelette d'un README. Cinq lignes qui répondent aux cinq questions qu'on se pose. */
export function readme(depot) {
  const nom = String(depot).split('/').pop() || depot;
  return `# ${nom}\n\n`
    + '_À compléter par l\'équipe. Ce squelette a été proposé automatiquement parce que le '
    + 'dépôt n\'avait pas de README ; il ne dit encore rien d\'utile._\n\n'
    + '## À quoi ça sert\n\n'
    + '_Une ou deux phrases : quel problème ce dépôt résout, et pour qui._\n\n'
    + '## Comment le lancer\n\n'
    + '```sh\n# _les commandes réellement nécessaires, à jour_\n```\n\n'
    + '## Qui le tient\n\n'
    + '_L\'équipe responsable, et où la joindre. C\'est la ligne la plus utile du fichier : '
    + 'sans elle, un dépôt hérité devient un dépôt orphelin._\n';
}

/** Le squelette d'un CONTRIBUTING. Il décrit ce qui EXISTE, pas un idéal. */
export function contributing(depot, { prefixes = [], flow = '' } = {}) {
  return `# Contribuer à ${depot}\n\n`
    + '_À compléter. Proposé automatiquement : le dépôt compte plusieurs contributeurs et '
    + 'rien n\'écrivait comment on y travaille._\n\n'
    + '## Les branches\n\n'
    + (flow ? `Modèle observé sur ce dépôt : **${flow}**.\n\n` : '')
    + (prefixes.length
      ? `Préfixes attendus : ${prefixes.map((p) => `\`${p}\``).join(', ')}.\n\n`
      : '')
    + '## Les messages de commit\n\n'
    + '_Format retenu par l\'équipe — par exemple `type: description`, avec `feat`, `fix`, '
    + '`chore`._\n\n'
    + '## La revue\n\n'
    + '_Qui relit quoi, combien d\'approbations, et sous quel délai. Un délai annoncé vaut '
    + 'mieux qu\'un délai espéré._\n';
}

/*
 * Le `.gitignore` est le correctif le plus DÉLICAT de la liste.
 *
 * Il dépend de la technologie du projet, que la matière ne connaît pas — on lit un arbre de
 * fichiers, pas un langage. Poser un `.gitignore` Node sur un dépôt Java serait pire
 * qu'inutile : il donnerait l'impression que la question est réglée.
 *
 * On pose donc un fichier MINIMAL — ce qui traîne dans tous les dépôts, quelle que soit la
 * pile — et il annonce lui-même qu'il est incomplet.
 */
export function gitignore() {
  return '# Proposé automatiquement — MINIMAL et incomplet.\n'
    + '#\n'
    + '# Ce fichier ne couvre que ce qui traîne dans tous les dépôts.\n'
    + '# Les artefacts propres à la technologie du projet restent à compléter par\n'
    + '# l\'équipe — node_modules/, target/, __pycache__/, vendor/… — car ils ne se\n'
    + '# devinent pas depuis la seule liste des fichiers.\n\n'
    + '# Environnement local — la raison principale d\'avoir ce fichier\n'
    + '.env\n.env.*\n!.env.example\n\n'
    + '# Secrets déposés à côté du code\n'
    + '*.pem\n*.key\n*-credentials.json\n\n'
    + '# Systèmes de fichiers et éditeurs\n'
    + '.DS_Store\nThumbs.db\n.idea/\n.vscode/\n*.swp\n\n'
    + '# Journaux\n'
    + '*.log\n';
}

/** Le modèle de merge request. Trois questions, et la troisième est celle qu'on oublie. */
export function modeleMr() {
  return '<!-- Proposé automatiquement. À COMPLÉTER ou à adapter : trois questions valent\n'
    + '     mieux qu\'un formulaire que personne ne remplit. -->\n\n'
    + '## Ce que ça change\n\n'
    + '_Une phrase. Le diff dit le comment ; cette ligne dit le pourquoi._\n\n'
    + '## Comment le tester\n\n'
    + '_Les étapes exactes, ou le test automatique qui couvre le cas._\n\n'
    + '## Ce que ça risque de casser\n\n'
    + '_La question qu\'on oublie de se poser. « Rien » est une réponse valable, à '
    + 'condition de l\'avoir cherchée._\n';
}

/** Où vit un modèle de merge request, selon la forge. */
export const CHEMIN_MODELE_MR = {
  gitlab: '.gitlab/merge_request_templates/defaut.md',
  github: '.github/pull_request_template.md'
};

/**
 * Les fichiers à poser pour un rapport de dépôt.
 *
 * Chacun porte le CONSTAT qui le justifie : la description de la merge request les relie,
 * et une équipe qui relit doit pouvoir remonter de chaque fichier à la raison de sa
 * présence. Un fichier sans justification s'appelle une pollution.
 */
export function fichiersDepotAProposer(rapport, { forge = 'gitlab' } = {}) {
  const vus = new Set((rapport?.constats || []).map((c) => c.cle));
  const depot = rapport?.depot || '';
  const out = [];

  if (vus.has('pas_de_readme')) {
    out.push({ chemin: 'README.md', contenu: readme(depot),
               pourquoi: 'Rien ne dit à quoi sert ce dépôt' });
  }
  if (vus.has('pas_de_contributing')) {
    out.push({ chemin: 'CONTRIBUTING.md',
               contenu: contributing(depot, { prefixes: rapport?.prefixes_acceptes,
                                              flow: rapport?.flow }),
               pourquoi: 'Plusieurs contributeurs, aucune règle écrite' });
  }
  if (vus.has('pas_de_gitignore')) {
    out.push({ chemin: '.gitignore', contenu: gitignore(),
               pourquoi: 'Des artefacts et des secrets peuvent finir au dépôt' });
  }
  if (vus.has('pas_de_codeowners')) {
    out.push({ chemin: 'CODEOWNERS', contenu: codeowners(depot),
               pourquoi: 'Sans propriétaire déclaré, la revue échoit à qui passe' });
  }
  if (vus.has('pas_de_modele_mr')) {
    out.push({ chemin: CHEMIN_MODELE_MR[forge] || CHEMIN_MODELE_MR.gitlab,
               contenu: modeleMr(),
               pourquoi: 'Chaque merge request est décrite — donc relue — différemment' });
  }
  return out;
}

/** Y a-t-il quelque chose à proposer ? Sinon le bouton ne doit rien promettre. */
export const aProposerDepot = (rapport) =>
  fichiersDepotAProposer(rapport).length > 0;

/**
 * La description de la merge request.
 *
 * Elle porte les DEUX listes, et la seconde est la plus importante : ce que cette merge
 * request ne corrige pas. Sans elle, une équipe fusionne, voit son score bouger à peine, et
 * conclut que l'outil raconte n'importe quoi.
 */
export function descriptionMrDepot({ rapport = null, fichiers = [] } = {}) {
  const constats = rapport?.constats || [];
  const poses = new Set(fichiers.map((f) => f.pourquoi));
  const restants = constats.filter((c) => !CORRIGEABLES_DEPOT.has(c.cle));

  const l = [
    `## 🧹 Hygiène du dépôt — ${constats.length} constat(s)`,
    '',
    `Analyse automatique de \`${rapport?.depot || ''}\`, d'après les vingt-cinq contrôles du `
      + 'module Repo Analyzer de la plateforme.',
    '',
    '> ⚠️ **C\'est une PROPOSITION.** Relisez, ajustez, fusionnez — ou fermez. Rien n\'est '
      + 'fusionné automatiquement, et les fichiers posés sont des SQUELETTES : ils ne '
      + 'valent que complétés.',
    ''
  ];

  if (fichiers.length) {
    l.push(`### Ce que cette merge request pose (${fichiers.length})`, '');
    for (const f of fichiers) l.push(`- \`${f.chemin}\` — ${f.pourquoi}`);
    l.push('');
  }

  if (restants.length) {
    l.push(`### Ce qu'elle ne corrige PAS (${restants.length})`, '',
      'Aucun commit ne répare ces points : ce sont des réglages, des suppressions ou des '
      + 'décisions d\'équipe.', '');
    for (const c of restants) {
      l.push(`- **${c.titre}** — ${c.geste}`);
    }
    l.push('');
  }

  if (constats.some((c) => c.origine === 'observation')) {
    l.push('_Certains constats ci-dessus ne viennent pas du module de la plateforme : ils '
      + 'portent sur le flow réellement pratiqué, que son écran ne regarde pas. Ne pas '
      + 's\'attendre à les y retrouver._', '');
  }

  l.push('---', '_Proposé par SalsiIAPrompt. Les constats sont calculés par du code ; aucun '
    + 'modèle n\'a écrit cette description._');

  return l.join('\n');
}

/** Le titre. Il dit combien de fichiers et combien de constats restent à la main. */
export const titreMrDepot = (rapport, fichiers = []) =>
  `🧹 Hygiène du dépôt — ${fichiers.length} fichier(s) proposé(s), `
  + `${(rapport?.constats || []).length} constat(s) au total`;

/** Le message du commit. */
export const messageCommitDepot = (fichiers = []) =>
  `chore(hygiene): ${fichiers.length} fichier(s) de base proposes\n\n`
  + 'Squelettes a completer par l\'equipe. Cette MR ne corrige NI les reglages du projet,\n'
  + 'NI les branches, NI les merge requests : voir la description.';
