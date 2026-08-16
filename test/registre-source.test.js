/*
 * D'OÙ L'EXÉCUTION LIT UN AGENT.
 *
 * Le défaut que ce fichier fige était invisible et systématique : le catalogue lisait les
 * agents CHEZ LA FORGE, avec le jeton du navigateur, tandis que l'exécution les lisait sur
 * le DISQUE du serveur. Deux sources pour la même chose, et rien ne le disait.
 *
 * Conséquence : tout agent créé depuis l'écran s'affichait au catalogue et se faisait
 * répondre « introuvable au registre » au lancement. Chaque agent créé, sans exception.
 *
 * `runtime/api.js` est pur — il reçoit `charger` par injection. On vérifie donc ici le
 * CONTRAT que le serveur doit remplir, sans dépendre de git ni du réseau.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { executer, DOSSIERS } from '../runtime/api.js';

const AGENT = {
  id: 'export-rapport-dora', kind: 'prompt', title: 'Export du rapport DORA',
  owner: { person: 'moi', scope: 'Plateforme' },
  intent: { purpose: 'Exporter le rapport.', not_for: 'Pas pour décider.' },
  spec: 'Exporte le rapport pour {{branche_cible}}.',
  variables: [{ name: 'branche_cible', source: 'repo', required: true }],
  criteria: [{ target: 'output.contains_secret', op: 'eq', value: false }],
  target_level: 'experimental', model_tier: 'mid'
};

/** Le minimum pour que `executer` aille jusqu'au chargement. */
const deps = (charger) => ({
  charger, banque: {}, models: [],
  registres: { tools: [], targets: [], entrees: {}, validateArtifact: () => [] },
  creerVertex: () => { throw new Error('le modèle ne doit pas être appelé ici'); }
});

describe('l\'exécution lit LE REGISTRE, pas une copie', () => {
  test('un agent absent du disque mais présent au registre est TROUVÉ', () => {
    /*
     * Le cas rapporté à l'usage : l'agent venait d'être validé depuis l'écran, donc il
     * était chez la forge et pas encore sur le disque du serveur.
     */
    let demande = null;
    const charger = (id, dossiers) => {
      demande = { id, dossiers };
      return id === AGENT.id ? AGENT : null;      // le serveur sait aller le chercher
    };

    return executer({ id: 'export-rapport-dora', valeurs: { branche_cible: 'main' } },
                    deps(charger))
      .then((r) => {
        assert.notEqual(r.status, 404, 'ne doit plus répondre « introuvable »');
        assert.equal(demande.id, 'export-rapport-dora');
        // Les deux dossiers du registre sont proposés, dans cet ordre : le validé
        // d'abord, ce qui attend en revue ensuite.
        assert.deepEqual(demande.dossiers, DOSSIERS);
      });
  });

  test('vraiment introuvable reste un 404, et c\'est la bonne réponse', () => {
    // Le repli élargit la recherche ; il ne doit pas inventer un agent.
    return executer({ id: 'nexiste-nulle-part' }, deps(() => null))
      .then((r) => {
        assert.equal(r.status, 404);
        assert.match(r.corps.erreur, /introuvable/);
      });
  });

  test('un identifiant malformé est refusé AVANT tout chargement', () => {
    /*
     * Il entre désormais dans une commande (`git show origin/main:…`). Le refus en amont
     * n'est plus seulement une politesse : c'est ce qui garantit qu'aucune chaîne
     * arbitraire n'atteint le shell.
     */
    let appele = false;
    return executer({ id: '../../etc/passwd' }, deps(() => { appele = true; return null; }))
      .then((r) => {
        assert.equal(r.status, 400);
        assert.equal(appele, false, 'le chargement ne doit même pas être tenté');
      });
  });
});
