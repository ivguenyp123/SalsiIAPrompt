/*
 * L008 · L009 · L017 — le contrat de runtime et les cas d'or.
 *
 * Rappel de la distinction, souvent confondue :
 *   criteria     → contrat de RUNTIME, évalué au moment 5 sur chaque exécution en
 *                  production. Déclaratif par nécessité : la plateforme l'applique
 *                  et le relecteur l'inspecte. D'où le registre des cibles.
 *   golden_cases → TESTS de développement, joués au banc d'essai.
 */
import { finding, ERROR, WARN, indexBy, jsonType } from '../core.js';

/** Seuils de cas d'or par niveau visé (L010, appliqué dans lifecycle.js). */
export const GOLDEN_THRESHOLDS = { experimental: 0, team: 3, officiel: 5 };

/**
 * L008 — `criteria` non vide. 🔴
 * Sans critère, rien n'est vérifiable au post-vol : on retombe sur du jugement.
 */
export function L008(artifact) {
  if (Array.isArray(artifact?.criteria) && artifact.criteria.length > 0) return [];
  return [
    finding(
      'L008', ERROR,
      'Aucun critère : l\'artefact n\'est pas vérifiable au post-vol. Un agent de lecture ' +
      'peut assertir sur la FORME de sa sortie (cibles de classe `form` : patch applicable, ' +
      'JSON valide, sections présentes, absence de secret).',
      'criteria'
    )
  ];
}

/**
 * L009 — Chaque critère est assertable. 🔴
 * Assertable = la cible existe au registre, l'opérateur y est autorisé, et la valeur
 * est du bon type. Sans le registre des cibles, rien ne distingue `pipeline.status`
 * de `foo.bar` et la règle serait un vœu.
 */
export function L009(artifact, ctx) {
  const known = indexBy(ctx.targets, 'target');
  const out = [];

  (artifact?.criteria || []).forEach((c, i) => {
    const ref = known.get(c.target);

    if (!ref) {
      out.push(finding(
        'L009', ERROR,
        `Cible non assertable : \`${c.target}\` n'existe pas au registre des cibles. ` +
        'Un critère que la plateforme ne sait pas résoudre ne peut pas trancher.',
        `criteria[${i}].target`
      ));
      return;
    }

    if (!ref.ops.includes(c.op)) {
      out.push(finding(
        'L009', ERROR,
        `L'opérateur \`${c.op}\` n'est pas autorisé sur \`${c.target}\` ` +
        `(autorisés : ${ref.ops.join(', ')}).`,
        `criteria[${i}].op`
      ));
    }

    const got = jsonType(c.value);
    const expected = c.op === 'exists' ? 'boolean' : ref.type;
    // `matches` compare une représentation textuelle : la valeur est un motif.
    const ok = c.op === 'matches' ? got === 'string' : got === expected;

    if (!ok) {
      out.push(finding(
        'L009', ERROR,
        `Type de valeur incohérent pour \`${c.target}\` : attendu \`${expected}\`, reçu \`${got}\`.`,
        `criteria[${i}].value`
      ));
    }
  });

  return out;
}

/**
 * L017 — Consistance des cas d'or. 🔴 / 🟡
 *
 * Ajout au jeu de règles d'origine. Un LLM n'est pas reproductible : un cas d'or joué
 * une seule fois est un tirage, pas une porte. Sans définition k/n explicite, le banc
 * d'essai rend un verdict différent à chaque passage — exactement le défaut reproché
 * au juge LLM, déplacé d'un cran.
 *
 * La règle couvre aussi le cas d'or CREUX. Depuis que le Studio sait les saisir, un
 * auteur peut en ajouter cinq vides pour atteindre le seuil de L010 : le niveau
 * `officiel` serait alors une formalité de comptage. Compter des cas qui n'assertent
 * rien reviendrait à certifier sur du vide, donc ils sont refusés ici — c'est L017 qui
 * empêche L010 d'être un simple compteur.
 */
export function L017(artifact) {
  const out = [];

  (artifact?.golden_cases || []).forEach((g, i) => {
    const runs = g.runs ?? 3;
    const pass = g.pass_at_least;

    // Une attente vide ne teste rien. Le schéma le refusait déjà, mais en disant
    // « au moins 1 propriété·s » : exact, illisible, et sans la raison.
    if (!g.expect || Object.keys(g.expect).length === 0) {
      out.push(finding(
        'L017', ERROR,
        `Cas d'or \`${g.id}\` sans attente : il s'exécute et ne vérifie rien. ` +
        'Un cas d\'or est un test — il doit assertir au moins une cible.',
        `golden_cases[${i}].expect`
      ));
    }

    // Un contexte vide n'est pas toujours une faute — un cas d'or peut n'avoir aucune
    // entrée — mais dès qu'une variable est déclarée, il joue sur du vide.
    if ((!g.context || Object.keys(g.context).length === 0) && (artifact?.variables || []).length > 0) {
      out.push(finding(
        'L017', WARN,
        `Cas d'or \`${g.id}\` sans contexte alors que l'artefact déclare ` +
        `${artifact.variables.length} variable(s) : le cas jouera sur des entrées vides.`,
        `golden_cases[${i}].context`
      ));
    }

    if (pass === undefined) {
      out.push(finding(
        'L017', WARN,
        `Cas d'or \`${g.id}\` sans \`pass_at_least\` : le seuil de succès sur ${runs} exécutions ` +
        'est implicite. L\'expliciter rend le verdict du banc d\'essai reproductible.',
        `golden_cases[${i}].pass_at_least`
      ));
      return;
    }

    if (pass > runs) {
      out.push(finding(
        'L017', ERROR,
        `Cas d'or \`${g.id}\` : \`pass_at_least\` (${pass}) dépasse \`runs\` (${runs}) — ` +
        'le cas ne peut jamais passer.',
        `golden_cases[${i}].pass_at_least`
      ));
    }
  });

  return out;
}

/*
 * L022 — Un cas d'or dont l'attente viole un critère de l'artefact. 🟡
 *
 * Règle née de l'écran, pas de la spécification. Le jour où la fiche du Catalogue a
 * montré les critères et les cas d'or l'un sous l'autre, la contradiction a sauté aux
 * yeux sur l'artefact de référence :
 *
 *   contrat :  output.files_touched  lte 20
 *   gc-05   :  attend output.files_touched = 47
 *
 * Le cas d'or décrit une exécution que le contrat de l'artefact refuserait. Les deux
 * blocs vivaient dans des écrans séparés, et personne ne les avait confrontés.
 *
 * AVERTISSEMENT, jamais refus : tester le chemin d'échec est légitime et même
 * souhaitable. Ce qui ne l'est pas, c'est qu'on ne sache pas si c'était voulu. La règle
 * ne tranche donc pas à la place de l'auteur — elle l'oblige à déclarer son intention
 * avec `expects_violation`, et se tait dès qu'il l'a fait.
 */

/** Un opérateur de critère, évalué sur une valeur. `null` = opérateur non décidable ici. */
function satisfait(valeur, op, attendu) {
  switch (op) {
    case 'eq': return valeur === attendu;
    case 'neq': return valeur !== attendu;
    case 'lt': return Number(valeur) < Number(attendu);
    case 'lte': return Number(valeur) <= Number(attendu);
    case 'gt': return Number(valeur) > Number(attendu);
    case 'gte': return Number(valeur) >= Number(attendu);
    case 'contains': return String(valeur).includes(String(attendu));
    case 'matches':
      try { return new RegExp(attendu).test(String(valeur)); }
      catch { return null; }                  // motif invalide : L009 s'en occupe, pas nous
    // `exists` porte sur la présence de la cible, pas sur sa valeur : le cas d'or qui
    // fournit une valeur satisfait toujours `exists: true`.
    case 'exists': return attendu === true || attendu === 'true';
    default: return null;
  }
}

export function L022(artifact) {
  const criteres = artifact?.criteria || [];
  if (criteres.length === 0) return [];

  const out = [];

  (artifact?.golden_cases || []).forEach((g, i) => {
    if (g.expects_violation) return;          // intention déclarée : la règle se tait

    for (const [cible, valeur] of Object.entries(g.expect || {})) {
      for (const c of criteres.filter((c) => c.target === cible)) {
        if (satisfait(valeur, c.op, c.value) !== false) continue;

        out.push(finding(
          'L022', WARN,
          `Cas d'or \`${g.id}\` : il attend \`${cible}\` = ${JSON.stringify(valeur)}, ` +
          `que le critère \`${cible} ${c.op} ${JSON.stringify(c.value)}\` refuserait. ` +
          'Si c\'est un test du chemin d\'échec, déclare-le avec `expects_violation: true` ; ' +
          'sinon l\'un des deux chiffres est faux.',
          `golden_cases[${i}].expect.${cible}`
        ));
      }
    }
  });

  return out;
}
