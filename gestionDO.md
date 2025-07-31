# Guide de déploiement du Bot Discord sur DigitalOcean

## 📋 Prérequis

- Compte DigitalOcean avec crédit
- Compte Discord Developer avec bot créé
- Clé API Riot Games
- Client SSH (Terminal sur Mac/Linux, PuTTY sur Windows)

## 🚀 Étape 1 : Créer un Droplet (serveur)

### 1.1 Connexion à DigitalOcean
1. Va sur [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. Clique sur **"Create"** → **"Droplets"**

### 1.2 Configuration du Droplet
- **Choose an image** : Ubuntu 22.04 LTS
- **Choose a plan** : Basic → Regular → $6/month (1GB RAM suffit)
- **Choose a datacenter** : Frankfurt ou Amsterdam (proche de EUW)
- **Authentication** : 
  - Choisis **SSH keys** (plus sécurisé)
  - Ou **Password** (plus simple pour débuter)
- **Hostname** : `pacte-aram-bot`
- Clique **"Create Droplet"**

### 1.3 Récupérer l'IP
Une fois créé (environ 1 minute), note l'adresse IP du serveur.

## 🔧 Étape 2 : Configurer le serveur

### 2.1 Se connecter au serveur
```bash
# Sur Mac/Linux
ssh root@TON_IP_SERVEUR

# Sur Windows avec PuTTY
# Entre l'IP dans "Host Name" et clique "Open"
```

### 2.2 Créer un utilisateur non-root (sécurité)
```bash
# Créer un nouvel utilisateur
adduser botuser

# Donner les droits sudo
usermod -aG sudo botuser

# Copier les clés SSH
rsync --archive --chown=botuser:botuser ~/.ssh /home/botuser

# Se connecter avec le nouveau user
su - botuser
```

### 2.3 Installer Node.js et les dépendances
```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Installer PM2 (gestionnaire de processus)
sudo npm install -g pm2

# Installer Git
sudo apt install git -y

# Créer le dossier pour le bot
mkdir ~/bot && cd ~/bot
```

## 📦 Étape 3 : Déployer le bot

### 3.1 Cloner le projet
```bash
# Si tu as un repo Git
git clone https://github.com/ton-username/pacte-aram-bot.git .

# OU upload manuel avec SFTP/FileZilla
# Connecte-toi avec les mêmes infos SSH
```

### 3.2 Installer les dépendances
```bash
cd ~/bot
npm install
```

### 3.3 Configurer les variables d'environnement
```bash
# Créer le fichier .env
nano .env
```

Ajoute ces lignes (remplace les valeurs) :
```env
DISCORD_TOKEN=ton_token_discord
CLIENT_ID=id_de_ton_bot
GUILD_ID=id_de_ton_serveur
RIOT_API_KEY=ta_clé_api_riot
LOG_CHANNEL_ID=id_du_canal_logs
NODE_ENV=production
```

Sauvegarder : `Ctrl+X`, puis `Y`, puis `Enter`

### 3.4 Créer les dossiers nécessaires
```bash
mkdir -p database logs
```

### 3.5 Déployer les commandes Discord
```bash
npm run deploy-commands
```

## 🏃 Étape 4 : Lancer le bot

### 4.1 Tester d'abord
```bash
# Lancer en mode test
node src/bot.js

# Si tout fonctionne, arrêter avec Ctrl+C
```

### 4.2 Lancer avec PM2
```bash
# Démarrer le bot
pm2 start src/bot.js --name "pacte-bot"

# Voir les logs
pm2 logs pacte-bot

# Sauvegarder la config PM2
pm2 save

# Démarrage automatique au reboot
pm2 startup
# Copier et exécuter la commande affichée
```

### 4.3 Commandes PM2 utiles
```bash
pm2 status          # Voir l'état
pm2 restart pacte-bot   # Redémarrer
pm2 stop pacte-bot      # Arrêter
pm2 logs pacte-bot      # Voir les logs
pm2 monit           # Monitoring temps réel
```

## 🔒 Étape 5 : Sécuriser le serveur

### 5.1 Configurer le firewall
```bash
# Activer le firewall
sudo ufw allow ssh
sudo ufw allow 3000  # Si tu as un health check
sudo ufw enable
```

### 5.2 Désactiver la connexion root
```bash
sudo nano /etc/ssh/sshd_config
# Chercher et mettre : PermitRootLogin no
sudo systemctl restart ssh
```

## 📊 Étape 6 : Monitoring et maintenance

### 6.1 Surveiller les ressources
```bash
# Voir l'utilisation CPU/RAM
htop

# Installer si pas présent
sudo apt install htop -y

# Espace disque
df -h
```

### 6.2 Sauvegardes automatiques
```bash
# Créer un script de backup
nano ~/backup.sh
```

Contenu du script :
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp ~/bot/database/pactes.db ~/bot/database/backup_$DATE.db
# Garder seulement les 7 derniers backups
ls -t ~/bot/database/backup_*.db | tail -n +8 | xargs rm -f
```

```bash
# Rendre exécutable
chmod +x ~/backup.sh

# Ajouter au cron (tous les jours à 3h)
crontab -e
# Ajouter : 0 3 * * * /home/botuser/backup.sh
```

### 6.3 Rotation des logs
```bash
# Créer la config logrotate
sudo nano /etc/logrotate.d/pacte-bot
```

Contenu :
```
/home/botuser/bot/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

## 🆘 Dépannage

### Bot ne démarre pas
```bash
# Vérifier les logs
pm2 logs pacte-bot --lines 100

# Vérifier le .env
cat .env

# Tester Node.js
node --version
```

### Connexion SSH perdue
- Va sur DigitalOcean → Droplet → Access → Launch Console

### Bot crash régulièrement
```bash
# Augmenter la mémoire max de Node
pm2 start src/bot.js --name "pacte-bot" --max-memory-restart 900M
```

## 📱 Étape 7 : Inviter le bot sur Discord

1. Va sur [discord.com/developers/applications](https://discord.com/developers/applications)
2. Sélectionne ton bot
3. OAuth2 → URL Generator
4. Cocher : `bot` et `applications.commands`
5. Permissions : 
   - Send Messages
   - Embed Links
   - Read Message History
   - Add Reactions
   - Use Slash Commands
6. Copier l'URL et l'ouvrir dans ton navigateur

## ✅ Checklist finale

- [ ] Bot en ligne sur Discord (point vert)
- [ ] Commandes slash fonctionnelles
- [ ] Base de données créée
- [ ] Logs qui s'écrivent
- [ ] PM2 configuré pour redémarrage auto
- [ ] Backups automatiques configurés
- [ ] Firewall activé

## 💡 Tips bonus

### Mettre à jour le bot
```bash
cd ~/bot
git pull  # Si repo Git
pm2 restart pacte-bot
```

### Voir les performances
```bash
pm2 monit
```

### Débugger une commande
```bash
pm2 logs pacte-bot --lines 50 | grep "ERROR"
```

### Snapshot DigitalOcean
- Fais un snapshot de ton Droplet une fois tout configuré
- Permet de restaurer rapidement en cas de problème

## 🎉 Félicitations !

Ton bot est maintenant en ligne 24/7 ! 

Pour toute question ou problème, les ressources utiles :
- [DigitalOcean Community](https://www.digitalocean.com/community)
- [PM2 Documentation](https://pm2.keymetrics.io/)
- Discord Developer Server