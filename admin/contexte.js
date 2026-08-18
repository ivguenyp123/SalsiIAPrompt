/*
 * Les référentiels que l'Admin lit, chargés une fois.
 *
 * Deux écrans en ont besoin — la file de validation, qui relinte ce qu'elle relit, et
 * l'import, qui doit refuser un artefact avant de le déposer. Les charger séparément
 * ferait deux vérités possibles à quelques secondes d'intervalle, et deux verdicts
 * différents sur le même fichier selon l'onglet ouvert.
 *
 * ── `cache: 'no-cache'`, ET CE N'EST PAS UNE COQUETTERIE ────────────────────
 *
 * Le linter tranche à partir de CES fichiers. Un navigateur qui sert une version périmée
 * du registre des outils fait refuser des artefacts parfaitement valides, et rien à
 * l'écran ne peut le dire à l'auteur. `no-cache` ne saute pas le cache : il le REVALIDE.
 * Sur des fichiers inchangés, la réponse est un 304 vide.
 */
import yaml from '../lib/yaml.js';
import { makeValidator } from '../lib/schema.js';
import { carte } from '../runtime/etat-derive.js';
import { attestationsPar } from '../lib/executeur.js';

const FRAIS = { cache: 'no-cache' };
const texte = (url) => fetch(url, FRAIS).then((r) => r.text()).then((t) => yaml.parse(t));

/**
 * L'état dérivé, s'il existe.
 *
 * Absent, il rend `null`, et c'est la bonne valeur : `null` fait taire L016, P005 et P006
 * au lieu de leur faire dire « jamais certifié » sur tout le catalogue. Une plateforme
 * sans mesure ne doit pas ressembler à une plateforme dont tout échoue.
 */
async function etatDerive() {
  try {
    const r = await fetch('../derive/etat.json', FRAIS);
    return r.ok ? carte(await r.json()) : null;
  } catch {
    return null;                            // pas de banc, pas de mesure : on ne devine pas
  }
}

let promesse = null;

/** Les référentiels, chargés une seule fois par session d'onglet. */
export function contexte() {
  if (!promesse) {
    promesse = (async () => {
      const [tools, targets, entrees, isolements, modeles, attestations, schema, derive] =
        await Promise.all([
          texte('../registries/tools.yaml'),
          texte('../registries/targets.yaml'),
          texte('../entrees/index.yaml'),
          texte('../registries/isolements.yaml'),
          texte('../registries/models.yaml'),
          texte('../attestations/index.yaml'),
          fetch('../schema/artifact.schema.json', FRAIS).then((r) => r.json()),
          etatDerive()
        ]);
      return {
        tools: tools.tools, targets: targets.targets, entrees, derive,
        validateArtifact: makeValidator(schema),
        isolements: isolements.isolements, ecritures: isolements.ecritures,
        /*
         * Les attestations en vigueur, indexées par preuve, à L'HEURE DU CHARGEMENT.
         * L'heure entre ici et pas dans le module pur : c'est l'appelant qui sait quelle
         * heure il est, et c'est ce qui rend la péremption testable.
         */
        attestations: attestationsPar(attestations.attestations || [], new Date()),
        paliers: (modeles.models || []).map((m) => m.tier)
      };
    })();
  }
  return promesse;
}

export default { contexte };
