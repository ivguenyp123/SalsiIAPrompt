/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  NE PAS RELIRE CE QUI N'A PAS CHANGÉ
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── LE PROBLÈME, ET IL EST ARRIVÉ ────────────────────────────────────────────
 *
 * Ouvrir le Catalogue coûtait UN APPEL PAR ARTEFACT. À quarante-cinq agents, personne ne
 * s'en apercevait. À cent quarante-deux, une poignée de visites suffit à épuiser la limite
 * d'appels de la forge — et tout s'arrête, pour une heure, y compris ce qui n'a rien à
 * voir avec le catalogue.
 *
 * ── LA CLÉ EST L'EMPREINTE, PAS LE CHEMIN ────────────────────────────────────
 *
 * Le listing d'un dossier rend, en UN appel, le chemin ET l'empreinte de chaque fichier.
 * Une empreinte inchangée veut dire un contenu inchangé — c'est la définition même d'un
 * objet git. On peut donc servir depuis le cache sans rien vérifier de plus.
 *
 * Une clé par CHEMIN aurait été fausse : le fichier change et le chemin non. Le cache
 * aurait servi du périmé, ce qui est bien pire que de coûter des appels — on publie une
 * correction et le catalogue continue d'afficher l'ancienne version, sans que rien ne
 * l'indique.
 *
 * ── ET IL SE PURGE, PARCE QU'UN STOCKAGE PLEIN CASSE TOUT LE RESTE ───────────
 *
 * Le stockage d'un navigateur est petit et PARTAGÉ : le remplir ferait échouer l'écriture
 * de la session, ce qui déconnecte quelqu'un pour lui avoir fait gagner un appel. On tient
 * donc un budget, et on jette les entrées les moins récemment servies quand il est atteint.
 *
 * Module PUR : le stockage est INJECTÉ. C'est ce qui le rend testable sans navigateur, et
 * ce qui permet de vérifier le cas qui compte — un stockage qui refuse d'écrire.
 */

/** Le budget, en caractères. Au-delà, les entrées les plus anciennes partent. */
export const BUDGET = 2_000_000;

/** La version du format. La changer invalide tout — c'est voulu lors d'un changement. */
const VERSION = 1;

const CLE = 'salsi_cache_fichiers';

const vide = () => ({ v: VERSION, e: {} });

function lire(stockage) {
  try {
    const brut = stockage.getItem(CLE);
    if (!brut) return vide();
    const o = JSON.parse(brut);
    // Un format d'une autre version ne se migre pas : il se jette. Migrer un cache est du
    // travail pour zéro gain — le pire qui puisse arriver est de tout relire une fois.
    return o && o.v === VERSION && o.e ? o : vide();
  } catch {
    // Un cache illisible n'est pas une panne : c'est un cache vide. Lever ici ferait
    // échouer l'ouverture du catalogue pour une optimisation.
    return vide();
  }
}

function ecrire(stockage, etat) {
  try {
    stockage.setItem(CLE, JSON.stringify(etat));
    return true;
  } catch {
    /*
     * LE STOCKAGE A REFUSÉ — ET ON CONTINUE.
     *
     * Plein, désactivé, en navigation privée : aucun de ces cas n'est une raison
     * d'empêcher quelqu'un d'ouvrir le catalogue. On perd le cache, on garde le produit.
     */
    return false;
  }
}

/**
 * Fait de la place, en jetant les entrées les moins récemment SERVIES.
 *
 * `vu` est mis à jour à chaque lecture, pas à chaque écriture : ce qu'on consulte souvent
 * survit, même s'il est ancien. Une purge par date d'écriture jetterait exactement ce qui
 * sert le plus.
 */
function purger(etat, budget) {
  const entrees = Object.entries(etat.e);
  let taille = entrees.reduce((s, [, v]) => s + (v.c?.length || 0), 0);
  if (taille <= budget) return etat;

  const parAge = entrees.sort((a, b) => (a[1].vu || 0) - (b[1].vu || 0));
  for (const [cle, v] of parAge) {
    if (taille <= budget) break;
    taille -= v.c?.length || 0;
    delete etat.e[cle];
  }
  return etat;
}

/**
 * Le cache adossé à un stockage.
 *
 * @param {object} stockage  n'importe quoi qui a `getItem`/`setItem` — `localStorage` en
 *                           navigateur, une Map dans un test.
 * @param {object} options   `budget`, et `maintenant` pour que les tests ne dépendent pas
 *                           de l'horloge.
 */
export function cacheFichiers(stockage, { budget = BUDGET, maintenant = () => Date.now() } = {}) {
  return {
    /** Le contenu si l'empreinte correspond, `null` sinon. Jamais d'exception. */
    lu(sha) {
      if (!sha) return null;          // sans empreinte, pas de cache : on ne devine pas
      const etat = lire(stockage);
      const e = etat.e[sha];
      if (!e) return null;
      // Servi = récent. Ce qui sert survit à la purge.
      e.vu = maintenant();
      ecrire(stockage, etat);
      return e.c;
    },

    /** Range un contenu sous son empreinte. Rend `false` si le stockage a refusé. */
    range(sha, contenu) {
      if (!sha || typeof contenu !== 'string') return false;
      const etat = lire(stockage);
      etat.e[sha] = { c: contenu, vu: maintenant() };
      return ecrire(stockage, purger(etat, budget));
    },

    /** Ce que le cache tient — pour l'afficher, jamais pour décider. */
    etat() {
      const e = Object.values(lire(stockage).e);
      return { entrees: e.length, caracteres: e.reduce((s, v) => s + (v.c?.length || 0), 0) };
    },

    /** Tout jeter. Le geste qu'on offre quand quelque chose paraît périmé. */
    vider() {
      try { stockage.removeItem(CLE); return true; } catch { return false; }
    }
  };
}

/**
 * Le stockage du navigateur, ou un stockage qui ne garde rien.
 *
 * Hors navigateur — un test, un script — `localStorage` n'existe pas. Rendre un objet
 * inerte plutôt que de lever laisse le même code tourner des deux côtés, et le cache
 * devient simplement sans effet.
 */
export function stockageLocal() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* accès refusé : navigation privée, ou cookies bloqués */ }
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

export default { cacheFichiers, stockageLocal, BUDGET };
