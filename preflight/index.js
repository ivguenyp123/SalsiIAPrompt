/*
 * Le pré-vol — moment 4.
 *
 * ── CE QUI LE DISTINGUE DU LINT ──────────────────────────────────────────────
 *
 * Tout ce qui précède juge l'artefact SEUL : sa forme, ses outils, ses critères. Le
 * pré-vol est le premier moment où le DÉCLARÉ RENCONTRE LE RÉEL — un dépôt précis, un
 * utilisateur précis, des valeurs précises, à un instant précis.
 *
 * D'où la règle de partage, qui n'est pas une convention mais un test : un contrôle
 * appartient au pré-vol si et seulement s'il a besoin du contexte d'exécution. Sinon il
 * appartient au lint, où il coûte moins cher et prévient plus tôt. Un contrôle placé du
 * mauvais côté est soit impossible (le lint ne connaît pas le dépôt cible), soit tardif
 * (le pré-vol arrive après que l'auteur a fini d'écrire).
 *
 * Zéro IA, comme la porte. Le verdict est déterministe, reproductible et explicable —
 * et il tombe AVANT le premier jeton dépensé, pas après.
 *
 * Module PUR : ni forge, ni DOM, ni horloge implicite (`now` est passé). Testable.
 */
import { lint, ERROR, WARN } from '../lint/index.js';

/** Échelle de sensibilité, ordonnée. Comparer des rangs, pas des chaînes. */
export const SENSIBILITES = ['public', 'interne', 'confidentiel', 'secret'];
const rang = (s) => SENSIBILITES.indexOf(s);

/*
 * Faute de plafond déclaré, on retient `interne`.
 *
 * C'est le choix structurant du pré-vol : le silence n'est PAS une permission. Traiter
 * l'absence comme un blanc-seing ferait de l'oubli le chemin le plus permissif — un
 * auteur pressé accéderait au confidentiel en ne remplissant rien, et la déclaration
 * deviendrait une formalité pour les consciencieux.
 */
const PLAFOND_PAR_DEFAUT = 'interne';

/** Les niveaux, du moins au plus exigeant. */
const NIVEAUX = ['experimental', 'team', 'officiel'];

/** Un constat de pré-vol. Même forme qu'un constat de lint : un seul rendu possible. */
const constat = (code, severity, message, quoi = '') => ({ code, severity, message, path: quoi });

/* ── P001 ─────────────────────────────────────────────────────────────────── */
/**
 * L'artefact franchit-il ENCORE la porte ? 🔴
 *
 * Les règles évoluent ; un artefact validé il y a six mois peut ne plus être conforme
 * aujourd'hui. Sans ce contrôle, le registre garantirait la conformité au moment de la
 * publication et plus jamais ensuite — ce qui, sur un parc qui vieillit, ne garantit
 * rien du tout.
 */
function P001(artifact, ctx) {
  const rapport = lint(artifact, ctx.registres || {});
  if (!rapport.blocked) return [];

  const codes = rapport.findings.filter((f) => f.severity === ERROR).map((f) => f.code);
  return [constat('P001', ERROR,
    `L'artefact ne franchit plus la porte : ${[...new Set(codes)].join(', ')}. ` +
    'Les règles ont évolué depuis sa publication — il doit être corrigé avant de servir.',
    'artefact')];
}

/* ── P002 ─────────────────────────────────────────────────────────────────── */
/**
 * La sensibilité du dépôt cible dépasse-t-elle le plafond déclaré ? 🔴
 *
 * LE contrôle qui ne peut exister qu'ici : le lint ne sait pas sur quel dépôt on va
 * tourner. C'est aussi celui qui porte le risque — un agent autorisé sur de l'interne
 * qui lit un dépôt confidentiel, c'est une fuite, pas une erreur de conformité.
 */
function P002(artifact, ctx) {
  const declare = artifact?.classification?.max_repo_sensitivity;
  const plafond = declare || PLAFOND_PAR_DEFAUT;
  const reelle = ctx.depot?.sensibilite;

  const out = [];

  if (!reelle) {
    return [constat('P002', ERROR,
      'Sensibilité du dépôt cible inconnue : impossible de vérifier le plafond. ' +
      'Une exécution sur un dépôt non classé se refuse — c\'est la classification qui manque, pas l\'artefact.',
      'depot.sensibilite')];
  }

  if (!declare) {
    out.push(constat('P002', WARN,
      `Aucun plafond de sensibilité déclaré : \`${PLAFOND_PAR_DEFAUT}\` est retenu. ` +
      'Le silence n\'ouvre pas de droit — pour aller au-delà, il faut le déclarer et passer la revue sécurité.',
      'classification.max_repo_sensitivity'));
  }

  if (rang(reelle) > rang(plafond)) {
    out.push(constat('P002', ERROR,
      `Dépôt classé \`${reelle}\`, plafond de l'artefact \`${plafond}\`` +
      `${declare ? '' : ' (par défaut)'}. L'exécution est refusée.`,
      'classification.max_repo_sensitivity'));
  }

  return out;
}

/* ── P003 ─────────────────────────────────────────────────────────────────── */
/**
 * Les variables requises sont-elles toutes résolues ? 🔴
 *
 * Refuser ici ne coûte rien. Laisser passer coûte un appel au modèle, et rend une sortie
 * construite sur `{{repo}}` non remplacé — donc une réponse qui a l'air d'une réponse.
 */
function P003(artifact, ctx) {
  const valeurs = ctx.valeurs || {};
  return (artifact?.variables || [])
    .filter((v) => v.required !== false)
    .filter((v) => {
      const val = valeurs[v.name];
      return val === undefined || val === null || String(val).trim() === '';
    })
    .map((v) => constat('P003', ERROR,
      `Variable requise \`${v.name}\` non résolue (source déclarée : \`${v.source}\`). ` +
      'Le prompt partirait avec un trou.',
      `variables.${v.name}`));
}

/* ── P004 ─────────────────────────────────────────────────────────────────── */
/**
 * Les outils sont-ils autorisés pour le périmètre du DÉPÔT CIBLE ? 🔴
 *
 * À ne pas confondre avec L006, qui vérifie le périmètre déclaré de l'owner. Ici c'est
 * le périmètre du dépôt qu'on s'apprête à toucher. Un agent appartenant à Plateforme,
 * lancé sur un dépôt de Data, ne doit pas emporter ses outils Plateforme avec lui : le
 * droit suit la cible, pas le porteur.
 */
function P004(artifact, ctx) {
  const scope = ctx.depot?.scope;
  if (!scope) return [];                    // périmètre inconnu : P002 a déjà refusé le flou

  const registre = new Map((ctx.registres?.tools || []).map((t) => [t.id, t]));

  return (artifact?.tools || [])
    .map((t) => ({ t, ref: registre.get(t.id) }))
    .filter(({ ref }) => ref && !(ref.scopes || []).includes('*') && !(ref.scopes || []).includes(scope))
    .map(({ t, ref }) => constat('P004', ERROR,
      `Outil \`${t.id}\` interdit sur un dépôt du périmètre \`${scope}\` ` +
      `(autorisé pour : ${(ref.scopes || []).join(', ') || 'aucun'}).`,
      `tools.${t.id}`));
}

/* ── P005 ─────────────────────────────────────────────────────────────────── */
/**
 * La certification est-elle présente et valide pour le modèle courant ? 🔴 (contextuelle)
 *
 * Un agent se périme : le modèle bouge sous le prompt. C'est le vrai point d'application
 * de L016, qui ne peut rien vérifier au lint de fichier seul. Sans état dérivé joignable,
 * la règle s'abstient plutôt que de rendre un faux verdict.
 */
function P005(artifact, ctx) {
  if (!ctx.derive) return [];

  const cert = ctx.derive[artifact?.id]?.certification;
  if (!cert) {
    return [constat('P005', ERROR,
      'Aucune certification enregistrée : l\'artefact n\'a jamais passé le banc d\'essai.', 'certification')];
  }

  const maintenant = ctx.now instanceof Date ? ctx.now : new Date();
  const fin = new Date(cert.expires_on);
  if (!Number.isNaN(fin.getTime()) && fin < maintenant) {
    return [constat('P005', ERROR,
      `Certification périmée le ${cert.expires_on} (modèle ${cert.model_version}). Recertification requise.`,
      'certification')];
  }

  if (ctx.modele && cert.model_version && ctx.modele !== cert.model_version) {
    return [constat('P005', WARN,
      `Certifié sur \`${cert.model_version}\`, exécution demandée sur \`${ctx.modele}\`. ` +
      'Les cas d\'or n\'ont pas été rejoués sur ce modèle.', 'certification')];
  }
  return [];
}

/* ── P006 ─────────────────────────────────────────────────────────────────── */
/**
 * Le niveau atteint suffit-il au contexte d'exécution ? 🔴
 *
 * Un artefact `expérimental` n'a pas sa place en production. Le niveau ATTEINT est
 * dérivé — il se mérite sur preuve. Faute d'état dérivé, on retombe sur le niveau VISÉ,
 * et on le dit : sinon on prendrait une intention pour un acquis.
 */
function P006(artifact, ctx) {
  if (ctx.criticite !== 'production') return [];

  const derive = ctx.derive?.[artifact?.id]?.level;
  const niveau = derive || artifact?.target_level || 'experimental';

  if (NIVEAUX.indexOf(niveau) >= NIVEAUX.indexOf('team')) {
    return derive ? [] : [constat('P006', WARN,
      `Niveau \`${niveau}\` retenu d'après le niveau VISÉ, faute d'état dérivé joignable. ` +
      'Le niveau atteint se mérite sur preuve : sans banc d\'essai, c\'est une intention.',
      'target_level')];
  }

  return [constat('P006', ERROR,
    `Niveau \`${niveau}\` insuffisant pour un contexte de production (\`team\` au minimum).`,
    'target_level')];
}

/* ── P007 ─────────────────────────────────────────────────────────────────── */
/**
 * L'artefact écrit-il ? Alors l'exécution ne peut pas être autonome. 🟡
 *
 * Ce n'est pas un refus, c'est une PORTE : le pré-vol rend la confirmation humaine
 * mécaniquement obligatoire au lieu de la laisser à la discipline de l'appelant. C'est
 * « l'humain valide » transformé en contrainte du système.
 */
function P007(artifact) {
  const ecritures = (artifact?.tools || []).filter((t) => t.mode === 'write');
  if (ecritures.length === 0) return [];

  return [constat('P007', WARN,
    `${ecritures.length} outil(s) d'écriture (${ecritures.map((t) => t.id).join(', ')}) : ` +
    'l\'exécution exige une confirmation humaine après aperçu. Aucun lancement autonome.',
    'tools')];
}

/* ── Le pré-vol ───────────────────────────────────────────────────────────── */

const CONTROLES = [
  { code: 'P001', fn: P001, titre: 'L\'artefact franchit encore la porte' },
  { code: 'P002', fn: P002, titre: 'Sensibilité du dépôt sous le plafond déclaré' },
  { code: 'P003', fn: P003, titre: 'Variables requises résolues' },
  { code: 'P004', fn: P004, titre: 'Outils autorisés pour le périmètre du dépôt cible' },
  { code: 'P005', fn: P005, titre: 'Certification présente et valide' },
  { code: 'P006', fn: P006, titre: 'Niveau suffisant pour la criticité' },
  { code: 'P007', fn: P007, titre: 'Écriture : confirmation humaine requise' }
];

/**
 * Décide si une exécution peut partir, et à quelles conditions.
 *
 * @param {object} artifact  l'artefact du registre
 * @param {object} ctx       le contexte D'EXÉCUTION :
 *   { depot: { path, scope, sensibilite }, valeurs: {}, criticite: 'test'|'production',
 *     modele, derive, now, registres: { tools, targets, validateArtifact } }
 * @returns {{constats, bloque, erreurs, avertissements, confirmationRequise}}
 */
export function prevol(artifact, ctx = {}) {
  const constats = [];

  for (const controle of CONTROLES) {
    try {
      constats.push(...(controle.fn(artifact, ctx) || []));
    } catch (err) {
      // Un contrôle qui casse ne doit jamais laisser partir une exécution : même
      // principe que le lint, le doute bloque.
      constats.push(constat(controle.code, ERROR,
        `Le contrôle ${controle.code} a échoué : ${err.message}`, ''));
    }
  }

  const erreurs = constats.filter((c) => c.severity === ERROR).length;

  return {
    constats,
    bloque: erreurs > 0,
    erreurs,
    avertissements: constats.length - erreurs,
    // Distinct de `bloque` : ce n'est pas un refus, c'est une condition de départ.
    confirmationRequise: constats.some((c) => c.code === 'P007')
  };
}

export default { prevol, CONTROLES, SENSIBILITES };
