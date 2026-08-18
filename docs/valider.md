# Valider ce qu'une équipe soumet

**Pour qui** : vous relisez ce que les équipes déposent, et vous décidez si ça devient
visible de tous.

**Où** : onglet **📊 Admin**, vue **✅ À valider**. L'onglet s'ouvre sur **📦 Le parc**, parce
qu'administrer n'est pas que valider ; le nombre en attente est affiché sur le sélecteur,
donc visible depuis n'importe laquelle des trois vues.

## Ce que vous décidez, et ce que vous ne décidez pas

Vous ne décidez **pas** la conformité. Elle est déjà tranchée : ce qui arrive devant vous
a franchi 28 règles automatiques. Un artefact qui viole une règle bloquante n'est jamais
arrivé jusqu'à cet écran.

Vous décidez ce qu'aucune règle ne sait décider :

- **est-ce que ça sert vraiment à quelque chose ?**
- **est-ce que la consigne fait ce que l'intention annonce ?**
- **est-ce que c'est un doublon d'un agent existant ?**
- **est-ce que le périmètre et les outils sont raisonnables pour cette équipe ?**

Autrement dit : les règles vérifient **la forme**, vous vérifiez **le fond**. C'est écrit
en tête du dépôt depuis le début, et c'est une limite assumée : un agent syntaxiquement
irréprochable qui ne veut rien dire franchit la porte automatique. Il ne franchit pas la
vôtre.

## Ce qu'il faut regarder, dans l'ordre

**1. « Quand ne pas l'utiliser ».** Le champ le plus révélateur. Vide ou creux, c'est le
signe d'un agent dont l'auteur n'a pas cerné les limites — et donc dont personne ne les
cernera au moment de s'en servir.

**2. La consigne, contre l'intention.** Est-ce qu'elle fait ce qui est promis juste
au-dessus ? C'est le désaccord le plus fréquent et le plus coûteux.

**3. Les critères.** Ce qui sera vérifié à chaque exécution. Un agent dont le seul critère
est « moins de 2500 caractères » ne vérifie rien de ce qu'il promet.

**4. Les cas d'or, contre les critères.** Un cas de test qui attend 47 fichiers touchés
quand le contrat en refuse plus de 20 est une contradiction — et celle-là est devenue
`L022`, donc vous ne devriez plus la voir. Les autres, si.

**5. Les avertissements 🟡.** Ils ne bloquent pas, ils vous sont adressés. Le doublon
(`L015`) en particulier : la plateforme dit le pourcentage de ressemblance, c'est vous qui
dites si ce sont deux agents ou un seul.

## 🔎 Le bouton « L'IA relit »

Un bouton, jamais un appel automatique. Vous choisissez de vous en servir ou non.

### Ce qu'il fait

Il demande à un modèle **une seule question** : *ce fichier se contredit-il lui-même ?*

Il ne demande pas « cet agent est-il bon ? ». C'est une question sans réponse, et un
modèle à qui on la pose invente une note. « Ces deux déclarations peuvent-elles être
vraies en même temps ? » est une question fermée, et vérifiable en cinq secondes.

**Cohérence interne ≠ qualité.** C'est toute la ligne de conduite de ce bouton.

### Ce qu'il vous rend

Des contradictions, chacune avec **deux extraits cités du fichier** et une phrase disant
pourquoi ils ne tiennent pas ensemble. Jamais un verdict.

> `purpose` dit *« proposer un index »*
> …contre…
> le spec dit *« tu ne modifies rien et n'analyses pas la structure »*

Un constat qui n'a pas ses deux citations est **jeté avant de vous être montré**. Une
citation qui ne se trouve pas dans le fichier est jetée aussi : c'est le signe d'une
contradiction inventée, et c'est exactement ce qu'il ne faut pas montrer à quelqu'un qui
s'apprête à valider.

Cette contrainte a un but précis : **on ne tamponne pas deux extraits qu'on a sous les
yeux.** Elle vous force à lire.

### Ce qu'il ne fait pas, et ne fera jamais

- **il ne bloque rien.** Il ajoute du doute, il n'en retire jamais. Le bouton « Valider et
  publier » ne change pas d'état, quoi qu'il trouve ;
- **il ne peut pas laisser passer quelque chose.** S'il pouvait, le jour où il se trompe,
  ce serait *lui* qui aurait validé ;
- **il ne commente ni le style, ni la longueur, ni ce qui manque.** Ce qui manque est déjà
  l'affaire des 25 règles.

« Aucune contradiction » est une bonne réponse, et elle est distinguée à l'écran de « le
modèle n'a rien renvoyé de lisible ». Confondre les deux ferait passer une panne pour un
feu vert.

### À quoi il sert vraiment

À fabriquer des règles.

`L022` est née exactement comme ça : une contradiction a sauté aux yeux d'un humain, et
elle est devenue une vérification déterministe qui n'a plus jamais besoin d'un modèle.

Chaque motif qui revient dans les constats est un candidat `L0xx`. Ce bouton est censé
**rétrécir avec le temps**, pas grossir.

## Les trois décisions

| Bouton | Ce qui se passe |
|---|---|
| **Valider et publier** | le fichier passe de `artifacts/pending/` à `artifacts/` — il devient visible au catalogue |
| **Corriger** | vous ouvrez le Studio sur ce fichier, vous amendez, vous revalidez |
| **Refuser** | le fichier est écarté, avec votre motif |

Rien n'est perdu : tout passe par un commit, et le **Journal** garde la trace de qui a
décidé quoi et quand.

## 📦 Le parc — gérer le catalogue

C'est la vue qui s'ouvre en premier, et la plus utilisée : **une ligne par agent**, tous
dossiers confondus — ce qui est actif, ce qui attend, ce qui a été retiré. Recherche,
filtre par nature, filtre par statut.

Sur chaque ligne, quatre gestes :

| | Ce que ça fait |
|---|---|
| **⏸ Retirer** | l'agent sort du catalogue, plus personne ne peut le lancer. **Réversible** |
| **▶ Remettre** | il revient au catalogue |
| **Éditer** | ouvre le Studio sur ce fichier — et repasse par la validation. Corriger n'est pas contourner |
| **🗑 Supprimer** | efface le fichier du registre. **Irréversible** — la confirmation le dit |

Retirer plutôt que supprimer, c'est ce qui permet de nettoyer sans se faire peur. Sans
cette porte de sortie, personne n'ose enlever quoi que ce soit, et un catalogue qu'on ne
croit plus ne se consulte plus.

La colonne **Porte** dit si l'agent franchit *encore* les règles. Elle est calculée à
chaque affichage, pas au moment de la validation : une règle ajoutée depuis peut très bien
faire tomber un agent validé il y a six mois. C'est le but.

La colonne des usages affiche **« jamais mesuré »**, et c'est volontaire. Rien ne capture
encore les exécutions ; un chiffre à cet endroit serait inventé.

## 📜 Le journal — ce qui a été décidé

L'historique des décisions, reconstruit depuis les commits du dépôt : qui a validé, qui a
refusé, quoi, quand. Aucune base à tenir — chaque décision **est** un commit, donc
l'historique du dépôt fait le journal.
