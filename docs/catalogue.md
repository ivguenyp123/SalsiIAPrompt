# Trouver et lancer un agent

**Où** : onglet **🧰 Les agents**.

Le catalogue montre les agents **validés** — plus **les vôtres**. Ce qui attend une
décision est dans l'Admin ; ce qui a été retiré n'y est plus.

Deux provenances, et elles ne se valent pas :

- **sans badge** : validé. Quelqu'un l'a relu et en répond ;
- **badge 💾 à moi** : sauvé par vous dans `mes-agents/` ou `mes-chaines/`. **Personne ne
  l'a relu**, et personne d'autre ne le voit. Le filtre **💾 Les miens** ne montre que
  ceux-là.

Les vôtres se lancent exactement comme les autres — mêmes contrôles, même pré-vol, même
évaluation du contrat. Être à vous ne donne aucun privilège.

## Trouver

### La recherche

Elle répond pendant que vous tapez, et elle cherche partout : le titre, l'intention, les
étiquettes, les entrées de l'agent, jusqu'aux cibles de ses critères. Taper `secret`
remonte l'agent qui vérifie qu'aucun secret ne sort, même si le mot n'est ni dans son
titre ni dans sa description.

Trois choses à savoir :

- **tous les mots doivent correspondre.** `code sql` rend moins de résultats que `code`.
  Ajouter un mot resserre, toujours ;
- **les accents et la casse ne comptent pas.** `REQUÊTE` et `requete` donnent la même
  chose ;
- **le classement est expliqué.** Chaque résultat dit par quel champ il a été trouvé —
  « le titre », « les étiquettes ». Un ordre inattendu cesse d'être suspect quand on
  voit d'où il vient.

### Les étiquettes

Sous la recherche, les étiquettes du registre, les plus portées en tête, avec leur
nombre. Elles **se cumulent** : chaque étiquette cliquée resserre. Elles se combinent
aussi avec la recherche — `sql` + l'étiquette `performance` est une requête parfaitement
normale.

### La visite guidée

Au premier passage, un tour de cinq étapes montre les endroits qu'on ne devine pas, dont
la distinction entre niveau visé et niveau atteint. Il ne se rejoue pas tout seul ; il se
relance depuis le lien en haut de l'écran.

## Lire une fiche

Ce qu'il faut regarder, dans l'ordre :

**À quoi ça sert / Quand ne pas l'utiliser.** Le second compte plus que le premier. Un
agent qui lit une requête SQL ne connaît ni votre volumétrie ni vos usages ; c'est écrit,
et c'est ce qui vous évite de lui faire dire ce qu'il ne peut pas savoir.

**La pastille de niveau.** En pointillés = *visé*, personne ne l'a mesuré. Pleine =
*atteint*, au banc d'essai. Voir [Niveaux et certification](niveaux.md).

**Les entrées.** Ce que l'agent réclame pour tourner : un dépôt, un fichier, un texte que
vous collez. Une entrée manquante est un refus au lancement, pas une erreur en cours de
route.

**Les critères.** Ce qui sera vérifié sur la sortie, à chaque exécution, par du code.
« moins de 2500 caractères », « aucun secret dans la sortie », « du JSON valide ». Ce
n'est pas décoratif : si la sortie viole un critère, elle vous est rendue avec la
violation affichée.

**Les cas d'or.** Les exemples de référence, avec le résultat attendu. C'est ce que le
banc d'essai rejouera.

## Lancer

Le bouton **Lancer** ouvre l'écran d'exécution.

### Où va-t-il chercher la matière ?

Trois sources, et c'est vous qui choisissez :

| Source | Quand |
|---|---|
| **Un fichier du dépôt** | vous savez ce que vous voulez faire relire |
| **Une pull request ouverte** | vous voulez faire relire ce que vous venez de changer |
| **Coller** | la matière ne vient pas d'un dépôt (un log, une trace, un extrait) |

La plateforme devine la source la plus probable d'après ce que l'agent demande — un
agent qui parle de `diff` propose les PR ouvertes, un agent qui parle de `code` propose
les fichiers — mais la proposition n'est jamais imposée. Vous pouvez toujours en changer,
et modifier le contenu récupéré avant de lancer.

### Ce qui se passe au clic

1. **le pré-vol tranche** — avant le premier jeton dépensé. Refuser après aurait coûté
   le prix de l'appel *et* laissé partir votre code au modèle ;
2. **une confirmation** si l'agent écrit quelque part. Un agent en lecture seule part
   directement ;
3. **le modèle répond**, au palier déclaré par l'agent ;
4. **le post-vol vérifie les critères** sur la sortie réelle.

Le fournisseur et le modèle exact qui ont répondu sont affichés. Toujours. Dans un
registre gouverné, « quel modèle a répondu » est la moitié de ce qu'un auditeur
demandera.

### Si ça refuse

Le refus porte un code et une phrase. Voir [Quand ça refuse](refus.md) — chaque code y a
sa manœuvre.

Un point qui surprend au début : un contrôle **refuse ce qu'il sait, il demande ce qu'il
ignore**. Si le référentiel ne sait pas encore classer votre dépôt, vous aurez un
avertissement (« je ne sais pas, confirmez ») et non un refus. Le jour où le référentiel
le sait, le même contrôle refuse — sans qu'une ligne de code ait changé.
