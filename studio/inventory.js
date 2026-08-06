/*
 * L'inventaire du Studio — ce que j'ai écrit, et où ça en est.
 *
 * Le Studio ouvrait sur un formulaire vide. On écrivait un artefact, on le soumettait, et
 * on ne le revoyait plus jamais depuis le Studio : pour le retrouver il fallait passer par
 * le Catalogue, qui ne montre QUE le validé — donc une soumission en attente était
 * introuvable une fois l'onglet fermé. Un atelier sans établi.
 *
 * L'état vient du DOSSIER, faute d'état dérivé :
 *   artifacts/pending/<id>.yaml   soumis, attend une décision humaine
 *   artifacts/<id>.yaml           validé, visible au catalogue
 *
 * Un identifiant peut être aux DEUX endroits, et ce n'est pas un défaut : c'est une
 * correction en attente sur une capacité déjà publiée. La version publiée continue de
 * servir tant que la correction n'a pas été validée. Confondre les deux ferait croire à
 * l'auteur que sa correction est en ligne — elle ne l'est pas encore.
 *
 * Module PUR : aucune forge, aucun DOM. C'est ce qui le rend testable en Node.
 */

/** Les états possibles, du plus demandeur d'attention au plus stable. */
export const ETATS = {
  revue: { label: 'en revue', ordre: 0, aide: 'soumis, attend une décision humaine' },
  correction: { label: 'correction en revue', ordre: 1, aide: 'la version publiée sert toujours' },
  publie: { label: 'publié', ordre: 2, aide: 'visible au catalogue' }
};

const cle = (fichier) => fichier?.artifact?.id || fichier?.path?.split('/').pop()?.replace(/\.ya?ml$/, '') || '';

/**
 * Croise les deux dossiers en une liste d'entrées uniques par identifiant.
 *
 * @param {object}   entrees
 * @param {Array}    entrees.pending    [{ path, artifact }] lus dans artifacts/pending/
 * @param {Array}    entrees.published  [{ path, artifact }] lus dans artifacts/
 * @param {string}   [entrees.me]       le compte connecté, pour marquer ce qui est à soi
 * @returns {Array} entrées triées : ce qui attend une décision d'abord
 */
export function inventaire({ pending = [], published = [], me = '' } = {}) {
  const par = new Map();

  const poser = (fichier, ou) => {
    const id = cle(fichier);
    if (!id) return;
    if (!par.has(id)) par.set(id, { id, pending: null, published: null });
    par.get(id)[ou] = fichier;
  };

  for (const f of pending) poser(f, 'pending');
  for (const f of published) poser(f, 'published');

  return [...par.values()]
    .map((e) => {
      // La fiche affichée est celle qui porte la dernière intention de l'auteur : la
      // soumission en attente quand il y en a une, sinon la version publiée.
      const vivant = (e.pending || e.published);
      const a = vivant?.artifact || {};
      const etat = e.pending && e.published ? 'correction' : e.pending ? 'revue' : 'publie';

      return {
        id: e.id,
        etat,
        titre: a.title || e.id,
        kind: a.kind || 'agent',
        auteur: a.owner?.person || '',
        scope: a.owner?.scope || '',
        niveau: a.target_level || 'experimental',
        purpose: a.intent?.purpose || '',
        // Un fichier au YAML cassé n'a ni titre ni owner. Il doit rester VISIBLE : c'est
        // celui qu'il faut retrouver pour le réparer, et le filtre « les miens » le
        // ferait disparaître puisqu'il n'appartient à personne.
        lisible: Boolean(vivant?.artifact),
        // « à moi » se juge sur l'owner déclaré, pas sur l'auteur du commit : c'est
        // l'owner qui engage sa responsabilité sur la capacité.
        mien: Boolean(me) && a.owner?.person === me,
        pending: e.pending,
        published: e.published
      };
    })
    .sort((x, y) => ETATS[x.etat].ordre - ETATS[y.etat].ordre
                 || x.titre.localeCompare(y.titre, 'fr'));
}

/** Le fichier à rouvrir pour corriger : la soumission en attente prime sur le publié. */
export function aCorriger(entree) {
  return entree?.pending || entree?.published || null;
}

export default { inventaire, aCorriger, ETATS };
