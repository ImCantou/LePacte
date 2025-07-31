#!/usr/bin/env node

/**
 * Script de migration pour nettoyer et optimiser la base de données
 */

require('dotenv').config();
const { initDatabase, getDb } = require('./src/utils/database');
const logger = require('./src/utils/logger');

async function migrate() {
    try {
        console.log('🔄 Migration de la base de données...\n');
        
        await initDatabase();
        const db = getDb();
        
        console.log('1. Nettoyage des données incohérentes...');
        
        // Nettoyer les pactes en attente qui ont expiré
        const expiredResult = await db.run(
            `UPDATE pactes 
             SET status = 'failed', completed_at = CURRENT_TIMESTAMP 
             WHERE status = 'pending' 
               AND datetime(created_at, '+5 minutes') <= datetime('now')`
        );
        console.log(`✅ ${expiredResult.changes} pactes expirés nettoyés`);
        
        // Nettoyer les participants orphelins (sans pacte correspondant)
        const orphansResult = await db.run(
            `DELETE FROM participants 
             WHERE pacte_id NOT IN (SELECT id FROM pactes)`
        );
        console.log(`✅ ${orphansResult.changes} participants orphelins supprimés`);
        
        // Nettoyer les participants qui ont quitté des pactes échoués/terminés
        const inactiveResult = await db.run(
            `UPDATE participants 
             SET left_at = CURRENT_TIMESTAMP 
             WHERE pacte_id IN (
                 SELECT id FROM pactes WHERE status IN ('failed', 'success')
             ) AND left_at IS NULL AND signed_at IS NOT NULL`
        );
        console.log(`✅ ${inactiveResult.changes} participants de pactes terminés mis à jour`);
        
        console.log('\n2. Optimisation de la base de données...');
        
        // Analyser les tables pour optimiser les requêtes
        await db.run('ANALYZE');
        console.log('✅ Statistiques de la DB mises à jour');
        
        // Compacter la base de données
        await db.run('VACUUM');
        console.log('✅ Base de données compactée');
        
        console.log('\n3. Vérification de l\'intégrité...');
        
        // Vérifier l'intégrité
        const integrity = await db.get('PRAGMA integrity_check');
        console.log(`✅ Intégrité: ${integrity.integrity_check}`);
        
        // Statistiques finales
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
                'pactes_actifs', COUNT(*) FROM pactes WHERE status = 'active'
            UNION ALL
            SELECT 
                'pactes_en_attente', COUNT(*) FROM pactes WHERE status = 'pending'
        `);
        
        console.log('\n📊 Statistiques de la base de données:');
        stats.forEach(stat => {
            console.log(`  - ${stat.table_name}: ${stat.count}`);
        });
        
        console.log('\n🎉 Migration terminée avec succès !');
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
        process.exit(1);
    }
}

migrate();
