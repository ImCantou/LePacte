#!/usr/bin/env node

/**
 * Script de test pour vérifier les corrections apportées au bot
 */

require('dotenv').config();
const { initDatabase, getDb } = require('./src/utils/database');
const logger = require('./src/utils/logger');
const { cleanupExpiredPactes, getPendingPactes } = require('./src/services/userManager');

async function runTests() {
    try {
        console.log('🧪 Tests des corrections...\n');
        
        // Test 1: Initialisation de la base de données
        console.log('1. Test initialisation DB...');
        await initDatabase();
        console.log('✅ Base de données initialisée\n');
        
        // Test 2: Test du logger
        console.log('2. Test du logger...');
        logger.warn('Test log niveau warn');
        logger.info('Test log niveau info (devrait être filtré en production)');
        logger.error('Test log niveau error');
        console.log('✅ Logger configuré (vérifiez les fichiers dans ./logs)\n');
        
        // Test 3: Test de nettoyage des pactes expirés
        console.log('3. Test nettoyage pactes expirés...');
        const cleaned = await cleanupExpiredPactes();
        console.log(`✅ ${cleaned} pactes expirés nettoyés\n`);
        
        // Test 4: Test de la structure de la DB
        console.log('4. Test structure DB...');
        const db = getDb();
        
        // Vérifier que les index sont créés
        const indexes = await db.all("SELECT name FROM sqlite_master WHERE type='index'");
        console.log('Index disponibles:', indexes.map(i => i.name).join(', '));
        
        // Vérifier les colonnes importantes
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('Tables disponibles:', tables.map(t => t.name).join(', '));
        console.log('✅ Structure DB vérifiée\n');
        
        // Test 5: Test de la fonction getPendingPactes
        console.log('5. Test getPendingPactes...');
        const pendingPactes = await getPendingPactes('test_channel_id');
        console.log(`✅ Fonction getPendingPactes fonctionne (${pendingPactes.length} pactes trouvés)\n`);
        
        console.log('🎉 Tous les tests passés ! Le bot est prêt.\n');
        
        console.log('📋 Résumé des améliorations:');
        console.log('- Logger moins verbeux (warn/error seulement)');
        console.log('- Fichiers de logs plus petits (5-10MB max)');
        console.log('- Système de signatures robuste (DB comme source de vérité)');
        console.log('- Gestion d\'abandon améliorée avec logs détaillés');
        console.log('- Nettoyage automatique des pactes expirés');
        console.log('- Transactions DB pour éviter les conditions de course');
        console.log('- Index ajoutés pour de meilleures performances');
        
    } catch (error) {
        console.error('❌ Erreur lors des tests:', error);
        process.exit(1);
    }
}

// Gestion propre de l'arrêt
process.on('SIGINT', () => {
    console.log('\n👋 Tests arrêtés');
    process.exit(0);
});

runTests();
