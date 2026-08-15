# Niveaux, certification, banc d'essai

C'est le chapitre où le produit est le plus exigeant avec lui-même, et celui qui explique
le plus de choses à l'écran.

## Le principe : déclaré ≠ mesuré

Un auteur **déclare** ce qu'il vise. La plateforme **dérive** ce qui a été constaté.
Les deux ne s'affichent jamais pareil.

| | Niveau **visé** | Niveau **atteint** |
|---|---|---|
| D'où il vient | l'auteur l'a écrit | le banc d'essai l'a mesuré |
| Ce que c'est | une intention | un acquis |
| À l'écran | pastille **en pointillés** | pastille **pleine** |

Un registre qui afficherait « officiel » parce que l'auteur a tapé `officiel` ne
certifierait rien du tout — il recopierait une ambition en lui donnant l'allure d'un fait.

> **État actuel de ce registre : le banc d'essai n'a encore rien mesuré.** Tous les
> niveaux visibles sont donc des niveaux *visés*, et les pastilles sont toutes en
> pointillés. Ce n'est pas un oubli d'affichage, c'est l'état réel.

## Les trois niveaux

| Niveau | Ce que ça veut dire | Cas d'or exigés |
|---|---|---|
| **expérimental** | on essaie. Pas pour la production. | 0 |
| **équipe** | éprouvé dans une équipe, sur son périmètre. | 3 |
| **officiel** | utilisable par toute la banque. | 5 |

Le nombre de cas d'or est vérifié à l'entrée (`L010`) : viser *officiel* avec deux cas de
test est refusé tout de suite. Mais **écrire cinq cas ne donne pas le niveau** — il faut
que le banc les joue et qu'ils passent.

## Le banc d'essai

Le banc rejoue les cas d'or d'un agent, plusieurs fois chacun, et en dérive ce qu'on a le
droit d'affirmer.

```bash
npm run banc -- <identifiant-de-l-agent>       # le plan, sans rien dépenser
npm run banc -- <identifiant-de-l-agent> --go  # pour de vrai
```

Le **plan s'affiche d'abord** : combien d'appels, à quel palier, pour quel coût estimé.
Rien ne part sans `--go`.

### Comment il juge

Chaque exécution est confrontée aux critères de l'agent, et rend un des trois verdicts :

- **satisfait** — le critère est vérifié ;
- **violé** — le critère est vérifié, et il dit non ;
- **non résolu** — le critère porte sur l'état du monde après exécution (`state`), que le
  banc ne sait pas encore observer.

**`non résolu` n'est jamais compté comme un succès.** Les confondre ferait passer un agent
dont on n'a vérifié que la longueur pour un agent conforme.

### Comment le niveau en sort

Le niveau atteint est dérivé du nombre de cas qui **passent**, **plafonné au niveau visé**
— on ne donne pas plus que ce qui a été demandé. Et **un seul cas en échec plafonne à
_équipe_** : un agent qui rate un de ses propres exemples de référence n'est pas officiel.

Le seuil est strict : un cas ne passe que si **toutes** ses exécutions passent. Trois
succès sur cinq, c'est un échec — un agent qui répond juste deux fois sur trois n'est pas
un agent, c'est un tirage.

## La certification

La certification lie trois choses : **un agent**, **un modèle**, **une date**.

Elle vaut **90 jours**. Passé ce délai, elle est périmée et le lancement est refusé.

Ce n'est pas de la bureaucratie. Le modèle bouge **sous le prompt** : un agent certifié
sur une version d'un modèle n'est pas certifié sur la suivante. C'est précisément ce que
le registre des modèles existe pour rendre traçable — le jour où un palier change de
modèle, on sait quels agents sont concernés et on rejoue *leurs* cas d'or.

Le banc **refuse de certifier** dans trois cas, et c'est le comportement voulu :

- aucun cas d'or joué ;
- au moins un cas en échec ;
- un résultat indécis.

### Ce que vous verrez en attendant

Tant que le banc n'a rien mesuré, les contrôles de certification et de niveau
(`P005`, `P006`) **demandent** au lieu de refuser : ils vous font confirmer, et le disent.

C'est un principe qui vaut partout ici : **un contrôle refuse ce qu'il SAIT, il demande
ce qu'il IGNORE.** Et il est *auto-resserrant* : le jour où le banc mesure, les mêmes
contrôles se remettent à refuser, sans qu'une ligne de code change. Rien à se rappeler de
durcir.

## Le palier de modèle

Un agent déclare un **palier** (`nano`, `small`, `mid`, `large`), jamais un nom de modèle.

Trois raisons, et la troisième est la vraie :

- un nom de modèle change tous les six mois ; un palier, non ;
- 200 agents portant un nom de modèle, c'est 200 fichiers à rouvrir à chaque montée ;
- surtout : le jour où le modèle change sous le prompt, il faut pouvoir dire **quels
  agents sont concernés**. C'est le registre des modèles qui le dit.

Le fournisseur est choisi bien au-dessus de l'équipe qui écrit les agents, et il changera.
Un agent ne nomme donc ni l'un ni l'autre.

## Le coût

Affiché avant de lancer, et affiché après, avec le nombre de jetons réellement consommés.

Quand le tarif d'un fournisseur n'est pas renseigné, l'écran affiche **« tarif inconnu »**
et non `0 €`. Un coût faux affiché avec l'aplomb d'un coût mesuré est pire que pas de
coût du tout.
