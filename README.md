# LePacte


# V1
  
    Discord bot version

# V2

    Web Application for the gamemode Le Pacte for ARAM Players 


pacte-aram-bot/
├── src/
│   ├── bot.js                 # Point d'entrée
│   ├── commands/               # Commandes slash
│   │   ├── register.js
│   │   ├── pacte.js
│   │   ├── stats.js
│   │   └── ladder.js
│   ├── events/                 # Events Discord
│   │   ├── ready.js
│   │   ├── interactionCreate.js
│   │   └── messageCreate.js
│   ├── services/               # Logique métier
│   │   ├── riotApi.js
│   │   ├── pacteManager.js
│   │   ├── userManager.js
│   │   └── pointsCalculator.js
│   ├── utils/                  # Utilitaires
│   │   ├── database.js
│   │   ├── logger.js
│   │   └── constants.js
│   └── models/                 # Modèles DB
│       ├── User.js
│       ├── Pacte.js
│       └── Participant.js
├── config/
│   └── config.json
├── database/
│   └── pactes.db
├── logs/
├── package.json
└── .env