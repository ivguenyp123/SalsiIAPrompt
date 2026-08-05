/*
 * Évaluateur JSON Schema — sous-ensemble utilisé par les schémas du registre.
 * Aucune dépendance : le socle tourne sans `npm install` et s'embarque dans le Studio.
 *
 * Ce n'est PAS une validation réécrite à côté du schéma : le fichier
 * `schema/artifact.schema.json` reste la source unique de la forme de l'artefact,
 * ce module se contente de l'évaluer. Un test de conformité croisée le compare à ajv
 * quand celui-ci est installé (test/conformance.test.js).
 *
 * MOTS-CLÉS GÉRÉS
 *   type · enum · const · required · properties · additionalProperties
 *   items · minItems · maxItems · uniqueItems
 *   minLength · maxLength · pattern
 *   minimum · maximum · exclusiveMinimum · exclusiveMaximum
 *   minProperties · maxProperties · propertyNames
 *   allOf · anyOf · oneOf · not
 *
 * Un mot-clé inconnu et contraignant lève : mieux vaut refuser d'évaluer qu'accepter
 * un artefact sur la foi d'une contrainte silencieusement ignorée.
 */

const ANNOTATIONS = new Set([
  '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated'
]);

const HANDLED = new Set([
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minProperties', 'maxProperties', 'propertyNames',
  'allOf', 'anyOf', 'oneOf', 'not'
]);

/** Type JSON, avec l'entier distingué du flottant comme le veut la spécification. */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // string | boolean | object
}

function typeMatches(expected, actual) {
  const list = Array.isArray(expected) ? expected : [expected];
  // Un entier satisfait `number`, l'inverse est faux.
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

const join = (path, key) => (path ? `${path}.${key}` : String(key));

/** Vérifie qu'un schéma n'emploie que des mots-clés que nous savons évaluer. */
function assertSupported(schema, where = '') {
  for (const key of Object.keys(schema)) {
    if (ANNOTATIONS.has(key) || HANDLED.has(key)) continue;
    throw new Error(`Mot-clé JSON Schema non géré : \`${key}\`${where ? ` (en ${where})` : ''}. ` +
      'Refuser d\'évaluer plutôt qu\'ignorer silencieusement une contrainte.');
  }
}

function check(schema, data, path, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { errors.push({ path, message: 'Schéma : aucune valeur n\'est admise ici' }); return; }
  assertSupported(schema, path);

  const t = typeOf(data);

  if (schema.type !== undefined && !typeMatches(schema.type, t)) {
    const want = Array.isArray(schema.type) ? schema.type.join(' ou ') : schema.type;
    errors.push({ path, message: `Schéma : type \`${want}\` attendu, \`${t}\` reçu` });
    return; // les contraintes suivantes supposent le bon type
  }

  if (schema.enum !== undefined && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(data))) {
    errors.push({ path, message: `Schéma : valeur hors liste — attendu ${schema.enum.map((v) => `\`${v}\``).join(', ')}` });
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(data)) {
    errors.push({ path, message: `Schéma : valeur \`${schema.const}\` attendue` });
  }

  if (t === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({ path, message: `Schéma : au moins ${schema.minLength} caractères (${data.length} fourni·s)` });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({ path, message: `Schéma : au plus ${schema.maxLength} caractères (${data.length} fourni·s)` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      errors.push({ path, message: `Schéma : ne respecte pas le motif \`${schema.pattern}\`` });
    }
  }

  if (t === 'integer' || t === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push({ path, message: `Schéma : minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && data > schema.maximum) errors.push({ path, message: `Schéma : maximum ${schema.maximum}` });
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) errors.push({ path, message: `Schéma : strictement supérieur à ${schema.exclusiveMinimum}` });
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) errors.push({ path, message: `Schéma : strictement inférieur à ${schema.exclusiveMaximum}` });
  }

  if (t === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push({ path, message: `Schéma : au moins ${schema.minItems} élément·s` });
    if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push({ path, message: `Schéma : au plus ${schema.maxItems} élément·s` });
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of data) {
        const k = JSON.stringify(item);
        if (seen.has(k)) { errors.push({ path, message: 'Schéma : éléments en double' }); break; }
        seen.add(k);
      }
    }
    if (schema.items !== undefined) data.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
  }

  if (t === 'object') {
    const keys = Object.keys(data);

    for (const req of schema.required || []) {
      if (!(req in data)) errors.push({ path, message: `Schéma : propriété obligatoire manquante (\`${req}\`)` });
    }
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push({ path, message: `Schéma : au moins ${schema.minProperties} propriété·s` });
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      errors.push({ path, message: `Schéma : au plus ${schema.maxProperties} propriété·s` });
    }
    if (schema.propertyNames !== undefined) {
      for (const k of keys) check(schema.propertyNames, k, join(path, k), errors);
    }

    const declared = schema.properties || {};
    for (const [k, v] of Object.entries(data)) {
      if (k in declared) check(declared[k], v, join(path, k), errors);
      else if (schema.additionalProperties === false) {
        errors.push({ path, message: `Schéma : propriété non autorisée (\`${k}\`)` });
      } else if (typeof schema.additionalProperties === 'object') {
        check(schema.additionalProperties, v, join(path, k), errors);
      }
    }
  }

  for (const sub of schema.allOf || []) check(sub, data, path, errors);

  if (schema.anyOf && !schema.anyOf.some((sub) => valid(sub, data))) {
    errors.push({ path, message: 'Schéma : ne satisfait aucune des formes admises' });
  }
  if (schema.oneOf) {
    const n = schema.oneOf.filter((sub) => valid(sub, data)).length;
    if (n !== 1) errors.push({ path, message: `Schéma : doit satisfaire exactement une forme admise (${n} satisfaite·s)` });
  }
  if (schema.not !== undefined && valid(schema.not, data)) {
    errors.push({ path, message: 'Schéma : forme explicitement interdite' });
  }
}

function valid(schema, data) {
  const errors = [];
  check(schema, data, '', errors);
  return errors.length === 0;
}

/**
 * Fabrique un validateur, même signature que le câblage ajv.
 * @returns {(data:any) => {valid:boolean, errors:Array<{path:string,message:string}>}}
 */
export function makeValidator(schema) {
  return (data) => {
    const errors = [];
    check(schema, data, '', errors);
    return { valid: errors.length === 0, errors };
  };
}

export default { makeValidator };
