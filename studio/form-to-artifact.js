/*
 * Traduction du formulaire du Studio en artefact du registre.
 *
 * C'est le chaînon qui manquait : le linter travaille sur un artefact structuré, le
 * Studio collecte des champs. Cette fonction est PURE et sans dépendance — donc testée
 * en Node et exécutée dans le navigateur, sans divergence possible.
 *
 * DÉCISION STRUCTURANTE : l'auteur ne choisit PAS `mode` ni `executor`. Il choisit un
 * outil ; le registre dit ce qu'il est. Conséquence directe, un auteur ne PEUT PAS
 * confier une écriture au LLM depuis le Studio : l'invariant L005 n'est plus une règle
 * qu'on lui oppose après coup, c'est une impossibilité de saisie. Le moment 1 bien fait
 * ne signale pas les erreurs, il les empêche.
 */

/** Identifiant stable dérivé du titre — conforme au motif du schéma. */
export function slugify(title) {
  return String(title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** Retire les clés vides : mieux vaut un champ absent qu'un champ nul face au schéma. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Applique un type connu à une saisie. `undefined` = type inconnu, on rend la chaîne. */
function asType(value, type) {
  if (type === 'boolean') return value === true || value === 'true';
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;                // on laisse passer : L009 tranchera
  }
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Convertit la saisie d'un critère en valeur typée, d'après le registre des cibles. */
function coerce(value, target, op, targets) {
  if (op === 'exists') return value === true || value === 'true';
  const ref = (targets || []).find((t) => t.target === target);
  return asType(value, op === 'matches' ? 'string' : ref?.type);
}

/**
 * Type deviné, faute de registre. Réservé au CONTEXTE d'un cas d'or : ses clés sont les
 * variables de l'artefact, qui n'ont pas de type déclaré — on ne peut donc pas faire
 * mieux que lire ce qui est écrit. Un champ vaut `true`, `12` ou du texte.
 */
function devine(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return value;
}

/**
 * Les lignes de saisie d'un cas d'or redeviennent un dictionnaire.
 *
 * Accepte aussi un objet déjà formé : les tests et le code appelant construisent parfois
 * l'artefact directement, sans passer par les champs de l'interface.
 */
function toMap(rows, valueOf) {
  if (rows && !Array.isArray(rows)) return rows;
  const out = {};
  for (const row of rows || []) {
    const key = String(row?.key ?? row?.target ?? '').trim();
    if (!key) continue;
    out[key] = valueOf(key, row.value);
  }
  return out;
}

/** Un entier de saisie, ou `undefined` si le champ est laissé vide. */
function entier(value) {
  if (value === '' || value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;               // non entier : le schéma tranchera
}

/**
 * @param {object} form      les champs du Studio
 * @param {object} [ctx]     { tools, targets } — les registres, pour compléter et typer
 * @returns {object} l'artefact, prêt à passer au linter
 */
export function formToArtifact(form = {}, ctx = {}) {
  const known = new Map((ctx.tools || []).map((t) => [t.id, t]));

  const artifact = {
    id: form.id?.trim() || slugify(form.title),
    kind: form.kind || 'agent',
    title: form.title?.trim(),

    owner: compact({ person: form.ownerPerson?.trim(), scope: form.ownerScope?.trim() }),

    tags: (form.tags || []).map((t) => String(t).trim()).filter(Boolean),
    moment: form.moment?.trim(),

    intent: compact({ purpose: form.purpose?.trim(), not_for: form.notFor?.trim() }),

    spec: form.spec ?? '',

    variables: (form.variables || [])
      .filter((v) => v?.name?.trim())
      .map((v) => compact({
        name: v.name.trim(),
        source: v.source || 'user',
        // Un `required: true` explicite doit survivre : le supprimer parce que c'est
        // la valeur par défaut faisait perdre le champ à chaque réédition.
        required: typeof v.required === 'boolean' ? v.required : undefined,
        description: v.description?.trim()
      })),

    // L'auteur n'apporte que l'identifiant : mode et executor viennent du registre.
    tools: (form.tools || [])
      .filter((t) => t?.id?.trim())
      .map((t) => {
        const ref = known.get(t.id.trim());
        return {
          id: t.id.trim(),
          mode: ref?.mode ?? t.mode ?? 'read',
          executor: ref?.executor ?? t.executor ?? 'llm'
        };
      }),

    criteria: (form.criteria || [])
      .filter((c) => c?.target?.trim())
      .map((c) => ({
        target: c.target.trim(),
        op: c.op || 'eq',
        value: coerce(c.value, c.target.trim(), c.op || 'eq', ctx.targets)
      })),

    /*
     * Cas d'or. `context` et `expect` sont émis MÊME VIDES, contrairement au reste :
     * `compact` les effacerait, et un cas d'or sans attente disparaîtrait au lieu d'être
     * refusé. Or c'est exactement ce qu'il faut refuser — sinon cinq cas creux suffisent
     * à décrocher le niveau `officiel`. L017 les voit parce qu'ils sont encore là.
     */
    golden_cases: (form.goldenCases || [])
      .filter((g) => g?.id?.trim())
      .map((g, i) => {
        const noyau = {
          id: slugify(g.id) || `gc-${String(i + 1).padStart(2, '0')}`,
          context: toMap(g.context, (_k, v) => devine(v)),
          // Les attentes portent sur des cibles du registre : leur type y est déclaré.
          expect: toMap(g.expect, (k, v) => {
            const ref = (ctx.targets || []).find((t) => t.target === k);
            return ref ? asType(v, ref.type) : devine(v);
          })
        };
        return {
          ...noyau,
          ...compact({ runs: entier(g.runs), pass_at_least: entier(g.passAtLeast) }),
          // Émis seulement s'il vaut `true` : un `false` explicite polluerait tous les
          // fichiers pour dire ce que le défaut dit déjà.
          ...(g.expectsViolation ? { expects_violation: true } : {})
        };
      }),

    target_level: form.targetLevel || 'experimental',
    model_tier: form.modelTier || undefined,

    classification: form.maxRepoSensitivity ? { max_repo_sensitivity: form.maxRepoSensitivity } : undefined
  };

  // `spec` et `criteria` sont conservés même vides : L020 et L008 expliquent bien mieux
  // le problème que le « propriété obligatoire manquante » du schéma.
  return { ...compact(artifact), spec: artifact.spec, criteria: artifact.criteria };
}

export default { formToArtifact, slugify };
