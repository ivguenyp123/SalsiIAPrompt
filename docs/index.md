# Guide d'utilisation

Bienvenue. SalsiIAPrompt est le registre des agents IA de la banque : on y **trouve** un
agent déjà validé, on en **demande** un qui n'existe pas encore, on en **assemble** en
chaînes, et quelqu'un les **valide** avant qu'ils servent à tout le monde.

Ce guide s'adresse à ceux qui s'en servent, pas à ceux qui le développent. Aucune ligne
de code n'est nécessaire pour tout ce qui suit.

## La phrase à retenir

> **L'IA traduit l'intention, le noyau gouverne, l'humain valide.**

Concrètement, et c'est ce qui explique la moitié des comportements du produit :

- **le code décide**, pas le modèle. Ce qui refuse votre agent est une règle écrite, la
  même pour tout le monde, qui vous dit laquelle et pourquoi ;
- **le modèle rédige et conseille**, il ne valide jamais rien. Aucun écran ne vous
  refusera quoi que ce soit parce qu'« une IA a estimé que » ;
- **un humain tranche** avant qu'un agent devienne visible de tous.

## Par où commencer

**Vous avez un besoin, pas un agent.** → [Demander un agent](demander.md)
Vous écrivez ce que vous voulez obtenir en une phrase. Le reste est fabriqué pour vous et
part en validation.

**Vous cherchez ce qui existe déjà.** → [Trouver et lancer un agent](catalogue.md)
Le catalogue, sa recherche, ses étiquettes, et comment lancer un agent sur votre dépôt.

**Vous voulez enchaîner plusieurs agents.** → [Composer une chaîne](composer.md)
Prendre deux ou trois agents validés et les faire se passer le résultat. Sans écrire un
seul prompt.

**Vous validez ce que les équipes soumettent.** → [Valider](valider.md)
La file d'attente, ce qu'il faut regarder, et le bouton qui demande à un modèle de
chercher les contradictions.

**Vous voulez comprendre les pastilles de niveau.** → [Niveaux et certification](niveaux.md)
Visé contre atteint, le banc d'essai, et pourquoi une certification expire.

**Vous ne comprenez pas un mot de l'écran.** → [Les mots du produit](mots.md)
Palier, niveau visé, certification, cas d'or, périmètre. Cinq minutes.

**Ça refuse et vous ne savez pas quoi faire.** → [Quand ça refuse](refus.md)
Le catalogue complet des refus, les 32 codes un par un, avec la manœuvre à faire.

## Les deux choses à savoir avant tout le reste

### 1. Ce qui est *déclaré* n'est pas ce qui est *mesuré*

C'est la distinction qui traverse tous les écrans. Un auteur **déclare** ce qu'il vise ;
la plateforme **dérive** ce qui a été constaté.

Une pastille **en pointillés** dit « visé, jamais mesuré ». Une pastille **pleine** dit
« atteint, au banc d'essai ». Les deux se ressemblent volontairement peu, parce que la
confusion entre les deux est exactement ce qui fait prendre un agent jamais testé pour un
agent éprouvé.

À ce jour, **le banc d'essai n'a encore rien mesuré sur ce registre** : tous les niveaux
que vous voyez sont donc des niveaux visés. La plateforme le dit elle-même sur chaque
pastille plutôt que de laisser croire le contraire.

### 2. Le dossier porte l'état

Il n'y a pas de champ « statut » qu'on pourrait oublier de mettre à jour. L'endroit où
vit le fichier **est** son état :

| Où | Ce que ça veut dire |
|---|---|
| `artifacts/pending/` | en attente d'une décision humaine, invisible au catalogue |
| `artifacts/` | actif, visible de tous, utilisable |
| `artifacts/retires/` | retiré du service, conservé pour l'historique |
| `mes-chaines/<vous>/` | votre chaîne personnelle, que personne d'autre ne voit |

Déplacer le fichier, c'est changer l'état. Rien d'autre à faire.
