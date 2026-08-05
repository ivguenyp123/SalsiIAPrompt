/*
 * Lecteur YAML — sous-ensemble suffisant pour les artefacts et les registres.
 * Aucune dépendance : le socle tourne sans `npm install`, et s'embarque tel quel
 * dans le Studio sans bundler.
 *
 * SUPPORTÉ
 *   commentaires (# en début de ligne ou précédé d'un espace, hors chaînes)
 *   dictionnaires imbriqués par indentation ; listes `- ` ; listes de dictionnaires
 *   flow : { a: 1, b: deux }  et  [ 1, 2, trois ]
 *   scalaires bloc : |  |-  |+  >  >-  >+
 *   chaînes 'simples' et "doubles" (avec échappements \n \t \" \\ dans les doubles)
 *   true/false, null/~, entiers, flottants — le reste est une chaîne
 *   un `---` d'ouverture
 *
 * REFUSÉ EXPLICITEMENT, avec le numéro de ligne
 *   ancres &x / alias *x, clés de fusion <<, tags !, documents multiples, clés ?
 *
 * Le refus est délibéré : mieux vaut une erreur nette sur une construction non gérée
 * qu'une lecture silencieusement fausse d'un artefact de gouvernance.
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `ligne ${line} : ${message}` : message);
    this.name = 'YamlError';
    this.line = line;
  }
}

/** Retire un commentaire de fin de ligne sans toucher aux # à l'intérieur des chaînes. */
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === '"' && c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

const UNSUPPORTED = [
  [/^\s*<<\s*:/, 'clé de fusion `<<` non gérée'],
  [/^\s*\?\s/, 'clé complexe `?` non gérée'],
  [/(^|\s)&[A-Za-z0-9_-]+(\s|$)/, 'ancre `&` non gérée'],
  [/(^|\s)\*[A-Za-z0-9_-]+\s*$/, 'alias `*` non géré'],
  [/(^|\s)!!?[A-Za-z0-9_/-]+/, 'tag `!` non géré']
];

/** Découpe le texte en lignes structurantes, en mémorisant l'indice d'origine. */
function scan(text) {
  const raw = text.split('\n');
  const entries = [];

  raw.forEach((line, i) => {
    const noComment = stripComment(line);
    if (noComment.trim() === '') return;                       // vide ou commentaire seul
    if (/^---\s*$/.test(noComment.trim())) {
      if (entries.length > 0) throw new YamlError('documents multiples non gérés', i + 1);
      return;
    }
    if (/^\.\.\.\s*$/.test(noComment.trim())) return;

    for (const [re, msg] of UNSUPPORTED) {
      if (re.test(noComment)) throw new YamlError(msg, i + 1);
    }

    entries.push({ indent: line.length - line.trimStart().length, content: noComment.trim(), line: i + 1, at: i });
  });

  return { raw, entries };
}

/** Position du `:` séparateur d'une paire clé/valeur, hors chaînes et hors flow. */
function colonAt(s) {
  let quote = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === '"' && c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ':' && depth === 0 && (i + 1 === s.length || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
}

function unquote(s, line) {
  const q = s[0];
  const body = s.slice(1, -1);
  if (q === "'") return body.replace(/''/g, "'");            // seul échappement du simple
  return body.replace(/\\(["\\/nrt])/g, (_, c) =>
    ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
}

/** Scalaire simple : booléen, null, nombre, chaîne quotée, sinon chaîne brute. */
function scalar(s, line) {
  const v = s.trim();
  if (v === '') return null;
  if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) {
    if (v.length < 2) throw new YamlError('chaîne non fermée', line);
    return unquote(v, line);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^[+-]?\d+$/.test(v)) return Number(v);
  // Le point décimal est facultatif devant un exposant : `1e3` vaut 1000, comme en YAML 1.1.
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Analyse `{...}` / `[...]`. Renvoie [valeur, indexAprès]. */
function flow(s, i, line) {
  const open = s[i];
  const close = open === '{' ? '}' : ']';
  const isMap = open === '{';
  const out = isMap ? {} : [];
  i++;

  for (;;) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) throw new YamlError(`\`${open}\` non fermé`, line);
    if (s[i] === close) return [out, i + 1];

    // Lit un élément brut jusqu'à la virgule ou la fermeture de ce niveau.
    let start = i, quote = null, depth = 0, colon = -1;
    for (; i < s.length; i++) {
      const c = s[i];
      if (quote === '"' && c === '\\') { i++; continue; }
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
      else if (c === ':' && depth === 0 && colon === -1 && /[\s]/.test(s[i + 1] ?? ' ')) colon = i;
    }

    const chunk = s.slice(start, i).trim();
    if (isMap) {
      if (colon === -1) throw new YamlError(`\`${chunk}\` : paire clé/valeur attendue dans un dictionnaire flow`, line);
      const key = String(scalar(s.slice(start, colon), line));
      const rest = s.slice(colon + 1, i).trim();
      out[key] = rest[0] === '{' || rest[0] === '[' ? flow(rest, 0, line)[0] : scalar(rest, line);
    } else {
      out.push(chunk[0] === '{' || chunk[0] === '[' ? flow(chunk, 0, line)[0] : scalar(chunk, line));
    }
  }
}

/** Scalaire bloc `|` / `>` avec indicateur de chomp. Lit les lignes BRUTES. */
function blockScalar(header, raw, at, parentIndent, line) {
  const folded = header[0] === '>';
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';

  const body = [];
  let i = at + 1;
  let blockIndent = null;

  for (; i < raw.length; i++) {
    const l = raw[i];
    if (l.trim() === '') { body.push(''); continue; }
    const ind = l.length - l.trimStart().length;
    if (ind <= parentIndent) break;
    if (blockIndent === null) blockIndent = ind;
    if (ind < blockIndent) break;
    body.push(l.slice(blockIndent));
  }

  while (body.length && body.at(-1) === '') body.pop();       // les vides finales se gèrent au chomp

  let text;
  if (folded) {
    // Repli : les lignes contiguës se joignent par une espace, une ligne vide fait un saut.
    const out = [];
    for (const l of body) {
      if (l === '') out.push('\n');
      else if (out.length && out.at(-1) !== '\n') out[out.length - 1] += ` ${l}`;
      else out.push(l);
    }
    text = out.join('').replace(/\n(?!$)/g, '\n');
  } else {
    text = body.join('\n');
  }

  if (chomp === 'clip') text += '\n';
  else if (chomp === 'keep') text += '\n';
  return [text, i];
}

/**
 * Analyse un bloc (dictionnaire ou liste) à un niveau d'indentation donné.
 * @returns [valeur, positionSuivanteDansEntries]
 */
function block(state, pos, indent) {
  const { entries } = state;
  if (pos >= entries.length) return [null, pos];

  return entries[pos].content.startsWith('-') && /^-(\s|$)/.test(entries[pos].content)
    ? sequence(state, pos, indent)
    : mapping(state, pos, indent);
}

function mapping(state, pos, indent) {
  const { entries, raw } = state;
  const out = {};

  while (pos < entries.length) {
    const e = entries[pos];
    if (e.indent < indent) break;
    if (e.indent > indent) throw new YamlError('indentation inattendue', e.line);
    if (/^-(\s|$)/.test(e.content)) break;

    const c = colonAt(e.content);
    if (c === -1) throw new YamlError(`\`${e.content}\` : paire clé/valeur attendue`, e.line);

    const key = String(scalar(e.content.slice(0, c), e.line));
    const rest = e.content.slice(c + 1).trim();
    pos++;

    if (/^[|>][+-]?$/.test(rest)) {
      const [text, nextRaw] = blockScalar(rest, raw, e.at, e.indent, e.line);
      out[key] = text;
      while (pos < entries.length && entries[pos].at < nextRaw) pos++;   // saute les lignes consommées
      continue;
    }
    if (rest === '') {
      // Valeur sur les lignes suivantes, plus indentées — sinon clé nulle.
      if (pos < entries.length && entries[pos].indent > indent) {
        [out[key], pos] = block(state, pos, entries[pos].indent);
      } else out[key] = null;
      continue;
    }
    out[key] = rest[0] === '{' || rest[0] === '[' ? flow(rest, 0, e.line)[0] : scalar(rest, e.line);
  }

  return [out, pos];
}

function sequence(state, pos, indent) {
  const { entries } = state;
  const out = [];

  while (pos < entries.length) {
    const e = entries[pos];
    if (e.indent < indent) break;
    if (e.indent > indent) throw new YamlError('indentation inattendue dans une liste', e.line);
    if (!/^-(\s|$)/.test(e.content)) break;

    const rest = e.content.slice(1).trim();
    // Colonne réelle du contenu après le tiret : c'est l'indentation du dictionnaire
    // que porte l'élément, quand il en porte un.
    const off = e.indent + (e.content.length - e.content.slice(1).trimStart().length);
    pos++;

    if (rest === '') {
      if (pos < entries.length && entries[pos].indent > indent) {
        let value; [value, pos] = block(state, pos, entries[pos].indent);
        out.push(value);
      } else out.push(null);
      continue;
    }
    if (rest[0] === '{' || rest[0] === '[') { out.push(flow(rest, 0, e.line)[0]); continue; }

    if (colonAt(rest) !== -1) {
      // Élément-dictionnaire (`- id: x` puis les clés suivantes alignées sur `id`).
      // On réécrit la ligne du tiret comme sa première clé, à la colonne du contenu,
      // et on laisse `mapping` consommer la suite normalement.
      entries[pos - 1] = { indent: off, content: rest, line: e.line, at: e.at };
      let value; [value, pos] = mapping(state, pos - 1, off);
      out.push(value);
      continue;
    }

    out.push(scalar(rest, e.line));
  }

  return [out, pos];
}

/** Lit un document YAML. Lève YamlError, avec le numéro de ligne, sur toute construction non gérée. */
export function parse(text) {
  const state = scan(String(text));
  if (state.entries.length === 0) return null;
  const [value] = block(state, 0, state.entries[0].indent);
  return value;
}

/** Alias de compatibilité : même nom que js-yaml, pour un remplacement transparent. */
export const load = parse;

export default { parse, load, YamlError };
