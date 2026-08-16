# Demander un agent

**Pour qui** : vous avez un besoin et vous ne savez pas — et n'avez pas à savoir — ce
qu'est un artefact, une variable ou un critère.

**Où** : onglet **✨ Demander**.

## Ce que vous faites

Un champ. Vous écrivez ce que vous voudriez obtenir, comme vous le diriez à un collègue.

> *« je veux savoir quelles branches de mon dépôt sont mortes depuis six mois, avec qui
> les a créées »*

Vous choisissez votre **périmètre** (l'équipe pour laquelle l'agent est écrit), et vous
envoyez. C'est tout.

Si vous manquez d'inspiration, le catalogue des besoins juste en dessous liste tout ce
que la plateforme DevOps sait déjà faire — 135 capacités, rangées par famille. Cliquer
sur une ligne remplit le champ à votre place.

## Ce qui se passe ensuite

1. **un modèle rédige** l'agent : son titre, sa consigne, ses entrées, ses critères de
   vérification, ses cas de test. Il traduit votre phrase, il ne décide de rien ;
2. **les règles passent dessus** — les mêmes 25 que pour un agent écrit à la main. Si
   quelque chose ne va pas, la rédaction est refaite, pas rafistolée ;
3. **le fichier est déposé** dans la file de validation ;
4. **un humain valide** — et l'agent apparaît au catalogue.

Vous voyez le déroulé en direct, étape par étape.

## Ce que vous devez savoir

**Votre phrase est conservée.** Elle est écrite en tête du fichier produit, avec votre
nom et la date. Ce n'est pas de la traçabilité pour la traçabilité : le jour où quelqu'un
se demande pourquoi cet agent existe, la réponse est en haut du fichier.

**Vous n'êtes pas le validateur.** Votre demande part en file d'attente ; quelqu'un
d'autre la relit. C'est volontaire — un registre où l'on valide ses propres demandes n'est
pas un registre.

**Vous pouvez demander deux fois la même chose.** Une règle (`L015`) signale les doublons
au validateur, avec le pourcentage de ressemblance. Ce n'est pas un refus : deux agents
proches mais distincts, ça existe. C'est un humain qui tranche.

**Le résultat n'est pas garanti au premier coup.** Un modèle qui traduit une phrase floue
produit un agent flou. Si le retour ne correspond pas, redemandez en précisant — c'est
plus rapide que de corriger.

## Écrire une bonne demande

Ce qui change tout, dans l'ordre d'importance :

**Dites ce que vous voulez EN SORTIE.** « analyser mes dépendances » ne dit rien ;
« la liste des dépendances non mises à jour depuis un an, avec le risque de sécurité
connu pour chacune » se traduit tout seul.

**Dites sur quoi ça porte.** Un dépôt ? Un rapport ? Un log collé à la main ? La
plateforme doit savoir d'où vient la matière.

**Dites ce que ça ne doit PAS faire.** « sans toucher aux fichiers », « sans proposer de
migration », « lecture seule ». Ça devient le `not_for` de l'agent, et ça évite qu'on
l'utilise un jour pour ce qu'il ne sait pas faire.

**N'écrivez pas le prompt.** C'est le travail de la plateforme. Si vous écrivez « tu es
un expert en… », vous vous donnez du mal pour un résultat moins bon : vous perdez les
critères, les cas de test et les entrées déclarées, que le modèle sait générer et vous
non.
