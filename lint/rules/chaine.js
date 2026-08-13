/*
 * L024 · L025 — les chaînes, ou composer sans rouvrir la porte.
 *
 * `kind: chain` figure au schéma depuis le premier jour : « séquence gouvernée d'autres
 * artefacts ». Ces deux règles sont ce qui rend le mot « gouvernée » vrai.
 *
 * ── CE QU'ELLES PROTÈGENT ────────────────────────────────────────────────────
 *
 * Une chaîne n'écrit aucun prompt. Elle ordonne des briques qui ont chacune franchi la
 * porte, et elle hérite de leur validation — c'est ce qui permettra de composer sans
 * repasser par la file à chaque essai. Cette hérédité ne tient que si deux choses sont
 * vraies, et elles ne sont pas évidentes :
 *
 *   L024 — chaque étape désigne un artefact qui EXISTE VRAIMENT au registre. Une étape
 *          qui pointe dans le vide ne rend pas la chaîne « incomplète » : elle rend
 *          l'héritage MENSONGER, puisqu'on hériterait de la validation de rien.
 *
 *   L025 — le câblage est résoluble AU MOMENT où l'étape se joue. C'est la faute que la
 *          composition provoque toute seule : on réordonne deux étapes, le câblage était
 *          bon, et la référence pointe maintenant vers une sortie qui n'existe pas encore.
 *
 * ── LE SILENCE PLUTÔT QUE LE FAUX VERDICT ────────────────────────────────────
 *
 * Les deux règles ont besoin des AUTRES artefacts pour trancher. Sans `ctx.artifacts`,
 * elles se taisent — comme L001 sans validateur, comme L023 sans la banque. Mieux vaut
 * une règle absente qu'une règle qui invente son référentiel : au lint de fichier seul,
 * on ne peut pas savoir si `expliquer-un-code` existe.
 */
import { finding, ERROR, WARN, indexBy } from '../core.js';
import { renvoisImpossibles, entreesManquantes, entreesInconnues } from '../../lib/chaine.js';

/**
 * L024 — Une chaîne enchaîne des artefacts qui existent. 🔴
 *
 * Couvre aussi le sens inverse : `steps` sur un artefact qui n'est pas une chaîne. Le
 * schéma l'accepterait — c'est une propriété connue — et il ne serait jamais joué :
 * `runtime/chaine.js` ne déroule que les `kind: chain`. Des étapes écrites, visibles en
 * revue, et mortes.
 */
export function L024(artifact, ctx) {
  const out = [];
  const etapes = artifact?.steps || [];
  const chaine = artifact?.kind === 'chain';

  if (!chaine) {
    if (etapes.length > 0) {
      out.push(finding(
        'L024', ERROR,
        `\`steps\` sur un artefact de type \`${artifact?.kind || '—'}\` : seules les chaînes ` +
        '(`kind: chain`) sont déroulées. Ces étapes ne seraient jamais jouées.',
        'steps'
      ));
    }
    return out;
  }

  if (etapes.length === 0) {
    return [finding(
      'L024', ERROR,
      'Chaîne sans étape : une chaîne est une SÉQUENCE. Sans `steps`, elle ne compose ' +
      'rien et son `spec` décrit un assemblage vide.',
      'steps'
    )];
  }

  // Deux étapes du même nom : `{{e1.sortie}}` désignerait deux choses, et le dérouleur
  // en choisirait une sans le dire.
  const vus = new Set();
  etapes.forEach((e, i) => {
    if (vus.has(e.id)) {
      out.push(finding('L024', ERROR,
        `Deux étapes portent l'identifiant \`${e.id}\` : un renvoi \`{{${e.id}.sortie}}\` ` +
        'deviendrait ambigu.', `steps[${i}].id`));
    }
    vus.add(e.id);
  });

  // Sans le registre, on ne peut pas dire si `expliquer-un-code` existe : on se tait.
  const connus = indexBy(ctx?.artifacts, 'id');
  if (connus.size === 0) return out;

  etapes.forEach((e, i) => {
    if (e.artefact === artifact.id) {
      out.push(finding('L024', ERROR,
        'Une chaîne ne peut pas se jouer elle-même : la boucle serait infinie.',
        `steps[${i}].artefact`));
      return;
    }
    const cible = connus.get(e.artefact);
    if (!cible) {
      out.push(finding('L024', ERROR,
        `L'étape \`${e.id}\` désigne \`${e.artefact}\`, qui n'existe pas au registre. ` +
        'Une chaîne hérite de la validation de ses briques — elle ne peut pas hériter de rien.',
        `steps[${i}].artefact`));
      return;
    }
    if (cible.kind === 'chain') {
      out.push(finding('L024', WARN,
        `L'étape \`${e.id}\` joue une autre chaîne (\`${e.artefact}\`). C'est permis, mais ` +
        'une chaîne de chaînes devient vite illisible en revue et son coût imprévisible.',
        `steps[${i}].artefact`));
    }
  });

  return out;
}

/**
 * L025 — Le câblage d'une chaîne est résoluble. 🔴 / 🟡
 *
 * Trois choses, et la première est la seule qui casse à l'exécution sans prévenir :
 *   🔴 un renvoi impossible — variable non déclarée, étape citée avant d'être jouée
 *   🔴 une variable requise de l'artefact que rien ne remplit : le prompt partirait troué
 *   🟡 une entrée câblée qui n'existe pas sur l'artefact : elle ne sert à rien, et elle
 *      signale presque toujours qu'on a câblé la mauvaise étape
 */
export function L025(artifact, ctx) {
  if (artifact?.kind !== 'chain') return [];
  const etapes = artifact?.steps || [];
  const connus = indexBy(ctx?.artifacts, 'id');
  const out = [];

  etapes.forEach((e, i) => {
    for (const p of renvoisImpossibles(artifact, i)) {
      out.push(finding('L025', ERROR,
        `Étape \`${e.id}\`, entrée \`${p.cible}\` : \`${p.renvoi}\` est irrésoluble — ${p.raison}.`,
        `steps[${i}].entrees.${p.cible}`));
    }

    const cible = connus.get(e.artefact);
    if (!cible) return;                       // L024 l'a déjà dit ; on ne le répète pas

    for (const nom of entreesManquantes(e, cible)) {
      out.push(finding('L025', ERROR,
        `Étape \`${e.id}\` : \`${cible.id}\` exige la variable \`${nom}\`, qu'aucun câblage ` +
        'ne remplit. Le prompt partirait avec un trou.',
        `steps[${i}].entrees`));
    }

    for (const nom of entreesInconnues(e, cible)) {
      out.push(finding('L025', WARN,
        `Étape \`${e.id}\` : \`${nom}\` est câblée mais \`${cible.id}\` ne déclare aucune ` +
        'variable de ce nom. Elle sera ignorée — as-tu câblé la bonne étape ?',
        `steps[${i}].entrees.${nom}`));
    }
  });

  return out;
}
