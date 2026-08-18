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
 * ── QUAND UN CONTRÔLE REFUSE, ET QUAND IL DEMANDE UN HUMAIN ──────────────────
 *
 * Première version : tout ce qui n'allait pas refusait. Résultat, le pré-vol refusait
 * TOUT — pas parce que les artefacts étaient mauvais, mais parce que la plateforme
 * n'avait pas encore de quoi répondre. Aucun dépôt n'est classé, donc P002 refusait
 * partout. Aucun banc d'essai ne tourne, donc rien n'est certifié et rien ne dépasse
 * `expérimental`, donc P005 et P006 refusaient toute production. Un contrôle qui refuse
 * tout ne protège de rien : on finit par le contourner, et c'est là qu'on perd.
 *
 * La règle qui remplace ça tient en une phrase :
 *
 *     un contrôle REFUSE quand il sait que c'est non ;
 *     il demande une CONFIRMATION HUMAINE quand il ne sait pas.
 *
 * Un dépôt classé `secret` sous un plafond `interne` : c'est non, on refuse. Un dépôt
 * non classé : la plateforme l'ignore, donc elle demande à quelqu'un qui sait. C'est
 * exactement « le noyau gouverne, l'humain valide » — l'ignorance devient une question,
 * pas un mur.
 *
 * Et c'est AUTO-RESSERRANT, ce qui compte plus que le desserrage lui-même : le jour où
 * le référentiel des dépôts existe, P002 se remet à refuser sans qu'on touche au code.
 * Le jour où le banc mesure un niveau, P006 aussi. Rien à se rappeler de durcir — on
 * n'a pas baissé une exigence, on a branché la sévérité sur ce que la plateforme sait.
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

/**
 * Un constat de pré-vol. Même forme qu'un constat de lint : un seul rendu possible.
 *
 * `confirme` marque un avertissement qui EXIGE une confirmation humaine avant le
 * départ. Sans ce drapeau, desserrer un contrôle reviendrait à le supprimer : la
 * question disparaîtrait dans une liste d'avertissements que personne ne lit.
 */
const constat = (code, severity, message, quoi = '', confirme = false) =>
  ({ code, severity, message, path: quoi, confirme });

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
 * La sensibilité du dépôt cible dépasse-t-elle le plafond déclaré ? 🔴 / 🟡
 *
 * LE contrôle qui ne peut exister qu'ici : le lint ne sait pas sur quel dépôt on va
 * tourner. C'est aussi celui qui porte le risque — un agent autorisé sur de l'interne
 * qui lit un dépôt confidentiel, c'est une fuite, pas une erreur de conformité.
 *
 * Dépassement AVÉRÉ : refus, sans discussion. Sensibilité INCONNUE : ce n'est pas le
 * même constat, et le confondre coûtait cher — aucun dépôt n'étant classé aujourd'hui,
 * refuser l'inconnu revenait à tout refuser. On demande donc à un humain de dire ce que
 * la plateforme ignore, et le jour où le référentiel des dépôts répond, ce chemin-là
 * ne s'emprunte plus.
 */
function P002(artifact, ctx) {
  const declare = artifact?.classification?.max_repo_sensitivity;
  const plafond = declare || PLAFOND_PAR_DEFAUT;
  const reelle = ctx.depot?.sensibilite;

  const out = [];

  if (!reelle) {
    return [constat('P002', WARN,
      `Sensibilité du dépôt cible inconnue : le plafond \`${plafond}\`` +
      `${declare ? '' : ' (par défaut)'} ne peut pas être vérifié. ` +
      'C\'est la classification du dépôt qui manque, pas l\'artefact — quelqu\'un qui sait ce que ' +
      'ce dépôt contient doit confirmer avant le départ.',
      'depot.sensibilite', true)];
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
  /*
   * ── « VIDE » N'EST PAS « ABSENT », ET SEULE LA PROVENANCE LE DIT ──────────
   *
   * Défaut trouvé en jouant le banc d'essai pour la PREMIÈRE fois.
   *
   * `expliquer-un-code` porte un cas d'or `gc-05-vide` : un fichier vide, tiré de la
   * banque d'entrées, dont l'origine déclare « fichier vide, volontairement ». Le spec de
   * l'agent porte la règle correspondante — « si le fichier est vide, dis qu'il est vide
   * et arrête-toi ». Trois règles de lint validaient ce cas d'or. Et P003 le refusait à
   * l'exécution : la seule règle qu'on tenait vraiment à certifier était la seule que le
   * banc ne pouvait pas jouer.
   *
   * Deux situations que le CONTENU ne distingue pas :
   *
   *   NON RÉSOLUE   personne n'a rempli le champ. Trou. P003 a raison de refuser.
   *   RÉSOLUE VIDE  une source a répondu, et sa réponse est vide. C'est une VALEUR — et
   *                 la plus intéressante à éprouver, puisque c'est exactement là qu'un
   *                 modèle sans matière se met à en inventer.
   *
   * `ctx.resolues` porte les noms qu'une source a réellement remplis. Sans lui, rien ne
   * change : l'écran, la CLI et l'API ne le fournissent pas, et une chaîne vide y reste
   * un refus. C'est le banc — qui SAIT ce que la banque lui a rendu — qui l'apporte.
   *
   * Même distinction que partout ailleurs ici : `N/A` n'est pas zéro.
   */
  const resolues = new Set(ctx.resolues || []);
  return (artifact?.variables || [])
    .filter((v) => v.required !== false)
    .filter((v) => {
      const val = valeurs[v.name];
      if (val === undefined || val === null) return true;
      return String(val).trim() === '' && !resolues.has(v.name);
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
 * La certification est-elle présente et valide pour le modèle courant ? 🔴 / 🟡 (contextuelle)
 *
 * Un agent se périme : le modèle bouge sous le prompt. C'est le vrai point d'application
 * de L016, qui ne peut rien vérifier au lint de fichier seul. Sans état dérivé joignable,
 * la règle s'abstient plutôt que de rendre un faux verdict.
 *
 * PÉRIMÉE, c'est un fait mesuré : refus. JAMAIS CERTIFIÉ, c'est autre chose — tant
 * qu'aucun banc d'essai ne tourne, AUCUN artefact ne peut l'être, et refuser là-dessus
 * reviendrait à interdire la plateforme au nom d'un outil qui n'existe pas encore. On
 * demande une confirmation humaine, et le refus reviendra tout seul le jour où la
 * certification sera possible : un artefact non certifié le sera alors par choix.
 */
function P005(artifact, ctx) {
  if (!ctx.derive) return [];

  const cert = ctx.derive[artifact?.id]?.certification;
  if (!cert) {
    return [constat('P005', WARN,
      'Aucune certification enregistrée : l\'artefact n\'a jamais passé le banc d\'essai. ' +
      'Ses cas d\'or n\'ont donc jamais été joués — ce qu\'il fait vraiment reste une hypothèse.',
      'certification', true)];
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
      'Les cas d\'or n\'ont pas été rejoués sur ce modèle.', 'certification', true)];
  }
  return [];
}

/* ── P006 ─────────────────────────────────────────────────────────────────── */
/**
 * Le niveau atteint suffit-il au contexte d'exécution ? 🔴 / 🟡
 *
 * Un artefact `expérimental` n'a pas sa place en production. Le niveau ATTEINT est
 * dérivé — il se mérite sur preuve. Faute d'état dérivé, on retombe sur le niveau VISÉ,
 * et on le dit : sinon on prendrait une intention pour un acquis.
 *
 * D'où la sévérité, qui suit d'où vient le niveau et non sa valeur :
 *   niveau DÉRIVÉ et insuffisant  → refus. La mesure a été faite, elle dit non.
 *   niveau seulement DÉCLARÉ      → confirmation humaine. Rien n'a été mesuré ; refuser
 *                                   sur une intention non vérifiée fermerait la
 *                                   production à tout le catalogue, puisque aucun
 *                                   artefact ne peut aujourd'hui dépasser l'expérimental.
 */
function P006(artifact, ctx) {
  if (ctx.criticite !== 'production') return [];

  const derive = ctx.derive?.[artifact?.id]?.level;
  const niveau = derive || artifact?.target_level || 'experimental';

  if (NIVEAUX.indexOf(niveau) >= NIVEAUX.indexOf('team')) {
    // Niveau suffisant, mais annoncé et non mesuré : la plateforme ne sait pas, donc
    // elle demande. Même raison que plus bas, même traitement.
    return derive ? [] : [constat('P006', WARN,
      `Niveau \`${niveau}\` retenu d'après le niveau VISÉ, faute d'état dérivé joignable. ` +
      'Le niveau atteint se mérite sur preuve : sans banc d\'essai, c\'est une intention.',
      'target_level', true)];
  }

  if (derive) {
    return [constat('P006', ERROR,
      `Niveau \`${niveau}\` insuffisant pour un contexte de production (\`team\` au minimum). ` +
      'Ce niveau a été MESURÉ au banc d\'essai : c\'est un fait, pas une déclaration.',
      'target_level')];
  }

  return [constat('P006', WARN,
    `Niveau visé \`${niveau}\`, insuffisant pour un contexte de production (\`team\` au minimum) — ` +
    'et rien n\'a été mesuré, faute de banc d\'essai. Quelqu\'un doit assumer ce départ. ' +
    'Le jour où le niveau sera dérivé d\'une mesure, ce constat deviendra un refus.',
    'target_level', true)];
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
    'tools', true)];
}

/* ── P008 ─────────────────────────────────────────────────────────────────── */
/**
 * La dépense de la fenêtre est-elle sous le plafond ? 🔴
 *
 * ── POURQUOI CE CONTRÔLE EST AU PRÉ-VOL, ET NULLE PART AILLEURS ─────────────
 *
 * Le journal sait combien on a dépensé. L'Admin le trace. Le registre porte les tarifs.
 * Tout ça dit COMBIEN ÇA A COÛTÉ — rien ne disait STOP. Une plateforme qui découvre la
 * facture à la fin du mois a le problème de celles qui arrêtent l'IA parce que c'est trop
 * cher, avec de plus jolis graphiques.
 *
 * Le pré-vol est l'endroit exact : c'est le seul contrôle qui tombe AVANT le premier jeton
 * dépensé, et un plafond qui refuserait après l'appel aurait laissé payer l'appel.
 *
 * ── SILENCIEUX SANS CHIFFRE, COMME LES AUTRES ──────────────────────────────
 *
 * Sans `ctx.budget`, le contrôle se tait — l'appelant n'a pas lu le journal, et refuser
 * sur une ignorance serait un mur. Sans plafond déclaré au registre, il se tait aussi :
 * on n'invente pas une limite. C'est la même règle que L023 sans la banque et L027 sans
 * le vocabulaire.
 *
 * ── ET « JE NE SAIS PAS » DEMANDE UN HUMAIN, IL NE REFUSE PAS ──────────────
 *
 * Trois issues, et elles suivent la règle du pré-vol — refuser quand on sait que c'est
 * non, demander quand on ne sait pas :
 *
 *   FRANCHI     la dépense connue dépasse le plafond. C'est non.
 *   MINORANT    des appels de la fenêtre n'ont pas de tarif au registre. La dépense
 *               affichée est un plancher : la vraie peut déjà être au-dessus. On ne
 *               refuse pas sur une supposition, on demande à quelqu'un.
 *   APPROCHÉ    au-delà de 80 %. On prévient pendant qu'il est encore temps de décider :
 *               découvrir la limite au moment où elle tombe, en pleine démonstration,
 *               n'aide personne.
 */
function P008(artifact, ctx) {
  const b = ctx?.budget;
  if (!b || !Array.isArray(b.etats) || b.etats.length === 0) return [];

  const out = [];
  for (const e of b.etats) {
    if (!e?.etat?.declare) continue;
    const ou = e.portee === 'scope' ? `du périmètre \`${e.nom}\`` : 'global';
    const quand = e.fenetre === 'jour' ? 'sur 24 h' : 'sur 30 jours';

    if (e.etat.franchi) {
      out.push(constat('P008', ERROR,
        `Plafond ${ou} ${quand} atteint. ${e.etat.raison} Rien ne part tant qu'il n'est pas `
        + 'relevé au registre, ou que la fenêtre ne s\'est pas écoulée.',
        'budget'));
      continue;
    }
    if (e.etat.inconnus > 0) {
      out.push(constat('P008', WARN,
        `Plafond ${ou} ${quand} : ${e.etat.raison} La plateforme ne sait donc pas où elle `
        + 'en est — quelqu\'un doit décider de partir quand même.',
        'budget', true));
      continue;
    }
    if (e.etat.alerte) {
      out.push(constat('P008', WARN,
        `Plafond ${ou} ${quand} : ${e.etat.raison}`, 'budget'));
    }
  }
  return out;
}

/* ── Le pré-vol ───────────────────────────────────────────────────────────── */

const CONTROLES = [
  { code: 'P001', fn: P001, titre: 'L\'artefact franchit encore la porte' },
  { code: 'P002', fn: P002, titre: 'Sensibilité du dépôt sous le plafond déclaré' },
  { code: 'P003', fn: P003, titre: 'Variables requises résolues' },
  { code: 'P004', fn: P004, titre: 'Outils autorisés pour le périmètre du dépôt cible' },
  { code: 'P005', fn: P005, titre: 'Certification présente et valide' },
  { code: 'P006', fn: P006, titre: 'Niveau suffisant pour la criticité' },
  { code: 'P007', fn: P007, titre: 'Écriture : confirmation humaine requise' },
  { code: 'P008', fn: P008, titre: 'Dépense de la fenêtre sous le plafond' }
];

/**
 * Décide si une exécution peut partir, et à quelles conditions.
 *
 * @param {object} artifact  l'artefact du registre
 * @param {object} ctx       le contexte D'EXÉCUTION :
 *   { depot: { path, scope, sensibilite }, valeurs: {}, criticite: 'test'|'production',
 *     modele, derive, now, registres: { tools, targets, validateArtifact } }
 * @returns {{constats, bloque, erreurs, avertissements, confirmationRequise, raisons}}
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
  /*
   * Ce qu'un humain doit assumer avant le départ.
   *
   * Ce n'était que P007 — « ça écrit, il faut confirmer ». S'y ajoute maintenant tout
   * ce que la plateforme ne SAIT pas : un dépôt non classé, un artefact jamais certifié,
   * un niveau jamais mesuré. La liste est le prix du desserrage : sans elle, un contrôle
   * qu'on passe d'erreur à avertissement disparaît purement et simplement.
   */
  const raisons = constats.filter((c) => c.confirme);

  return {
    constats,
    bloque: erreurs > 0,
    erreurs,
    avertissements: constats.length - erreurs,
    // Distinct de `bloque` : ce n'est pas un refus, c'est une condition de départ.
    confirmationRequise: raisons.length > 0,
    raisons
  };
}

export default { prevol, CONTROLES, SENSIBILITES };
