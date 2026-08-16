/*
 * Choisir un dépôt — une liste, jamais une saisie.
 *
 * ── POURQUOI CE MODULE EXISTE ────────────────────────────────────────────────
 *
 * Le sélecteur vivait dans le Catalogue, et lui seul en profitait. Partout ailleurs, un
 * dépôt se tapait à la main : à l'exécution d'un agent, dans les cas d'or du Studio.
 *
 * Demander à quelqu'un d'ÉCRIRE `groupe/sous-groupe/projet` quand le jeton sait déjà la
 * liste, c'est lui demander de connaître par cœur ce que la machine a sous la main. Et
 * une faute de frappe ne donne pas une erreur : elle donne un agent qui tourne sur le
 * mauvais dépôt, ou qui échoue plus tard sans dire pourquoi.
 *
 * ── LA SAISIE RESTE POSSIBLE, ET CE N'EST PAS UNE CONCESSION ─────────────────
 *
 * Un jeton restreint à un seul dépôt ne peut pas lister les autres — c'est le jeton qui
 * fait son travail, pas une panne. Et cent dépôts ne couvrent pas tout. « Autre » est
 * donc offert, mais en dernier recours et jamais comme point de départ.
 *
 * Module de PRÉSENTATION : il touche au DOM, pas au réseau — la forge est injectée.
 */

/** La clé du dépôt de travail, choisi à l'accueil. Une seule définition. */
export const CLE_TRAVAIL = 'salsi_ia_project_path';

/** Les noms de variable qui désignent un dépôt, et méritent donc la liste. */
const NOMS_DEPOT = new Set(['repo', 'depot', 'dépôt', 'projet', 'project', 'repository']);

/**
 * Cette variable désigne-t-elle un dépôt ?
 *
 * Sur le NOM, pas sur la source. `stack` et `diff` sont eux aussi « métadonnée du dépôt »
 * sans être des noms de dépôt : leur offrir la liste ferait choisir `groupe/projet` là où
 * on attend `java`.
 */
export const estUnDepot = (variable) =>
  NOMS_DEPOT.has(String(variable?.name || '').trim().toLowerCase());

/** Le cache des dépôts atteignables. Une fois par session d'écran, pas par champ. */
let cache = null;
export function oublierDepots() { cache = null; }

export async function listerDepots(forge) {
  if (cache) return cache;
  cache = await forge.listRepos({ perPage: 100 });
  return cache;
}

/**
 * Un champ « dépôt » : une liste, avec la saisie en secours.
 *
 * @param {object} options
 * @param {object} options.forge      pour lister
 * @param {string} [options.valeur]   valeur de départ
 * @param {Function} [options.surChoix] appelée à chaque changement, avec le chemin
 * @param {Document} [options.doc]
 * @returns {{noeud, valeur, remplir}}
 */
export function champDepot({ forge, valeur = '', surChoix = () => {}, doc = document } = {}) {
  const AUTRE = '__autre__';
  const el = (tag, attrs = {}) => Object.assign(doc.createElement(tag), attrs);

  const noeud = el('div', { className: 'champ-depot' });
  const select = el('select');
  const libre = el('input', { placeholder: 'groupe/projet', hidden: true });
  const aide = el('div', { className: 'note' });

  noeud.append(select, libre, aide);

  const lire = () => (select.value === AUTRE ? libre.value.trim() : select.value);
  const prevenir = () => surChoix(lire());

  select.onchange = () => {
    libre.hidden = select.value !== AUTRE;
    if (!libre.hidden) libre.focus();
    prevenir();
  };
  libre.oninput = prevenir;

  async function remplir() {
    select.textContent = '';
    select.append(el('option', { value: '', textContent: '— chargement… —' }));
    select.disabled = true;

    // Le dépôt de travail choisi à l'accueil est la proposition par défaut : c'est celui
    // sur lequel on veut travailler neuf fois sur dix.
    const prefere = valeur || localStorage.getItem(CLE_TRAVAIL) || '';

    try {
      const depots = await listerDepots(forge);
      select.textContent = '';
      select.disabled = false;
      select.append(el('option', { value: '', textContent: `— choisir parmi ${depots.length} —` }));

      for (const d of depots) {
        select.append(el('option', { value: d.path, textContent: d.path,
                                     selected: d.path === prefere }));
      }
      // Un dépôt connu mais absent de la liste ne se perd pas en silence.
      if (prefere && !depots.some((d) => d.path === prefere)) {
        select.append(el('option', { value: prefere, textContent: prefere, selected: true }));
      }
      select.append(el('option', { value: AUTRE, textContent: '— un autre dépôt… —' }));
      aide.textContent = `${depots.length} dépôt(s) accessibles avec ta connexion.`;
    } catch {
      /*
       * Un jeton restreint à un seul dépôt ne peut pas lister les autres. Ce n'est pas
       * une panne — on bascule en saisie, en le disant.
       */
      select.textContent = '';
      select.disabled = false;
      select.append(el('option', { value: AUTRE, textContent: '— saisir le dépôt —', selected: true }));
      libre.hidden = false;
      libre.value = prefere;
      aide.textContent = 'La liste n\'est pas accessible avec cette connexion — écris le dépôt.';
    }
    prevenir();
  }

  return { noeud, valeur: lire, remplir };
}

export default { CLE_TRAVAIL, estUnDepot, listerDepots, oublierDepots, champDepot };
