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
