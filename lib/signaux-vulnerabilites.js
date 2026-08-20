/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  LES VULNÉRABILITÉS SIGNALÉES — ET « PERSONNE N'A CHERCHÉ » EST UN RÉSULTAT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── LE CAS QUE CE SIGNAL EXISTE POUR NE PAS RATER ────────────────────────────
 *
 * Aucun des deux forges ne rend un rapport de vulnérabilités par défaut. Sur GitLab,
 * l'API est réservée aux éditions supérieures ; sur GitHub, les alertes doivent être
 * activées et le jeton porter la bonne portée. Sur une instance ordinaire, la réponse est
 * donc « pas de service », pas « pas de vulnérabilité ».
 *
 * TROIS ÉTATS, ET ILS NE SE CONFONDENT JAMAIS :
 *
 *   SERVICE ABSENT   personne n'a cherché. On ne sait RIEN.
 *   ZÉRO TROUVÉ      un scanner a cherché et n'a rien trouvé — dans ce qu'il couvre.
 *   N TROUVÉS        voici la liste.
 *
 * Rendre une liste vide dans le premier cas ferait écrire « aucune vulnérabilité connue »
 * sur un dépôt que rien n'a jamais scanné. C'est le faux avec autorité le plus coûteux du
 * registre, parce qu'il rassure exactement là où il ne faut pas.
 *
 * ── ET LA SÉVÉRITÉ DÉCLARÉE N'EST PAS LE RISQUE ──────────────────────────────
 *
 * Un scanner note une faille dans l'absolu : « critique » veut dire « critique pour
 * quelqu'un qui utilise la fonction vulnérable, exposée à une entrée hostile ». Une
 * dépendance tirée pour trois fonctions dont aucune n'est celle-là n'est pas critique ici.
 *
 * L'inverse existe aussi et se voit moins : une faille « moyenne » dans une bibliothèque
 * qui traite les entrées d'une API publique est plus urgente qu'une « critique » dans un
 * outil de build. Le texte le dit, et les agents qui le lisent ont l'interdiction de
 * reprendre la sévérité déclarée comme un ordre de traitement.
 */

/** Le vocabulaire de sévérité, tel que les deux forges le rendent. FERMÉ. */
export const SEVERITES = ['critical', 'high', 'medium', 'low', 'info', 'unknown'];

/** L'ordre de gravité déclarée — pour trier, jamais pour prioriser. */
const RANG = Object.fromEntries(SEVERITES.map((s, i) => [s, i]));

const rangDe = (s) => (RANG[String(s || '').toLowerCase()] ?? RANG.unknown);

const MAX_DETAIL = 40;

/**
 * Le rapport de vulnérabilités d'un dépôt.
 *
 * @param {object} e
 *   @param {string} e.depot
 *   @param {boolean} e.disponible  la forge a-t-elle RÉPONDU
 *   @param {string} e.raison       pourquoi elle n'a pas répondu, le cas échéant
 *   @param {Array} e.liste         les vulnérabilités, si disponible
 *   @param {Date} e.maintenant
 */
export function rapportVulnerabilites({ depot = '', disponible = false, raison = '',
                                        liste = [], maintenant = new Date() } = {}) {
  const propres = (disponible ? liste : []).map((v) => ({
    titre: v.titre || '(sans titre)',
    severite: String(v.severite || 'unknown').toLowerCase(),
    etat: String(v.etat || '').toLowerCase(),
    paquet: v.paquet || '',
    version: v.version || '',
    fichier: v.fichier || '',
    identifiants: (v.identifiants || []).filter(Boolean),
    decrit: String(v.decrit || '').split('\n')[0].slice(0, 200)
  })).sort((a, b) => rangDe(a.severite) - rangDe(b.severite));

  const parSeverite = new Map();
  for (const v of propres) parSeverite.set(v.severite, (parSeverite.get(v.severite) || 0) + 1);

  const parPaquet = new Map();
  for (const v of propres) {
    const k = v.paquet || '(paquet non nommé)';
    if (!parPaquet.has(k)) parPaquet.set(k, { paquet: k, total: 0, pire: v.severite });
    const e = parPaquet.get(k);
    e.total += 1;
    if (rangDe(v.severite) < rangDe(e.pire)) e.pire = v.severite;
  }

  const r = {
    depot,
    disponible,
    raison,
    total: propres.length,
    vulnerabilites: propres,
    parSeverite: [...parSeverite.entries()].map(([severite, n]) => ({ severite, n }))
      .sort((a, b) => rangDe(a.severite) - rangDe(b.severite)),
    parPaquet: [...parPaquet.values()].sort((a, b) => rangDe(a.pire) - rangDe(b.pire)
                                                  || b.total - a.total),
    le: maintenant.toISOString()
  };
  return { ...r, texte: texteVulnerabilites(r) };
}

function texteVulnerabilites(r) {
  const L = [];
  L.push(`Vulnérabilités signalées — ${r.depot}`);
  L.push('');

  /*
   * L'ÉTAT DU SERVICE AVANT TOUT CHIFFRE, ET IL PEUT CLORE LE TEXTE.
   *
   * Un rapport qui commence par « 0 vulnérabilité » sur un dépôt jamais scanné est le pire
   * résultat que cette plateforme puisse produire : il rassure exactement là où il ne faut
   * pas, et il a l'autorité d'un chiffre.
   */
  if (!r.disponible) {
    L.push('AUCUN SCAN N\'A EU LIEU — ET CE N\'EST PAS « AUCUNE VULNÉRABILITÉ »');
    L.push(`  ${r.raison || 'La forge n\'a pas fourni de rapport de vulnérabilités.'}`);
    L.push('');
    L.push('  CE QU\'IL FAUT EN CONCLURE : RIEN. Ce dépôt a peut-être zéro faille connue, ou');
    L.push('  quarante. On ne sait pas, et personne ne le saura tant qu\'un scanner n\'aura pas');
    L.push('  tourné.');
    L.push('');
    L.push('  N\'ÉCRIS DONC NI « aucune vulnérabilité », NI « le dépôt est sain », NI aucun');
    L.push('  chiffre. La seule réponse honnête est de dire que la mesure n\'existe pas, et');
    L.push('  de proposer de la mettre en place.');
    L.push('');
    L.push('  Ce qui la mettrait en place : activer le scan de dépendances de la forge, ou');
    L.push('  ajouter un contrôle de dépendances à la chaîne CI, qui fonctionne sur toutes');
    L.push('  les éditions et n\'attend aucune licence.');
    return L.join('\n');
  }

  L.push('LE SCAN A EU LIEU');
  if (!r.total) {
    L.push('  0 vulnérabilité ouverte signalée.');
    L.push('  Ce qui veut dire : le scanner n\'a rien trouvé DANS CE QU\'IL COUVRE. Il ne voit');
    L.push('  que les dépendances DÉCLARÉES dans les manifestes qu\'il sait lire, et que les');
    L.push('  failles PUBLIÉES à ce jour. Ce n\'est pas « ce dépôt est sûr ».');
    return L.join('\n');
  }

  L.push(`  ${r.total} vulnérabilité(s) ouverte(s) signalée(s).`);
  L.push(`  Par sévérité déclarée : ${r.parSeverite.map((s) => `${s.n} ${s.severite}`).join(' · ')}`);
  L.push('');

  L.push('LA SÉVÉRITÉ DÉCLARÉE N\'EST PAS LE RISQUE ICI');
  L.push('  Un scanner note dans l\'absolu : « critique » veut dire critique pour quelqu\'un');
  L.push('  qui appelle la fonction vulnérable avec une entrée hostile. Une dépendance tirée');
  L.push('  pour trois fonctions dont aucune n\'est celle-là n\'est pas critique dans ce dépôt.');
  L.push('  L\'inverse se voit moins et compte autant : une faille « moyenne » dans ce qui');
  L.push('  traite les entrées d\'une API publique passe devant une « critique » dans un outil');
  L.push('  de build. NE REPRENDS DONC PAS CET ORDRE COMME UN ORDRE DE TRAITEMENT.');
  L.push('');

  L.push(`PAR PAQUET (${r.parPaquet.length})`);
  for (const p of r.parPaquet.slice(0, 20)) {
    L.push(`  ${String(p.paquet).slice(0, 34).padEnd(34)} ${String(p.total).padStart(3)} faille(s)`
         + ` · pire déclarée : ${p.pire}`);
  }
  if (r.parPaquet.length > 20) L.push(`  … ${r.parPaquet.length - 20} autre(s) paquet(s).`);
  L.push('  Un paquet qui porte plusieurs failles se met à jour UNE fois : c\'est souvent le');
  L.push('  geste le plus rentable, et il ne se voit pas dans une liste triée par sévérité.');
  L.push('');

  const montrees = r.vulnerabilites.slice(0, MAX_DETAIL);
  L.push(`LE DÉTAIL (${montrees.length}${r.total > montrees.length ? ` sur ${r.total}` : ''})`);
  for (const v of montrees) {
    L.push(`  [${v.severite}] ${v.paquet}${v.version ? ` ${v.version}` : ''}`
         + `${v.identifiants.length ? ` · ${v.identifiants.join(', ')}` : ''}`);
    L.push(`      ${v.titre}`);
    if (v.fichier) L.push(`      déclaré dans ${v.fichier}`);
  }
  if (r.total > montrees.length) {
    L.push(`  … ${r.total - montrees.length} non détaillée(s), mais COMPTÉE(S) plus haut.`);
  }
  L.push('');

  L.push('CE QUE CE RAPPORT NE DIT PAS');
  L.push('  · si le code APPELLE vraiment la fonction vulnérable — c\'est la question qui');
  L.push('    décide de l\'urgence, et aucun scanner de dépendances n\'y répond ;');
  L.push('  · les dépendances TRANSITIVES mal déclarées, et tout ce qui est installé hors');
  L.push('    manifeste ;');
  L.push('  · les failles NON PUBLIÉES, qui sont par définition la majorité de celles qui');
  L.push('    comptent un jour donné ;');
  L.push('  · si une mise à jour casse quelque chose : le scanner propose une version, il');
  L.push('    n\'a pas lu ton code.');
  return L.join('\n');
}

/** Le résumé d'une ligne — et il dit « non mesuré » plutôt que zéro. */
export function resumeVulnerabilites(r) {
  if (!r.disponible) return `${r.depot} — aucun scan disponible : rien n'est mesuré ici`;
  if (!r.total) return `${r.depot} — 0 faille signalée dans ce que le scanner couvre`;
  const pire = r.parSeverite[0];
  return `${r.depot} — ${r.total} faille(s) sur ${r.parPaquet.length} paquet(s)`
       + ` · pire déclarée : ${pire.n} ${pire.severite}`;
}

export const SIGNAUX_VULNERABILITES = {
  /*
   * `rapport_vulnerabilites` — le nom de l'inventaire, deux capacités s'en réclament.
   *
   * Il n'a PAS de réglage : la question « quelles failles ce dépôt porte-t-il » n'admet
   * pas de variante. Ce qui varie, c'est la disponibilité du service — et ça, ce n'est pas
   * un choix de l'utilisateur, c'est un fait de la forge.
   */
  rapport_vulnerabilites: {
    libelle: 'les vulnérabilités signalées par la forge',
    mots: ['faille', 'failles', 'cve', 'faillies'],
    besoin: 'le rapport de vulnérabilités du dépôt, s\'il en existe un',
    source: 'js/secrets-scanner.js · js/gouvernance-repo.js'
  }
};
