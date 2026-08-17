/*
 * La matière des signaux de SÉCURITÉ — calculée depuis le dépôt, jamais demandée.
 *
 * ── LA MÊME FORME QUE LE BUS FACTOR, POUR LA MÊME RAISON ─────────────────────
 *
 * Le bus factor a fini par marcher le jour où il a cessé de demander quoi que ce soit :
 * une entrée que la plateforme calcule, une consigne qui interdit de recalculer, des
 * critères sur les sections. Les agents de sécurité reprennent cette forme à l'identique.
 *
 * L'inventaire déclare `rapport_secrets`, `inventaire_dependances` et `rapport_conformite`
 * comme des entrées à FOURNIR — autrement dit : lance le scanner du hub, exporte, colle le
 * résultat. Personne ne fera ça. Et un agent lancé sans ce collage reçoit un champ vide,
 * donc invente. On calcule donc les trois ici.
 *
 * ── EXTRAIT, JAMAIS INVENTÉ ──────────────────────────────────────────────────
 *
 * Rien de ce fichier n'a été imaginé. Chaque motif, chaque seuil, chaque pondération est
 * lu dans la plateforme :
 *
 *   les 24 motifs de secret et le filtre des valeurs factices   js/secrets-scanner.js
 *   la liste des fichiers à risque, et ceux qu'on saute          js/secrets-scanner.js
 *   les règles de chaîne d'approvisionnement, par écosystème     js/secrets-scanner.js
 *   les contrôles CIS, leurs poids, et l'exclusion du non vu     js/gouvernance-repo.js
 *
 * Un seuil approximatif ferait diverger deux rapports censés être le même, et personne ne
 * saurait lequel croire.
 *
 * ── CE QU'ON NE PEUT PAS VOIR EST DIT, PAS CACHÉ ─────────────────────────────
 *
 * Le hub interroge des points d'API réservés aux administrateurs — approbations, webhooks,
 * membres — et retombe sur `unverif` dès qu'il prend un 403. Notre couche de forge ne les
 * expose pas du tout : ces contrôles sont donc `unverif` par construction. Ils ne sont ni
 * comptés dans la note, ni masqués. C'est la règle du hub lui-même, et elle est la seule
 * honnête : on ne note pas ce qu'on ne voit pas, et on ne laisse pas croire qu'on l'a vu.
 *
 * Module PUR : ni forge, ni DOM, ni réseau, ni horloge. Il reçoit des fichiers déjà lus.
 */

/** Ce qu'on sait calculer côté sécurité. Fusionné dans `SIGNAUX` par signaux-matiere.js. */
export const SIGNAUX_SECURITE = {
  rapport_secrets: {
    libelle: 'les secrets exposés dans le dépôt',
    besoin: 'les fichiers à risque du dépôt, lus sur la branche par défaut',
    source: 'js/secrets-scanner.js'
  },
  inventaire_dependances: {
    libelle: 'les dépendances et la chaîne d\'approvisionnement',
    besoin: 'les manifestes du dépôt : package.json, pom.xml, Dockerfile, CI…',
    source: 'js/secrets-scanner.js'
  },
  rapport_conformite: {
    libelle: 'la conformité du dépôt au référentiel CIS',
    besoin: 'les branches, l\'arborescence et la dernière activité du dépôt',
    source: 'js/gouvernance-repo.js'
  }
};

/* ══ LES SECRETS ═══════════════════════════════════════════════════════════════
 *
 * Repris de `js/secrets-scanner.js`, motif pour motif. Ne rien retirer et ne rien ajouter :
 * un motif de plus produirait des constats que le hub ne montre pas, un motif de moins
 * ferait passer pour propre un dépôt que le hub signale.
 */
export const MOTIFS_SECRET = [
  { nom: 'AWS Access Key',            re: /\bAKIA[0-9A-Z]{16}\b/g },
  { nom: 'GitLab PAT',                re: /\bglpat-[a-zA-Z0-9_\-]{20}\b/g },
  { nom: 'GitHub PAT (classic)',      re: /\bghp_[a-zA-Z0-9]{36}\b/g },
  { nom: 'GitHub PAT (fine-grained)', re: /\bgithub_pat_[a-zA-Z0-9_]{82}\b/g },
  { nom: 'Slack Token',               re: /\bxox[baprs]-[0-9a-zA-Z\-]{10,}\b/g },
  { nom: 'Stripe Secret Key',         re: /\bsk_live_[0-9a-zA-Z]{24}\b/g },
  { nom: 'Stripe Restricted Key',     re: /\brk_live_[0-9a-zA-Z]{24}\b/g },
  { nom: 'Google API Key',            re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { nom: 'GCP OAuth Client Secret',   re: /\bGOCSPX-[a-zA-Z0-9_\-]{28}\b/g },
  { nom: 'GCP Service Account ID',    re: /"private_key_id"\s*:\s*"[a-f0-9]{40}"/g },
  { nom: 'GitLab Runner/Deploy/CI Token', re: /\bgl(?:rt|dt|ft|ptt|cbt|soat|agent|imt)-[0-9a-zA-Z_\-]{20,}\b/g },
  { nom: 'GitHub Token (oauth/server/refresh)', re: /\bgh[opsu]_[a-zA-Z0-9]{36}\b/g },
  { nom: 'npm Token',                 re: /\bnpm_[a-zA-Z0-9]{36}\b/g },
  { nom: 'PyPI Token',                re: /\bpypi-AgEIcHlwaS[a-zA-Z0-9_\-]{50,}\b/g },
  { nom: 'OpenAI Key',                re: /\bsk-(?:proj|svcacct|admin)-[a-zA-Z0-9_\-]{20,}\b|\bsk-[a-zA-Z0-9]{48}\b/g },
  { nom: 'Anthropic Key',             re: /\bsk-ant-[a-zA-Z0-9_\-]{20,}\b/g },
  { nom: 'HuggingFace Token',         re: /\bhf_[a-zA-Z0-9]{34,}\b/g },
  { nom: 'HashiCorp Vault Token',     re: /\bhvs\.[a-zA-Z0-9_\-]{20,}\b/g },
  { nom: 'DigitalOcean Token',        re: /\bdo[oprt]_v1_[a-f0-9]{64}\b/g },
  { nom: 'SendGrid API Key',          re: /\bSG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43}\b/g },
  { nom: 'Private Key (PEM)',         re: /-----BEGIN (?:RSA |OPENSSH |DSA |EC )?PRIVATE KEY-----/g },
  { nom: 'JWT Token',                 re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
  { nom: 'Basic Auth in URL',         re: /https?:\/\/[a-zA-Z0-9._\-]+:[^@\s\/]{6,}@/g },
  { nom: 'DB Connection String',      re: /\b(?:mongodb|postgres|postgresql|mysql|redis|amqp|amqps)(?:\+srv)?:\/\/[^:\/\s]+:[^@\s\/]+@/gi }
];

/** Ce qui ressemble à un secret sans en être un : `your-token`, `CHANGE_ME`, `${VAR}`… */
export const MOTIF_FACTICE =
  /^(?:your[-_]?|x{3,}|<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|placeholder|change[-_]?me|redacted|todo|fake|dummy|example|sample|test[-_]?only)/i;

/**
 * Un fichier vaut-il d'être lu ?
 *
 * On ne scanne pas tout le dépôt, et ce n'est pas une économie : c'est le seul moyen
 * d'avoir un taux de faux positifs supportable. Un secret se pose dans un `.env`, un
 * `credentials.json`, une clé privée — pas dans un fichier de traduction.
 */
export function fichierSuspect(chemin) {
  const nom = String(chemin).split('/').pop().toLowerCase();
  const bas = String(chemin).toLowerCase();
  if (/\.(example|template|sample|dist|md|png|jpe?g|gif|ico|svg|woff2?|ttf|eot|webp|mp[34]|mov|avi|zip|tar|gz|rar|7z|pdf|jar|war|class)$/i.test(nom)) return false;
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|target|coverage|\.git|out|\.next|\.nuxt|\.cache|__pycache__|\.venv|venv)(?:\/|$)/.test(bas)) return false;
  const risques = [
    /^\.env(\..+)?$/,
    /^(config|application|appsettings|settings|secrets?|credentials?)(\..+)?\.(json|ya?ml|toml|properties|ini|xml|env)$/,
    /^application(-.+)?\.(properties|ya?ml)$/,
    /^appsettings(\..+)?\.json$/,
    /^(local_settings|secret_settings)\.py$/,
    /^service[-_]account.*\.json$/,
    /^(credentials|firebase|gcp|aws)(\..+)?\.json$/,
    /\.(pem|key|p12|pfx|jks|asc)$/,
    /^id_(rsa|dsa|ecdsa|ed25519)$/,
    /^\.(npmrc|pypirc|dockercfg|htpasswd|netrc)$/,
    /^config\.json$/,
    /^terraform\.tfvars(\..+)?$/,
    /\.tfstate(\.backup)?$/,
    /^web\.config$/,
    /^\.gitlab-ci(\..+)?\.ya?ml$/,
    /^docker-compose(\..+)?\.ya?ml$/
  ];
  return risques.some((re) => re.test(nom));
}

/*
 * Combien de fichiers on lit. Un appel chacun : sans plafond, un dépôt truffé de
 * `application-*.yml` en déclencherait des centaines. Ce qu'on n'a pas lu est COMPTÉ et
 * dit dans le texte — un scan partiel qui se présenterait comme complet est pire qu'un
 * scan absent, parce qu'il rassure.
 */
export const MAX_FICHIERS_LUS = 60;

/** La référence CIS d'un constat, d'après le fichier où il se trouve. */
const refCis = (chemin) => {
  const feuille = String(chemin).split('/').pop();
  if (/^\.gitlab-ci/i.test(feuille)) return '2.3.8';
  if (/\.tfvars|\.tfstate/i.test(feuille)) return '5.1.3';
  return '1.5.1';
};

/**
 * Ce qu'on montre d'un secret : ses huit premiers caractères, et rien de plus.
 *
 * Assez pour le retrouver dans le fichier, jamais assez pour s'en servir. Le rapport part
 * dans un mail et un ticket : y recopier le secret en entier le republierait une fois de
 * plus, à l'endroit précis où on explique qu'il ne faut pas.
 */
export function apercuDe(trouve) {
  const s = String(trouve);
  return s.length > 10 ? `${s.substring(0, Math.min(8, s.length - 4))}***` : '***';
}

/** Les constats d'un fichier. Une ligne trop longue est sautée : c'est du minifié. */
export function scannerSecrets(contenu, fichier) {
  const constats = [];
  const lignes = String(contenu).split('\n');
  for (const motif of MOTIFS_SECRET) {
    const re = new RegExp(motif.re.source, motif.re.flags);
    lignes.forEach((ligne, i) => {
      if (ligne.length > 500) return;
      let m;
      while ((m = re.exec(ligne)) !== null) {
        if (MOTIF_FACTICE.test(m[0])) continue;
        constats.push({ fichier, ligne: i + 1, type: motif.nom,
                        apercu: apercuDe(m[0]), cis: refCis(fichier) });
      }
    });
  }
  return constats;
}

/** Un compteur trié par occurrences décroissantes. */
function parCle(items, cle) {
  const m = new Map();
  for (const it of items) m.set(it[cle], (m.get(it[cle]) || 0) + 1);
  return [...m.entries()].map(([nom, n]) => ({ nom, n })).sort((a, b) => b.n - a.n);
}

/**
 * La matière de `rapport_secrets`.
 *
 * @param {object} donnees
 *   depot      le dépôt
 *   fichiers   `[{ chemin, contenu }]` — ceux qu'on a réussi à lire
 *   candidats  combien de fichiers étaient suspects en tout
 *   total      combien de fichiers compte le dépôt
 */
export function rapportSecrets({ depot = '', fichiers = [], candidats = 0, total = 0 } = {}) {
  const constats = fichiers.flatMap((f) => scannerSecrets(f.contenu, f.chemin));
  const nonLus = Math.max(0, candidats - fichiers.length);

  const comptes = {
    constats: constats.length,
    fichiersTouches: new Set(constats.map((c) => c.fichier)).size,
    lus: fichiers.length,
    candidats, nonLus, total
  };
  const parType = parCle(constats, 'type');
  const parFichier = parCle(constats, 'fichier');

  return {
    constats, comptes, parType, parFichier,
    texte: texteSecrets({ depot, constats, comptes, parType }),
    presentation: presentationSecrets({ constats, comptes, parType, parFichier })
  };
}

function texteSecrets({ depot, constats, comptes, parType }) {
  const l = [
    `SECRETS EXPOSÉS — ${depot}`,
    `${comptes.lus} fichier(s) à risque lus sur les ${comptes.total} fichiers du dépôt.`,
    ''
  ];

  if (!comptes.lus) {
    l.push('Aucun fichier à risque n\'a pu être lu. Ce n\'est PAS un dépôt propre : c\'est '
      + 'une absence de mesure. Ne conclus rien sur la présence ou l\'absence de secrets.');
    return l.join('\n');
  }

  if (!constats.length) {
    l.push('Aucun secret détecté dans les fichiers lus.', '');
  } else {
    l.push(`${constats.length} constat(s), dans ${comptes.fichiersTouches} fichier(s).`, '',
      'Par nature :');
    for (const t of parType) l.push(`  ${String(t.n).padStart(4)}   ${t.nom}`);
    l.push('', 'Le détail, fichier par fichier :');
    for (const c of constats) {
      l.push(`  ${c.fichier}:${c.ligne}  ${c.type.padEnd(34)} ${c.apercu}   CIS ${c.cis}`);
    }
    l.push('');
  }

  if (comptes.nonLus > 0) {
    l.push(`${comptes.nonLus} fichier(s) à risque n'ont PAS été lus — on s'arrête à `
      + `${MAX_FICHIERS_LUS} pour ne pas multiplier les appels. Un secret peut s'y trouver.`, '');
  }

  l.push('Méthode : les fichiers du dépôt sont filtrés sur leur nom — `.env`, '
    + '`credentials.json`, clés privées, `terraform.tfvars`, fichiers de CI — puis lus sur '
    + 'la branche par défaut et confrontés à 24 motifs de secret. Les valeurs manifestement '
    + 'factices (`your-token`, `CHANGE_ME`, `${VAR}`) sont écartées. Ce sont les motifs et '
    + 'le filtre du scanner de la plateforme, repris à l\'identique.',
    '',
    'CE QUE CE RAPPORT NE VOIT PAS, et il faut le dire : il lit l\'ÉTAT ACTUEL de la '
    + 'branche par défaut. Un secret retiré du code hier est toujours lisible dans '
    + 'l\'historique git et sur les autres branches, et il n\'apparaîtra pas ici. Retirer '
    + 'un secret d\'un fichier ne le révoque pas.');

  return l.join('\n');
}

function presentationSecrets({ constats, comptes, parType, parFichier }) {
  const entete = !comptes.lus
    ? { valeur: '—', libelle: 'aucune mesure', sous: 'aucun fichier à risque n\'a pu être lu', ton: 'na' }
    : { valeur: String(constats.length),
        libelle: constats.length ? 'secrets à révoquer' : 'aucun secret détecté',
        sous: `${comptes.lus} fichier(s) à risque lus · ${comptes.fichiersTouches} touché(s)`,
        ton: constats.length ? 'ko' : 'ok' };

  const tableaux = [];
  if (parType.length) {
    tableaux.push({
      titre: 'Par nature de secret',
      colonnes: [{ libelle: 'Nature' }, { libelle: 'Constats', align: 'n' }],
      lignes: parType.map((t) => ({ cellules: [{ texte: t.nom }, { texte: String(t.n) }] }))
    });
  }
  if (constats.length) {
    tableaux.push({
      titre: 'Où ils se trouvent',
      colonnes: [{ libelle: 'Fichier' }, { libelle: 'Ligne', align: 'n' },
                 { libelle: 'Nature' }, { libelle: 'Aperçu' }],
      lignes: constats.map((c) => ({
        ton: 'ko',
        cellules: [{ texte: c.fichier, code: true }, { texte: String(c.ligne) },
                   { texte: c.type }, { texte: c.apercu, code: true }]
      })),
      note: 'Les valeurs sont tronquées à huit caractères : assez pour retrouver la ligne, '
          + 'jamais assez pour s\'en servir.'
    });
  }
  if (comptes.nonLus > 0) {
    tableaux.push({ titre: 'Ce qui n\'a pas été lu', colonnes: [], lignes: [],
      note: `${comptes.nonLus} fichier(s) à risque n'ont pas été lus. Le scan est partiel.` });
  }
  // parFichier sert au texte court ; il n'a pas de tableau propre, la liste le porte déjà.
  void parFichier;
  return { entete, tableaux };
}

/** Le résumé d'une ligne affiché à l'écran. */
export function resumeSecrets(r) {
  const c = r?.comptes;
  if (!c) return 'aucune mesure';
  if (!c.lus) return 'aucun fichier à risque lu — pas de mesure';
  if (!c.constats) return `aucun secret détecté · ${c.lus} fichier(s) à risque lus`;
  return `${c.constats} secret(s) · ${c.fichiersTouches} fichier(s)`
       + (c.nonLus ? ` · ${c.nonLus} non lu(s)` : '');
}

/* ══ LA CHAÎNE D'APPROVISIONNEMENT ═════════════════════════════════════════════
 *
 * Repris de `checkSupply` dans `js/secrets-scanner.js`. Deux sévérités, et elles ne se
 * valent pas : `rouge` est une porte ouverte (un script qui s'exécute à l'installation,
 * un registre en clair, un `curl | sh`), `orange` est une dérive possible (une version
 * qui bouge sous les pieds). Les mélanger ferait noyer trois urgences dans deux cents
 * versions non figées.
 */
export function ecosysteme(chemin) {
  const bas = String(chemin).toLowerCase();
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|target|\.git|__pycache__|venv|\.venv|coverage)(?:\/|$)/.test(bas)) return null;
  const nom = String(chemin).split('/').pop();
  if (nom === 'package.json') return 'npm';
  if (nom === '.npmrc') return 'npmrc';
  if (/^\.gitlab-ci(\..+)?\.ya?ml$/i.test(nom)) return 'ci';
  if (nom === 'pom.xml') return 'maven';
  if (nom === 'build.gradle' || nom === 'build.gradle.kts') return 'gradle';
  if (/^requirements.*\.txt$/i.test(nom)) return 'pip';
  if (nom === 'Dockerfile' || /\.dockerfile$/i.test(nom) || /^Dockerfile\./i.test(nom)) return 'docker';
  return null;
}

const ligneDe = (brut, aiguille) => {
  const i = brut.indexOf(aiguille);
  return i < 0 ? null : brut.slice(0, i).split('\n').length;
};
const court = (s) => { const t = String(s).trim(); return t.length > 90 ? `${t.slice(0, 90)}…` : t; };
const TUYAU = /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)\b/;

/** Les constats d'un manifeste, selon son écosystème. */
export function verifierManifeste(eco, contenu, fichier) {
  const out = [];
  const noter = (severite, tag, type, ligne, apercu) =>
    out.push({ severite, tag, type, fichier, ligne, apercu: court(apercu) });

  if (eco === 'npm') {
    let pkg; try { pkg = JSON.parse(contenu); } catch { return out; }
    for (const h of ['preinstall', 'install', 'postinstall']) {
      if (pkg.scripts && pkg.scripts[h]) {
        noter('rouge', 'npm', `Script ${h}`, ligneDe(contenu, `"${h}"`), pkg.scripts[h]);
      }
    }
    const exact = /^\d+\.\d+\.\d+([-+].+)?$/;
    for (const dk of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = pkg[dk];
      if (!deps || typeof deps !== 'object') continue;
      for (const [n, v] of Object.entries(deps)) {
        const val = String(v).trim();
        if (exact.test(val)) continue;
        const sev = (val === 'latest' || val === '*' || /^(git\+|https?:\/\/|github:|file:)/i.test(val))
          ? 'rouge' : 'orange';
        noter(sev, 'npm', 'Dépendance non figée', ligneDe(contenu, `"${n}"`), `${n}: ${val}`);
      }
    }
  } else if (eco === 'npmrc') {
    contenu.split('\n').forEach((ln, i) => {
      const m = ln.match(/registry\s*=\s*(\S+)/i);
      if (!m) return;
      if (/^http:\/\//i.test(m[1])) noter('rouge', 'npm', 'Registry HTTP (non chiffré)', i + 1, ln);
      else if (/^https?:/i.test(m[1]) && !/registry\.npmjs\.org/i.test(m[1])) {
        noter('orange', 'npm', 'Registry npm tiers', i + 1, ln);
      }
    });
  } else if (eco === 'ci') {
    contenu.split('\n').forEach((ln, i) => {
      const im = ln.match(/^\s*image:\s*["']?([^\s"'{]+)/);
      if (im && (/:latest$/i.test(im[1]) || !/:/.test(im[1]))) {
        noter('orange', 'ci', 'Image CI non pinnée', i + 1, im[1]);
      }
      if (TUYAU.test(ln)) noter('rouge', 'ci', 'Exécution distante (pipe shell)', i + 1, ln);
      if (/(remote:|include:).*https?:\/\//.test(ln)) noter('orange', 'ci', 'include CI distant', i + 1, ln);
    });
  } else if (eco === 'maven') {
    contenu.split('\n').forEach((ln, i) => {
      const m = ln.match(/<version>\s*([^<]+?)\s*<\/version>/i);
      if (m && !m[1].includes('${') && (/[[\]()]/.test(m[1]) || /\b(LATEST|RELEASE)\b/.test(m[1]))) {
        noter('orange', 'maven', 'Version Maven dynamique', i + 1, m[1]);
      }
    });
  } else if (eco === 'gradle') {
    contenu.split('\n').forEach((ln, i) => {
      if (/['"][\w.\-]+:[\w.\-]+:[^'"]*(\+|latest\.)[^'"]*['"]/i.test(ln)) {
        noter('orange', 'gradle', 'Version Gradle dynamique', i + 1, ln);
      }
    });
  } else if (eco === 'pip') {
    contenu.split('\n').forEach((ln, i) => {
      const t = ln.trim();
      if (!t || t.startsWith('#') || t.startsWith('-') || /^https?:/i.test(t) || t.startsWith('git+')) return;
      if (/^[A-Za-z0-9._\-[\]]+/.test(t) && !/[=<>~!]=/.test(t)) {
        noter('orange', 'pip', 'Dépendance Python non figée', i + 1, t);
      }
    });
  } else if (eco === 'docker') {
    contenu.split('\n').forEach((ln, i) => {
      const f = ln.match(/^\s*FROM\s+(\S+)/i);
      if (f && !/@sha256:/.test(f[1]) && (/:latest$/i.test(f[1]) || !/:/.test(f[1]))) {
        noter('orange', 'docker', 'Image Docker non pinnée', i + 1, f[1]);
      }
      if (/^\s*ADD\s+https?:\/\//i.test(ln)) noter('orange', 'docker', 'ADD distant (Dockerfile)', i + 1, ln);
      if (TUYAU.test(ln)) noter('rouge', 'docker', 'Exécution distante (pipe shell)', i + 1, ln);
    });
  }
  return out;
}

/** Combien de manifestes on lit. Même raison que pour les secrets, même honnêteté. */
export const MAX_MANIFESTES_LUS = 40;

/** Ce qu'on liste en clair. Au-delà, on compte : deux cents lignes ne se lisent pas. */
export const MAX_CONSTATS_LISTES = 40;

/**
 * La matière de `inventaire_dependances`.
 *
 * @param {object} donnees
 *   depot      le dépôt
 *   fichiers   `[{ chemin, eco, contenu }]` — les manifestes lus
 *   candidats  combien de manifestes le dépôt contient
 */
export function inventaireDependances({ depot = '', fichiers = [], candidats = 0 } = {}) {
  const constats = fichiers.flatMap((f) => verifierManifeste(f.eco, f.contenu, f.chemin));
  const nonLus = Math.max(0, candidats - fichiers.length);

  const rouges = constats.filter((c) => c.severite === 'rouge');
  const oranges = constats.filter((c) => c.severite === 'orange');
  const comptes = {
    constats: constats.length, rouges: rouges.length, oranges: oranges.length,
    lus: fichiers.length, candidats, nonLus,
    ecosystemes: [...new Set(fichiers.map((f) => f.eco))]
  };

  return {
    constats, rouges, oranges, comptes, parType: parCle(constats, 'type'),
    texte: texteDependances({ depot, rouges, oranges, comptes, parType: parCle(constats, 'type') }),
    presentation: presentationDependances({ rouges, oranges, comptes, parType: parCle(constats, 'type') })
  };
}

function texteDependances({ depot, rouges, oranges, comptes, parType }) {
  const l = [
    `CHAÎNE D'APPROVISIONNEMENT — ${depot}`,
    `${comptes.lus} manifeste(s) lus : ${comptes.ecosystemes.join(', ') || 'aucun'}.`,
    ''
  ];

  if (!comptes.lus) {
    l.push('Aucun manifeste trouvé. Ce dépôt ne déclare aucune dépendance là où on sait '
      + 'regarder — ce n\'est pas la preuve qu\'il n\'en a pas.');
    return l.join('\n');
  }

  l.push(`Ouvertures franches (rouge)  : ${comptes.rouges}`,
    `Versions qui bougent (orange) : ${comptes.oranges}`, '');

  if (parType.length) {
    l.push('Par nature :');
    for (const t of parType) l.push(`  ${String(t.n).padStart(4)}   ${t.nom}`);
    l.push('');
  }

  const dire = (titre, liste) => {
    if (!liste.length) return;
    l.push(titre);
    for (const c of liste.slice(0, MAX_CONSTATS_LISTES)) {
      l.push(`  ${c.fichier}:${c.ligne ?? '?'}  [${c.tag}] ${c.type} — ${c.apercu}`);
    }
    if (liste.length > MAX_CONSTATS_LISTES) {
      l.push(`  … et ${liste.length - MAX_CONSTATS_LISTES} de plus, de même nature.`);
    }
    l.push('');
  };
  dire('ROUGE — du code tiers s\'exécute, ou transite en clair :', rouges);
  dire('ORANGE — la version installée peut changer sans que le dépôt change :', oranges);

  if (comptes.nonLus > 0) {
    l.push(`${comptes.nonLus} manifeste(s) n'ont pas été lus — on s'arrête à `
      + `${MAX_MANIFESTES_LUS}.`, '');
  }

  l.push('Méthode : les manifestes du dépôt (package.json, .npmrc, .gitlab-ci.yml, pom.xml, '
    + 'build.gradle, requirements.txt, Dockerfile) sont lus sur la branche par défaut et '
    + 'confrontés aux règles de la plateforme. ROUGE désigne ce qui fait exécuter ou '
    + 'transiter du code tiers : un script `postinstall`, un registre en HTTP, un '
    + '`curl | sh`, une dépendance pointant une URL ou une branche git. ORANGE désigne une '
    + 'version non figée : le dépôt ne change pas, la dépendance installée si.',
    '',
    'CE QUE CE RAPPORT NE DIT PAS : il regarde ce qui est DÉCLARÉ, pas ce qui est '
    + 'installé. Il ne connaît aucune vulnérabilité publiée, et ne dit donc pas si une '
    + 'version figée est une version saine.');

  return l.join('\n');
}

function presentationDependances({ rouges, oranges, comptes, parType }) {
  const entete = !comptes.lus
    ? { valeur: '—', libelle: 'aucun manifeste', sous: 'rien à examiner', ton: 'na' }
    : { valeur: String(comptes.rouges),
        libelle: comptes.rouges ? 'ouvertures franches' : 'aucune ouverture franche',
        sous: `${comptes.oranges} version(s) non figée(s) · ${comptes.lus} manifeste(s) lus`,
        ton: comptes.rouges ? 'ko' : comptes.oranges ? 'moyen' : 'ok' };

  const tableau = (titre, liste, ton) => (liste.length ? {
    titre,
    colonnes: [{ libelle: 'Fichier' }, { libelle: 'Ligne', align: 'n' },
               { libelle: 'Nature' }, { libelle: 'Ce qui est écrit' }],
    lignes: liste.slice(0, MAX_CONSTATS_LISTES).map((c) => ({
      ton,
      cellules: [{ texte: c.fichier, code: true }, { texte: String(c.ligne ?? '?') },
                 { texte: c.type }, { texte: c.apercu, code: true }]
    })),
    note: liste.length > MAX_CONSTATS_LISTES
      ? `… et ${liste.length - MAX_CONSTATS_LISTES} de plus, de même nature.` : ''
  } : null);

  const tableaux = [
    parType.length ? {
      titre: 'Par nature',
      colonnes: [{ libelle: 'Nature' }, { libelle: 'Constats', align: 'n' }],
      lignes: parType.map((t) => ({ cellules: [{ texte: t.nom }, { texte: String(t.n) }] }))
    } : null,
    tableau('Rouge — du code tiers s\'exécute ou transite en clair', rouges, 'ko'),
    tableau('Orange — la version installée peut changer sans que le dépôt change', oranges, 'moyen')
  ].filter(Boolean);

  return { entete, tableaux };
}

/** Le résumé d'une ligne affiché à l'écran. */
export function resumeDependances(r) {
  const c = r?.comptes;
  if (!c) return 'aucune mesure';
  if (!c.lus) return 'aucun manifeste trouvé';
  return `${c.rouges} rouge(s) · ${c.oranges} orange(s) · ${c.lus} manifeste(s)`;
}

/* ══ LA CONFORMITÉ CIS ═════════════════════════════════════════════════════════
 *
 * Repris de `scanCIS` dans `js/gouvernance-repo.js` : les mêmes identifiants, les mêmes
 * références CIS, les mêmes poids, la même exclusion du non vérifiable, et le même verdict
 * BINAIRE — un seul écart et le dépôt est non conforme, quelle que soit la note.
 */
export const POIDS_CIS = { branch: 25, approvals: 25, linear: 5, codeowners: 5,
                           securitymd: 5, inactive: 5, maintainers: 10, webhooks: 10,
                           lockfiles: 5, maven: 5 };

/** Le seuil d'inactivité du hub : au-delà, le dépôt devrait être archivé. */
export const JOURS_INACTIF = 180;

/*
 * Ce que notre couche de forge ne peut PAS voir, et pourquoi.
 *
 * Le hub interroge quatre points d'API réservés — et prend un 403 dès qu'on n'est pas
 * administrateur du projet, ce qu'il gère déjà par `unverif`. `app/forge.js` ne les expose
 * pas du tout, volontairement : la couche est symétrique GitHub/GitLab, et ces quatre-là
 * n'ont pas d'équivalent commun. Ils sont donc non vérifiables PAR CONSTRUCTION, ce qui
 * est un fait à afficher, pas un trou à combler.
 */
export const NON_VERIFIABLES = [
  { id: 'approvals', cis: '1.1.4', libelle: 'Paramètres d\'approbation',
    pourquoi: 'les règles d\'approbation d\'une MR ne se lisent pas de la même façon sur les deux forges' },
  { id: 'linear', cis: '1.1.13', libelle: 'Historique linéaire',
    pourquoi: 'la méthode de fusion du projet n\'est pas exposée par notre couche' },
  { id: 'maintainers', cis: '1.3.7', libelle: 'Au moins 2 mainteneurs',
    pourquoi: 'la liste des membres demande des droits d\'administration du projet' },
  { id: 'webhooks', cis: '1.4.4', libelle: 'Webhooks sécurisés (HTTPS + token)',
    pourquoi: 'la liste des webhooks demande des droits d\'administration du projet' }
];

/** Les couples manifeste / verrou du hub, dans son ordre. */
const VERROUS = [['Pipfile', 'Pipfile.lock', 'Pipenv'], ['pyproject.toml', 'poetry.lock', 'Poetry'],
                 ['Gemfile', 'Gemfile.lock', 'Ruby'], ['composer.json', 'composer.lock', 'PHP'],
                 ['Cargo.toml', 'Cargo.lock', 'Rust'], ['go.mod', 'go.sum', 'Go']];

/** Les versions Maven qui bougent, telles que le hub les repère. */
export function versionsMavenMouvantes(contenu) {
  const trouves = [];
  let m;
  const plage = /<version>\s*([[(][^<]+[\])])\s*<\/version>/g;
  while ((m = plage.exec(contenu)) !== null) trouves.push(m[1]);
  const dyn = /<version>\s*(LATEST|RELEASE|.*-SNAPSHOT)\s*<\/version>/g;
  while ((m = dyn.exec(contenu)) !== null) trouves.push(m[1]);
  return trouves;
}

/**
 * La matière de `rapport_conformite`.
 *
 * @param {object} donnees
 *   depot            le dépôt
 *   defaut           le nom de la branche par défaut
 *   visibilite       'private' | 'public'
 *   branches         `[{ name, protectee, default }]`
 *   chemins          l'arborescence complète, chemins à plat
 *   pom              le contenu de `pom.xml`, ou null
 *   derniereActivite la date du dernier commit de la branche par défaut, ou ''
 *   maintenant       la date de référence — ce module n'a pas d'horloge
 */
export function rapportConformite({ depot = '', defaut = 'main', visibilite = '',
                                    branches = [], chemins = [], pom = null,
                                    derniereActivite = '', maintenant = null } = {}) {
  const controles = [];
  const noter = (id, cis, libelle, etat, detail) =>
    controles.push({ id, cis, libelle, etat, detail, poids: POIDS_CIS[id] || 5 });

  const a = (nom) => chemins.some((f) => f === nom || f.endsWith(`/${nom}`));

  /*
   * 1.1.1 — la branche par défaut est-elle protégée ?
   *
   * Le hub exige DEUX choses : protégée, et force push interdit. Notre couche rend le
   * drapeau `protected` mais pas les règles de push. Non protégée est donc un écart
   * CERTAIN ; protégée est un demi-constat, et un demi-constat noté comme un succès
   * ferait passer pour conforme un dépôt où le force push reste ouvert.
   */
  const laDefaut = branches.find((b) => b.name === defaut || b.default);
  if (!branches.length) {
    noter('branch', '1.1.1', 'Branche par défaut protégée', 'unverif', 'Aucune branche lue');
  } else if (!laDefaut) {
    noter('branch', '1.1.1', 'Branche par défaut protégée', 'unverif',
      `\`${defaut}\` introuvable parmi les branches lues`);
  } else if (!laDefaut.protectee) {
    noter('branch', '1.1.1', 'Branche par défaut protégée', 'ko', `\`${laDefaut.name}\` non protégée`);
  } else {
    noter('branch', '1.1.1', 'Branche par défaut protégée', 'unverif',
      `\`${laDefaut.name}\` est protégée, mais le force push n'est pas vérifiable ici`);
  }

  // 1.1.6 CODEOWNERS — le hub cherche aussi `.github/CODEOWNERS`, qui est l'emplacement
  // GitHub. Sans lui, tout dépôt GitHub correctement outillé serait déclaré en écart.
  const codeowners = ['CODEOWNERS', '.gitlab/CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']
    .find((p) => chemins.includes(p));
  noter('codeowners', '1.1.6', 'CODEOWNERS présent', codeowners ? 'ok' : 'ko',
    codeowners ? `Présent : \`${codeowners}\`` : 'Absent');

  // 1.2.1 SECURITY.md
  noter('securitymd', '1.2.1', 'SECURITY.md présent', a('SECURITY.md') ? 'ok' : 'ko',
    a('SECURITY.md') ? 'Présent' : 'Absent');

  /*
   * 1.2.7 — un dépôt inactif doit être archivé.
   *
   * DIVERGENCE ASSUMÉE : le hub lit `last_activity_at`, qui bouge sur une issue ou un
   * commentaire. Nous lisons la date du dernier COMMIT de la branche par défaut, la seule
   * que les deux forges rendent. Un dépôt discuté mais jamais commité paraîtra donc plus
   * inactif ici que sur le hub. C'est dit plutôt que lissé.
   */
  const ref = maintenant ? new Date(maintenant).getTime() : NaN;
  const t = derniereActivite ? new Date(derniereActivite).getTime() : NaN;
  if (Number.isFinite(ref) && Number.isFinite(t)) {
    const jours = Math.floor((ref - t) / 86400000);
    noter('inactive', '1.2.7', 'Archivage si inactif', jours < JOURS_INACTIF ? 'ok' : 'ko',
      `${jours} j depuis le dernier commit de \`${defaut}\``);
  } else {
    noter('inactive', '1.2.7', 'Archivage si inactif', 'unverif', 'Date du dernier commit inconnue');
  }

  // Lock files — un manifeste sans verrou installe une version différente à chaque build.
  const verrous = [];
  if (a('package.json')) {
    verrous.push({ eco: 'npm',
      present: a('package-lock.json') || a('yarn.lock') || a('pnpm-lock.yaml') });
  }
  for (const [man, lock, eco] of VERROUS) if (a(man)) verrous.push({ eco, present: a(lock) });
  if (verrous.length) {
    const manquants = verrous.filter((v) => !v.present);
    noter('lockfiles', '2.4.x', 'Lock files présents', manquants.length ? 'ko' : 'ok',
      manquants.length ? `Manquant(s) : ${manquants.map((v) => v.eco).join(', ')}`
                       : `${verrous.length} verrou(s) présent(s)`);
  }

  // Versions Maven figées — seulement si le dépôt a un `pom.xml`, comme le hub.
  if (a('pom.xml')) {
    if (pom === null) {
      noter('maven', '2.4.x', 'Versions Maven fixées', 'unverif', '`pom.xml` non lu');
    } else {
      const mouvantes = versionsMavenMouvantes(pom);
      noter('maven', '2.4.x', 'Versions Maven fixées', mouvantes.length ? 'ko' : 'ok',
        mouvantes.length ? `${mouvantes.length} version(s) non figée(s)` : 'Toutes figées');
    }
  }

  for (const n of NON_VERIFIABLES) noter(n.id, n.cis, n.libelle, 'unverif', n.pourquoi);

  /*
   * La note : moyenne pondérée des seuls contrôles tranchés. `unverif` est exclu du
   * DÉNOMINATEUR — c'est la règle du hub, et la seule défendable : compter un contrôle
   * qu'on n'a pas pu faire comme un échec punirait un droit manquant, et le compter comme
   * un succès récompenserait l'aveuglement.
   */
  let num = 0;
  let den = 0;
  for (const c of controles) {
    if (c.etat === 'ok' || c.etat === 'ko') { den += c.poids; if (c.etat === 'ok') num += c.poids; }
  }
  const note = den === 0 ? null : Math.round((num / den) * 100);
  const ecarts = controles.filter((c) => c.etat === 'ko');
  const nonVus = controles.filter((c) => c.etat === 'unverif');
  const verdict = den === 0 ? 'non mesuré' : (ecarts.length === 0 ? 'conforme' : 'non conforme');

  const comptes = { total: controles.length, ok: controles.filter((c) => c.etat === 'ok').length,
                    ecarts: ecarts.length, nonVus: nonVus.length, poidsNote: den };

  return {
    controles, ecarts, nonVus, note, verdict, comptes, visibilite,
    texte: texteConformite({ depot, defaut, visibilite, controles, ecarts, nonVus,
                             note, verdict, comptes }),
    presentation: presentationConformite({ controles, ecarts, nonVus, note, verdict, comptes })
  };
}

const ETAT_LISIBLE = { ok: 'conforme', ko: 'ÉCART', unverif: 'non vérifiable' };

function texteConformite({ depot, defaut, visibilite, controles, ecarts, nonVus,
                           note, verdict, comptes }) {
  const l = [
    `CONFORMITÉ CIS — ${depot}`,
    `Branche par défaut : ${defaut}${visibilite ? ` · dépôt ${visibilite === 'public' ? 'public' : 'privé'}` : ''}`,
    ''
  ];

  if (note === null) {
    l.push('Aucun contrôle n\'a pu être tranché : il n\'y a pas de note. Ce n\'est pas un '
      + 'zéro, c\'est une absence de mesure.', '');
  } else {
    l.push(`Verdict : ${verdict.toUpperCase()} — ${ecarts.length} écart(s).`,
      `Note : ${note} / 100, sur les ${comptes.total - comptes.nonVus} contrôle(s) tranchés.`,
      '  Le verdict est BINAIRE et la note ne le change pas : un seul écart rend le dépôt',
      '  non conforme. La note sert à savoir par quoi commencer, pas à négocier.',
      '');
  }

  l.push('Les contrôles, un par un :');
  for (const c of controles) {
    l.push(`  [${ETAT_LISIBLE[c.etat].padEnd(14)}] CIS ${c.cis.padEnd(7)} ${c.libelle.padEnd(38)} `
      + `poids ${String(c.poids).padStart(2)}   ${c.detail}`);
  }
  l.push('');

  if (ecarts.length) {
    l.push('Les écarts, par poids décroissant :');
    for (const c of [...ecarts].sort((a, b) => b.poids - a.poids)) {
      l.push(`  poids ${String(c.poids).padStart(2)}   CIS ${c.cis}   ${c.libelle} — ${c.detail}`);
    }
    l.push('');
  }

  if (nonVus.length) {
    l.push(`${nonVus.length} contrôle(s) n'ont PAS pu être vérifiés. Ils ne sont ni comptés `
      + 'dans la note, ni tenus pour conformes :');
    for (const c of nonVus) l.push(`  CIS ${c.cis}   ${c.libelle} — ${c.detail}`);
    l.push('');
  }

  l.push('Méthode : les contrôles, leurs références CIS et leurs poids sont ceux de l\'audit '
    + 'de la plateforme. La note est la moyenne pondérée des seuls contrôles tranchés — un '
    + 'contrôle non vérifiable est retiré du dénominateur, jamais compté comme réussi. '
    + 'L\'inactivité est mesurée sur le dernier commit de la branche par défaut, là où la '
    + 'plateforme lit la dernière activité du projet : un dépôt discuté sans être commité '
    + 'paraîtra plus inactif ici.');

  return l.join('\n');
}

function presentationConformite({ controles, ecarts, nonVus, note, verdict, comptes }) {
  const entete = note === null
    ? { valeur: '—', libelle: 'non mesuré', sous: 'aucun contrôle tranché', ton: 'na' }
    : { valeur: `${note}`, libelle: verdict,
        sous: `${ecarts.length} écart(s) · ${comptes.nonVus} non vérifiable(s) · note sur 100`,
        ton: ecarts.length ? 'ko' : 'ok' };

  const rang = { ko: 0, unverif: 1, ok: 2 };
  const tableaux = [{
    titre: 'Les contrôles, écarts en tête',
    colonnes: [{ libelle: 'État' }, { libelle: 'CIS' }, { libelle: 'Contrôle' },
               { libelle: 'Poids', align: 'n' }, { libelle: 'Constat' }],
    lignes: [...controles]
      .sort((a, b) => (rang[a.etat] - rang[b.etat]) || (b.poids - a.poids))
      .map((c) => ({
        ton: c.etat === 'ko' ? 'ko' : c.etat === 'unverif' ? 'moyen' : '',
        cellules: [{ texte: ETAT_LISIBLE[c.etat] }, { texte: c.cis, code: true },
                   { texte: c.libelle }, { texte: String(c.poids) }, { texte: c.detail }]
      })),
    note: nonVus.length
      ? `${nonVus.length} contrôle(s) non vérifiable(s) : retirés du dénominateur de la note, `
        + 'jamais tenus pour conformes.'
      : ''
  }];

  return { entete, tableaux };
}

/** Le résumé d'une ligne affiché à l'écran. */
export function resumeConformite(r) {
  if (!r?.comptes) return 'aucune mesure';
  if (r.note === null) return 'aucun contrôle tranché — pas de note';
  return `${r.verdict} · ${r.note}/100 · ${r.ecarts.length} écart(s) · `
       + `${r.comptes.nonVus} non vérifiable(s)`;
}

export default { SIGNAUX_SECURITE, MOTIFS_SECRET, MOTIF_FACTICE, MAX_FICHIERS_LUS,
                 MAX_MANIFESTES_LUS, MAX_CONSTATS_LISTES, POIDS_CIS, JOURS_INACTIF,
                 NON_VERIFIABLES, fichierSuspect, apercuDe, scannerSecrets, rapportSecrets,
                 resumeSecrets, ecosysteme, verifierManifeste, inventaireDependances,
                 resumeDependances, versionsMavenMouvantes, rapportConformite,
                 resumeConformite };
