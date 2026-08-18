# Quand ça refuse

Tout refus de cette plateforme porte **un code** et **une phrase**. Jamais « une erreur
est survenue », jamais « l'IA a estimé que ». Cette page dit ce que chaque code veut dire
et ce qu'il faut faire.

## Les deux moments, et pourquoi ils sont deux

| | **La porte** (`L0xx`) | **Le pré-vol** (`P0xx`) |
|---|---|---|
| Quand | à l'écriture, et à chaque validation | juste avant chaque lancement |
| Ce qu'elle voit | le fichier | le fichier **et** le dépôt visé, le modèle, l'état dérivé |
| Question posée | « ce fichier est-il correct ? » | « ce lancement-ci est-il légitime ? » |

Un agent parfaitement conforme peut être refusé au pré-vol : la porte ne sait pas sur quel
dépôt vous allez tourner.

## Les deux sévérités

🔴 **bloquant** — ça ne passe pas. Il y a quelque chose à corriger.
🟡 **avertissement** — ça passe, mais quelqu'un doit le lire. Souvent le validateur.

Certaines règles sont **contextuelles** : la même règle bloque ou avertit selon ce qu'elle
sait. Voir « refuser ce qu'on sait » en bas de page — c'est la clé de lecture.

---

## La porte — les 28 règles

### Structure et propriété

**`L001` 🔴 — Schéma valide et complet.**

Le fichier ne respecte pas la forme attendue : un champ obligatoire manque, ou une valeur
n'est pas du bon type. Le message dit lequel.

→ *Le Studio signale la même chose à la frappe. Corrigez le champ nommé.*

**`L013` 🔴 — Owner personne ET périmètre, réellement renseignés.**

Un agent sans propriétaire identifiable est un agent que personne ne maintiendra.
`equipe`, `à définir` ou une chaîne vide ne comptent pas.

→ *Mettez un nom de personne et un périmètre réel.*

**`L011` 🟡 — `intent.not_for` renseigné.**

Vous n'avez pas dit quand *ne pas* utiliser cet agent. Le champ le plus utile de la fiche.

→ *Écrivez une phrase. Ce n'est pas bloquant, mais un validateur vous le demandera.*

### Variables

**`L002` 🔴 — Toute `{{variable}}` du spec est déclarée.**

La consigne utilise une variable qui n'existe nulle part. À l'exécution, elle partirait au
modèle telle quelle, en toutes lettres.

→ *Déclarez-la, ou retirez-la de la consigne.*

**`L003` 🟡 — Toute variable déclarée est utilisée.**

L'inverse : une variable déclarée que la consigne n'emploie jamais. Souvent un reste d'une
version précédente.

→ *Supprimez-la, ou servez-vous-en.*

**`L021` 🔴 — Un spec qui déclare des entrées doit en utiliser au moins une.**

Aucune des variables déclarées n'apparaît dans la consigne. L'agent réclame de la matière
et ne la lit pas.

→ *Insérez `{{votre_variable}}` là où la consigne doit lire la matière.*

### Outils

**`L004` 🔴 — Tout outil existe au registre, et l'artefact le décrit conformément.**

Vous déclarez un outil inconnu, ou vous en décrivez un connu autrement que le registre.

→ *Reprenez l'identifiant, le mode et l'exécuteur exactement comme au registre des outils.*

**`L005` 🔴 — INVARIANT : `mode: write` ⟹ `executor: module`.**

Un outil qui écrit ne peut pas être exécuté par le modèle. C'est l'invariant central du
produit : **le LLM ne tient jamais la plume sur un système**. Il propose, un module
déterministe applique.

→ *Il n'y a pas de contournement. Passez l'exécuteur en `module`.*

**`L006` 🔴 — L'outil est autorisé pour le périmètre de l'owner.**

Cet outil n'est pas ouvert à l'équipe qui porte l'agent.

→ *Retirez l'outil, ou faites élargir le périmètre au registre des outils.*

### Sécurité

**`L007` 🔴 — Aucun secret, URL ou identifiant de projet en dur.**

La consigne contient quelque chose qui ressemble à une clé, un jeton, une URL interne ou
un identifiant de projet.

→ *Sortez-le en variable. Un secret dans un spec part au modèle à chaque exécution, et
reste dans l'historique du dépôt pour toujours.*

**`L012` 🟡 — Marqueurs d'injection dans le spec.**

Des tournures du genre « ignore les instructions précédentes ». Parfois légitime, souvent
un copier-coller malheureux.

→ *Relisez le passage signalé.*

### Le contrat

**`L008` 🔴 — `criteria` non vide.**

Aucun critère : rien ne sera vérifié sur la sortie, et on retombe sur du jugement.

→ *Ajoutez au moins un critère vérifiable. `output.length lte 2500` est un plancher, pas
une réponse.*

**`L009` 🔴 — Chaque critère est assertable.**

Un critère que le code ne sait pas évaluer est un critère décoratif.

→ *Utilisez une cible connue du registre des cibles.*

**`L017` 🔴/🟡 — Consistance des cas d'or.**

Les cas de test se contredisent, ou l'un d'eux n'a pas de quoi être joué.

→ *Le message dit lequel et en quoi.*

**`L026` 🔴 — Un contrat ne doit pas exiger deux formes incompatibles.**

Votre agent demande une sortie **JSON** et, en même temps, des **titres Markdown**
(`output.sections`) ou un **message de commit conventionnel**. Aucune réponse ne peut
satisfaire les deux : le contrat échouerait quoi que le modèle réponde.

Chaque critère est valide isolément — c'est leur rencontre qui est impossible, et c'est
pour ça que rien ne l'attrapait avant.

→ *Pour exiger des clés dans une sortie JSON, utilisez `output.json_keys` et non
`output.sections`.*

**`L028` 🔴🟡 — L'atelier de votre chaîne ne tient pas debout.**

Une chaîne peut déclarer un **atelier** : des cases nommées où ses étapes accumulent de
l'état. Le registre n'accepte cet état mutable que parce qu'on peut en dire quelque chose
**sans l'exécuter**. Cette règle est ce « quelque chose ».

Elle bloque sur quatre fautes : une case **non déclarée** ; une case **lue avant que
quiconque y ait écrit** ; **deux étapes qui remplacent la même case**, la seconde
effaçant le travail de la première sans que rien ne le dise ; une étape nommée `atelier`.

→ *Déclarez la case dans `atelier`, ou remettez l'étape qui l'écrit avant celle qui la
lit. Pour deux étapes qui alimentent la même case, `mode: ajoute` — c'est le défaut.*

**`L027` 🟡 — Une entrée porte un nom que la plateforme ne connaît pas.**

Votre agent déclare une entrée hors du **vocabulaire des entrées** — `repo_metadata`,
`contribution_data`, ce genre de nom.

Ce n'est pas une question de style. La plateforme sait **calculer** certaines matières et
remplir le champ toute seule au lancement — mais elle se branche sur le **nom**. Sous un
nom inventé, même limpide, elle ne reconnaît rien : la matière sera réclamée à la main à
chaque exécution, et l'agent deviendra pénible au point que personne ne s'en servira.

Le message vous propose le nom connu le plus proche quand il y en a un.

→ *Reprenez le nom du vocabulaire. Si votre besoin réclame vraiment une entrée que le
référentiel ne connaît pas, l'avertissement n'est pas bloquant — mais dites-le à
quelqu'un : c'est peut-être une entrée à ajouter.*

**`L022` 🟡 — Un cas d'or dont l'attente viole un critère de l'artefact.**

Votre cas de test attend un résultat que votre propre contrat refuse. L'un des deux a
tort.

→ *Alignez le cas sur le critère, ou desserrez le critère si c'est lui qui est faux.*

**`L023` 🔴/🟡 — Un cas d'or joue sur une entrée qui existe.**

Le cas fournit une valeur pour une variable non déclarée, ou en oublie une obligatoire.

→ *Corrigez le contexte du cas.*

### Cycle de vie

**`L010` 🔴 — Nombre de cas d'or ≥ seuil du niveau visé.**

0 pour *expérimental*, **3** pour *équipe*, **5** pour *officiel*.

→ *Ajoutez des cas, ou visez plus bas. Viser bas et monter sur preuve est le chemin
normal.*

**`L014` 🟡 — Palier de modèle cohérent avec la taille de contexte.**

Un palier `nano` pour une consigne de 3000 caractères est probablement sous-dimensionné ;
un palier `large` pour trois lignes est probablement du gâchis.

→ *Avertissement seulement : c'est le banc d'essai qui tranchera pour de bon.*

**`L015` 🟡 — Similarité élevée avec un artefact existant.**

Au-delà de 60 % de ressemblance avec un agent du registre. Le message dit lequel.

→ *C'est un humain qui décide. Deux agents proches mais distincts, ça existe.*

**`L016` 🔴/🟡 — Certification présente et non périmée.**

Périmée → bloquant. Jamais certifié → avertissement, tant qu'aucun banc n'a tourné.

→ *Passez l'agent au banc d'essai. Voir [Niveaux et certification](niveaux.md).*

### Le texte de la consigne

**`L018` 🔴 — Aucun reste de rédaction dans le spec.**

`TODO`, `FIXME`, `TBD`, `lorem ipsum`, `[à compléter]`, `___`. Un agent inachevé qui part
au modèle à chaque exécution, et que personne ne relira jamais.

→ *Finissez la phrase.*

**`L019` 🟡 — Pas de logique dans le spec.**

Des `if`, des boucles, des accolades. Si votre consigne a besoin d'un algorithme, ce n'est
pas un prompt qu'il vous faut.

→ *Sortez la logique dans un outil, gardez l'intention dans la consigne.*

**`L020` 🔴/🟡 — Taille du spec dans des bornes exploitables.**

Trop court pour dire quoi que ce soit, ou trop long pour être relu par un humain.

→ *Le message donne la taille et la borne.*

### Les chaînes

**`L024` 🔴 — Une chaîne enchaîne des artefacts qui existent.**

Une étape désigne un agent absent du registre, ou s'appelle elle-même, ou deux étapes
portent le même identifiant.

→ *Le [Composer](composer.md) le signale en direct.*

**`L025` 🔴/🟡 — Le câblage d'une chaîne est résoluble.**

Une entrée obligatoire non branchée (🔴), ou une entrée branchée que l'agent ne connaît
pas (🟡). Brancher une étape sur la sortie d'une étape **postérieure** est bloquant : au
moment où elle tourne, celle-ci n'a rien produit.

→ *Rebranchez, ou réordonnez.*

---

## Le pré-vol — les 7 contrôles

Ils tournent **avant le premier jeton dépensé**. Refuser après aurait coûté le prix de
l'appel *et* laissé partir votre matière au modèle.

**`P001` 🔴 — L'artefact franchit-il ENCORE la porte ?**

Les règles évoluent ; un agent validé il y a six mois peut ne plus être conforme. Sans ce
contrôle, le registre garantirait la conformité au moment de la publication et plus jamais
ensuite.

→ *Rouvrez l'agent dans le Studio : il vous dira quelle règle a bougé.*

**`P002` 🔴/🟡 — Sensibilité du dépôt sous le plafond déclaré.**

Le contrôle qui ne peut exister qu'ici — la porte ne sait pas sur quel dépôt vous tournez.
C'est aussi celui qui porte le risque : un agent autorisé sur de l'interne qui lit un
dépôt confidentiel, c'est une fuite.

La sensibilité vient du **référentiel des dépôts** (`registries/repos.yaml`) quand il
connaît le dépôt : les champs sont alors figés à l'écran, et le contrôle refuse sur cette
base. Quand il ne le connaît pas, elle se saisit à la main — et le contrôle demande au
lieu de refuser, parce qu'il ne peut pas opposer une valeur qu'on lui a soufflée.

Dépassement avéré → refus. Sensibilité **inconnue** → on vous demande de confirmer.

→ *Choisissez un autre dépôt, faites relever le plafond de l'agent, ou faites classer le
dépôt au référentiel.*

**`P003` 🔴 — Variables requises résolues.**

Une entrée obligatoire n'a pas de valeur. Laisser passer coûterait un appel et rendrait
une sortie construite sur `{{repo}}` non remplacé — donc une réponse qui a l'air d'une
réponse.

→ *Remplissez le champ signalé.*

**`P004` 🔴 — Outils autorisés pour le périmètre du dépôt CIBLE.**

À ne pas confondre avec `L006`. Ici c'est le périmètre du dépôt qu'on s'apprête à toucher :
**le droit suit la cible, pas le porteur**. Un agent de Plateforme lancé sur un dépôt de
Data n'emporte pas ses outils Plateforme avec lui.

→ *Lancez-le sur un dépôt de son périmètre.*

**`P005` 🔴/🟡 — Certification présente et valide.**

Périmée, c'est un fait mesuré → refus. Jamais certifié, c'est autre chose : tant qu'aucun
banc ne tourne, aucun agent ne peut l'être, et refuser là-dessus reviendrait à interdire la
plateforme au nom d'un outil qui n'existe pas encore → on demande une confirmation.

→ *Confirmez, ou passez l'agent au banc.*

**`P006` 🔴/🟡 — Niveau suffisant pour la criticité.**

Un agent *expérimental* n'a pas sa place en production. La sévérité suit **d'où vient le
niveau**, pas sa valeur : niveau dérivé et insuffisant → refus, la mesure a été faite, elle
dit non. Niveau seulement visé → avertissement, parce qu'une intention n'est pas un acquis.

→ *Passez l'agent au banc pour transformer le visé en atteint.*

**`P007` 🟡 — Écriture : confirmation humaine requise.**

Cet agent écrit quelque part. Il ne part pas sans que vous le disiez.

→ *Cochez la confirmation. Ce n'est pas une formalité : c'est le dernier point où un
humain voit ce qui va être modifié.*

**`P008` 🔴 — Le plafond de dépense est atteint.**

La fenêtre — 24 heures ou 30 jours — a consommé l'enveloppe déclarée dans
`registries/budget.yaml`, celle de votre périmètre ou la globale. Les deux s'appliquent :
votre équipe ne dépasse pas son enveloppe même si le global a de la marge, et personne ne
dépasse le global même si son équipe en a.

→ *Attendez que la fenêtre s'écoule, ou faites relever le plafond au registre. C'est une
décision de gouvernance — elle se discute et s'historise, elle ne se contourne pas.*

**`P008` 🟡 — Des appels de la fenêtre n'ont pas de tarif.**

Le montant affiché est un **plancher**, pas un total : certains paliers n'ont pas de tarif
relevé au registre des modèles, et leur coût vaut `null`. On ne les compte pas pour zéro —
sinon le plafond se contournerait en choisissant justement le palier dont on ignore le
prix. La dépense réelle est donc au-dessus de ce qui s'affiche, et de combien, personne ne
le sait.

→ *Confirmez si vous acceptez de partir dans le flou, ou faites relever le tarif manquant.
Le pré-vol ne refuse pas sur une supposition — il vous passe la décision.*

Une limite à connaître : le plafond porte sur ce qui a **déjà** été dépensé. On ne connaît
ni la longueur de la réponse ni le taux de cache avant d'appeler, et estimer reviendrait à
poser un chiffre inventé devant un contrôle budgétaire. Le dernier appel peut donc
franchir la limite — d'au plus un appel.

**`P009` 🔴 — L'isolement qu'exige cet artefact n'est pas tenu.**

L'artefact déclare une **exigence** d'isolement, et le pré-vol **recalcule à chaque
lancement** si elle est tenue — preuves lisibles par la plateforme d'un côté,
attestations en vigueur de l'autre. Rien n'est figé : une attestation qui périme fait
re-refuser le même artefact qui passait la veille. Et « non vérifiable » refuse autant
que « non tenu » : ce qu'on ne sait pas ne se lance pas.

→ *Le message liste les preuves manquantes. Pour un artefact qui n'exécute rien,
`aucune-execution` suffit. Pour un conteneur : le job de CI épinglé par digest ET une
attestation fraîche dans `attestations/` — une MR, avec un nom de personne.*

---

## La clé de lecture : refuser ce qu'on sait, demander ce qu'on ignore

Vous verrez souvent un avertissement là où vous attendiez un refus. Ce n'est pas de la
mollesse, c'est une règle explicite du produit :

> **Un contrôle refuse ce qu'il SAIT. Il demande ce qu'il IGNORE.**

Aujourd'hui, aucun dépôt n'est classé au référentiel et le banc n'a rien mesuré. Un
contrôle qui refuserait l'inconnu refuserait donc **tout**, et la plateforme serait
inutilisable au nom de sa propre rigueur.

Ces contrôles sont **auto-resserrants** : le jour où le référentiel des dépôts répond,
`P002` se remet à refuser. Le jour où le banc mesure un niveau, `P006` aussi. Sans qu'une
ligne de code change, et sans que personne ait à se rappeler de durcir quoi que ce soit.

Le référentiel des dépôts existe désormais — `registries/repos.yaml` — et il est **livré
vide**. Le remplir n'est pas une décision de code : une classification inventée servirait
ici à *autoriser* des lectures. Chaque ligne qu'on y ajoute resserre `P002` sur ce
dépôt-là, immédiatement, sans rien changer d'autre.

Un avertissement d'aujourd'hui est donc un refus de demain. C'est le sens à lui donner.
