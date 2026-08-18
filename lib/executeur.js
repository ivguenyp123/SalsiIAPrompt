/*
 * L'EXÉCUTEUR — ce qu'il faudrait pour qu'un isolement soit tenu, et ce qu'on en sait.
 *
 * ── LE PROBLÈME, POSÉ HONNÊTEMENT ────────────────────────────────────────────
 *
 * `registries/isolements.yaml` portait un `applicable: true|false` écrit à la main. C'est
 * l'erreur exacte que ce dépôt reproche à tout le monde depuis le premier jour : un
 * booléen déclaré qui affirme ce que la plateforme sait faire respecter. Un caractère mal
 * tapé accordait un droit.
 *
 * Ici, l'applicabilité est CALCULÉE à partir de preuves, et le calcul a trois issues.
 *
 * ── LA TROISIÈME ISSUE EST TOUT LE SUJET ─────────────────────────────────────
 *
 *   applicable        toutes les preuves sont établies
 *   non_applicable    au moins une preuve est établie FAUSSE
 *   non_verifiable    au moins une preuve ne peut pas être établie d'ici, et aucune
 *                     n'est fausse
 *
 * `non_verifiable` n'est ni l'un ni l'autre, et il ne se lance pas non plus. C'est la
 * règle du dépôt appliquée une fois de plus : `non résolu` ne vaut jamais `satisfait`,
 * `N/A` ne vaut pas zéro, « déduit » ne vaut pas « lu ». Le collapser vers `applicable`
 * accorderait un droit sur une ignorance ; le collapser vers `non_applicable` ferait
 * croire qu'on a mesuré une absence.
 *
 * ── POURQUOI IL N'Y A PAS D'EXÉCUTEUR ISOLÉ MAISON ──────────────────────────
 *
 * Cette plateforme est une application statique qui parle à une forge avec le jeton de
 * l'utilisateur. Elle n'a pas de serveur, donc pas de conteneur à elle. Le seul exécuteur
 * jetable disponible dans cet écosystème est le RUNNER DE CI de la forge — et ses
 * propriétés sont décidées par son `config.toml`, sur sa machine, qu'aucune API ne rend.
 *
 * On peut donc lire qu'un job existe et qu'il épingle son image ; on ne peut pas lire que
 * le réseau est coupé. Prétendre le contraire en lisant `.gitlab-ci.yml` serait
 * exactement I001 : accorder un droit sur la lecture d'un texte.
 *
 * ── L'ATTESTATION EST UN ENGAGEMENT, PAS UNE MESURE ─────────────────────────
 *
 * Ce qui n'est pas lisible d'ici peut être ATTESTÉ par quelqu'un qui administre les
 * runners. Son attestation est un fichier daté et périmable du dépôt de registre. Elle
 * vaut ce que vaut une signature — et c'est dit partout où elle apparaît, parce qu'une
 * plateforme qui affiche « isolé » sur la foi d'un engagement humain sans le nommer ment
 * par omission.
 *
 * Elle PÉRIME. Un runner se reconfigure ; une attestation de l'an dernier décrit une
 * machine qui n'existe peut-être plus.
 *
 * Module PUR.
 */

/* ── Les issues ────────────────────────────────────────────────────────────── */

export const APPLICABLE = 'applicable';
export const NON_APPLICABLE = 'non_applicable';
export const NON_VERIFIABLE = 'non_verifiable';

/** Un isolement dans cet état peut-il être LANCÉ ? Une seule issue le permet. */
export const tenable = (issue) => issue === APPLICABLE;

/**
 * Combien de temps une attestation vaut.
 *
 * Le même chiffre que la certification d'un agent au banc, et pour la même raison : ce
 * qui a été vrai un jour ne l'est pas indéfiniment, et une plateforme qui ne fait pas
 * périmer ses preuves finit par afficher l'état du monde d'il y a deux ans.
 */
export const JOURS_ATTESTATION = 90;

/* ── Les preuves que la plateforme établit elle-même ───────────────────────── */

/** Une image épinglée par digest — un tag bouge, un digest non. */
const DIGEST = /@sha256:[a-f0-9]{64}/;

/**
 * Ce que la plateforme peut établir seule, à partir de ce qu'elle a sous la main.
 *
 * @param {object} e
 *   @param {object} [e.artefact]  pour les preuves qui portent sur la capacité
 *   @param {Array}  [e.outils]    le registre des outils
 *   @param {object} [e.ci]        le fichier de CI du dépôt, déjà parsé — `null` si absent
 *   @param {string} [e.jobIsole]  le nom du job attendu
 * @returns {Map<string, {etabli: boolean|null, detail: string}>}
 *          `etabli: null` = la plateforme n'a pas de quoi trancher. Ce n'est PAS `false`.
 */
export function preuvesPlateforme({ artefact = null, outils = [], ci = undefined,
                                    jobIsole = 'salsi-isole' } = {}) {
  const out = new Map();
  const dit = (id, etabli, detail) => out.set(id, { etabli, detail });

  const declares = (artefact?.tools || [])
    .map((t) => outils.find((x) => x.id === t.id) || t);
  const ecrivants = declares.filter((t) => t.mode === 'write');

  dit('aucun_outil_write', ecrivants.length === 0,
    ecrivants.length
      ? `Elle déclare ${ecrivants.map((t) => `\`${t.id}\``).join(', ')} en \`mode: write\`.`
      : 'Aucun outil déclaré n\'écrit.');

  dit('write_par_module',
    ecrivants.every((t) => t.executor === 'module'),
    ecrivants.length
      ? 'Les outils qui écrivent sont tous en `executor: module` — L005 le contrôle à la porte.'
      : 'Aucun outil n\'écrit : l\'invariant est vrai sans objet.');

  /*
   * Le job de CI. `ci === undefined` veut dire « on n'a pas regardé » et `ci === null »
   * veut dire « on a regardé, il n'y a pas de fichier ». Deux choses différentes, et la
   * première ne doit pas se lire comme la seconde.
   */
  if (ci === undefined) {
    dit('job_ci_declare', null, 'Le fichier de CI du dépôt n\'a pas été lu.');
  } else if (!ci) {
    dit('job_ci_declare', false, 'Le dépôt ne porte aucun fichier de CI.');
  } else {
    const job = ci[jobIsole];
    if (!job) {
      dit('job_ci_declare', false,
        `Le fichier de CI ne définit aucun job \`${jobIsole}\`.`);
    } else {
      const image = typeof job.image === 'string' ? job.image : job.image?.name || '';
      dit('job_ci_declare', DIGEST.test(image),
        DIGEST.test(image)
          ? `Le job \`${jobIsole}\` épingle son image par digest.`
          : `Le job \`${jobIsole}\` existe, mais son image \`${image || '?'}\` n'est pas `
            + 'épinglée par digest. Un tag se réécrit ; ce qui tournerait demain n\'est pas '
            + 'ce qui a été relu aujourd\'hui.');
    }
  }

  return out;
}

/* ── Les attestations ──────────────────────────────────────────────────────── */

/**
 * Une attestation est-elle recevable aujourd'hui ?
 *
 * Trois refus, et le troisième est le moins évident : une attestation qui ne dit pas QUI
 * s'engage n'engage personne. Un fichier signé « l'équipe » n'a personne à qui parler le
 * jour où le runner s'avère mal configuré.
 */
export function attestationValide(a, maintenant = new Date(), jours = JOURS_ATTESTATION) {
  if (!a) return { valide: false, raison: 'Aucune attestation.' };
  if (!a.par) return { valide: false, raison: 'L\'attestation ne dit pas qui s\'engage.' };
  const le = a.le ? new Date(a.le) : null;
  if (!le || Number.isNaN(le.getTime())) {
    return { valide: false, raison: 'L\'attestation n\'est pas datée.' };
  }
  const age = Math.floor((maintenant - le) / 86400000);
  if (age > jours) {
    return { valide: false,
             raison: `Attestation vieille de ${age} jours, au-delà de ${jours}. Un runner `
                   + 'se reconfigure : elle décrit une machine qui n\'existe peut-être plus.' };
  }
  if (age < 0) return { valide: false, raison: 'L\'attestation est datée du futur.' };
  return { valide: true, raison: `Attestée par ${a.par}, il y a ${age} jour(s).`, age };
}

/** Les attestations en vigueur, indexées par preuve. */
export function attestationsPar(fichiers = [], maintenant = new Date()) {
  const out = new Map();
  for (const a of fichiers) {
    for (const p of a?.preuves || []) {
      const v = attestationValide(a, maintenant);
      // La MEILLEURE attestation gagne : une périmée ne doit pas masquer une fraîche.
      if (v.valide || !out.has(p)) out.set(p, { ...a, ...v });
    }
  }
  return out;
}

/* ── Le verdict ────────────────────────────────────────────────────────────── */

/**
 * L'isolement est-il tenu ? Et si non, par quoi exactement.
 *
 * @param {object} isolement  une entrée de `registries/isolements.yaml`
 * @param {object} e
 *   @param {Map}   [e.etablies]     sortie de `preuvesPlateforme`
 *   @param {Map}   [e.attestations] sortie de `attestationsPar`
 * @returns {{issue, tenable, preuves: Array, manque: Array}}
 */
export function verdict(isolement, { etablies = new Map(), attestations = new Map() } = {}) {
  const preuves = [];

  for (const p of isolement?.preuves || []) {
    if (p.par === 'attestation') {
      const a = attestations.get(p.id);
      preuves.push({
        id: p.id, par: p.par, quoi: p.quoi,
        etabli: a?.valide ? true : null,          // sans attestation : INCONNU, pas faux
        detail: a ? a.raison : 'Aucune attestation ne couvre cette preuve.',
        pourquoi_pas_lisible: p.pourquoi_pas_lisible || '',
        // Une attestation n'est pas une mesure, et l'écran doit pouvoir le dire.
        atteste: Boolean(a?.valide), par_qui: a?.valide ? a.par : ''
      });
      continue;
    }
    const e = etablies.get(p.id);
    preuves.push({
      id: p.id, par: 'plateforme', quoi: p.quoi,
      etabli: e ? e.etabli : null,
      detail: e ? e.detail : 'La plateforme n\'a pas établi cette preuve.',
      atteste: false, par_qui: ''
    });
  }

  const fausses = preuves.filter((p) => p.etabli === false);
  const inconnues = preuves.filter((p) => p.etabli === null);

  const issue = fausses.length ? NON_APPLICABLE
              : inconnues.length ? NON_VERIFIABLE
              : APPLICABLE;

  return { issue, tenable: tenable(issue), preuves, manque: [...fausses, ...inconnues] };
}

/**
 * La phrase qu'on met sous les yeux de quelqu'un.
 *
 * Elle nomme ce qui manque ET qui pourrait le fournir. « Non vérifiable » tout seul se lit
 * comme une panne ; « la configuration du runner, que seul son administrateur peut
 * attester » se lit comme une action.
 */
export function phrase(isolement, v) {
  if (v.issue === APPLICABLE) {
    const attestes = v.preuves.filter((p) => p.atteste);
    return attestes.length
      ? `« ${isolement.titre} » est tenu, dont ${attestes.length} preuve(s) sur `
        + `attestation de ${[...new Set(attestes.map((p) => p.par_qui))].join(', ')} — `
        + 'un engagement humain, pas une mesure.'
      : `« ${isolement.titre} » est tenu : toutes les preuves sont établies par la plateforme.`;
  }
  if (v.issue === NON_APPLICABLE) {
    return `« ${isolement.titre} » n'est PAS tenu : `
         + `${v.preuves.filter((p) => p.etabli === false).map((p) => p.detail).join(' ')}`;
  }
  const manquantes = v.preuves.filter((p) => p.etabli === null);
  const attestables = manquantes.filter((p) => p.par === 'attestation');
  return `« ${isolement.titre} » est NON VÉRIFIABLE d'ici — ce qui ne veut dire ni tenu, `
       + `ni non tenu. ${manquantes.length} preuve(s) manquent`
       + (attestables.length
         ? `, dont ${attestables.length} qui ne peuvent venir que d'une attestation de `
           + 'qui administre les runners.'
         : '.')
       + ' Ce qu\'on ne sait pas ne se lance pas.';
}

export default { APPLICABLE, NON_APPLICABLE, NON_VERIFIABLE, tenable, verdict, phrase,
                 preuvesPlateforme, attestationValide, attestationsPar, JOURS_ATTESTATION };
