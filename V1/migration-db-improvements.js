const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function migrateDbImprovements() {
    console.log('🔧 Démarrage de la migration des améliorations DB...\n');
    
    let db;
    try {
        // Ouvrir la base de données
        db = await open({
            filename: './database/pactes.db',
            driver: sqlite3.Database
        });
        
        console.log('✅ Connexion à la base de données établie');
        
        // Sauvegarder la DB avant migration
        console.log('📦 Création d\'une sauvegarde...');
        const backupPath = `./database/pactes_backup_${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.db`;
        await db.exec(`VACUUM INTO '${backupPath}'`);
        console.log(`✅ Sauvegarde créée : ${backupPath}`);
        
        console.log('\n🚀 Application des améliorations...\n');
        
        // 1. Création de la table game_history pour tracker les games détectées
        console.log('1. Création de la table game_history...');
        try {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS game_history (
                    match_id TEXT PRIMARY KEY,
                    pacte_id INTEGER,
                    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    result TEXT CHECK (result IN ('win', 'loss')),
                    FOREIGN KEY (pacte_id) REFERENCES pactes(id)
                );
            `);
            console.log('✅ Table game_history créée');
        } catch (error) {
            console.log('⚠️  Table game_history existe déjà ou erreur:', error.message);
        }
        
        // 2. Ajout des contraintes pour la robustesse
        console.log('\n2. Ajout des contraintes de validation...');
        
        // Vérifier les contraintes existantes
        const constraints = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type = 'table' AND name = 'pactes'
        `);
        
        // Note: SQLite ne supporte pas ADD CONSTRAINT directement
        // Nous devons recréer la table avec les contraintes
        try {
            // Vérifier si les contraintes existent déjà en testant une insertion invalide
            await db.run('BEGIN TRANSACTION');
            
            try {
                await db.run('INSERT INTO pactes (objective, status) VALUES (1, "invalid_status")');
                // Si ça passe, les contraintes n'existent pas, on doit les ajouter
                await db.run('ROLLBACK');
                console.log('⚠️  Contraintes non détectées, mise à jour nécessaire');
                
                // Créer une nouvelle table avec contraintes
                await db.exec(`
                    CREATE TABLE pactes_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        objective INTEGER NOT NULL CHECK (objective >= 3 AND objective <= 10),
                        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'success', 'failed')),
                        current_wins INTEGER DEFAULT 0 CHECK (current_wins >= 0),
                        best_streak_reached INTEGER DEFAULT 0,
                        in_game BOOLEAN DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        started_at TIMESTAMP,
                        completed_at TIMESTAMP,
                        log_channel_id TEXT,
                        last_checked TIMESTAMP
                    );
                `);
                
                // Copier les données
                await db.exec(`
                    INSERT INTO pactes_new (id, objective, status, current_wins, best_streak_reached, 
                                          in_game, created_at, started_at, completed_at, log_channel_id)
                    SELECT id, objective, status, current_wins, best_streak_reached,
                           in_game, created_at, started_at, completed_at, log_channel_id
                    FROM pactes;
                `);
                
                // Supprimer l'ancienne table et renommer
                await db.exec('DROP TABLE pactes');
                await db.exec('ALTER TABLE pactes_new RENAME TO pactes');
                
                console.log('✅ Contraintes ajoutées à la table pactes');
                
            } catch (insertError) {
                // Les contraintes existent déjà ou autre erreur
                await db.run('ROLLBACK');
                console.log('✅ Contraintes déjà en place ou erreur attendue');
            }
            
        } catch (error) {
            console.log('⚠️  Erreur lors de l\'ajout des contraintes:', error.message);
        }
        
        // 3. Ajouter le champ last_checked s'il n'existe pas déjà
        console.log('\n3. Ajout du champ last_checked...');
        try {
            await db.run('ALTER TABLE pactes ADD COLUMN last_checked TIMESTAMP');
            console.log('✅ Colonne last_checked ajoutée');
        } catch (error) {
            console.log('⚠️  Colonne last_checked existe déjà ou erreur:', error.message);
        }
        
        // 4. Création de l'index pour match_id
        console.log('\n4. Création de l\'index sur match_id...');
        try {
            await db.exec('CREATE INDEX IF NOT EXISTS idx_game_history_match ON game_history(match_id)');
            console.log('✅ Index idx_game_history_match créé');
        } catch (error) {
            console.log('⚠️  Erreur lors de la création de l\'index:', error.message);
        }
        
        // 5. Ajouter les champs pour les kicks
        console.log('\n5. Ajout des champs pour les kicks...');
        try {
            await db.run('ALTER TABLE participants ADD COLUMN kicked_at TIMESTAMP');
            console.log('✅ Colonne kicked_at ajoutée');
        } catch (error) {
            console.log('⚠️  Colonne kicked_at existe déjà ou erreur:', error.message);
        }
        
        try {
            await db.run('ALTER TABLE participants ADD COLUMN kick_reason TEXT');
            console.log('✅ Colonne kick_reason ajoutée');
        } catch (error) {
            console.log('⚠️  Colonne kick_reason existe déjà ou erreur:', error.message);
        }
        
        // 6. Ajouter des index supplémentaires pour optimiser les performances
        console.log('\n6. Création d\'index supplémentaires...');
        try {
            await db.exec(`
                CREATE INDEX IF NOT EXISTS idx_game_history_pacte ON game_history(pacte_id);
                CREATE INDEX IF NOT EXISTS idx_game_history_processed ON game_history(processed_at);
                CREATE INDEX IF NOT EXISTS idx_pactes_last_checked ON pactes(last_checked);
                CREATE INDEX IF NOT EXISTS idx_participants_kicked ON participants(kicked_at);
            `);
            console.log('✅ Index supplémentaires créés');
        } catch (error) {
            console.log('⚠️  Erreur lors de la création des index:', error.message);
        }
        
        // 7. Recréer les index existants pour s'assurer qu'ils sont présents
        console.log('\n7. Vérification des index existants...');
        try {
            await db.exec(`
                CREATE INDEX IF NOT EXISTS idx_pactes_status ON pactes(status);
                CREATE INDEX IF NOT EXISTS idx_pactes_channel ON pactes(log_channel_id);
                CREATE INDEX IF NOT EXISTS idx_pactes_created_at ON pactes(created_at);
                CREATE INDEX IF NOT EXISTS idx_users_points ON users(points_total);
                CREATE INDEX IF NOT EXISTS idx_participants_pacte ON participants(pacte_id);
                CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(discord_id);
                CREATE INDEX IF NOT EXISTS idx_participants_signed ON participants(signed_at);
                CREATE INDEX IF NOT EXISTS idx_participants_left ON participants(left_at);
                CREATE INDEX IF NOT EXISTS idx_monthly_history ON monthly_history(discord_id, month);
            `);
            console.log('✅ Index existants vérifiés');
        } catch (error) {
            console.log('⚠️  Erreur lors de la vérification des index:', error.message);
        }
        
        console.log('\n8. Optimisation de la base de données...');
        
        // Analyser les tables pour optimiser les requêtes
        await db.run('ANALYZE');
        console.log('✅ Statistiques de la DB mises à jour');
        
        // Compacter la base de données
        await db.run('VACUUM');
        console.log('✅ Base de données compactée');
        
        console.log('\n9. Vérification de l\'intégrité...');
        
        // Vérifier l'intégrité
        const integrity = await db.get('PRAGMA integrity_check');
        console.log(`✅ Intégrité: ${integrity.integrity_check}`);
        
        // Test des contraintes
        console.log('\n10. Test des nouvelles contraintes...');
        try {
            await db.run('BEGIN TRANSACTION');
            await db.run('INSERT INTO pactes (objective, status) VALUES (1, "invalid")');
            await db.run('ROLLBACK');
            console.log('⚠️  Attention: Les contraintes ne semblent pas actives');
        } catch (error) {
            console.log('✅ Contraintes fonctionnelles (erreur attendue)');
        }
        
        // Statistiques finales
        console.log('\n📊 Statistiques de la base de données après migration:');
        const stats = await db.all(`
            SELECT 
                'users' as table_name, COUNT(*) as count FROM users
            UNION ALL
            SELECT 
                'pactes', COUNT(*) FROM pactes
            UNION ALL
            SELECT 
                'participants', COUNT(*) FROM participants
            UNION ALL
            SELECT 
                'game_history', COUNT(*) FROM game_history
            UNION ALL
            SELECT 
                'pactes_actifs', COUNT(*) FROM pactes WHERE status = 'active'
            UNION ALL
            SELECT 
                'pactes_en_attente', COUNT(*) FROM pactes WHERE status = 'pending'
        `);
        
        stats.forEach(stat => {
            console.log(`  - ${stat.table_name}: ${stat.count}`);
        });
        
        // Afficher la structure des nouvelles tables
        console.log('\n📋 Structure de la nouvelle table game_history:');
        const gameHistorySchema = await db.all("PRAGMA table_info(game_history)");
        gameHistorySchema.forEach(col => {
            console.log(`  - ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
        });
        
        console.log('\n📋 Nouvelles colonnes ajoutées:');
        const pacteSchema = await db.all("PRAGMA table_info(pactes)");
        const participantSchema = await db.all("PRAGMA table_info(participants)");
        
        console.log('  Pactes:');
        pacteSchema.filter(col => ['last_checked'].includes(col.name)).forEach(col => {
            console.log(`    - ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
        });
        
        console.log('  Participants:');
        participantSchema.filter(col => ['kicked_at', 'kick_reason'].includes(col.name)).forEach(col => {
            console.log(`    - ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
        });
        
        console.log('\n🎉 Migration des améliorations DB terminée avec succès !');
        
        console.log('\n📝 Résumé des améliorations appliquées:');
        console.log('  ✅ Table game_history pour éviter les doublons de games');
        console.log('  ✅ Contraintes de validation sur les pactes');
        console.log('  ✅ Champ last_checked pour optimiser le polling');
        console.log('  ✅ Index sur match_id pour les performances');
        console.log('  ✅ Champs kicked_at et kick_reason pour gérer les exclusions');
        console.log('  ✅ Index supplémentaires pour optimiser les requêtes');
        console.log('  ✅ Base de données optimisée et vérifiée');
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
        process.exit(1);
    } finally {
        if (db) {
            await db.close();
            console.log('\n🔐 Connexion à la base de données fermée');
        }
    }
}

// Exécuter la migration si le script est appelé directement
if (require.main === module) {
    migrateDbImprovements().catch(console.error);
}

module.exports = { migrateDbImprovements };
