# Mxx — Nom du module

> Priorité : P0/P1/P2 · Dépend de : Mxx, Mxx · Rôles concernés : …

## 1. Objectif
Pourquoi ce module existe, quel problème du garage il résout (2-4 phrases).

## 2. Utilisateurs et cas d'usage
Tableau : rôle → ce qu'il fait → fréquence.

## 3. User stories
Format : `US-Mxx-01 — En tant que <rôle>, je veux <action> afin de <bénéfice>.`
Chaque story a ses **critères d'acceptation** testables (Étant donné / Quand / Alors).

## 4. Règles métier
Règles numérotées `RG-Mxx-01`. Calculs précis, cas limites, valeurs par défaut, exemples chiffrés en FCFA.

## 5. Machine à états (si applicable)
Statuts, transitions autorisées, qui peut déclencher, effets de bord (événements émis).

## 6. Données
Entités de `02-modele-donnees.md` utilisées, champs ajoutés éventuels (à reporter dans 02).

## 7. Écrans et interface
Pour chaque écran : route, contenu, actions, filtres, états vides/chargement/erreur, version mobile.

## 8. API
Procédures tRPC (`module.action`) avec entrée/sortie résumées, et endpoints REST publics si concernés.

## 9. Automatisations et événements
Événements émis/consommés, tâches du worker, notifications.

## 10. Permissions
Tableau action → rôles autorisés par défaut.

## 11. Cas limites et erreurs
Liste des situations délicates et du comportement attendu (messages en français).

## 12. Tests
Tests unitaires `core`, tests d'intégration, scénario E2E Playwright principal.

## 13. Définition de « terminé »
Checklist de livraison du module.
