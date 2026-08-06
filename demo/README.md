# Dépôt de démonstration — livraison

La cible sur laquelle l'agent **préparer la livraison** s'exécute pour de vrai.

| Fichier | Ce qu'il porte |
|---|---|
| `.gitlab-ci.yml` | `IMAGE_TAG` — la version de référence |
| `k8s/overlays/preprod/kustomization.yaml` | `newTag` **et** `APP_VERSION` — les deux doivent suivre |
| `k8s/base/kustomization.yaml` | rien de versionné — l'agent doit le laisser intact |

Le troisième fichier n'est pas décoratif : il vérifie que l'agent ne commite **que** ce
qu'il a réellement modifié. Un agent qui touche la base sans raison passerait inaperçu
sans lui.

Ce dossier vit dans le dépôt produit faute d'avoir pu créer un dépôt dédié — l'intégration
GitHub de la session n'en a pas le droit. Sur une vraie cible, ces fichiers sont à la
racine du dépôt livré.
