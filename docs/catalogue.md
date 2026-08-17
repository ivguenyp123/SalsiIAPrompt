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

## 💾 Mes agents — lancer ce que vous avez monté

**Où** : onglet **💾 Mes agents**.

C'est **le même écran**, ouvert sur le filtre « les miens ». Pas un second catalogue : un
catalogue dupliqué aurait divergé du premier au premier correctif, et il aurait fallu
corriger le lancement, l'export et le pré-vol à deux endroits.

Ce qu'on y trouve : ce que vous avez assemblé dans **🧩 Fabriquer** puis enregistré avec
**💾 Sauver chez moi**. Le fichier part dans `mes-agents/<vous>/`.

**Rien ne passe par l'Admin, et c'est délibéré.** Ce qui déclenche une validation, ce n'est
pas d'écrire du texte neuf — sinon noter un prompt dans un carnet demanderait une revue.
C'est **d'engager les autres**. Sauver chez vous n'engage personne :

- l'agent n'apparaît **pas au catalogue** des autres ;
- il ne peut **pas servir de brique** à une suite — `L024` exige le registre ;
- il ne déclare **aucun outil** ;
- il a franchi **les 27 règles** avant que le bouton s'active ;
- et **le pré-vol tourne quand même** à chaque lancement.

Le jour où vous voulez qu'il serve aux autres, le bouton **📮 Partager** l'envoie en
validation. Là, quelqu'un le relit — parce que là, il engage.

Depuis Fabriquer, le lien **▶ Le lancer** apparaît juste après l'enregistrement et ouvre
directement sa fiche : pas besoin de venir le chercher dans une liste.

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

### Les agents qui ne demandent rien

Certains agents n'ont **aucun champ à remplir**. Vous choisissez un dépôt dans la liste, et
c'est tout : la plateforme lit la forge et calcule elle-même ce dont l'agent a besoin.

| L'agent | Ce que la plateforme calcule pour lui |
|---|---|
| **Bus factor et plan d'action** | qui contribue, et sur quelles zones |
| **Vérification des branches mortes** | l'âge de chaque branche, les protégées mises à part |
| **Secrets exposés** | les fichiers à risque, confrontés à 24 motifs de secret |
| **Chaîne d'approvisionnement** | les manifestes : versions non figées, scripts d'installation |
| **Conformité CIS** | les contrôles du référentiel, leurs poids, et le verdict |
| **Revue de sécurité du dépôt** | les trois précédents, d'un coup |
| **DORA — vos quatre métriques et le plan** | fréquence, lead time, taux d'échec, rétablissement |
| **DORA — le commentaire du comité** | les mêmes chiffres, pour cinq lignes |
| **Taux d'échec — ce qui a bougé** | les trois fenêtres du taux d'échec, et la tendance |
| **Conformité du parc** | l'audit CIS de **plusieurs** dépôts que vous cochez |
| **Relire une merge request** | le diff de la MR choisie, avec son titre et ses branches |

Trois formes de choix, et c'est **le signal** qui décide laquelle, jamais l'écran :

- **un dépôt** — un menu déroulant, la plupart des agents ;
- **plusieurs dépôts** — des cases à cocher, pour la conformité du parc. Rien n'est coché
  au départ : un jeton voit des archives et des bacs à sable, et ce qui n'est pas coché est
  compté à part plutôt que passé sous silence ;
- **une merge request** — la liste des MR ouvertes du dépôt se déroule, vous en choisissez
  une, le diff s'assemble seul.

### 📮 Proposer les correctifs

Sur la **conformité du parc**, un bouton apparaît à côté de l'export dès qu'un dépôt est en
écart. Il ouvre **une merge request par dépôt**, qui ajoute `SECURITY.md` et `CODEOWNERS`
quand ils manquent.

Ce qu'il ne fait pas, et qui compte autant :

- **il ne fusionne jamais.** Les équipes relisent, ajustent, fusionnent ou ferment ;
- **il ne corrige aucun réglage de projet.** Protéger une branche, exiger deux
  approbateurs, sécuriser un webhook : aucun commit ne les change. La description de la MR
  les liste avec l'écran exact où aller les régler ;
- **aucun modèle ne décide** de ce qui est écrit. Les fichiers et le texte viennent de
  l'audit, par du code.

Une confirmation liste les dépôts visés et les fichiers avant d'écrire quoi que ce soit.
Sur GitHub le bouton est désactivé : l'ouverture d'une merge request n'y est pas
implémentée — la cible est GitLab.

C'est **la séparation qui fait marcher ces agents** : le chiffre est calculé par du code,
déterministe et rejouable ; l'explication est écrite par le modèle, qui est bon à ça et
mauvais à l'arithmétique. Un modèle à qui on demande de calculer un bus factor sans données
répond « élevé », et aucun contrôle automatique ne peut le prendre en défaut — un critère
vérifie une forme, jamais un fait.

Le résultat du calcul s'affiche **avant** le lancement — *« bus factor 1 — RISQUE CRITIQUE ·
3 contributeurs · 9 zones »* — et le détail complet reste à un clic, sous **voir la matière
envoyée**. Vous voyez ce qui part avant que ça parte, et vous pouvez le contester.

Ce que ces calculs **n'ont pas pu voir** est toujours écrit dans la matière, jamais masqué :
les répertoires non interrogés, les fichiers non lus, les contrôles qui demandent des droits
d'administration. Un scan partiel qui se présenterait comme complet est pire qu'un scan
absent, parce qu'il rassure.

### Où va-t-il chercher la matière ?

Pour les autres agents, trois sources, et c'est vous qui choisissez :

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
