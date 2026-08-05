# Registre de capacités IA — socle déterministe

Vague 1 du document d'architecture : le schéma de l'artefact, les deux registres dont
il dépend, et le linter qui garde la porte d'entrée (moment 2, couche 1).

**Aucun LLM n'intervient ici.** C'est délibéré : la porte doit être *vérifiable*,
*reproductible* et *explicable*. Un auteur doit pouvoir corriger, resoumettre et
comprendre — et en audit, un refus non reproductible est indéfendable.

```bash
npm install
npm run lint      # vérifie artifacts/ — code de sortie 1 si un artefact est bloqué
npm test          # 30 tests
```

## Ce qu'il y a dedans

| Chemin | Rôle |
|---|---|
| `schema/artifact.schema.json` | forme d'un agent, d'un prompt ou d'une chaîne |
| `schema/tool-registry.schema.json` | forme du registre des outils |
| `schema/target-registry.schema.json` | forme du registre des cibles assertables |
| `registries/tools.yaml` | les outils réels, avec `mode`, `executor` et périmètres |
| `registries/targets.yaml` | les cibles qu'un critère a le droit de viser |
| `lint/` | les 17 règles, sans dépendance hors validation de schéma |
| `artifacts/` | les artefacts du registre (deux exemples canoniques) |
| `fixtures/invalid/` · `fixtures/warn/` | une fixture par règle, adossée aux tests |

Le linter tourne à l'identique **en CI et dans le navigateur** : `lint/index.js` et les
règles n'ont aucune dépendance, la validation de schéma est injectée via
`ctx.validateArtifact`. Le lint en direct du Studio (moment 1) et le job de CI (moment 2)
partagent donc **une seule implémentation** — il n'y a rien qui puisse diverger.

```js
import { lint } from './lint/index.js'
const report = lint(artifact, { tools, targets, validateArtifact })
if (report.blocked) { /* … */ }
```

## Écarts assumés par rapport au document d'architecture

Cinq décisions prises en écrivant le socle. Chacune est un choix, pas un oubli.

**1 · La certification sort du fichier.** Le §02 pose que le dérivé n'est jamais déclaré,
mais l'annexe A place `certification` (dont `certified_on`) dans le YAML de l'auteur —
qui peut donc se certifier lui-même. La certification est *octroyée* après passage du
banc d'essai : elle vit dans l'état dérivé. Conséquence directe, **L016 ne peut rien
vérifier au lint de fichier seul** : la règle s'abstient quand l'état dérivé n'est pas
joignable, et s'applique au pré-vol (moment 4), qui est son vrai point d'application.

**2 · Deux classes de cibles assertables — `state` et `form`.** Avec les seules cibles
d'état du monde (`pipeline.status`, `branch.mergeable`), L008 et L009 étant bloquantes,
la porte serait **infranchissable pour tout agent de lecture** : « Expliquer ce code » ou
« Générer un message de commit » n'ont aucun pipeline à assertir. Le registre serait
réservé à une minorité du catalogue. Les cibles de classe `form` portent sur la sortie
elle-même — patch applicable, JSON valide, sections présentes, absence de secret — et
restent parfaitement déterministes. Voir `artifacts/commit-message.yaml`.

**3 · L012 passe en avertissement.** Un artefact *est* légitimement un texte
d'instructions : y chercher des motifs d'injection produit surtout des faux positifs, et
une règle bloquante à fort taux de faux positifs se contourne ou se désactive. Surtout,
la menace est déjà neutralisée par conception — la porte n'emploie aucun juge LLM, donc
injecter le spec n'ouvre rien. L'injection qui compte arrive à l'exécution, dans le
contexte récupéré (code, journaux), et se traite aux moments 4 et 5.

**4 · Nouvelle règle L017 — cohérence statistique des cas d'or.** Un LLM n'est pas
reproductible. Un cas d'or joué une fois est un tirage, pas une porte : sans `runs` et
`pass_at_least`, le banc d'essai rendrait un verdict différent à chaque passage —
exactement le défaut reproché au juge LLM, déplacé d'un cran.

**5 · L'invariant est évalué sur le mode *effectif*.** Le registre des outils fait
autorité sur `mode` et `executor` (L004). Sans cela, déclarer `mode: read` sur un outil
que le registre sait en écriture suffirait à passer L005 sans l'avoir violé en apparence.
Le contournement est couvert par `fixtures/invalid/L004-contournement-invariant.yaml`.

## Les règles

🔴 bloquant · 🟡 avertissement (n'empêche pas la soumission)

| Code | Règle | |
|---|---|:--:|
| `L001` | Schéma valide et complet — et **aucun bloc `derived`** | 🔴 |
| `L002` | Toute `{{variable}}` du spec est déclarée | 🔴 |
| `L003` | Toute variable déclarée est utilisée | 🟡 |
| `L004` | Tout outil existe au registre et y est décrit conformément | 🔴 |
| `L005` | `mode:write` ⟹ `executor:module` | 🔴 |
| `L006` | Outils autorisés pour le périmètre de l'owner | 🔴 |
| `L007` | Aucun secret, URL ou identifiant de projet en dur | 🔴 |
| `L008` | `criteria` non vide | 🔴 |
| `L009` | Chaque critère est assertable (cible connue, opérateur et type valides) | 🔴 |
| `L010` | Nombre de cas d'or ≥ seuil du niveau visé | 🔴 |
| `L011` | `intent.not_for` renseigné | 🟡 |
| `L012` | Marqueurs d'injection dans le spec | 🟡 |
| `L013` | Owner personne **et** périmètre réellement renseignés | 🔴 |
| `L014` | Palier de modèle cohérent avec la taille de contexte | 🟡 |
| `L015` | Similarité élevée avec un artefact existant | 🟡 |
| `L016` | Certification présente et non périmée — *contextuelle, cf. écart 1* | 🔴 |
| `L017` | Cohérence statistique des cas d'or (`pass_at_least` ≤ `runs`) | 🔴 |

## Tests

Le nom d'une fixture porte le code de la règle qu'elle doit déclencher
(`L009-cible-non-assertable.yaml`). Ajouter une fixture crée donc son test : il n'y a
pas de liste à tenir à jour à côté, donc rien à oublier.

## Ce que ce socle ne fait pas encore

Le lint est la **couche 1** du moment 2. Restent à construire, dans l'ordre du document :

- le **banc d'essai** (couche 2) — c'est l'item le plus cher de la vague 2 : il lui faut
  des dépôts fixtures, une CI isolée et un reset entre exécutions
- le **pré-vol** (moment 4) — meilleur rapport valeur/effort, zéro IA, et désormais
  porteur de la sécurité depuis le passage en compte de service
- la **capture d'outcome** (moment 7), qui rend toutes les métriques défendables
