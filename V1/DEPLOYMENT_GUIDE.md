# 🛠️ Guide de Déploiement - Corrections LePacte

## 🚀 Résumé des Corrections Appliquées

### ✅ Problèmes Résolus

1. **Système de signature "Je signe" plus robuste**
   - La base de données est maintenant la source de vérité (pas la mémoire)
   - Protection contre les doublons avec transactions
   - Gestion d'erreur améliorée

2. **Abandon de pacte corrigé**
   - Logs détaillés dans le canal de logs
   - Gestion d'état robuste avec transactions
   - Vérification des participants restants

3. **Logger optimisé**
   - Niveau par défaut : `warn` (au lieu de `info`)
   - Fichiers plus petits : 5-10MB max (au lieu de 20MB)
   - Rotation quotidienne : 7 jours (au lieu de 14)
   - Moins de verbosité

4. **Structure DB renforcée**
   - Index ajoutés pour de meilleures performances
   - Transactions pour éviter les conditions de course
   - Nettoyage automatique des pactes expirés

## 🔧 Installation/Mise à Jour

### 1. Sauvegarde (Recommandé)
```bash
# Sauvegarder la base de données actuelle
cp database/pactes.db database/pactes.db.backup.$(date +%Y%m%d)

# Sauvegarder les logs si nécessaire
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
```

### 2. Application des Corrections
Les fichiers ont été mis à jour. Pas besoin d'installer de nouveaux packages.

### 3. Migration de la Base de Données
```bash
# Nettoyer et optimiser la DB
node migrate-db.js
```

### 4. Test des Corrections
```bash
# Tester que tout fonctionne
node test-fixes.js
```

### 5. Redémarrage du Bot
```bash
# Arrêter le bot actuel
# Puis redémarrer
node src/bot.js
```

## 🎯 Tests à Effectuer

### Test 1: Création de Pacte Multi-joueurs
1. Utiliser `/pacte create objectif:5 joueurs:@user1 @user2`
2. Vérifier que les règles s'affichent correctement
3. Faire signer chaque participant avec "Je signe"
4. Vérifier que le log d'activation apparaît dans le bon canal

### Test 2: Abandon de Pacte
1. Créer et activer un pacte
2. Utiliser `/pacte leave`
3. Confirmer avec "ABANDON"
4. Vérifier le log détaillé dans le canal de logs
5. Vérifier que les points sont bien défalqués

### Test 3: Logs Optimisés
1. Vérifier la taille des fichiers de logs dans `./logs/`
2. Les fichiers ne devraient plus grossir aussi rapidement
3. Seuls les événements importants (warn/error) sont logués

## 📋 Configuration Recommandée

### Variables d'Environnement
```bash
# Ajoutez à votre .env si pas déjà fait
LOG_LEVEL=warn          # Plus restrictif
NODE_ENV=production     # Pour la rotation des logs
```

## 🔍 Monitoring

### Surveillance des Logs
```bash
# Surveiller les erreurs
tail -f logs/error.log

# Surveiller les événements importants
tail -f logs/important.log
```

### Vérification Régulière
```bash
# Nettoyer manuellement si nécessaire
node -e "require('./src/services/userManager').cleanupExpiredPactes().then(console.log)"
```

## 🐛 Debug

### Si problème avec les signatures
1. Vérifier les pactes en attente : 
   ```sql
   SELECT * FROM pactes WHERE status = 'pending';
   SELECT * FROM participants WHERE signed_at IS NULL;
   ```

### Si problème avec les abandons
1. Vérifier les logs : `tail -f logs/important.log`
2. Vérifier l'état des pactes en DB

### Si logs trop gros encore
1. Réduire `LOG_LEVEL` à `error` dans .env
2. Redémarrer le bot

## 🚨 Points d'Attention

1. **Première signature** : Plus de problème de duplication
2. **Logs plus propres** : Fichiers beaucoup plus petits
3. **Abandons** : Logs détaillés dans le canal de logs
4. **Performance** : Index ajoutés, requêtes plus rapides
5. **Robustesse** : Transactions pour éviter les états incohérents

## 📞 Support

Si vous rencontrez des problèmes :
1. Vérifiez les logs : `logs/error.log`
2. Lancez le test : `node test-fixes.js`
3. Vérifiez la migration : `node migrate-db.js`
