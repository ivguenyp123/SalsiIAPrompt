/*
 * Les chaînes — composer avec des briques déjà validées.
 *
 * ── CE QUE LE SCHÉMA PROMETTAIT DEPUIS LE PREMIER JOUR ───────────────────────
 *
 *   kind: "agent" | "prompt" | "chain"
 *   chain : séquence gouvernée d'autres artefacts (vague 4).
 *
 * Trois mots au schéma, et rien derrière. Comme `criteria` avant les résolveurs, comme
 * `golden_cases` avant le banc d'essai : le registre décrivait une capacité que personne
 * n'avait construite.
 *
 * ── POURQUOI COMPOSER PLUTÔT QUE RÉÉCRIRE ────────────────────────────────────
 *
 * « Je veux un agent qui mixe le rapport DORA et le rapport journalier. » On pourrait
 * faire écrire un gros prompt de plus par un modèle. Il serait non testé, non mesuré, et
 * il dupliquerait deux capacités qui existent déjà — le jour où l'une est corrigée, la
 * copie reste fausse.
 *
 * Une chaîne ne contient AUCUN prompt. Elle ordonne des artefacts qui ont chacun franchi
 * la porte, avec leur intention, leurs outils autorisés, leur contrat de sortie et leurs
 * cas d'or. Corriger une brique corrige toutes les chaînes qui l'utilisent.
 *
 * D'où une propriété de gouvernance qui n'est pas un détail : **une chaîne hérite de la
 * validation de ses briques**. Ce qui reste à juger tient dans l'ordre et le câblage —
 * infiniment moins risqué qu'un texte neuf, et c'est ce qui permettra de composer sans
 * repasser par la file de validation à chaque essai.
 *
 * ── LE « MANAGER » EST DU CODE, PAS UN AGENT ─────────────────────────────────
 *
 * La mode est à l'orchestrateur : un LLM décide de l'étape suivante. Ici, non. La séquence
 * est DÉCLARÉE, un module la déroule, et entre deux étapes le contrat de celle qui vient
 * de finir est évalué par `runtime/resolveurs.js`, sans jugement. Une étape qui viole son
 * propre contrat ARRÊTE la chaîne.
 *
 * C'est la phrase du dépôt, appliquée à l'orchestration : le déterministe décide et
 * bloque, le LLM conseille, l'humain tranche. Un orchestrateur LLM inverserait les trois
 * d'un coup — et personne ne saurait dire, après coup, pourquoi la chaîne a pris ce
 * chemin-là.
 *
 * Module PUR : ni réseau, ni DOM, ni système de fichiers.
 */

import { RENVOI_ATELIER, lire as lireCase } from './atelier.js';

/** Un renvoi dans le câblage : `{{code}}` ou `{{e1.sortie}}`. */
export const RENVOI = /\{\{\s*([a-z][a-z0-9_]*)(?:\.(sortie))?\s*\}\}/g;

/** Les renvois d'une expression, décomposés. */
export function renvois(expression) {
  return [...String(expression ?? '').matchAll(RENVOI)]
    .map((m) => ({ nom: m[1], etape: Boolean(m[2]), brut: m[0] }));
}

/* ── La résolution ────────────────────────────────────────────────────────── */

/**
 * Les entrées d'une étape, câblage résolu.
 *
 * Une expression mélange texte et renvois — un pont entre deux étapes vaut souvent mieux
 * qu'un passe-plat :
 *
 *   entrees: { contexte: "Chiffres DORA :\n{{e1.sortie}}\n\nJournée :\n{{e2.sortie}}" }
 *
 * Un renvoi non résolu RESTE visible, comme dans `rendre()` : le contrôle qui suit doit
 * pouvoir le voir et refuser, plutôt que de recevoir un trou déguisé en chaîne vide.
 */
export function resoudreEntrees(etape, variables = {}, sorties = {}, atelier = null) {
  const out = {};
  for (const [cible, expression] of Object.entries(etape?.entrees || {})) {
    /*
     * L'ATELIER D'ABORD, et le `{{atelier.x}}` ne peut pas se confondre avec le reste :
     * `RENVOI` exige `}}` juste après le nom ou après `.sortie`, donc il ne mord pas sur
     * `{{atelier.notes}}`. Les deux syntaxes cohabitent sans se marcher dessus, et une
     * étape nommée `atelier` est refusée au lint (L028) pour que ça reste vrai.
     *
     * Sans atelier ouvert, le renvoi RESTE VISIBLE — comme un renvoi d'étape non résolu.
     * Le remplacer par du vide ferait partir un prompt troué qui a l'air complet.
     */
    let texte = String(expression ?? '');
    if (atelier) texte = texte.replace(RENVOI_ATELIER, (tout, cle) => lireCase(atelier, cle));

    out[cible] = texte.replace(RENVOI, (tout, nom, sortie) => {
      const valeur = sortie ? sorties[nom] : variables[nom];
      return valeur === undefined || valeur === null ? tout : String(valeur);
    });
  }
  return out;
}

/* ── Ce qu'une chaîne exige ───────────────────────────────────────────────── */

/**
 * Les renvois d'une étape qui ne peuvent PAS être satisfaits.
 *
 * Trois fautes, et la troisième est celle qu'un écran de composition provoque tout seul :
 *   — une variable de chaîne non déclarée
 *   — une étape qui se lit elle-même
 *   — une étape citée AVANT d'avoir été jouée
 *
 * La dernière arrive dès qu'on réordonne : le câblage était bon, l'ordre a changé, et la
 * référence pointe maintenant vers l'avenir. Le contrôle porte donc sur la POSITION, pas
 * seulement sur l'existence — sans quoi une chaîne réordonnée passerait le lint et
 * s'arrêterait à l'exécution, bien plus tard et sans dire pourquoi.
 */
export function renvoisImpossibles(artefact, index) {
  const etapes = artefact?.steps || [];
  const etape = etapes[index];
  if (!etape) return [];

  const declarees = new Set((artefact?.variables || []).map((v) => v.name));
  const avant = new Set(etapes.slice(0, index).map((e) => e.id));
  const toutes = new Set(etapes.map((e) => e.id));
  const out = [];

  for (const [cible, expression] of Object.entries(etape.entrees || {})) {
    for (const r of renvois(expression)) {
      if (!r.etape) {
        if (!declarees.has(r.nom)) {
          out.push({ cible, renvoi: r.brut, raison: `la chaîne ne déclare pas de variable \`${r.nom}\`` });
        }
        continue;
      }
      if (r.nom === etape.id) {
        out.push({ cible, renvoi: r.brut, raison: 'une étape ne peut pas se lire elle-même' });
      } else if (!toutes.has(r.nom)) {
        out.push({ cible, renvoi: r.brut, raison: `aucune étape \`${r.nom}\` dans cette chaîne` });
      } else if (!avant.has(r.nom)) {
        out.push({ cible, renvoi: r.brut,
                   raison: `l'étape \`${r.nom}\` vient APRÈS : sa sortie n'existe pas encore` });
      }
    }
  }
  return out;
}

/**
 * Les variables d'une étape qu'aucun câblage ne remplit.
 *
 * L'artefact référencé déclare ce dont il a besoin ; l'étape dit d'où ça vient. Ce qui
 * manque partirait en trou dans le prompt — le pré-vol le refuserait à l'exécution, mais
 * sans savoir dire quelle étape de quelle chaîne.
 */
export function entreesManquantes(etape, artefactCible) {
  const cablees = new Set(Object.keys(etape?.entrees || {}));
  return (artefactCible?.variables || [])
    .filter((v) => v.required !== false && !cablees.has(v.name))
    .map((v) => v.name);
}

/** Les variables câblées qui n'existent pas sur l'artefact de l'étape. */
export function entreesInconnues(etape, artefactCible) {
  const connues = new Set((artefactCible?.variables || []).map((v) => v.name));
  return Object.keys(etape?.entrees || {}).filter((n) => !connues.has(n));
}

/* ── La narration ─────────────────────────────────────────────────────────── */

/**
 * La chaîne, dite en français.
 *
 * Le `spec` d'une chaîne n'est envoyé à aucun modèle — chaque étape envoie le sien. C'est
 * une SPÉCIFICATION au sens propre : ce que l'assemblage fait, lisible par l'humain qui
 * valide. La composer ici plutôt que de la laisser à l'auteur garantit qu'elle décrit la
 * chaîne RÉELLE : réordonner deux étapes la réécrit, elle ne peut pas mentir.
 *
 * Elle cite les variables entre accolades, et c'est vrai au sens le plus littéral : la
 * chaîne consomme bien ces entrées-là. `L002` et `L021` sont donc satisfaites par
 * construction, pas par ruse.
 */
export function narrer(artefact, parId = new Map()) {
  const etapes = artefact?.steps || [];
  const variables = (artefact?.variables || []).map((v) => `{{${v.name}}}`).join(', ');

  const lignes = etapes.map((e, i) => {
    const cible = parId.get(e.artefact);
    const quoi = e.titre || cible?.intent?.purpose || '';
    const depuis = Object.entries(e.entrees || {})
      .map(([k, v]) => `${k} ← ${String(v).replace(/\s+/g, ' ').trim()}`).join(' · ');
    return `${i + 1}. ${cible?.title || e.artefact}`
         + (quoi ? `\n   ${quoi}` : '')
         + (depuis ? `\n   ${depuis}` : '');
  });

  return [
    `Cette chaîne enchaîne ${etapes.length} artefact(s) du registre, dans cet ordre.`,
    variables ? `Elle consomme : ${variables}.` : '',
    '',
    ...lignes,
    '',
    'Chaque étape est jouée par la plateforme, et son contrat est évalué avant de passer',
    'à la suivante : une étape qui viole son contrat arrête la chaîne. Ce texte décrit la',
    'séquence — il n\'est envoyé à aucun modèle.'
  ].join('\n');
}

/* ── Composer ─────────────────────────────────────────────────────────────── */

/** Le prochain identifiant d'étape libre. L'écran n'a pas à les inventer. */
export function prochainId(etapes = []) {
  const pris = new Set(etapes.map((e) => e.id));
  for (let n = 1; n <= 999; n++) if (!pris.has(`e${n}`)) return `e${n}`;
  return `e${etapes.length + 1}`;
}

/**
 * Une étape toute prête pour un artefact, câblage PRÉ-REMPLI.
 *
 * Chaque variable requise est branchée sur la sortie de l'étape précédente si elle attend
 * de la matière (`source: signal` consomme du texte produit), sinon sur une variable de
 * chaîne du même nom. C'est ce qui rend la composition utilisable : on dépose, ça marche,
 * on corrige ensuite. Un formulaire vide à chaque ajout ferait abandonner au troisième.
 */
export function etapePour(artefactCible, etapes = []) {
  const precedente = etapes.at(-1);
  const entrees = {};

  for (const v of artefactCible?.variables || []) {
    if (v.required === false) continue;
    entrees[v.name] = (v.source === 'signal' && precedente)
      ? `{{${precedente.id}.sortie}}`
      : `{{${v.name}}}`;
  }

  return { id: prochainId(etapes), artefact: artefactCible?.id, entrees };
}

/**
 * Les variables que la chaîne DOIT déclarer, déduites de son câblage.
 *
 * Dérivé, jamais saisi : l'auteur branche des étapes, la liste des entrées en découle.
 * La lui faire tenir à la main garantirait qu'elle diverge au premier réordonnancement.
 * La `source` est reprise de la variable d'origine — une chaîne qui consomme un diff
 * consomme un `signal`, et l'écran d'exécution lui proposera d'aller le chercher à la
 * forge, exactement comme pour l'artefact seul.
 */
export function variablesDeduites(artefact, parId = new Map()) {
  const vues = new Map();

  for (const e of artefact?.steps || []) {
    const cible = parId.get(e.artefact);
    for (const [nomCible, expression] of Object.entries(e.entrees || {})) {
      for (const r of renvois(expression)) {
        if (r.etape || vues.has(r.nom)) continue;
        const origine = (cible?.variables || []).find((v) => v.name === nomCible);
        vues.set(r.nom, {
          name: r.nom,
          source: origine?.source || 'user',
          required: true,
          description: origine?.description || `Entrée de la chaîne, consommée par l'étape ${e.id}.`
        });
      }
    }
  }
  return [...vues.values()];
}

/**
 * Le contrat d'une chaîne : celui de sa DERNIÈRE étape.
 *
 * Une chaîne rend ce que rend sa dernière étape — c'est sa sortie, et donc son contrat.
 * Inventer des critères propres à la chaîne ferait juger sa sortie deux fois selon deux
 * barèmes ; les omettre ferait échouer L008, qui exige à raison qu'un artefact soit
 * vérifiable. On hérite, ce qui est à la fois vrai et vérifié.
 */
export function criteresHerites(artefact, parId = new Map()) {
  const derniere = (artefact?.steps || []).at(-1);
  const cible = derniere ? parId.get(derniere.artefact) : null;
  return structuredClone(cible?.criteria || []);
}

export default { RENVOI, renvois, resoudreEntrees, renvoisImpossibles, entreesManquantes,
                 entreesInconnues, narrer, prochainId, etapePour, variablesDeduites,
                 criteresHerites };
