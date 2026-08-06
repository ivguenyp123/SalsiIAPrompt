/*
 * Artefact → formulaire. L'inverse exact de form-to-artifact.js.
 *
 * Sans cette fonction, le registre est en écriture unique : on publie, et corriger
 * suppose de tout retaper. Avec elle, une capacité se reprend.
 *
 * LE PIÈGE, et c'est tout l'enjeu : le formulaire ne montre pas tous les champs de
 * l'artefact — ni les étiquettes, ni le moment, ni le palier de modèle, ni la
 * classification, ni les cas d'or. Une traduction naïve les perdrait à la republication,
 * en silence. Un artefact de niveau `officiel` reviendrait sans ses cinq cas d'or et
 * retomberait en `expérimental` sans que personne ne l'ait décidé.
 *
 * Ils sont donc TRANSPORTÉS tels quels dans `carried`, et remis en place à la sortie.
 * Un test d'aller-retour vérifie l'identité sur tous les artefacts du registre : c'est
 * lui qui garantit qu'éditer ne dégrade rien.
 */

/*
 * Ce que le formulaire ne sait pas afficher voyage ici, intact.
 *
 * `golden_cases` en est SORTI le jour où le Studio a su les saisir. Les transporter était
 * une rustine honnête tant qu'aucun champ ne les montrait ; les y laisser une fois les
 * champs écrits aurait figé les cas d'or d'un artefact repris — visibles, éditables en
 * apparence, et remplacés par la version transportée à la republication.
 */
export const CARRIED = ['tags', 'moment', 'model_tier', 'classification'];

/** Un dictionnaire redevient des lignes de saisie. L'ordre du fichier est conservé. */
const toRows = (map, keyName) =>
  Object.entries(map || {}).map(([k, v]) => ({ [keyName]: k, value: String(v) }));

/**
 * @param {object} artifact  un artefact lu dans le dépôt
 * @returns {object} les champs du formulaire, `carried` compris
 */
export function artifactToForm(artifact = {}) {
  const carried = {};
  for (const key of CARRIED) {
    if (artifact[key] !== undefined) carried[key] = artifact[key];
  }

  return {
    id: artifact.id || '',
    kind: artifact.kind || 'agent',
    title: artifact.title || '',

    ownerPerson: artifact.owner?.person || '',
    ownerScope: artifact.owner?.scope || '',

    purpose: artifact.intent?.purpose || '',
    notFor: artifact.intent?.not_for || '',

    spec: artifact.spec ?? '',

    variables: (artifact.variables || []).map((v) => ({ ...v })),

    // Le formulaire ne saisit que l'identifiant : mode et executor viennent du registre.
    tools: (artifact.tools || []).map((t) => ({ id: t.id })),

    // Les valeurs redeviennent du texte : c'est ce que contient un champ de saisie, et
    // formToArtifact les retypera d'après le registre des cibles.
    criteria: (artifact.criteria || []).map((c) => ({
      target: c.target, op: c.op, value: String(c.value)
    })),

    // Cas d'or : les dictionnaires deviennent des lignes, les nombres des chaînes —
    // c'est ce que contient un champ de saisie. formToArtifact les retypera.
    goldenCases: (artifact.golden_cases || []).map((g) => ({
      id: g.id,
      context: toRows(g.context, 'key'),
      expect: toRows(g.expect, 'target'),
      runs: g.runs === undefined ? '' : String(g.runs),
      passAtLeast: g.pass_at_least === undefined ? '' : String(g.pass_at_least),
      expectsViolation: Boolean(g.expects_violation)
    })),

    targetLevel: artifact.target_level || 'experimental',

    carried
  };
}

/** Réinjecte ce que le formulaire ne montrait pas. À appeler après formToArtifact. */
export function restoreCarried(artifact, carried = {}) {
  const out = { ...artifact };
  for (const key of CARRIED) {
    if (carried[key] !== undefined) out[key] = carried[key];
    else delete out[key];
  }
  return out;
}

export default { artifactToForm, restoreCarried, CARRIED };
