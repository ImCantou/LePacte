# Cahier des Charges - Bot Discord "Pacte ARAM"

## 1. Vue d'ensemble

**Objectif** : Développer un bot Discord permettant de créer et suivre des "pactes" entre joueurs pour enchaîner des victoires consécutives en ARAM sur League of Legends.

**Concept** : Les joueurs signent un engagement mutuel pour atteindre un objectif de victoires consécutives. Le bot automatise le suivi via l'API Riot et gère un système de points compétitif.

## 2. Fonctionnalités principales

### 2.1 Gestion des utilisateurs
- Association obligatoire Discord ID ↔ compte Riot (via PUUID)
- Commande d'enregistrement : `/register [pseudo_lol]`
- Vérification de la validité du compte via API Riot

### 2.2 Création de pactes
- Commande : `/pacte create @user1 @user2 ... [nombre_victoires]`
- Nombre de victoires minimum : 3
- Affichage automatique des articles du pacte
- **Validation** : Chaque participant doit écrire "Je signe" en toutes lettres dans le chat
- Délai de signature : 5 minutes
- Pacte actif uniquement si tous signent

### 2.3 Suivi automatique
- **Polling API Riot toutes les 10 secondes** (6 fois/minute)
- Détection automatique des parties ARAM avec tous les signataires
- Mise à jour du statut en temps réel
- Messages de taunt aléatoires :
  - "Toujours là ?"
  - "La pression monte..."
  - "Une de plus ou c'est fini ?"
  - "Les dieux de l'ARAM vous observent"
  - "L'Abîme Hurlant retient son souffle..."
- Notification dans le canal de logs à chaque changement d'état

### 2.4 Règles du pacte
- **Délai** : 24h maximum pour compléter le pacte (à partir de la dernière signature)
- **Composition** : Tous les signataires doivent être dans la même partie
- **Type** : Uniquement les parties ARAM comptent
- **Remake** : Les parties remake ne comptent pas
- **Modification** : Un joueur peut rejoindre si le compteur est à 0

### 2.5 Système de points

**Points de base** :
- 3 wins : 5 pts
- 4 wins : 15 pts
- 5 wins : 40 pts
- 6 wins : 100 pts
- 7 wins : 250 pts
- 8 wins : 400 pts
- 9 wins : 550 pts
- 10 wins : 700 pts
- Chaque win supplémentaire : +150 pts

**Bonus meilleure streak atteinte** :
- +2 pts par win de la meilleure streak
- Ex : Objectif 5, meilleure streak 3 = 40 pts + (3×2) = 46 pts même en cas d'échec final

**Malus échec** : -(Objectif - Meilleure streak) × 10
- Ex : Objectif 5, meilleure streak 3 = -20 pts
- Ex : Objectif 7, meilleure streak 0 = -70 pts

### 2.6 Commandes Discord

- `/register [pseudo_lol]` : Lier son compte LoL
- `/pacte create @users [victoires]` : Créer un pacte
- `/pacte status` : Voir le pacte en cours
- `/pacte leave` : Quitter le pacte (avec malus)
- `/pacte join` : Rejoindre un pacte à 0 victoire
- `/pacte taunt` : Forcer un message de taunt personnalisé
- `/stats [user]` : Statistiques d'un joueur
- `/ladder [monthly/alltime]` : Classement des joueurs
- `/history` : Historique des pactes
- Message "Je signe" : Validation de participation au pacte

## 3. Notifications et logs

**Canal de logs dédié** avec notifications pour :
- Création d'un nouveau pacte
- Validation/refus de signature
- Début de partie détectée
- Mise à jour du compteur (victoire/défaite)
- Pacte réussi/échoué
- Joueur quittant/rejoignant

**Messages automatiques de taunt** :
- Après 2 victoires : "Ça commence à sentir bon..."
- Après une défaite à 1 win de l'objectif : "Aïe, si proche..."
- 1h avant expiration : "Tic tac, plus que 1h !"
- Streak égale au record du serveur : "Record en vue ! 👀"

## 4. Règles du Pacte (affichées lors de la création)

**PACTE D'HONNEUR DE L'ABÎME HURLANT**

*En apposant ma signature sur ce pacte sacré, je m'engage devant mes pairs et les anciennes puissances de l'Abîme à :*

**Article I - De l'Engagement Solennel**
Poursuivre sans relâche l'objectif de [X] victoires consécutives en ARAM aux côtés de mes compagnons d'armes, dans l'honneur et la détermination, jusqu'à ce que gloire nous soit rendue ou que l'échec nous sépare.

**Article II - Des Conditions Impératives**
- Toute bataille doit se dérouler sur le pont de l'Abîme Hurlant (ARAM uniquement)
- L'intégralité des signataires doit combattre côte à côte dans chaque affrontement
- Le pacte prend fin 24 heures après l'apposition de la dernière signature
- Une unique défaite ramène le décompte au néant
- Nul remake ne saurait être compté dans la quête

**Article III - De l'Honneur et du Déshonneur**
- La réussite de cette quête octroiera [X] points de gloire éternelle
- L'échec de cette entreprise coûtera [X] points d'honneur
- L'abandon en cours de route sera considéré comme une défaite
- La meilleure série atteinte sera gravée dans les annales

**Article IV - Des Droits et Devoirs**
- Un combattant peut se retirer du pacte mais subira le déshonneur
- Un nouveau champion peut rejoindre la quête si aucune victoire n'est encore acquise
- Chaque signataire s'engage à donner le meilleur de lui-même
- Les excuses et justifications sont proscrites en cas d'échec

**Article V - Du Serment Inviolable**
*"Par les vents glacés de Freljord et les brumes de l'Abîme, je jure de respecter cet engagement jusqu'à son terme. Que la victoire nous sourie ou que la défaite nous accable, j'affronterai mon destin aux côtés de mes compagnons."*

**Pour sceller ce pacte de votre honneur, inscrivez : "Je signe"**

---

## 5. Gestion des cas particuliers

- **Un seul pacte actif** par groupe de joueurs
- **Parties en cours** : Un pacte créé pendant une partie ne la compte pas
- **Plusieurs pactes** : Impossible si un joueur est déjà dans un pacte actif
- **Déconnexion/AFK** : La partie compte si le joueur était présent au début
- **Limite de participants** : Maximum 5 (taille d'une équipe ARAM)

## 6. Architecture technique

### 6.1 Stack technique
- **Langage** : Python ou JavaScript (Node.js)
- **Framework Discord** : discord.py ou discord.js
- **Base de données** : SQLite pour commencer
- **API** : Riot Games API v5

### 6.2 Structure des données

**Table Users** :
- discord_id (PK)
- riot_puuid
- summoner_name
- points_total
- points_monthly
- best_streak_ever

**Table Pactes** :
- pacte_id (PK)
- created_at
- objective
- status (active/success/failed)
- current_wins
- best_streak_reached

**Table Participants** :
- pacte_id (FK)
- discord_id (FK)
- signed_at
- left_at
- points_gained

### 6.3 Sécurité et limites
- Respect des rate limits Riot API (100 requêtes/2min)
- Stockage sécurisé des clés API
- Validation des entrées utilisateur
- Gestion des erreurs API
- Logs détaillés pour debug

## 7. Roadmap

### Phase 1 - MVP (4 semaines)
- Système d'enregistrement
- Création/signature de pactes
- Suivi automatique avec polling
- Système de points avec malus
- Canal de logs basique

### Phase 2 - Améliorations (2 semaines)
- Commandes stats/ladder complètes
- Messages de taunt automatiques
- Gestion fine des edge cases
- Optimisation du polling

### Phase 3 - Features bonus (optionnel)
- Achievements/badges spéciaux
- Stats détaillées (champions joués, KDA moyen)
- Défis secondaires pendant les pactes
- Export de données
- Graphiques de progression

## 8. Tests et déploiement

- **Beta test** : 2-4 semaines sur serveur Discord privé
- **Participants** : Groupe d'amis initial
- **Métriques** : 
  - Stabilité du bot (uptime)
  - Précision du tracking
  - Latence de détection des games
  - Expérience utilisateur
- **Déploiement** : Sur un seul serveur Discord initialement
- **Monitoring** : Logs d'erreurs, stats d'utilisation