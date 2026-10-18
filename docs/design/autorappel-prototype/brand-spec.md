# AutoRappel — Brand spec

Direction imposée par le brief (section 4) : atelier moderne, fiable, précis — bleu pétrole/nuit en primaire, orange atelier en accent, statuts et canaux codifiés par couleur + icône + libellé.

## Tokens OKLch — thème clair

```
--bg:        oklch(97% 0.004 240)
--surface:   oklch(100% 0 0)
--surface-2: oklch(94.5% 0.006 240)
--fg:        oklch(23% 0.025 240)
--muted:     oklch(48% 0.02 240)
--border:    oklch(89% 0.008 240)
--accent:    oklch(66% 0.185 42)   /* orange atelier */
--accent-fg: oklch(99% 0 0)
--primary:   oklch(27% 0.045 235)  /* bleu pétrole/nuit — sidebar, headers */
--primary-fg: oklch(97% 0.005 240)
```

## Tokens OKLch — thème sombre

```
--bg:        oklch(17% 0.018 240)
--surface:   oklch(22% 0.022 240)
--surface-2: oklch(26% 0.024 240)
--fg:        oklch(95% 0.004 240)
--muted:     oklch(68% 0.018 240)
--border:    oklch(33% 0.022 240)
--accent:    oklch(70% 0.175 44)
--accent-fg: oklch(14% 0.01 240)
--primary:   oklch(20% 0.03 235)
--primary-fg: oklch(95% 0.004 240)
```

## Statuts (toujours couleur + icône + texte)

- Succès / à jour / payé / envoyé / lu : `--status-ok: oklch(62% 0.135 148)`
- Bientôt / en attente proche : `--status-warn: oklch(76% 0.145 72)`
- Retard / expiré / échec : `--status-bad: oklch(57% 0.21 23)`
- Neutre / brouillon / désactivé : `--status-off: oklch(55% 0.012 240)`

## Canaux (pastilles discrètes)

- WhatsApp : `--chan-whatsapp: oklch(66% 0.17 150)`
- SMS : `--chan-sms: oklch(58% 0.14 252)`
- Email : `--chan-email: oklch(55% 0.13 302)`

## Typographie

- Display (titres, KPI) : **Sora** — géométrique, lisible, pas de surcharge
- Body (texte courant, tableaux) : **Inter** — excellente lisibilité à petite taille
- Mono (plaques, VIN, n° facture, référence) : **JetBrains Mono**
- Chiffres tabulaires (`font-variant-numeric: tabular-nums`) sur tous les montants/dates/compteurs

## Règles observées / décidées

1. Un seul accent orange, utilisé uniquement pour l'action principale (CTA, élément "à traiter") — jamais pour la décoration.
2. Le bleu pétrole porte la navigation et les en-têtes ; il ne sert jamais de couleur de statut.
3. Chaque statut combine toujours pastille colorée + icône trait simple + libellé texte (jamais la couleur seule).
4. Zones tactiles ≥ 44px, texte ≥ 14px sur mobile, contraste AA minimum vérifié sur tous les états (hover/focus/actif/désactivé).
5. Montants en FCFA avec séparateur d'espace fine, toujours avec le suffixe " FCFA".
