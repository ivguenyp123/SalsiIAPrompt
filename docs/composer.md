# Composer une chaîne

**Pour qui** : vous voulez enchaîner plusieurs agents — « mixe-moi le rapport DORA et le
rapport journalier » — sans écrire de prompt.

**Où** : onglet **🔗 Composer**.

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
