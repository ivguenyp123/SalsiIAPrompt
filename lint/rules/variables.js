/*
 * L002 · L003 — cohérence entre le spec et les variables déclarées.
 */
import { finding, ERROR, WARN, interpolations } from '../core.js';

/**
 * L002 — Toute {{variable}} du spec est déclarée. 🔴
 * Une variable non déclarée n'a pas de source : la plateforme ne saurait pas quoi
 * injecter à l'exécution, et l'utilisateur verrait un {{trou}} partir vers le modèle.
 */
export function L002(artifact) {
  const used = interpolations(artifact?.spec);
  const declared = new Set((artifact?.variables || []).map((v) => v.name));

  return used
    .filter((name) => !declared.has(name))
    .map((name) =>
      finding(
        'L002', ERROR,
        `La variable {{${name}}} est utilisée dans le spec mais n'est pas déclarée. ` +
        'Ajouter une entrée dans `variables` avec sa source (user, signal ou repo).',
        'spec'
      )
    );
}

/**
 * L003 — Toute variable déclarée est utilisée. 🟡
 * Non bloquant : une variable morte est du bruit, pas un risque.
 */
export function L003(artifact) {
  const used = new Set(interpolations(artifact?.spec));

  return (artifact?.variables || [])
    .filter((v) => !used.has(v.name))
    .map((v, i) =>
      finding(
        'L003', WARN,
        `La variable \`${v.name}\` est déclarée mais n'apparaît jamais dans le spec.`,
        `variables[${i}].name`
      )
    );
}

/**
 * L021 — Un spec qui déclare des entrées doit en utiliser au moins une. 🔴
 *
 * Règle de COHÉRENCE STRUCTURELLE, pas de jugement : un artefact qui déclare recevoir
 * le dépôt et la stack, puis n'interpole rien, ne peut pas faire le travail qu'il
 * annonce. Le spec et les variables décrivent alors deux choses différentes.
 *
 * C'est la seule prise déterministe sérieuse sur le prompt vide de sens : « prout prout
 * prout » passe la longueur, le schéma et les critères, mais n'utilise aucune de ses
 * entrées. Le sens, lui, reste hors de portée du lint — c'est le banc d'essai qui
 * tranche, en jouant les cas d'or.
 *
 * L003 signale la même incohérence variable par variable, mais en avertissement : une
 * variable morte est du bruit. Zéro variable vivante, c'est un artefact cassé.
 */
export function L021(artifact) {
  const declared = artifact?.variables || [];
  if (declared.length === 0) return [];

  const used = new Set(interpolations(artifact?.spec));
  if (declared.some((v) => used.has(v.name))) return [];

  return [
    finding(
      'L021', ERROR,
      `Le spec déclare ${declared.length} variable(s) (${declared.map((v) => v.name).join(', ')}) ` +
      'et n\'en interpole aucune : il ne peut pas faire ce qu\'il annonce. ' +
      'Utiliser {{' + declared[0].name + '}} dans le spec, ou retirer la déclaration.',
      'spec'
    )
  ];
}

/**
 * L027 — Une entrée porte un nom du vocabulaire, ou personne ne saura la remplir. 🟡
 *
 * ── LE DÉFAUT QUE CETTE RÈGLE ATTRAPE ────────────────────────────────────────
 *
 * Le rédacteur IA invente librement ses noms de variables. Sur un besoin d'analyse de
 * bus factor, il a produit `{{repo_metadata}}` et `{{contribution_data}}` — deux noms
 * qui n'existent nulle part. L'agent était conforme, lançable, et inutilisable : la
 * plateforme sait CALCULER la répartition des contributions, mais elle se branche sur le
 * NOM `repartition_contributions`. Sous un autre nom, elle ne reconnaît rien et redemande
 * une saisie à la main.
 *
 * Le vocabulaire n'est pas une coquetterie de nommage : c'est ce qui relie une entrée
 * déclarée à la matière que la plateforme sait aller chercher.
 *
 * ── POURQUOI UN AVERTISSEMENT ET NON UN REFUS ────────────────────────────────
 *
 * Un besoin neuf peut réclamer une entrée que le référentiel ne connaît pas encore, et
 * refuser bloquerait le premier agent d'un domaine nouveau. Mais l'avertissement remonte
 * dans la boucle de correction du rédacteur : il se corrige tout seul, sans qu'on ait
 * jamais à refuser quoi que ce soit.
 *
 * Silencieuse sans référentiel — comme L023 sans la banque. Une règle qui inventerait son
 * vocabulaire vaudrait moins que pas de règle.
 */
export function L027(artifact, ctx = {}) {
  const connues = ctx.entreesConnues;
  if (!Array.isArray(connues) || connues.length === 0) return [];

  const vocabulaire = new Set(connues);
  return (artifact?.variables || [])
    .filter((v) => v?.name && !vocabulaire.has(v.name))
    .map((v) => {
      const proche = plusProche(v.name, connues);
      return finding(
        'L027', WARN,
        `L'entrée \`${v.name}\` n'est pas au vocabulaire des entrées. `
        + (proche
          ? `\`${proche}\` lui ressemble — et la plateforme sait la remplir toute seule.`
          : 'Sous un nom inconnu, la plateforme ne peut pas aller la chercher : '
            + 'elle sera demandée à la main à chaque lancement.'),
        `variables.${v.name}`
      );
    });
}

/**
 * Le nom connu le plus proche, ou rien.
 *
 * On compare les MOTS et non les lettres : `contribution_data` et
 * `repartition_contributions` ne se ressemblent pas caractère par caractère, mais ils
 * partagent « contribution ». C'est ce genre de parenté qu'un auteur reconnaît d'un
 * coup d'œil, et une distance d'édition la manquerait.
 */
function plusProche(nom, connues) {
  const mots = (s) => new Set(String(s).toLowerCase().split(/[_-]+/).filter((m) => m.length > 3));
  const cible = mots(nom);
  if (cible.size === 0) return '';

  let meilleur = '';
  let score = 0;
  for (const c of connues) {
    const communs = [...mots(c)].filter((m) => cible.has(m)
      || [...cible].some((x) => x.startsWith(m) || m.startsWith(x))).length;
    if (communs > score) { score = communs; meilleur = c; }
  }
  return score > 0 ? meilleur : '';
}
