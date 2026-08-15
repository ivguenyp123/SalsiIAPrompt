/*
 * L'aide à la validation — un modèle qui cherche les contradictions, jamais un juge.
 *
 * ── LE TROU QU'ELLE COMBLE, ET SEULEMENT LUI ─────────────────────────────────
 *
 * Les 25 règles vérifient la FORME. C'est écrit en tête du dépôt depuis le début : un
 * spec syntaxiquement irréprochable qui ne veut rien dire franchit la porte. Le relecteur
 * de l'Admin doit donc repérer SEUL que le spec ne fait pas ce que `intent.purpose`
 * annonce, que le `not_for` contredit le spec, ou que les cas d'or testent autre chose
 * que ce à quoi l'agent sert.
 *
 * ── LA LIGNE QUI REND ÇA ACCEPTABLE ──────────────────────────────────────────
 *
 *   COHÉRENCE INTERNE ≠ QUALITÉ.
 *
 * On ne demande pas « cet agent est-il bon ? » — c'est sans réponse, et un modèle à qui
 * on le demande invente une note. On demande « ce fichier se contredit-il lui-même ? »,
 * qui est une question fermée : deux déclarations de l'artefact, confrontées l'une à
 * l'autre, et vérifiable en cinq secondes par un humain.
 *
 * ── TROIS CONTRAINTES, ET LA DEUXIÈME FAIT TOUT LE TRAVAIL ───────────────────
 *
 *   1. JAMAIS BLOQUANT. Elle ajoute du doute, elle n'en retire jamais. Elle ne peut pas
 *      être ce qui laisse passer quelque chose — sinon le jour où elle se trompe, c'est
 *      elle qui aura validé.
 *   2. ELLE CITE DEUX FRAGMENTS qui se contredisent, jamais un verdict. Pas « cet agent
 *      est incohérent » mais « `purpose` dit *proposer un index*, le spec dit *ne modifie
 *      rien et n'analyse pas* ». Un constat sans ses deux citations est JETÉ ici même —
 *      c'est ce qui empêche le relecteur de tamponner sans lire : on ne tamponne pas deux
 *      extraits qu'on a sous les yeux.
 *   3. À LA DEMANDE. Un bouton, pas un appel automatique. Le relecteur choisit.
 *
 * ── LE VRAI BÉNÉFICE N'EST PAS CELUI QU'ON CROIT ─────────────────────────────
 *
 * `L022` est née exactement de ça : le jour où la fiche a montré `criteria` et
 * `golden_cases` l'un sous l'autre, la contradiction a sauté aux yeux — un cas d'or
 * attendait 47 fichiers touchés quand le contrat en refusait plus de 20. Un humain l'a
 * vue, et c'est devenu une règle DÉTERMINISTE.
 *
 * Le rôle de ce module est donc d'être une usine à règles : il propose des candidats, et
 * chaque motif qui revient devient une `L0xx` qui n'a plus besoin de lui. Il rétrécit
 * avec le temps au lieu de grossir.
 *
 * Module PUR : `moteur` est injecté.
 */

/** Ce qu'un constat doit porter pour être montré. Sans les deux citations, il est jeté. */
export const CHAMPS = ['ou', 'cite_a', 'cite_b', 'pourquoi'];

/**
 * Ce qu'on montre au modèle : les DÉCLARATIONS, confrontables entre elles.
 *
 * Le spec est inclus — c'est la seule fois du produit où il sort du serveur vers un
 * modèle pour être JUGÉ et non exécuté, et c'est nécessaire : la moitié des
 * contradictions l'impliquent. Rien n'en ressort : seuls des extraits cités reviennent.
 */
export function consigne(artefact) {
  const l = (t, v) => (v ? `${t} :\n${v}\n` : '');
  const gc = (artefact.golden_cases || []).map((g) =>
    `  - ${g.id} : attend ${JSON.stringify(g.expect || {})}${g.expects_violation ? ' (test du chemin d\'échec, assumé)' : ''}`
  ).join('\n');

  return `Tu relis un artefact d'un registre gouverné, pour aider un humain à le valider.

Tu ne juges PAS sa qualité. Tu cherches UNE SEULE chose : est-ce que ce fichier se
CONTREDIT LUI-MÊME ? Deux déclarations qui ne peuvent pas être vraies en même temps.

${l('TITRE', artefact.title)}${l('À QUOI ÇA SERT', artefact.intent?.purpose)}${l('QUAND NE PAS L\'UTILISER', artefact.intent?.not_for)}${l('ÉTIQUETTES', (artefact.tags || []).join(', '))}
CONSIGNE ENVOYÉE AU MODÈLE :
${artefact.spec || '(vide)'}

ENTRÉES DÉCLARÉES :
${(artefact.variables || []).map((v) => `  - ${v.name} (${v.source})${v.description ? ` — ${v.description}` : ''}`).join('\n') || '  (aucune)'}

OUTILS :
${(artefact.tools || []).map((t) => `  - ${t.id} (${t.mode}, ${t.executor})`).join('\n') || '  (aucun)'}

CE QUI SERA VÉRIFIÉ À CHAQUE EXÉCUTION :
${(artefact.criteria || []).map((c) => `  - ${c.target} ${c.op} ${JSON.stringify(c.value)}`).join('\n') || '  (aucun)'}

CAS DE TEST :
${gc || '  (aucun)'}

CHERCHE, DANS CET ORDRE :
1. le titre ou l'intention promettent quelque chose que la consigne ne fait pas
2. la consigne fait quelque chose que « quand ne pas l'utiliser » interdit
3. les critères ne vérifient rien de ce que l'intention promet
4. un cas de test porte sur autre chose que ce à quoi l'agent sert
5. une entrée déclarée n'est jamais utilisée pour ce que sa description annonce
6. un outil déclaré ne correspond à rien de ce que la consigne demande

RENDS UNIQUEMENT du JSON, ce format exactement :

{"constats":[{"ou":"purpose vs spec","cite_a":"<extrait EXACT du premier>","cite_b":"<extrait EXACT du second>","pourquoi":"<une phrase : pourquoi les deux ne tiennent pas ensemble>"}]}

RÈGLES ABSOLUES :
- \`cite_a\` et \`cite_b\` sont des extraits COPIÉS du fichier ci-dessus, mot pour mot,
  courts (moins de 140 caractères). Sans les deux, ne rends pas le constat.
- si tu ne trouves aucune contradiction, rends {"constats":[]}. C'est une bonne réponse.
- N'INVENTE PAS de contradiction pour avoir quelque chose à dire. Un artefact cohérent est
  le cas normal.
- ne commente ni le style, ni la longueur, ni ce qui manque : uniquement ce qui se
  contredit. Ce qui manque est déjà l'affaire des 25 règles.`;
}

/** Le JSON, sorti de la réponse du modèle. */
export function extraireJson(texte) {
  const nu = String(texte || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(nu); } catch { /* on retente sur le premier objet */ }
  const m = /\{[\s\S]*\}/.exec(nu);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Le tri des constats — c'est ici que la contrainte devient mécanique.
 *
 * Un constat sans ses deux citations est JETÉ, pas affiché « incomplet ». Et une citation
 * qui n'existe pas dans le fichier est jetée aussi : c'est le signe d'une contradiction
 * inventée, et c'est exactement ce qu'on ne veut pas montrer à quelqu'un qui s'apprête à
 * valider.
 */
export function retenir(constats, artefact) {
  const texte = normaliser([
    artefact?.title, artefact?.intent?.purpose, artefact?.intent?.not_for, artefact?.spec,
    (artefact?.variables || []).map((v) => `${v.name} ${v.description || ''}`).join(' '),
    (artefact?.tools || []).map((t) => t.id).join(' '),
    (artefact?.criteria || []).map((c) => `${c.target} ${c.op} ${JSON.stringify(c.value)}`).join(' '),
    (artefact?.golden_cases || []).map((g) => `${g.id} ${JSON.stringify(g.expect || {})}`).join(' ')
  ].join(' \n '));

  const gardes = [];
  const jetes = [];

  for (const c of Array.isArray(constats) ? constats : []) {
    const propre = { ou: str(c?.ou), cite_a: str(c?.cite_a), cite_b: str(c?.cite_b),
                     pourquoi: str(c?.pourquoi) };

    if (!propre.cite_a || !propre.cite_b || !propre.pourquoi) {
      jetes.push({ ...propre, raison: 'sans ses deux citations' });
      continue;
    }
    if (propre.cite_a.length > 300 || propre.cite_b.length > 300) {
      jetes.push({ ...propre, raison: 'citation trop longue pour être vérifiée d\'un coup d\'œil' });
      continue;
    }
    if (!texte.includes(normaliser(propre.cite_a)) || !texte.includes(normaliser(propre.cite_b))) {
      jetes.push({ ...propre, raison: 'citation absente du fichier' });
      continue;
    }
    gardes.push(propre);
  }

  return { constats: gardes, jetes };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/*
 * La comparaison ignore les espaces et la casse. Un modèle recopie fidèlement le fond et
 * réindente : refuser sur un retour à la ligne jetterait des constats justes.
 */
const normaliser = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Relit un artefact et rend les contradictions retenues.
 *
 * @returns {{constats, jetes, aucune, jetons, modele}}
 */
export async function relire(artefact, { moteur, tier = 'mid' } = {}) {
  const reponse = await moteur.generer({ prompt: consigne(artefact), tier, temperature: 0 });
  const brut = extraireJson(reponse.texte);

  if (!brut) {
    return { constats: [], jetes: [], aucune: false, illisible: true,
             jetons: reponse.jetons || null, modele: reponse.modele || '' };
  }

  const { constats, jetes } = retenir(brut.constats, artefact);
  return {
    constats, jetes,
    // « Aucune contradiction » est une BONNE réponse, et il faut pouvoir la distinguer de
    // « le modèle n'a rien renvoyé de lisible ». Confondre les deux ferait passer une
    // panne pour un feu vert.
    aucune: constats.length === 0 && jetes.length === 0,
    illisible: false,
    jetons: reponse.jetons || null,
    modele: reponse.modele || ''
  };
}

export default { consigne, extraireJson, retenir, relire, CHAMPS };
