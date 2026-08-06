# SalsiIAPrompt — registre de capacités IA

Un registre d'agents et de prompts IA **certifiés** : une capacité y entre par une porte
contrôlée, monte en maturité **sur preuve**, est surveillée en continu, et sort quand
elle se dégrade ou se périme.

> **L'IA traduit l'intention, le noyau gouverne, l'humain valide.**
> Le déterministe est premier : il décide, filtre, bloque et mesure. Le LLM produit et
> conseille. L'humain tranche. À aucun point de contrôle l'IA n'a de droit de veto.

État : **vague 1**. Le schéma de l'artefact, les deux registres dont il dépend, le linter
qui garde la porte d'entrée (moment 2, couche 1), et le Studio qui joue les mêmes règles
à la frappe (moment 1). Pas encore de back, donc pas encore d'état dérivé ni de jobs.

`maquette.html` est la maquette d'origine du produit — Catalogue, Studio, Admin, en un
seul fichier, données en dur. Elle s'ouvre par double-clic. Elle montre l'intention ;
elle ne vérifie rien. C'est le code ci-dessous qui vérifie.

## Lancer

**Rien à installer.** Aucune dépendance à l'exécution : ni `npm install`, ni réseau, ni
LLM. Node ≥ 18 suffit — et `npm start` ne fait que lancer `node serve.js`.

```bash
npm start                       # ou : node serve.js   →  http://localhost:8080
```

Sans Node sous la main (Chromebook, poste verrouillé), l'application est **entièrement
statique** : n'importe quel serveur de fichiers convient, `serve.js` n'est qu'une
commodité.

```bash
python3 -m http.server 8080     # puis http://localhost:8080/app/login.html
```

Ou, sans rien installer du tout : activer **GitHub Pages** sur le dépôt
(Settings → Pages → Deploy from a branch → `main` / `/`), et l'ouvrir depuis n'importe
quel appareil. Le jeton reste dans le navigateur — il n'y a aucun back où l'envoyer —
mais le dépôt étant public, la page l'est aussi : utiliser un jeton **fine-grained**
limité à ce seul dépôt.

Ce qu'on ne peut pas faire par double-clic : ouvrir `app/login.html` en `file://`. Les
navigateurs y interdisent les modules ES. Seule `maquette.html`, fichier unique sans
module, s'ouvre directement.

Connexion par jeton GitLab, comme le hub Salsifi — avec trois différences assumées :
la session a sa propre clé de stockage (deux applications, deux cycles de vie), elle
vit **dans l'onglet** par défaut plutôt que sur le navigateur, et une session Salsifi
ouverte ne sert qu'à pré-remplir l'instance : le jeton est toujours ressaisi.

## Le Catalogue — relire le registre

Le Studio écrit, le Catalogue relit. La liste est **lue dans le dépôt**, jamais tenue à
la main : chaque carte correspond à un `artifacts/*.yaml` réel. Recherche par intention,
filtres par type, et une fiche par capacité — spécification, outils, contrat de runtime.

Chaque artefact est **repassé au linter à la lecture**. Ce n'est pas redondant avec la
porte : les règles évoluent, et un artefact publié hier peut ne plus être conforme
aujourd'hui. Le filtre « non conformes » les isole, au lieu de les laisser pourrir en
silence. C'est l'embryon du moment 8 — la surveillance continue — sans jobs planifiés.

## Reprendre un artefact

Le registre n'est plus en écriture unique. Depuis la fiche du Catalogue ou depuis la file
de validation, **Modifier** rouvre l'artefact dans le Studio. La correction repasse par la
file comme toute soumission : corriger n'est pas contourner.

Le formulaire ne montre pas tous les champs — ni les étiquettes, ni le moment, ni le
palier de modèle, ni la classification. Ils sont **transportés** tels quels et remis en
place à la republication. Sans ça, rouvrir un artefact pour corriger une virgule lui
ferait perdre ces champs en silence — une dégradation causée par l'outil censé le
protéger.

Les cas d'or étaient transportés eux aussi, tant qu'aucun champ ne savait les montrer.
Ils ont maintenant les leurs, donc ils se **modifient** : les laisser dans le transport
aurait produit le pire des deux mondes, éditables à l'écran et remplacés à l'écriture.

La garantie tenue par les tests n'est pas l'identité mais l'**idempotence** : la reprise
normalise les blancs de bord venus du repli YAML, donc la première republication produit
un petit diff — et plus jamais ensuite. Sans cette propriété, chaque ouverture du Studio
salirait le dépôt d'un diff gratuit.

L'identifiant est préservé : renommer le titre d'un artefact repris ne crée pas un second
fichier en laissant l'ancien orphelin.

## La file de validation — le moment 3

Publier depuis le Studio ne met rien au catalogue : l'artefact part dans
`artifacts/pending/` et attend une **décision humaine** dans l'Admin. Valider le déplace
vers `artifacts/`, où le Catalogue le lit. Refuser le supprime.

**Le dossier porte l'état**, faute d'état dérivé. Et comme valider et refuser sont des
commits, l'historique du dépôt *est* le journal des décisions : qui a tranché quoi, quand,
et sur quel contenu exactement. Aucune base à tenir.

Ce que la porte automatique a refusé ne peut pas être validé à la main — le bouton reste
inerte. Sinon la règle ne sert plus à rien et un « oui » humain devient un contournement.

**Limite assumée** : rien n'empêche l'auteur de valider son propre artefact. La séparation
des rôles ne peut pas vivre dans le navigateur — qui détient le jeton a tous les droits.
Elle viendra des branches protégées et des `CODEOWNERS` du dépôt, côté forge, où elle ne
se contourne pas en ouvrant la console.

## Le journal des décisions

L'Admin a deux vues : la file, et le **journal**. Qui a soumis, qui a validé, qui a
refusé, et quand. Rien n'est tenu à la main — chaque décision de l'Admin est un commit,
donc l'historique du dépôt **est** le journal. Il n'était simplement pas affiché : on
avait la traçabilité sans l'auditabilité, ce qui revient à ne pas l'avoir.

Deux constats que le journal rend visibles et qu'aucune autre vue ne porte :

- **Ce qui n'est pas passé par le produit.** Un commit sur `artifacts/` dont le message ne
  suit pas le vocabulaire de l'application (`registre : soumettre|valider|refuser …`) a été
  écrit directement dans le dépôt : il a contourné la porte du lint **et** la file de
  validation. Le journal le marque « hors parcours » et l'annonce en tête. Le signaler est
  tout ce qu'un navigateur peut faire — seules des branches protégées l'empêchent.
- **L'acteur déclaré n'est pas l'auteur du commit.** L'auteur est celui dont le jeton a
  écrit ; l'acteur est celui que l'application a inscrit dans le corps du message. Ils
  coïncident aujourd'hui, parce que chacun agit avec son propre jeton. Le jour où un back
  écrira avec un compte de service, les confondre effacerait la responsabilité — le journal
  affiche alors les deux.

### La couture vers la base

`admin/journal.js` **ne connaît pas git**. Il transforme des commits en *événements*, et
c'est l'événement qui est le contrat :

```js
{ date, action, artefactId, cible, acteur, acteurDeclare, auteurCommit, source, ref }
```

Le jour où le journal viendra d'une base — avec les exécutions, les coûts, les
certifications, tout ce que git ne peut pas porter — il suffira d'une fonction
`depuisBase(lignes)` qui rende la même forme. Le rendu, les filtres et les tests ne bougent
pas. Le champ `source` distingue déjà les deux origines pour qu'elles **coexistent** pendant
la bascule au lieu que l'une remplace l'autre d'un coup.

Un test verrouille la liste des champs de l'événement : c'est le contrat que `depuisBase()`
devra honorer. Et les messages de commit sont recopiés à la virgule près dans les tests
depuis `studio/studio.js` et `admin/admin.js` — reformuler un message d'un côté fait tomber
un test de l'autre.

## Publier

Depuis le Studio, **Publier sur main** commite l'artefact en `artifacts/<id>.yaml` sur
le dépôt du registre. Pas de merge request à ce stade : on veut voir le flux tourner de
bout en bout. La revue humaine et la double validation reviendront par les **branches
protégées et les règles d'approbation** du dépôt — leur place naturelle.

Le lint reste la porte : le bouton est inerte tant qu'une erreur subsiste, et la CI du
dépôt rejoue les mêmes règles côté serveur. Rien ne dépend de la bonne foi de la page.

L'application parle **deux forges** : GitLab, qui est la cible, et GitHub, où vit ce
prototype. Elle les distingue à l'URL de connexion. L'abstraction n'est pas spéculative —
il y a deux implémentations réelles, et elles divergent là où ça compte : GitLab choisit
création ou mise à jour par le verbe HTTP, GitHub exige le `sha` du fichier existant.
Les deux ont leurs tests.

## Trois dépôts, pas un

| Dépôt | Contenu |
|---|---|
| **celui-ci** | l'application : front, linter, schémas, registres |
| *à créer* | les **artefacts gouvernés** — un `artifacts/*.yaml` par capacité |
| `Salsifi` | la plateforme DevOps existante, indépendante |

Le dépôt des artefacts doit rester distinct : sur lui, les branches protégées, les
`CODEOWNERS` et les règles d'approbation **sont** la gouvernance — c'est le moment 3. Un
`ai-maintainer` qui soumet un agent n'a aucune raison d'accéder au code de l'application.

Le dossier `artifacts/` ci-dessous contient les exemples canoniques qui servent de
fixtures aux tests — et, pour l'instant, ce que le Studio publie. Il a vocation à partir
dans ce troisième dépôt. L'accueil demande d'ailleurs déjà **deux** dépôts distincts :
celui du registre, où les artefacts sont commités, et celui de travail, sur lequel les
agents portent.

**Aucun LLM n'intervient ici.** C'est délibéré : la porte doit être *vérifiable*,
*reproductible* et *explicable*. Un auteur doit pouvoir corriger, resoumettre et
comprendre — et en audit, un refus non reproductible est indéfendable.

**Aucune dépendance à l'exécution : ni `npm install`, ni réseau, ni LLM.** Node ≥ 18 suffit.

```bash
node lint/cli.js artifacts    # la porte — sortie 1 si un artefact est bloqué
node lint/cli.js fixtures/    # voir des refus réels
node --test test/*.test.js    # 47 tests
```

`lib/yaml.js` et `lib/schema.js` remplacent `js-yaml` et `ajv`. Ceux-ci restent en
devDependencies facultatives : quand ils sont installés, `test/conformance.test.js`
compare ligne à ligne le code maison aux implémentations de référence (5 tests de plus).
Sans eux, ces tests se sautent et le reste tourne à l'identique.

```bash
npm install && npm test       # conformité croisée comprise
```

## Le Studio — l'établi et le lint en direct (moment 1)

```bash
npm run studio                # puis http://localhost:8080
```

Le Studio ouvre sur **l'établi** : ce qu'on a écrit, et où ça en est. Avant, il ouvrait
sur un formulaire vide — on soumettait un artefact et on ne le revoyait plus jamais
depuis le Studio, puisque le Catalogue ne montre que le validé. Une soumission en attente
devenait introuvable dès l'onglet fermé : on écrivait dans le vide en espérant qu'un
administrateur passe.

Trois états, portés par le dossier faute d'état dérivé :

| État | Où vit le fichier | Ce que ça veut dire |
|---|---|---|
| **en revue** | `artifacts/pending/<id>.yaml` | soumis, attend une décision humaine |
| **correction en revue** | les **deux** dossiers | une correction attend ; la version publiée sert toujours |
| **publié** | `artifacts/<id>.yaml` | visible au catalogue |

Le troisième état n'est pas un détail. Corriger un artefact publié ne le modifie pas : ça
dépose une soumission dans la file, et la version en ligne continue de servir jusqu'à la
décision. Confondre les deux ferait partir l'auteur en pensant sa correction déployée. Le
bandeau du formulaire dit lequel des deux cas s'applique.

Un fichier au YAML cassé **reste dans la liste** — c'est celui qu'il faut retrouver pour
le réparer — et son bouton est inerte : le rouvrir produirait un formulaire vide qu'on
republierait par-dessus l'original. Il échappe aussi au filtre « seulement les miens »,
puisqu'un fichier illisible n'a pas d'owner.

Derrière l'établi, le formulaire d'écriture où **les 21 règles s'exécutent à la frappe**.
Deux boutons chargent un exemple conforme et un exemple fautif, pour voir la porte
s'ouvrir et se fermer.

La page importe les **vrais** modules — `lint/index.js`, `lib/schema.js`, `lib/yaml.js` —
et charge les registres réels. Aucune copie, aucun portage, aucun bundler : c'est
exactement le code qui tourne en CI au moment 2. C'est la raison d'être du choix « sans
dépendance », et ce qui garantit que l'auteur ne peut pas voir vert ici et rouge là-bas.

Trois principes portés par le formulaire lui-même :

- **l'owner ne se saisit pas** — la personne vient de la connexion GitLab, le périmètre
  se choisit dans la liste dérivée du registre des outils. Un artefact est *signé* :
  laisser taper le nom d'un autre, ou un tiret, vide la propriété de son sens. Le
  périmètre du dépôt de travail est présélectionné quand il correspond à un périmètre
  connu — mais il reste choisi, pas prouvé : le prouver suppose de vérifier
  l'appartenance au groupe GitLab côté serveur, et c'est un travail de back.

- **`mode` et `executor` ne se saisissent pas** — ils viennent du registre et s'affichent
  en pastilles. Un auteur ne peut donc pas confier une écriture au LLM : L005 cesse
  d'être une règle qu'on lui oppose, elle devient une saisie impossible. Le moment 1
  bien fait ne signale pas les erreurs, il les empêche.
- **les cibles et opérateurs proposés viennent du registre** — un critère non assertable
  devient difficile à écrire plutôt que refusé après coup.

### Les cas d'or, et pourquoi l'échelle de maturité tenait à eux

Le formulaire n'avait pas de champ pour les cas d'or. Conséquence, invisible et totale :
`L010` en exige 3 pour `équipe` et 5 pour `officiel`, donc **aucun artefact écrit dans
l'interface ne pouvait dépasser `expérimental`**. Le niveau `officiel` n'existait que
dans les fichiers écrits à la main.

Un cas d'or n'est pas un critère, et la confusion est facile :

| | vérifié quand | par qui | à quoi ça sert |
|---|---|---|---|
| **critère** | à chaque exécution, en production | la plateforme, au post-vol | le contrat tenu |
| **cas d'or** | au banc d'essai, à chaque montée de modèle | la CI | la non-régression |

Sans cas d'or, un changement de version de modèle se constate en production.

La saisie suit la même règle que le reste : le **contexte** d'un nouveau cas est amorcé
avec les variables déclarées — c'est exactement ce qu'il doit fournir pour que le prompt
s'interpole — et les **attentes** se choisissent dans le registre des cibles, qui donne
leur type. Une chaîne `"true"` comparée à un booléen `true` échouerait au banc d'essai
sans qu'on comprenne pourquoi.

Un compteur annonce le manque avant que `L010` ne le reproche. Et `L017` refuse les cas
creux : sans elle, atteindre `officiel` ne demanderait que cinq cases vides.

L'aperçu montre l'**artefact YAML** qui partira en merge request : c'est lui qui sera relu
et audité, pas le formulaire. Un test d'aller-retour garantit que le YAML affiché est
exactement l'artefact évalué.

Un serveur est nécessaire (`npm run studio`) parce que les navigateurs interdisent les
modules ES en `file://`. Inliner le linter dans la page créerait une copie qui
divergerait au premier correctif — précisément ce qu'on évite.

## Ce qu'il y a dedans

| Chemin | Rôle |
|---|---|
| `schema/artifact.schema.json` | forme d'un agent, d'un prompt ou d'une chaîne |
| `schema/tool-registry.schema.json` | forme du registre des outils |
| `schema/target-registry.schema.json` | forme du registre des cibles assertables |
| `registries/tools.yaml` | les outils réels, avec `mode`, `executor` et périmètres |
| `registries/targets.yaml` | les cibles qu'un critère a le droit de viser |
| `lib/yaml.js` · `lib/schema.js` | lecteur YAML et évaluateur JSON Schema maison, sans dépendance |
| `lint/` | les 21 règles |
| `studio/` | le formulaire, le pont vers l'artefact, le serveur local |
| `artifacts/` | les artefacts du registre (deux exemples canoniques) |
| `fixtures/invalid/` · `fixtures/warn/` | une fixture par règle, adossée aux tests |

Le linter tourne à l'identique **en CI et dans le navigateur** : rien n'a de dépendance,
et la validation de schéma est injectée via `ctx.validateArtifact`. Le lint en direct du Studio (moment 1) et le job de CI (moment 2)
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

**4 · Nouvelle règle L017 — consistance des cas d'or.** Un LLM n'est pas reproductible.
Un cas d'or joué une fois est un tirage, pas une porte : sans `runs` et `pass_at_least`,
le banc d'essai rendrait un verdict différent à chaque passage — exactement le défaut
reproché au juge LLM, déplacé d'un cran.

La règle refuse aussi le cas d'or **creux**. `L010` ne sait que compter : cinq cas sans
attente décrochent le niveau `officiel` aussi bien que cinq vrais. C'est `L017` qui
empêche `L010` d'être un simple compteur — sans elle, la maturité s'obtiendrait en
remplissant, ce qui est exactement le contournement que le produit existe pour fermer.

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
| `L017` | Consistance des cas d'or : au moins une attente, contexte fourni, `pass_at_least` ≤ `runs` | 🔴 |
| `L018` | Aucun reste de rédaction dans le spec (`TODO`, `[à compléter]`…) | 🔴 |
| `L019` | Pas de logique dans le spec — condition ou boucle | 🟡 |
| `L020` | Taille du spec dans des bornes exploitables | 🔴 |
| `L021` | Le spec utilise au moins une des variables qu'il déclare | 🔴 |

## Tests

Le nom d'une fixture porte le code de la règle qu'elle doit déclencher
(`L009-cible-non-assertable.yaml`). Ajouter une fixture crée donc son test : il n'y a
pas de liste à tenir à jour à côté, donc rien à oublier.

## Ce que le lint ne peut pas faire, par construction

Le lint vérifie la **forme**, jamais le **sens**. Un spec syntaxiquement irréprochable
qui ne veut rien dire franchit la porte — aucune règle déterministe ne peut juger qu'un
texte décrit une tâche utile.

`L021` en attrape la variante structurelle la plus courante : déclarer des entrées et
n'en utiliser aucune. Mais un artefact sans variable, avec un spec creux assez long et un
critère valide, passe — et c'est assumé.

Trois remparts existent en aval, et c'est là que le sens se juge :

| Rempart | Ce qu'il fait |
|---|---|
| **Cycle de vie** | le creux ne passe qu'en `expérimental`. `équipe` exige 3 cas d'or, `officiel` 5 — et une réussite **mesurée**. Aucun bouton ne promeut. |
| **Banc d'essai** | joue les cas d'or : un spec creux échoue à tous |
| **Revue humaine** | moment 3, avec le rapport de banc sous les yeux |

C'est la répartition du §00 : la machine vérifie ce qui est vérifiable, l'IA commente ce
qui ne l'est pas, l'humain tranche. Attendre du lint qu'il juge la pertinence, c'est lui
demander le travail du banc d'essai.

## Ce que ce socle ne fait pas encore

Le lint est la **couche 1** du moment 2. Restent à construire, dans l'ordre du document :

- le **banc d'essai** (couche 2) — c'est l'item le plus cher de la vague 2 : il lui faut
  des dépôts fixtures, une CI isolée et un reset entre exécutions
- le **pré-vol** (moment 4) — meilleur rapport valeur/effort, zéro IA, et désormais
  porteur de la sécurité depuis le passage en compte de service
- la **capture d'outcome** (moment 7), qui rend toutes les métriques défendables
