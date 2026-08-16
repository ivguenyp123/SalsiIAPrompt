# Composer

**Où** : onglet **🔗 Composer**.

L'écran fait **deux choses différentes**, et les confondre est l'erreur la plus coûteuse
du produit. Choisissez d'abord laquelle.

| | 🧩 **Un agent** | 🔗 **Une chaîne** |
|---|---|---|
| Ce qu'on assemble | des **prompts** | des **agents déjà validés** |
| Ce que ça produit | **une** consigne, **un** appel | **N** appels, à la suite |
| Matière disponible | les 130 besoins de la plateforme, plus les consignes validées | les agents du registre |
| Contrat | à poser sur la sortie finale | celui de chaque brique, vérifié entre les étapes |
| Au bout | sauver chez soi, ou partager | sauver chez soi, ou partager |
| Clé modèle | **aucune** pour composer | une, pour l'exécuter |

## La règle pour choisir

> Si vous voudriez **regarder le résultat entre deux étapes**, c'est une chaîne.
> Si seule **la sortie finale** vous intéresse, c'est un agent.

*« Mixe le rapport DORA et le rapport journalier »* → deux vrais travaux, deux sorties
qu'on veut pouvoir vérifier séparément → **chaîne**.

*« Un agent qui lit un diff, vérifie qu'aucun secret ne sort et rédige le message de
commit »* → un seul travail → **agent composé**.

---

# 🧩 Composer un agent

**Pour qui** : vous voulez un agent qui n'existe pas, et vous savez de quoi il est fait.

## L'idée

À gauche, des **prompts**. Vous les posez à droite, dans l'ordre, et ils forment **une
seule consigne** jouée en un appel.

La matière vient de deux endroits, et l'écran dit toujours lequel :

- **les 130 besoins de la plateforme** — tout ce que le hub DevOps sait faire, rangé par
  famille. Disponible dès le premier jour, avant qu'aucun agent n'existe ;
- **les consignes déjà validées** — le texte d'un agent du registre, marqué `validé`.
  C'est la meilleure matière : un humain l'a relue.

Chaque morceau reste **modifiable** une fois posé. Un besoin de catalogue est une phrase,
pas une instruction ciselée — et comme le tout repasse de toute façon par la porte et par
un relecteur, vous écrire ne coûte aucune garantie.

## Ce qu'il faut poser vous-même

Trois champs, et aucun n'est décoratif :

**Le titre** et **à quoi ça sert.** Quelqu'un va relire cet agent ; il doit savoir ce
qu'il est censé faire avant de juger si la consigne le fait.

**Quand ne PAS l'utiliser.** Le champ le plus utile de la fiche, et celui qu'on saute.

Tant qu'ils manquent, l'écran vous le dit **en français** — les règles ne prennent la
parole qu'ensuite, quand il y a quelque chose à juger.

## Pour vous seul, ou pour tout le monde

Deux boutons, et la différence est la seule chose importante de cette page.

### 💾 Sauver chez moi

Immédiat. L'agent va dans `mes-agents/<vous>/`, personne d'autre ne le voit, aucune
validation n'est demandée.

**Ce qui déclenche une validation n'est pas d'écrire, c'est d'engager les autres.** Sauver
chez soi n'engage personne — et quatre choses rendent ça tenable :

- un agent assemblé **ne déclare aucun outil**. Il lit ce que vous lui donnez, il rend du
  texte. Il ne peut écrire nulle part ;
- **les 25 règles ont déjà tourné** : le bouton ne s'active pas avant que la porte soit
  franchie ;
- **le pré-vol tourne quand même** à chaque lancement, où que vive le fichier — `P002` sur
  la sensibilité du dépôt, `P003` sur les entrées, `P007` sur l'écriture ;
- il est **invisible au catalogue des autres** : personne ne peut le prendre en croyant
  qu'il a été relu.

Vous le retrouvez dans **🧰 Catalogue**, filtre **💾 Les miens**, avec un badge — et vous
le lancez comme n'importe quel autre.

**Et il ne peut pas servir de brique.** Une chaîne exige que chaque étape existe *au
registre* (`L024`) ; `mes-agents/` n'y est pas. Sans ça on composerait en privé, quelqu'un
l'enchaînerait, et la chaîne « hériterait de la validation de ses briques » alors que
personne n'a rien relu.

### 📮 Partager — envoyer en validation

Là, ça change de nature : votre agent devient une promesse faite aux autres, et une
promesse se relit. Il part dans la file de l'Admin.

## Ce qui n'est PAS hérité, et pourquoi

C'est le point à comprendre, et il tient en une phrase :

> **Coller deux consignes validées ne donne pas une consigne validée.**
> Ça donne une consigne que personne n'a jamais lue.

Concrètement :

- **rien n'est hérité au partage.** Un agent partagé repasse par les 25 règles *et* par
  une validation humaine, comme n'importe quel prompt écrit à la main. Pas de raccourci
  pour du texte que personne n'a lu — ce serait la faille par laquelle n'importe quoi
  entrerait au registre, en l'assemblant à partir de morceaux bénis ;
- **les critères ne se composent pas.** Ceux de l'agent A portent sur *la sortie de A*,
  qui n'existe plus : il n'y a qu'une sortie finale. L'écran en **propose** — jamais plus
  que ce qu'on a le droit d'affirmer : « aucun secret en sortie », qui vaut pour tout
  agent, plus ce que les morceaux déclarent produire. À vous de poser les vrais ;
- **le niveau retombe à *expérimental*.** Un assemblage n'a jamais été mesuré, quelle que
  soit la maturité de ses morceaux.

## Ce que ça ne demande pas

**Aucune clé, aucun appel, aucun jeton dépensé.** Assembler du texte est mécanique. Vous
composez, les 25 règles vous jugent à la frappe comme au Studio, et ça part en validation
— sans qu'un modèle intervienne à aucun moment.

---

# 🔗 Composer une chaîne

**Pour qui** : vous voulez enchaîner plusieurs agents — « mixe-moi le rapport DORA et le
rapport journalier » — sans écrire de prompt.

## L'idée

Une **chaîne** est une suite d'agents déjà validés qui se passent leur résultat. Elle ne
contient **aucun texte neuf** : elle dit quels agents, dans quel ordre, et branchés
comment.

C'est ce qui explique tout le reste du comportement de l'écran, y compris le fait que
sauver une chaîne ne demande la validation de personne.

## Deux façons de la construire

### En la disant

Le champ du haut. *« je veux un agent qui mixe le rapport DORA et le rapport
journalier »*, et la chaîne s'assemble sous vos yeux.

Un modèle choisit les briques et les branche. **Il ne peut pas écrire de prompt** : sa
seule sortie autorisée, ce sont des identifiants d'agents existants et du câblage. S'il
ne trouve rien qui convienne, il le dit au lieu d'inventer.

### En l'assemblant

Les briques à gauche, la chaîne à droite. On tire de l'une vers l'autre, on réordonne à
la poignée, on branche les entrées.

Le **câblage** est la seule chose que vous écrivez, et c'est deux mots : `{{depot}}` pour
une valeur que vous fournirez au lancement, `{{etape1.sortie}}` pour reprendre le
résultat d'une étape précédente.

## Le verdict, en direct

Sous la chaîne, un verdict qui se recalcule à chaque geste. Deux règles le produisent :

- **`L024`** — chaque étape désigne un agent qui existe vraiment au registre, aucune
  étape ne s'appelle elle-même, les identifiants sont uniques ;
- **`L025`** — le câblage est résoluble **au moment où l'étape se joue**. Brancher
  l'étape 2 sur la sortie de l'étape 5 est refusé : à l'instant où l'étape 2 tourne,
  l'étape 5 n'a rien produit.

Une entrée obligatoire non branchée est un refus. Une entrée branchée que l'agent ne
connaît pas est un avertissement.

## Sauver, partager, forker

Trois boutons, et la différence entre les deux premiers est la seule chose importante de
cette page.

### 💾 Sauver chez moi

Immédiat. La chaîne va dans `mes-chaines/<vous>/`, personne d'autre ne la voit, aucune
validation n'est demandée.

**Pourquoi c'est acceptable** : votre chaîne n'apporte aucun texte neuf. Chaque agent
qu'elle enchaîne a déjà franchi la porte, avec son intention, ses outils autorisés et son
contrat. Ce qu'un relecteur aurait à juger tient dans l'ordre et le câblage — et `L024`
et `L025` le vérifient déjà, mécaniquement, à chaque frappe.

C'est la règle qui rend le produit vivable : **une chaîne hérite de la validation de ses
briques.**

### 📮 Partager — envoyer en validation

Là, ça change de nature. « Partager » ne veut pas dire « rendre visible », il veut dire
**engager le registre** : votre chaîne devient une promesse faite aux autres, et une
promesse se valide. Elle part donc dans la file de l'Admin comme n'importe quel agent.

### Forker

Sur une chaîne qui n'est pas la vôtre — celle d'un collègue, ou une du registre — le fork
vous en donne votre copie, immédiatement, pour la même raison qu'à la sauvegarde.

Trois choses changent dans la copie, et aucune n'est cosmétique :

- **le propriétaire devient vous.** Garder l'auteur d'origine lui ferait porter une
  chaîne qu'il n'a pas écrite, et qu'il découvrirait le jour où elle casse ;
- **l'identifiant est suffixé**, sinon deux personnes qui forkent la même chaîne se
  marcheraient dessus ;
- **le niveau visé retombe à *expérimental*.** Un fork n'a jamais été mesuré, même si son
  original l'avait été. C'est un autre fichier, il refait ses preuves.

## Ce qui se passe au lancement d'une chaîne

Les étapes se déroulent dans l'ordre. Entre chacune, **le contrat de la brique qui vient
de tourner est évalué** — les critères de cet agent-là, pas ceux de la chaîne.

Une étape qui viole son contrat **arrête la chaîne**. Elle ne passe pas la main à la
suivante, et l'écran vous dit laquelle et pourquoi. Une chaîne qui continuerait sur une
sortie hors contrat propagerait une erreur sur trois étapes avant que quiconque la voie.

Le coût est celui de la somme des étapes, affiché avant de lancer.

## Les limites, dites franchement

**Une chaîne de chaînes** est acceptée mais avertie. Rien ne casse ; simplement, à deux
niveaux d'imbrication, plus personne ne sait ce qui tourne vraiment.

**Il n'y a ni condition ni boucle.** Une chaîne est une suite. Si votre besoin demande
un « si », c'est un agent qu'il faut, pas une chaîne — [demandez-le](demander.md).
