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

## Lancer un agent pour de vrai

Jusqu'ici le registre décrivait des capacités. Il en **exécute** maintenant, chez l'un
ou l'autre de deux fournisseurs.

```bash
cp .env.exemple .env      # puis remplis la clé dedans
npm start                 # l'écran, sur http://localhost:8080
npm run agent -- expliquer-un-code --cas=gc-01-module-court
```

**Sans rien installer — Codespaces.** Le dépôt porte un `.devcontainer` : `Code ▸
Codespaces ▸ Create codespace`, et tout est là. La clé se pose une fois dans
*Settings ▸ Codespaces ▸ Secrets* et arrive dans l'environnement du conteneur — jamais
dans le dépôt, jamais dans le navigateur. C'est la même frontière que sur un poste, et
c'est le seul chemin praticable depuis un Chromebook.

**Pourquoi ça ne marchera jamais depuis Pages ou raw.githack** : ces hôtes servent des
fichiers statiques. Il n'y a aucun serveur derrière, donc pas de `/api/lancer` — et la
clé ne peut pas descendre dans la page, sinon elle appartient à qui ouvre les outils de
développement. L'écran le dit au lieu d'échouer au clic.

`.env` est ignoré par git **et** refusé par `test/secrets.test.js` s'il y entrait quand
même. Node le lit lui-même — `--env-file-if-exists` — donc aucune dépendance de plus, et
la clé ne traîne pas dans l'historique du shell comme le ferait un `export`.

Pour un essai jetable, une seule commande fait aussi l'affaire — la variable meurt avec
le processus, et l'espace initial la garde hors de l'historique sur la plupart des shells :

```bash
 DEEPSEEK_API_KEY=sk-… npm run agent -- expliquer-un-code --cas=gc-01-module-court
```

Le fournisseur se déduit de la clé présente, ou se force avec `SALSI_FOURNISSEUR`.
Il **s'affiche toujours** — dans un registre gouverné, « quel modèle a répondu » est la
moitié de ce qu'un auditeur demandera.

Brancher le second n'a demandé **aucune modification** à une règle, un contrôle, un
critère ou un artefact : c'est ce que le registre des paliers existe pour permettre.
Un registre de capacités IA qui ne saurait parler qu'à un fournisseur serait périmé au
premier appel d'offres.

`--cas` rejoue un cas d'or : le contexte du cas fournit les valeurs, et les entrées
`*_fixture` sont **lues dans la banque**. C'est la première fois que ces fichiers
servent à autre chose qu'à être comptés.

Le compte de service a besoin du rôle **Utilisateur Vertex AI** sur le projet, et
de rien d'autre.

### Ce qui se passe à chaque appel

1. **le pré-vol tranche** — avant le premier jeton dépensé. Refuser après coûterait
   le prix de l'appel et aurait laissé partir le prompt.
2. **la confirmation** — un artefact qui écrit ne part pas sans `--assume`. Ce n'est
   pas de la discipline d'appelant, c'est une condition dans le code.
3. **Vertex répond**, au palier déclaré par `model_tier`.
4. **le post-vol évalue le contrat** sur la sortie réelle.

Le 4 est le vrai changement. `criteria` était déclaré depuis le début et **jamais
évalué** : le registre décrivait des vérifications que personne ne faisait. Chaque
cible de classe `form` a maintenant son résolveur — longueur, sections, JSON valide,
convention de commit, secret dans la sortie, fichiers touchés, patch applicable —
et le verdict tombe sans juge LLM. Du code.

Les cibles de classe `state` rendent `non résolu`, jamais `satisfait` : elles portent
sur l'état du monde après exécution et demandent le banc d'essai. Les confondre avec
un succès ferait passer un agent dont on n'a vérifié que la longueur pour un agent
conforme.

### Depuis le Catalogue

`serve.js` expose deux routes, et c'est le **seul serveur du produit** :

| | |
|---|---|
| `GET /api/etat` | la plateforme est-elle configurée — pour ne pas proposer un bouton qui échouera |
| `POST /api/lancer` | exécute un artefact et rend la sortie + le verdict |

Chaque fiche a maintenant **▶ Exécuter**. On y choisit une entrée — *rejouer un cas
d'or*, qui lit la banque, ou des valeurs libres — et l'écran affiche la sortie du
modèle, le contrat évalué ligne par ligne avec ses **valeurs réelles**, et le coût.

Un artefact qui écrit garde en plus **🚚 Livrer** : le module déterministe, sans
modèle. Les deux ne font pas la même chose et ne doivent pas se confondre.

La confirmation ne se contourne pas en passant par l'API : `assume` doit valoir
exactement `true`, et le serveur refuse en 409 en nommant chaque point. Un point
d'entrée qui relâcherait les contrôles « parce qu'il est côté serveur » rendrait tout
le moment 4 décoratif — il suffirait d'appeler l'API au lieu de cliquer.

Le **prompt ne repart jamais** vers la page : il contient le spec que le catalogue
masque volontairement, et la matière injectée peut venir d'un dépôt confidentiel.

Servi en fichiers statiques — Pages, raw.githack — il n'y a pas de serveur derrière :
le bouton le dit au lieu d'échouer au clic.

### Le palier, pas le modèle

Un artefact déclare `model_tier: nano`, jamais `gemini-2.5-flash-lite`. La
correspondance vit dans `registries/models.yaml`, avec les tarifs. Trois raisons, et
la troisième est la vraie :

- un nom de modèle change tous les six mois, un palier non
- 200 artefacts portant un nom de modèle, ce sont 200 fichiers à rouvrir à chaque montée
- **surtout** : le jour où le modèle change sous le prompt, il faut pouvoir dire quels
  artefacts sont concernés et rejouer *leurs* cas d'or. C'est ce fichier qui le dit.

Le tarif vit **sous le fournisseur**, pas sous le palier. Un tarif au niveau du palier
facturerait un appel DeepSeek au prix de Gemini : un coût faux, affiché avec l'aplomb
d'un coût mesuré. Les tarifs DeepSeek sont donc **absents** — je ne les ai pas vérifiés,
et l'écran affiche « tarif inconnu », ce qui est exact. Deux nombres pris dans la
console suffisent à le remplir.

`SALSI_MODELE_MID=gemini-3-pro` force un modèle sur un palier — c'est ce qui permettra
de rejouer les cas d'or sur un modèle candidat sans toucher au catalogue.

### Les identifiants ne sont jamais dans le dépôt

Tout le reste du produit tourne dans l'onglet, avec le jeton de l'utilisateur. Pas
ça. Vertex s'authentifie avec une **clé privée RSA** qui ouvre le projet GCP entier,
pas seulement un modèle : la mettre dans une page, c'est la donner à quiconque ouvre
les outils de développement. Ce module tourne donc côté serveur, là où le CI tourne
déjà. Rien n'est lu depuis le dépôt, rien n'est journalisé, et la clé ne sort pas de
la fonction qui signe.

Zéro dépendance, comme le reste : `google-auth-library` ferait ça en trois lignes et
amènerait cinquante paquets dans un dépôt qui n'en a aucun. Signer un JWT RS256 tient
dans `node:crypto`. Le socle reste installable derrière un proxy d'entreprise sans
demander l'ouverture d'un registre npm.

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

## Héberger : un mot sur GitHub Pages

Le site est du **statique pur** — aucune construction n'est nécessaire. Le fichier
`.nojekyll` à la racine le dit explicitement : Pages copie les fichiers au lieu de les
passer à Jekyll. Un moteur de gabarit sur des fichiers qui contiennent `{{repo}}` et
`{{stack}}` est un risque gratuit, et l'étape en moins est une cause de panne en moins.

Deux sources possibles dans `Settings` → `Pages` :

- **GitHub Actions** — passe par la file de déploiement du dépôt. Quand cette file se
  bloque, l'étape *Deploy to GitHub Pages* attend puis rend `Timeout reached, aborting!`
  au bout de dix minutes. La construction, elle, réussit en quelques secondes : lire le
  journal du bon job évite de chercher un défaut dans le code qui n'y est pas.
- **Deploy from a branch** (`main` / `/ (root)`) — ne passe pas par cette file. C'est le
  repli quand la première se bloque, et il convient parfaitement ici puisqu'il n'y a rien
  à construire.

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

Derrière l'établi, le formulaire d'écriture où **les 23 règles s'exécutent à la frappe**.
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

### 🌱 Salsi — l'aide à l'écriture

Un bouton à droite de la section **Identité**. Le formulaire réclame le *résultat* de la
réflexion — titre, intention, variables, outils, critères — pas son point de départ.
Devant une page vide, on ne sait pas par où commencer, et les 23 règles n'aident pas :
elles jugent ce qui est écrit, elles n'aident pas à l'écrire.

Salsi renverse l'ordre : **quatre questions sur ce qu'on veut obtenir**, et l'artefact se
compose. Une question à la fois, avec la progression affichée — la forme du scaffolder du
hub, pour la même raison : on répond à ce qu'on sait.

**Aucun LLM, et c'est le point.** Salsi ne rédige pas, il **compose à partir des
registres**. Les outils qu'il propose existent au registre des outils, les critères aux
cibles assertables. Il ne peut donc pas inventer un outil inexistant ni une cible non
vérifiable — les deux erreurs les plus fréquentes quand on écrit à la main, celles que
`L004` et `L009` refusent.

D'où une propriété qu'un assistant génératif ne pourrait pas offrir :

> **Quel que soit le chemin suivi dans le dialogue, l'artefact produit franchit la porte.**

Elle est vérifiée **exhaustivement** : les 108 chemins (4×3×3×3) sont énumérés et passés
au linter. Viser plus haut qu'`expérimental` n'est refusé que par `L010` — le manque de cas
d'or, la seule chose que Salsi ne peut pas savoir à la place de l'auteur.

Trois refus délibérés :

- **Le titre et « à quoi ça sert » restent vides.** C'est ce que l'auteur sait et que
  Salsi ne peut pas deviner. Les remplir d'à-peu-près donnerait un artefact d'apparence
  complète que personne ne relirait.
- **Le spec est une charpente, pas un prompt fini.** Salsi y met les règles qui valent pour
  tous et interpole chaque variable déclarée ; le métier reste à écrire. Prétendre rédiger
  à la place de l'auteur demanderait un modèle, et un modèle ne garantit rien.
- **Ce qui était déjà saisi n'est pas écrasé.** Perdre un titre déjà tapé serait la pire
  des punitions pour avoir demandé de l'aide.

Et le raisonnement est **montré** : une ligne par question, qui nomme la décision, sa
conséquence et la règle concernée. Un choix qu'on ne comprend pas, on le subit — et on ne
saura pas le corriger quand le contexte changera.

### 🌱 Salsi les écrit — l'aide aux cas d'or

Le bloc le plus obscur du formulaire : quatre concepts d'un coup — contexte, attente,
`runs`, `pass_at_least` — dans un vocabulaire que personne n'a jamais vu. Et le mur n'est
pas la difficulté d'un cas, c'est d'en écrire **cinq**.

Salsi ne demande qu'une chose, en français : **quel genre de situation**.

| Situation | k/n | pourquoi |
|---|---|---|
| ✅ Le cas courant | 5/5 | le cas courant ne se rate pas |
| ⚖️ Un cas limite | 4/5 | un LLM n'est pas reproductible, un cas rare tolère un raté |
| 🚫 Un cas qui doit être **refusé** | 3/3 | et le drapeau `expects_violation` est posé tout seul |
| 🕳️ Une entrée vide | 3/3 | ne rien inventer est un comportement, pas une chance |

**Tout le reste est déjà dans l'artefact**, il suffit de ne pas le redemander : le contexte
vient des variables déclarées, l'attente des critères déclarés. Réutiliser les critères
n'est pas une facilité — c'est ce qui rend le cas **cohérent par construction**, donc
`L022` satisfaite sans y penser. Un générateur qui produirait cinq cas contredisant les
critères ferait apparaître cinq avertissements, et l'auteur conclurait que l'aide est
cassée.

Le vocabulaire disparaît aussi : on ne demande pas `expects_violation`, on demande *« ce
cas doit-il être refusé ? »*. La réponse pose le drapeau. Et pour un cas de refus, Salsi
dérive une valeur qui **viole vraiment** le critère — le marquer sans que la contradiction
soit réelle serait un mensonge, et la règle se tairait sans raison.

Deux refus assumés :

- **`matches` est écarté** de l'attente d'un cas qui doit passer. Produire une chaîne
  satisfaisant une expression régulière quelconque ne se dérive pas ; proposer le motif
  comme valeur serait faux — un motif ne se correspond pas à lui-même.
- **Les cas sont AJOUTÉS**, jamais substitués. Écraser ce qu'on avait commencé seul
  punirait celui qui a essayé avant de demander de l'aide.

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
| `registries/models.yaml` | les paliers, leur modèle réel chez chaque fournisseur, et les tarifs |
| `lib/yaml.js` · `lib/schema.js` | lecteur YAML et évaluateur JSON Schema maison, sans dépendance |
| `lint/` | les 23 règles |
| `preflight/` | les sept contrôles du moment 4 |
| `entrees/` | la banque d'entrées — de la matière réelle, rangée par nature de signal |
| `runtime/vertex.js` · `runtime/deepseek.js` · `runtime/moteur.js` | les fournisseurs, et le seul endroit qui choisit |
| `runtime/resolveurs.js` | ce qui rend `criteria` exécutable, sans juge LLM |
| `runtime/redacteur.js` · `runtime/rediger-cli.js` | la dictée : une phrase → un artefact, corrigé par le linter |
| `runtime/banc.js` · `runtime/banc-cli.js` | le banc d'essai : joue les cas d'or, dérive le niveau |
| `runtime/etat-derive.js` · `derive/etat.json` | la mémoire de la plateforme — mesurée, jamais écrite à la main |
| `studio/` | le formulaire, le pont vers l'artefact, le serveur local |
| `artifacts/` | les artefacts du registre |
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

### `L022` — une règle née de l'écran

Elle ne vient d'aucune spécification. Le jour où la fiche du Catalogue a affiché les
critères et les cas d'or l'un sous l'autre, la contradiction a sauté aux yeux sur
l'artefact de référence :

```
contrat :  output.files_touched  lte 20
gc-05   :  attend output.files_touched = 47
```

Le cas d'or décrivait une exécution que le contrat de l'artefact refuserait. Les deux
blocs vivaient dans des écrans séparés, et personne ne les avait confrontés.

**Avertissement, jamais refus.** Tester le chemin d'échec est légitime et même
souhaitable — une bonne suite vérifie ce qui doit échouer autant que ce qui doit passer.
Ce qui ne l'est pas, c'est qu'on ne sache pas si c'était voulu. La règle ne tranche donc
pas à la place de l'auteur : elle l'oblige à déclarer son intention avec
`expects_violation: true`, et se tait dès qu'il l'a fait.

Passée sur le registre, elle a trouvé **quatre** cas dans `prep-delivery` — branche non
mergeable, vulnérabilité critique, pipeline en échec, volume excessif. Tous délibérés,
aucun déclaré. Ils le sont désormais, et l'artefact dit ce qu'il teste.

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

## Le pré-vol — moment 4

Depuis la fiche du Catalogue, un bouton **🛫 Pré-vol** répond à la seule question qui
intéresse vraiment celui qui trouve une capacité : *puis-je m'en servir **sur mon
dépôt** ?*

### Ce qui le distingue du lint

Tout ce qui précède juge l'artefact **seul** : sa forme, ses outils, ses critères. Le
pré-vol est le premier moment où le **déclaré rencontre le réel** — un dépôt précis, un
utilisateur précis, des valeurs précises, à un instant précis.

D'où la règle de partage, qui n'est pas une convention mais un test : **un contrôle
appartient au pré-vol si et seulement s'il a besoin du contexte d'exécution**. Sinon il
appartient au lint, où il coûte moins cher et prévient plus tôt. Un contrôle mal placé est
soit impossible — le lint ne connaît pas le dépôt cible — soit tardif : le pré-vol arrive
après que l'auteur a fini d'écrire.

### Les sept contrôles

| Code | Contrôle | |
|---|---|---|
| `P001` | L'artefact franchit **encore** la porte — les règles évoluent | 🔴 |
| `P002` | Sensibilité du dépôt sous le plafond déclaré | 🔴 |
| `P003` | Variables requises résolues | 🔴 |
| `P004` | Outils autorisés pour le périmètre du **dépôt cible** | 🔴 |
| `P005` | Certification présente et valide pour le modèle courant | 🔴 contextuel |
| `P006` | Niveau suffisant pour la criticité | 🔴 |
| `P007` | Écriture : confirmation humaine requise | 🟡 |

Quatre décisions qui portent le sens de l'ensemble :

**`P002` — le silence n'est pas une permission.** Faute de plafond déclaré, `interne` est
retenu. Traiter l'absence comme un blanc-seing ferait de l'oubli le chemin le plus
permissif : un auteur pressé accéderait au confidentiel en ne remplissant rien, et la
déclaration deviendrait une formalité pour les consciencieux. Un dépôt **non classé** est
refusé, pas toléré — c'est la classification qui manque, pas l'artefact.

**`P004` — le droit suit la cible, pas le porteur.** `L006` vérifie le périmètre déclaré
de l'*owner* ; `P004` vérifie celui du dépôt qu'on s'apprête à toucher. Un agent de
Plateforme lancé sur un dépôt Data ne doit pas emporter ses outils Plateforme avec lui. Un
test vérifie que le même artefact **franchit la porte du lint sans problème** — c'est la
preuve que le contrôle est à sa place et nulle part ailleurs.

**`P006` — une intention n'est pas un acquis.** Le niveau *atteint* est dérivé, il se
mérite sur preuve de banc d'essai. Faute d'état dérivé joignable, le pré-vol retombe sur
le niveau *visé* et **le dit** au lieu de faire passer l'un pour l'autre.

**`P007` — la confirmation n'est pas un refus.** C'est une *condition de départ* :
`confirmationRequise` est distinct de `bloque`. Les confondre ferait lire « il faut
valider » comme « c'est interdit ». C'est « l'humain valide » transformé en contrainte du
système plutôt qu'en discipline de l'appelant.

Zéro IA, comme la porte : verdict déterministe, reproductible, explicable — et rendu
**avant** le premier jeton dépensé.

### La limite, dite dans l'écran

La sensibilité et le périmètre se saisissent à la main parce qu'aucun référentiel n'est
branché. En production ils viendraient du référentiel des dépôts : c'est ce qui rendrait
le contrôle **opposable** au lieu de déclaratif. L'écran l'écrit noir sur blanc, pour que
personne ne prenne la maquette pour le contrôle.

## ▶ Lancer — l'exécution (moment 5)

Depuis la fiche d'une capacité, **▶ Lancer** exécute pour de vrai : bump de `IMAGE_TAG`,
synchronisation des overlays Kustomize, commit atomique, merge request.

Le bouton n'apparaît **que sur ce qui sait faire quelque chose**. Le registre déclare des
outils dont l'implémentation reste à écrire (`run_tests`, `scan_vulnerabilities`) ; les
présenter comme disponibles ferait apparaître un bouton qui échouerait à l'usage.

### Deux temps, et la séparation est la garantie

| | ce qui se passe | état du dépôt |
|---|---|---|
| **Préparer** | lit la CI, découvre les overlays, calcule le plan | **intact** |
| **Confirmer et livrer** | commit atomique + merge request | modifié |

Le second bouton **n'existe qu'une fois le plan affiché**. On ne peut donc pas livrer sans
avoir lu ce qu'on livre : ce n'est pas une politesse d'interface, c'est la confirmation
qu'exige `P007`, rendue impossible à sauter.

### Ce que la reprise du hub a changé

La logique vient du module `livraison` du hub DevOps — même règle de bump, même motif
`IMAGE_TAG`, même réécriture d'overlays. Une différence compte : ici elle est **pure**.
`runtime/livraison.js` calcule un plan et n'écrit rien ; `runtime/executer.js` orchestre.
L'original mélange calcul et appels réseau, et n'est donc testable qu'à la main sur un
vrai dépôt. Ici, 33 tests couvrent chaque règle hors navigateur.

Un garde de l'original n'a pas été repris. Le « rien à modifier » y est utile parce que la
version courante vient d'un état d'écran qui peut avoir vieilli ; ici elle est lue dans le
contenu qu'on réécrit, à l'instant, donc la cible diffère toujours de la courante. Un
garde inatteignable fait croire à une protection.

### Trois décisions qui portent le risque

**Le commit est atomique.** GitLab prend un tableau d'actions et fait un seul commit.
Bumper la CI sans les overlays laisserait le dépôt incohérent, et il n'y aurait rien à
annuler d'un bloc.

**Les overlays sont découverts, jamais supposés.** Une liste en dur vieillirait au premier
overlay ajouté par une équipe, et l'agent en laisserait un derrière — incohérence qui ne
se voit qu'au déploiement.

**Une merge request refusée ne fait pas passer le commit pour un échec.** Le cas fréquent
est qu'une MR existe déjà pour ce couple de branches : le travail utile a eu lieu, et le
cacher enverrait l'auteur relancer une livraison déjà faite.

### `executor: module` désigne enfin du code

L'artefact déclare depuis le premier jour `bump_image_tag / write / module`. Il ne manquait
pas une décision d'architecture, il manquait le module derrière l'identifiant. L'invariant
`L005` cesse d'être une promesse : l'écriture est faite par ce code, pas par un modèle. La
description de la merge request le dit au relecteur, parce que ça change la nature de sa
revue — il relit un calcul, pas une proposition.

### GitLab est la cible, GitHub le dit

`commitFiles` et `createMergeRequest` sont implémentés sur GitLab. Sur GitHub, ils lèvent
une erreur 501 explicite : un commit multi-fichiers y demande de reconstruire un arbre git
à la main, du code non trivial pour une opération que personne n'exécutera sur cette
forge. Mieux vaut une erreur qui dit la vérité qu'une implémentation à moitié. La
**préparation**, elle, fonctionne partout — on peut voir le plan sans pouvoir l'écrire.

## ✨ La dictée — une phrase, un artefact

C'est la phrase du dépôt, appliquée au dépôt :

> « L'IA traduit l'intention, le noyau gouverne, l'humain valide. »

```
npm run rediger -- "un agent qui relit une requête SQL lente et propose un index"
npm run rediger -- "…" --scope=Data --auteur=ivguenyp123 --ecrire
```

…ou, au Studio, le bouton **« ✨ Décris-le en une phrase »**.

### Les trois termes, un par un

**L'IA traduit.** Une phrase en français devient un artefact YAML complet — titre,
intention, spec, variables, outils, critères, cas d'or. La consigne envoyée au modèle est
**assemblée à partir du référentiel** : les outils disponibles sortent de
`registries/tools.yaml`, les cibles de `targets.yaml`, les entrées de `entrees/index.yaml`.
Rien n'est écrit en dur dans le rédacteur — le jour où un outil est ajouté au registre,
il le connaît, et il ne peut pas proposer un outil retiré.

**Le noyau gouverne.** Le brouillon passe au linter. S'il est bloqué, **les constats
repartent au modèle comme travail à faire** — avec leurs codes, leurs chemins et son
propre YAML, pour qu'il corrige au lieu de recommencer :

```
✕ tour 1  3 refus, renvoyés au modèle
      🔴 L001  Schéma : propriété obligatoire manquante (`criteria`)
      🔴 L004  Outil inconnu : `read_the_whole_internet` n'existe pas au registre
      🔴 L008  Aucun critère : l'artefact n'est pas vérifiable au post-vol
✔ tour 2  conforme
```

Trois tours au maximum. La porte ne s'assouplit jamais : c'est le brouillon qui s'y plie.
C'est la seule raison pour laquelle on peut laisser un LLM écrire dans un registre
gouverné — et le journal des tours est **montré à l'écran**, pas caché. Un rédacteur qui
ne montrerait que son résultat final demanderait qu'on lui fasse confiance ; c'est
exactement ce que ce produit refuse.

**L'humain valide.** Le brouillon atterrit dans le **formulaire du Studio**, pas dans la
file. C'est l'auteur qui relit, corrige, et clique sur « Soumettre à validation » — le
même bouton, le même commit, le même passage par `artifacts/pending/` qu'un artefact tapé
à la main. `POST /api/rediger` n'écrit rien : un rédacteur qui pousserait directement
dans la file de validation en ferait une formalité pour machines.

### Ce que le modèle n'a pas le droit de décider

| | pourquoi |
|---|---|
| `owner.person` | c'est la personne connectée. Un artefact **engage** quelqu'un ; une machine ne désigne pas un responsable |
| `target_level` | plafonné à `équipe`. Un niveau est un engagement, et `officiel` se **dérive** du banc d'essai |
| `derived` | jamais écrit. `L015` le refuserait — mieux vaut ne pas produire ce qu'on devrait effacer |
| `id` | réparé s'il n'est pas conforme au schéma : c'est une clé de fichier et d'URL, la seule valeur qu'on ne peut pas corriger après coup |

Et le fichier déposé est **re-sérialisé depuis l'artefact normalisé**, jamais recopié du
texte du modèle. Piège vécu en écrivant le module : la normalisation agit sur l'objet, si
bien qu'écrire le YAML brut aurait déposé un fichier dont l'auteur n'est pas celui qu'on a
linté. Un test d'aller-retour tient les deux ensemble.

### Ce que ça ne dit pas

« Conforme » veut dire *la forme est vérifiée* — et rien d'autre. **Aucun cas d'or n'a été
joué** : ce que l'agent fait vraiment reste une hypothèse jusqu'au banc d'essai. L'écran le
dit en toutes lettres, pour la même raison que la pastille « officiel — visé » existe :
présenter une intention comme un acquis est la seule faute que ce produit ne peut pas se
permettre.

### Dictée ou Salsi ?

Les deux boutons sont côte à côte, et ils ne promettent pas la même chose.

| | 🌱 Salsi | ✨ La dictée |
|---|---|---|
| comment | quatre questions, composition depuis le registre | une phrase, un modèle |
| LLM | aucun | oui, jusqu'à 3 appels |
| garantie | **tout chemin produit un artefact conforme** (vérifié exhaustivement) | aucune *a priori* — d'où la boucle |
| le spec | une charpente ; le métier reste à écrire | écrit, à relire |
| hors ligne | oui | non : il faut `npm start` |

Salsi ne peut pas se tromper de registre mais ne sait pas écrire ton métier. La dictée
écrit le métier et peut se tromper — alors on la fait juger. Aucune des deux ne remplace
l'autre.

## Le banc d'essai — où un niveau se mérite

`target_level: officiel` est une ligne que l'auteur écrit. Le Catalogue l'affichait
« officiel — visé », en pointillés, parce que **rien ne l'avait mesuré**. Les cas d'or
étaient dans le même état : `L010` les compte, `L017` vérifie qu'ils assertent quelque
chose, `L023` qu'ils jouent sur une entrée qui existe — et personne ne les jouait jamais.
Trois règles pour garder des tests que rien n'exécute : le défaut classique de la
gouvernance de papier, reproduit à l'intérieur de l'outil censé la remplacer.

Le banc les joue.

```
npm run banc -- expliquer-un-code                 # le PLAN, sans rien dépenser
npm run banc -- expliquer-un-code --go            # le passage, et l'état dérivé
npm run banc -- expliquer-un-code --runs=1 --go   # un tour par cas, pour voir
npm run banc -- --tout                            # le plan du catalogue entier
```

**Sans `--go`, il n'appelle rien.** C'est la seule commande du dépôt qui dépense en
boucle : cinq cas d'or à cinq exécutions font vingt-cinq appels pour un artefact, et le
catalogue entier en demande 262. Le compte s'affiche avant, avec une estimation de coût
annoncée comme grossière. Découvrir la facture après n'est pas une option dans un produit
qui se vend sur le FinOps.

### Ce qu'il produit, et rien d'autre

| | d'où ça vient |
|---|---|
| `level` | le nombre de cas d'or qui **passent**, contre les seuils de `L010` |
| `certification` | la preuve datée, attachée au **modèle** qui a répondu |

Les deux atterrissent dans `derive/etat.json`, que le Catalogue, l'Admin et le pré-vol
lisent. `L010` compte les cas **déclarés** pour autoriser une ambition ; le banc compte
ceux qui **tiennent**. Même barème, appliqué à la preuve au lieu de l'intention.

Deux garde-fous sur la dérivation :

- le niveau **visé plafonne** le niveau atteint — un artefact qui vise `équipe` n'est pas
  promu `officiel` dans le dos de son auteur ; le niveau l'engage
- un seul cas en échec **interdit `officiel`** — c'est le niveau qui ouvre la production,
  le décerner en sachant qu'un scénario déclaré casse serait exactement le mensonge que la
  pastille « visé » avait été inventée pour éviter

Et la certification n'est décernée qu'à un passage **complet et sans échec**. Un cas non
concluant — attente non résolue, appel sans réponse — la refuse aussi : ce n'est pas un
échec de l'agent, c'est un « on ne sait pas », donc pas une preuve.

### `expect: { output.length: 900 }` — ce que « 900 » veut dire

Une attente de cas d'or porte une valeur et pas d'opérateur. Il a fallu décider, et
surtout ne pas l'inventer : **l'opérateur implicite est le premier que le registre des
cibles déclare pour cette cible**. Sur `output.length`, `ops` commence par `lte` — « la
sortie tient en 900 caractères », ce que voulaient dire tous les cas écrits jusqu'ici. Sur
`output.contains_secret`, `ops: [eq]` — égalité stricte. Ce n'est donc pas une convention
du banc, c'est une lecture du référentiel, et réordonner `ops` est une modification de
contrat. Un auteur qui veut autre chose l'écrit : `output.length: { op: gte, value: 300 }`.

### Un LLM n'est pas reproductible

D'où `runs` / `pass_at_least`, imposés par `L017` : un cas joué une fois est un tirage,
pas une porte. Le banc joue *k* fois et compare au seuil **déclaré par l'auteur** — il ne
le choisit pas, il l'applique. Sans `pass_at_least`, le seuil implicite est *toutes* : le
plus strict, parce que choisir le plus permissif transformerait l'oubli que `L017` signale
en cadeau.

Un appel qui n'aboutit pas n'est **pas** compté comme un échec de l'agent. Sinon un niveau
chuterait sur une coupure réseau. C'est une mesure qui n'a pas eu lieu, et ça se dit
autrement — la même distinction que « non résolu » au post-vol.

### Le desserrage du pré-vol était une promesse. Elle est tenue.

`P005` et `P006` ont été desserrés — confirmation humaine au lieu de refus — sur un
argument : tant qu'aucun banc ne tourne, **aucun** artefact ne peut être certifié, et
refuser là-dessus reviendrait à interdire la production à tout le catalogue au nom d'un
outil qui n'existe pas. La contrepartie était écrite dans le code : *le jour où le banc
mesure un niveau, le refus revient tout seul, sans toucher au code.*

Il revient. `runtime/api.js` passe désormais `derive` au contexte du pré-vol, et le même
constat bascule :

| état | `P006` en production |
|---|---|
| aucune mesure | 🟡 confirmation — quelqu'un assume |
| niveau mesuré insuffisant | 🔴 refus — « ce niveau a été MESURÉ » |
| niveau mesuré suffisant | rien à dire |

Aucune ligne de `preflight/index.js` n'a changé pour ça. Quatre tests dans
`test/api.test.js` vérifient la bascule sur le **même** artefact et la **même** requête.

### Ce qu'il ne fait pas

Il ne résout pas les cibles de classe `state` — `pipeline.status`, `tests.passed`,
`branch.mergeable`. Elles portent sur l'état du monde après exécution : il leur faut un
dépôt jetable, une CI isolée, un reset entre deux passages. Le banc les compte **non
résolues**, et un cas qui n'en asserte que de celles-là ne peut pas être certifié. Les
compter comme satisfaites ferait certifier un agent sur des vérifications qui n'ont pas eu
lieu — la faute exacte que ce dépôt existe pour empêcher.

`derive/etat.json` ne conserve **ni sortie de modèle ni prompt rendu**. Une sortie peut
contenir ce qu'on lui a donné à lire — un extrait de dépôt, un journal de pipeline. On
garde le verdict, pas la matière.

## Ce que ce socle ne fait pas encore

Le lint est la **couche 1** du moment 2. Restent à construire, dans l'ordre du document :

- le **banc d'essai sur cibles `state`** — le banc joue les cas d'or et dérive le niveau,
  mais seulement sur les cibles de classe `form`. `pipeline.status` et `tests.passed`
  demandent des dépôts fixtures, une CI isolée et un reset entre exécutions : c'est ce qui
  reste le plus cher de la vague 2
- l'**écriture** (moment 5, second temps) — `lancer()` n'appelle aucun outil `mode: write` ;
  un artefact qui déclare `bump_image_tag` voit sa sortie évaluée, rien n'est écrit
- la **capture d'outcome** (moment 7), qui rend toutes les métriques défendables
- le **référentiel des dépôts**, sans lequel `P002` et `P004` restent déclaratifs
