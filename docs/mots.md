# Les mots du produit

Les termes qui reviennent sur tous les écrans, dans l'ordre où on les rencontre.

## Artefact

Le fichier qui décrit une capacité : ce qu'elle fait, ce qu'elle réclame, ce qu'on vérifie
sur sa sortie. C'est l'unité de tout le registre.

Deux formes : un **prompt** (une capacité seule) ou une **chaîne** (plusieurs prompts qui
se passent leur résultat).

Le mot ne s'affiche presque jamais à l'écran — vous y lirez « agent ». C'est le même
objet.

## Spec / consigne

Le texte envoyé au modèle. Ce n'est ni une documentation ni une description : c'est
littéralement ce que le modèle lit.

D'où plusieurs règles qui paraissent tatillonnes et ne le sont pas : un `TODO` dans un
spec part au modèle à chaque exécution.

## Variable, entrée

Ce que l'agent réclame pour tourner. Elle apparaît dans la consigne sous la forme
`{{nom}}` et se remplit au lancement.

Chaque variable a une **source** qui dit d'où la valeur vient : une saisie, une
métadonnée du dépôt, un fichier de la banque de cas.

## Critère

Ce qui sera vérifié **sur la sortie**, à chaque exécution, **par du code**. Pas par un
modèle, pas par un humain.

`output.length lte 2500`. `output.contains_secret eq false`. `output.sections exists true`.

Un critère peut porter sur deux natures de chose :

- **`form`** — la forme de la sortie. Évaluable tout de suite, à chaque exécution ;
- **`state`** — l'état du monde après exécution. Demande le banc d'essai ; en attendant, il
  rend **non résolu**, jamais *satisfait*.

## Cas d'or

Un exemple de référence : des entrées, et ce qu'on attend en sortie. C'est ce que le banc
d'essai rejoue pour dériver le niveau.

Le nombre exigé dépend du niveau visé : 0 / 3 / 5.

## Palier de modèle (`model_tier`)

`nano`, `small`, `mid`, `large`. Un agent déclare un palier, **jamais un nom de modèle**,
**jamais un fournisseur**.

C'est le registre des modèles qui dit qui répond pour chaque palier, chez chaque
fournisseur. Voir [Niveaux et certification](niveaux.md).

## Niveau visé / niveau atteint

**Visé** : l'auteur l'a écrit. Une intention. Pastille en pointillés.
**Atteint** : le banc l'a mesuré. Un acquis. Pastille pleine.

Trois valeurs : *expérimental*, *équipe*, *officiel*.

Ne jamais lire l'une pour l'autre. C'est la confusion que tout l'affichage du produit
cherche à empêcher.

## Certification

Le lien entre **un agent**, **un modèle** et **une date**. Valable 90 jours, parce que le
modèle bouge sous le prompt.

## Périmètre (`scope`)

L'équipe pour laquelle l'agent est écrit — Data, Plateforme, Sécurité…

Il sert deux fois, et ce n'est pas la même question :

- à l'écriture, il dit quels outils l'agent a le droit de déclarer (`L006`) ;
- au lancement, c'est le périmètre du **dépôt visé** qui décide (`P004`). **Le droit suit
  la cible, pas le porteur.**

## Sensibilité

Le classement d'un dépôt — `public`, `interne`, `confidentiel`, `secret`. Un agent déclare
la sensibilité **maximale** qu'il a le droit de lire ; `P002` compare au dépôt visé.

Elle vient du **référentiel des dépôts** (`registries/repos.yaml`) quand il connaît le
dépôt — auquel cas elle n'est plus modifiable à l'écran. Sinon elle se saisit, et le
contrôle demande confirmation plutôt que de refuser : il ne peut pas opposer une valeur
que la personne contrôlée lui a fournie.

## Outil, mode, exécuteur

Un **outil** est ce que l'agent a le droit de faire au-delà de produire du texte : lire des
métadonnées, ouvrir une merge request.

Le **mode** dit `read` ou `write`. L'**exécuteur** dit qui l'exécute : `llm` ou `module`.

Et l'invariant qui tient tout le produit :

> **`mode: write` ⟹ `executor: module`.**
> Le LLM ne tient jamais la plume sur un système. Il propose, un module déterministe
> applique.

## Pré-vol / post-vol

**Pré-vol** : les contrôles avant l'appel, avant le premier jeton dépensé.
**Post-vol** : l'évaluation des critères sur la sortie réelle, après.

## La porte

L'ensemble des 25 règles automatiques qu'un artefact doit franchir. « La porte est
franchie » veut dire : aucune règle bloquante n'a de constat.

La porte vérifie **la forme**. Le fond, c'est [le validateur](valider.md).

## État dérivé

Ce que la plateforme a **constaté**, par opposition à ce que les auteurs ont **déclaré** :
niveaux mesurés, certifications, dernières exécutions.

Il vit dans un fichier à part, jamais dans l'artefact. Un auteur ne peut pas s'auto-décerner
un niveau en éditant son propre fichier.

Il ne contient **jamais** de sortie de modèle ni de prompt.

## Chaîne

Une suite d'agents validés qui se passent leur résultat. Elle ne contient aucun texte neuf.

D'où la règle qui rend le produit vivable : **une chaîne hérite de la validation de ses
briques.** Voir [Composer](composer.md).

## Provenance

Les quelques lignes en tête d'un fichier qui disent d'où il vient : `demande` (quelqu'un
l'a demandé en une phrase), `dictee`, `composition`, `fork`.

Elle décrit l'origine du fichier, pas ce que la capacité fait. Deux agents identiques,
l'un écrit à la main et l'autre demandé, sont la même capacité.
