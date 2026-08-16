/*
 * L008 · L009 · L017 · L022 · L023 — le contrat de runtime et les cas d'or.
 *
 * Rappel de la distinction, souvent confondue :
 *   criteria     → contrat de RUNTIME, évalué au moment 5 sur chaque exécution en
 *                  production. Déclaratif par nécessité : la plateforme l'applique
 *                  et le relecteur l'inspecte. D'où le registre des cibles.
 *   golden_cases → TESTS de développement, joués au banc d'essai.
 */
import { finding, ERROR, WARN, indexBy, jsonType } from '../core.js';
import { references, naturesRequises, nature } from '../../lib/entrees.js';

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

/*
 * L023 — Un cas d'or joue sur une entrée qui existe. 🔴 / 🟡
 *
 * Née du même constat que L017 : depuis que le Studio sait saisir des cas d'or, il est
 * facile d'en produire cinq qui comptent pour L010 sans rien prouver. L017 a fermé la
 * porte du cas creux — sans attente, sans seuil. L023 ferme celle du cas qui asserte
 * correctement… sur une entrée qui n'a jamais existé.
 *
 * `diff_fixture: feat-add-endpoint` était écrit à la main dans commit-message.yaml bien
 * avant la banque. Personne ne pouvait dire si ce fichier existait : la convention était
 * une intention, pas un lien. Elle devient vérifiable.
 *
 * DEUX SÉVÉRITÉS, ET LA DIFFÉRENCE COMPTE :
 *   🔴 le cas DÉSIGNE une entrée absente — le banc d'essai ne pourra pas le jouer,
 *      c'est un test cassé, pas un test exigeant.
 *   🟡 le cas ne désigne RIEN alors que l'artefact consomme un signal dont la banque a
 *      la matière — il jouera sur du vide en croyant tester quelque chose.
 *
 * La règle se tait entièrement sans `ctx.entrees`, comme L001 sans validateur : mieux
 * vaut une règle absente qu'une règle qui invente son référentiel.
 */
export function L023(artifact, ctx) {
  const banque = ctx?.entrees;
  if (!banque) return [];

  const out = [];
  const requises = naturesRequises(artifact?.variables);

  (artifact?.golden_cases || []).forEach((g, i) => {
    const vues = new Set();

    for (const r of references(g.context, banque)) {
      vues.add(r.nature);

      if (!r.natureConnue) {
        out.push(finding(
          'L023', ERROR,
          `Cas d'or \`${g.id}\` : \`${r.cle}\` désigne une nature d'entrée inconnue — ` +
          `la banque n'a rien de nature \`${r.nature}\`. Natures disponibles : ` +
          `${(banque.natures || []).map((n) => n.nature).join(', ') || 'aucune'}.`,
          `golden_cases[${i}].context.${r.cle}`
        ));
        continue;
      }

      if (!r.entree) {
        const dispo = (nature(banque, r.nature).entrees || []).map((e) => e.id);
        out.push(finding(
          'L023', ERROR,
          `Cas d'or \`${g.id}\` : l'entrée \`${r.id}\` n'existe pas à la banque. ` +
          `Le banc d'essai n'aura rien à lui donner à lire. Entrées de nature ` +
          `\`${r.nature}\` : ${dispo.join(', ') || 'aucune'}.`,
          `golden_cases[${i}].context.${r.cle}`
        ));
      }
    }

    // L'inverse : une matière disponible que le cas n'utilise pas.
    for (const nom of requises) {
      if (vues.has(nom)) continue;
      const bloc = nature(banque, nom);
      if (!bloc) continue;                    // rien à proposer : le silence est honnête
      out.push(finding(
        'L023', WARN,
        `Cas d'or \`${g.id}\` : l'artefact consomme \`${nom}\` (source \`signal\`) mais le ` +
        `cas ne désigne aucune entrée. Il jouera sur du vide alors que la banque en ` +
        `propose ${bloc.entrees.length} — ajoute \`${nom}_fixture\` au contexte.`,
        `golden_cases[${i}].context`
      ));
    }
  });

  return out;
}

/**
 * L026 — Un contrat ne doit pas exiger deux formes incompatibles. 🔴
 *
 * ── D'OÙ VIENT CETTE RÈGLE ───────────────────────────────────────────────────
 *
 * D'un agent réel, écrit par le modèle sur demande, validé par un humain, et qui ne
 * pouvait PAS passer : il exigeait `output.is_valid_json eq true` ET quatre
 * `output.sections contains …`.
 *
 * Or `output.sections` extrait des titres MARKDOWN. Sur du JSON elle rend toujours une
 * liste vide. Le contrat échouait donc quoi que le modèle réponde — et rien, ni à la
 * porte ni à la relecture, ne pouvait le dire : chaque critère était valide isolément,
 * c'est leur RENCONTRE qui était impossible.
 *
 * C'est exactement le motif que le relecteur IA sert à repérer, transformé en code : la
 * contradiction a été vue une fois, elle ne sera plus jamais vue.
 *
 * ── CE QU'ELLE NE FAIT PAS ───────────────────────────────────────────────────
 *
 * Elle ne juge pas si un contrat est BON. Elle refuse deux exigences dont on sait, par
 * construction des résolveurs, qu'aucune sortie ne peut les satisfaire ensemble.
 */
const INCOMPATIBLES = [
  {
    quand: (c) => c.target === 'output.is_valid_json' && c.op === 'eq' && c.value === true,
    avec: (c) => c.target === 'output.sections',
    dire: 'Une sortie JSON n\'a pas de titres Markdown : `output.sections` y rendra toujours '
        + 'une liste vide, et le contrat échouera quelle que soit la réponse. '
        + 'Pour exiger des clés JSON, utiliser `output.json_keys`.'
  },
  {
    quand: (c) => c.target === 'output.is_valid_json' && c.op === 'eq' && c.value === true,
    avec: (c) => c.target === 'output.matches_convention',
    dire: 'Un message de commit conventionnel n\'est pas du JSON : les deux exigences '
        + 'ne peuvent pas être vraies en même temps.'
  }
];

export function L026(artifact) {
  const crit = artifact?.criteria;
  if (!Array.isArray(crit)) return [];
  const out = [];

  for (const regle of INCOMPATIBLES) {
    if (!crit.some(regle.quand)) continue;
    crit.forEach((c, i) => {
      if (!regle.avec(c)) return;
      out.push(finding('L026', ERROR,
        `Contrat impossible : \`${c.target}\` avec \`output.is_valid_json\`. ${regle.dire}`,
        `criteria[${i}].target`));
    });
  }
  return out;
}
