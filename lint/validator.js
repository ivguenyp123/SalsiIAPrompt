/*
 * Câblage JSON Schema (L001). Isolé ici pour que index.js et les règles restent
 * sans dépendance et embarquables dans le Studio.
 *
 * Le JSON Schema est la SEULE implémentation de la forme de l'artefact : pas de
 * validation structurelle réécrite à la main à côté, qui dériverait du schéma.
 */
// Point d'entrée 2020-12 : l'export ajv par défaut ne connaît que draft-07 et
// rejetterait le $schema de nos fichiers.
import Ajv from 'ajv/dist/2020.js';

/**
 * @param {object} schema  le JSON Schema de l'artefact
 * @returns {(artifact:object) => {valid:boolean, errors:Array<{path:string,message:string}>}}
 */
export function makeValidator(schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  return (artifact) => {
    const valid = validate(artifact);
    if (valid) return { valid: true, errors: [] };

    return {
      valid: false,
      errors: (validate.errors || []).map((e) => {
        const path = e.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : '';
        // Le nom de la propriété fautive n'est pas dans instancePath pour ces mots-clés.
        const extra =
          e.keyword === 'additionalProperties' ? ` (\`${e.params.additionalProperty}\`)`
          : e.keyword === 'required' ? ` (\`${e.params.missingProperty}\`)`
          : '';
        return { path, message: `Schéma : ${e.message}${extra}` };
      })
    };
  };
}
