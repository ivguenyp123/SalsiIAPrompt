/*
 * Sérialisation d'un artefact en YAML, pour l'aperçu du Studio.
 *
 * L'auteur doit voir le fichier qui sera soumis en merge request : c'est lui qui sera
 * relu, versionné et audité, pas le formulaire. Le formulaire est une commodité de
 * saisie ; l'artefact est la vérité.
 *
 * Un test d'aller-retour (dump → parse) garantit que ce que la page affiche est bien
 * ce que le linter a évalué.
 */

/** Une chaîne peut-elle s'écrire telle quelle, sans guillemets ? */
function isPlainSafe(s) {
  if (s === '') return false;
  if (/^[\s]|[\s]$/.test(s)) return false;                       // espaces aux bords
  if (/[:#\-?&*!|>'"%@`{}\[\],]/.test(s[0])) return false;       // premier caractère réservé
  if (/:\s|\s#/.test(s)) return false;                           // séparateurs ambigus
  if (/^(true|false|null|~|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/.test(s)) return false; // sinon retypé
  return true;
}

function scalar(v, indent) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);

  const s = String(v);
  if (s.includes('\n')) {
    // Scalaire bloc : la seule forme lisible pour un prompt de plusieurs lignes.
    // L'indicateur de chomp est choisi pour que la relecture rende EXACTEMENT la même
    // chaîne — sans quoi l'aperçu montrerait autre chose que ce que le linter a évalué.
    //   se termine par un \n          -> `|`  (clip en remet un)
    //   se termine sans \n            -> `|-` (strip n'en met aucun)
    //   se termine par plusieurs \n   -> non représentable proprement, on quote
    if (/\n\n$/.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    const chomp = s.endsWith('\n') ? '|' : '|-';
    const pad = ' '.repeat(indent + 2);
    const body = s.replace(/\n$/, '').split('\n').map((l) => (l ? pad + l : '')).join('\n');
    return `${chomp}\n${body}`;
  }
  if (isPlainSafe(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isPrimitive(v) {
  return v === null || v === undefined || typeof v !== 'object';
}

function dumpValue(v, indent) {
  if (isPrimitive(v)) return scalar(v, indent);

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const pad = ' '.repeat(indent);
    return '\n' + v.map((item) => {
      if (isPrimitive(item)) return `${pad}- ${scalar(item, indent)}`;
      // Élément-dictionnaire : la première clé suit le tiret, les autres s'alignent.
      const body = dumpMap(item, indent + 2).replace(/^\s{2}/, '');
      return `${pad}- ${body.trimStart()}`;
    }).join('\n');
  }

  if (Object.keys(v).length === 0) return '{}';
  return '\n' + dumpMap(v, indent);
}

function dumpMap(obj, indent) {
  const pad = ' '.repeat(indent);
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const rendered = dumpValue(v, indent + 2);
      return rendered.startsWith('\n') ? `${pad}${k}:${rendered}` : `${pad}${k}: ${rendered}`;
    })
    .join('\n');
}

/** Rend un artefact en YAML. Le résultat se relit à l'identique avec lib/yaml.js. */
export function toYaml(obj) {
  if (obj === null || obj === undefined) return '';
  if (isPrimitive(obj)) return `${scalar(obj, 0)}\n`;
  if (Array.isArray(obj)) return `${dumpValue(obj, 0).replace(/^\n/, '')}\n`;
  return `${dumpMap(obj, 0)}\n`;
}

export default { toYaml };
