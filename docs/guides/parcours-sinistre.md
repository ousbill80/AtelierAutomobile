# Guide — Réparer un véhicule accidenté avec l'assurance

Ce guide suit un dossier du début à la fin, avec l'exemple de **Mme Koné**, Hyundai Tucson **8812 HK 01**, sinistre **SIN-CODE001-2026-00001**.

Trois personnes fournissent les chiffres. Le logiciel calcule le reste.

| Information                       | Qui la donne                                  | Exemple                      |
| --------------------------------- | --------------------------------------------- | ---------------------------- |
| Franchise                         | L'assuré, puis la lettre d'accord la confirme | 100 000 FCFA                 |
| Devis (pièces, main-d'œuvre, TVA) | Le garage                                     | 653 720 FCFA TTC             |
| Montant accordé et vétusté        | La compagnie, après l'expert                  | 653 720 FCFA, vétusté vide   |
| Part compagnie et part client     | Calculées par AtelierOS                       | 553 720 FCFA et 100 000 FCFA |

La franchise n'est jamais une ligne du devis. La part client, c'est la franchise, plus la vétusté, plus les travaux que le client demande en plus.

## 1. Recevoir le véhicule

À la réception, notez l'arrivée : kilométrage, carburant, photos, dégâts, objets laissés dans la voiture. Ne chifrez pas encore les pièces. L'ordre de Mme Koné est **OR-CODE001-2026-00005**.

## 2. Ouvrir le dossier

Sur l'ordre, cliquez **Ouvrir un dossier sinistre**.

| Champ                   | Exemple                            |
| ----------------------- | ---------------------------------- |
| Compagnie               | Compagnie A                        |
| N° de police            | celui de l'attestation             |
| N° de sinistre assureur | CA-2026-00418                      |
| Date et lieu            | 29/10/2026, Boulevard VGE, Marcory |
| Circonstances           | ce que le client raconte           |
| Franchise               | 100 000                            |
| TVA payée par           | Assurance                          |

Enregistrez. Le dossier reçoit un numéro, ici **SIN-CODE001-2026-00001**.

Dans l'onglet **Documents**, ajoutez le constat, les photos des dégâts, la carte grise et l'attestation. La lettre d'accord viendra plus tard.

## 3. Planifier l'expert

Sur le dossier, cliquez **Planifier l'expert**.

| Champ         | Exemple          |
| ------------- | ---------------- |
| Expert        | Yao Kouamé       |
| Cabinet       | Expertise CI     |
| Téléphone     | 07 00 11 22 33   |
| Visite prévue | 31/10/2026 10:00 |

Quand l'expert est passé, cliquez **Visite effectuée** et indiquez la date réelle.

## 4. Faire le devis

Cliquez **Créer le devis assurance**. Les lignes sont au payeur **Assurance**. Le prix saisi est **hors taxes**.

Exemple, cinq lignes :

| Désignation             | Qté | Prix unitaire HT |
| ----------------------- | --- | ---------------- |
| Pare-choc AV            | 1   | 185 000          |
| Phare AV gauche         | 1   | 142 000          |
| Peinture et ingrédients | 1   | 95 000           |
| MO tôlerie              | 6 h | 12 000           |
| MO peinture             | 5 h | 12 000           |

Le récapitulatif doit afficher **554 000 FCFA HT**, TVA **99 720 FCFA**, total **653 720 FCFA TTC**.

MO signifie main-d'œuvre. La TVA est 18 % de chaque ligne, arrondie au franc, puis additionnée.

## 5. Dire à l'assureur que le devis est parti

Sur le dossier, cliquez **Marquer le devis envoyé**. Le dossier passe à l'étape **Devis envoyé**.

Ce bouton ne prévient pas Mme Koné. Le bouton **Envoyer au client**, sur le devis, sert à un devis particulier. Ne l'utilisez pas pour un sinistre.

Le badge du devis peut rester **Brouillon** à cette étape. C'est l'envoi à la compagnie qui est enregistré.

## 6. Saisir l'accord

Quand la lettre arrive, cliquez **Saisir l'accord**.

| Champ                 | Exemple                           |
| --------------------- | --------------------------------- |
| Montant accordé       | 653 720                           |
| Franchise             | 100 000                           |
| Vétusté               | vide, sauf si l'expert en retient |
| Référence de l'accord | ACC-2026-00418                    |

Le dossier passe à **Accord**. La répartition s'affiche :

- Total : 653 720 FCFA
- Part assureur : 553 720 FCFA
- Part client : 100 000 FCFA

Ajoutez tout de suite la **lettre d'accord** dans **Documents**. Sans cette pièce, ou sans le PV d'expertise, la facturation sera refusée.

Si le montant accordé est inférieur au devis, le logiciel demande quoi faire de l'écart : revoir le devis, le mettre à la charge du client, ou l'absorber par le garage.

## 7. Mettre les travaux sur l'ordre

Le devis est encore séparé de l'ordre. Ouvrez le devis et cliquez **Enregistrer la décision**.

| Champ                           | Valeur             |
| ------------------------------- | ------------------ |
| Canal                           | Assureur           |
| Chaque ligne                    | Accepter           |
| Interlocuteur                   | le nom de l'expert |
| Montant approuvé par l'assureur | 653 720            |

Validez. Les cinq lignes apparaissent sur l'ordre, approuvées. L'ordre passe à **Prêt à démarrer**.

## 8. Réparer

Sur l'ordre, cliquez **Démarrer les travaux**. Le dossier sinistre passe à **Réparation**.

Chaque ligne reste **À faire**. Le bouton **Démarrer** sur une carte lance seulement cette ligne. Pour finir, cliquez **Terminer** sur chaque carte, puis **Terminer les travaux** en haut.

## 9. Contrôler

L'ordre passe au contrôle qualité. Cliquez **Contrôle qualité**.

Cliquez **Tout marquer OK**. Pour l'essai routier, notez le kilométrage de départ et d'arrivée (exemple : 26 puis 32). Cliquez **Valider (véhicule prêt)**. L'ordre passe à **Prêt**.

## 10. Facturer

Retournez sur le sinistre et cliquez **Facturer le sinistre**. Deux brouillons sont créés. Ouvrez chacun et cliquez **Émettre**, puis **Émettre la facture**.

| Facture       | Destinataire | Montant      |
| ------------- | ------------ | ------------ |
| FAC compagnie | Compagnie A  | 553 720 FCFA |
| FAC client    | Mme Koné     | 100 000 FCFA |

Dans l'exemple : **FAC-2026-000006** et **FAC-2026-000005**. Le dossier passe à **Facturé**.

La compagnie apparaît alors dans **Clients**, comme destinataire de sa facture (NCC, e-mail comptable). Ce n'est pas un automobiliste. Mme Koné reste la cliente du véhicule. Les relances de la compagnie ne passent pas par les relances clients : le badge **Ne plus relancer** est normal. La compagnie se gère dans **Assurances**.

## 11. Encaisser la franchise et rendre la voiture

Ouvrez la facture de Mme Koné et cliquez **Encaisser**.

| Champ        | Exemple                     |
| ------------ | --------------------------- |
| Mode         | Orange Money                |
| Montant reçu | 100 000                     |
| Référence    | le numéro de la transaction |

La facture client est soldée. Le dossier passe à **Partiellement réglé**. La facture compagnie reste ouverte.

Sur l'ordre, cliquez **Restituer**. Cochez les objets vérifiés, indiquez le kilométrage de sortie, faites signer le client, puis **Restituer le véhicule**. La voiture peut sortir sans attendre le virement de la compagnie.

## 12. Attendre et relancer la compagnie

Le virement arrive souvent 60 à 120 jours plus tard. Le délai affiché sur la compagnie (souvent 60 jours) part de l'émission de la facture.

Les relances se préparent dans **Assurances → Relances assureurs** :

- le jour de l'échéance ;
- 15 jours après ;
- 30 jours après ;
- puis tous les 30 jours tant que la facture n'est pas payée.

Rien ne part tout seul. Quelqu'un clique **Valider et envoyer**, **Reporter de 3 jours**, ou **Appel fait**. L'e-mail va au contact sinistres de la compagnie. Il part seulement si le canal e-mail est actif dans **Paramètres → Canaux**.

Quand le virement arrive, ouvrez la facture compagnie et cliquez **Encaisser** : mode **Virement**, montant **553 720**, référence du virement. Le dossier passe à **Réglé**. Les relances s'arrêtent.

## Où en est le dossier

| Étape à l'écran | Ce qui vient d'être fait            |
| --------------- | ----------------------------------- |
| Ouverture       | Dossier créé                        |
| Expertise       | Visite prévue, puis visite notée    |
| Devis envoyé    | Devis transmis à la compagnie       |
| Accord          | Lettre saisie, répartition affichée |
| Réparation      | Travaux démarrés                    |
| Facturation     | Les deux factures sont émises       |
| Réglé           | Franchise et compagnie sont payées  |
