const { getDb } = require('./database');
const { resetMonthlyPoints, completePacte, cleanupExpiredPactes } = require('../services/userManager');
const { calculatePoints, calculateMalus } = require('../services/pointsCalculator');
const { sendTimeWarningTaunt } = require('../services/pacteManager');
const { cleanupOldMatchHistory } = require('../services/gameHistoryService');
const logger = require('./logger');

async function checkExpiredPactes(client) {
    const db = getDb();
    
    // Chercher les pactes actifs de plus de 24h
    const expiredPactes = await db.all(`
        SELECT p.*, GROUP_CONCAT(part.discord_id) as participant_ids
        FROM pactes p
        JOIN participants part ON p.id = part.pacte_id
        WHERE p.status = 'active' 
        AND datetime(p.started_at, '+24 hours') < datetime('now')
        AND part.signed_at IS NOT NULL
        GROUP BY p.id
    `);
    
    for (const pacte of expiredPactes) {
        const points = calculatePoints(pacte.objective, pacte.best_streak_reached);
        const malus = calculateMalus(pacte.objective, pacte.best_streak_reached);
        const totalPoints = points - malus;
        
        await completePacte(pacte.id, false, totalPoints);
        
        // Notifier dans le canal
        const channel = client.channels.cache.get(pacte.log_channel_id);
        if (channel) {
            await channel.send({
                content: `⏰ **PACTE EXPIRÉ** - Pacte #${pacte.id}\nMeilleure série: ${pacte.best_streak_reached}/${pacte.objective}\nPoints: ${totalPoints > 0 ? '+' : ''}${totalPoints}`
            });
        }
        
        logger.info(`Expired pacte #${pacte.id} completed with ${totalPoints} points`);
    }
}

async function sendWarnings(client) {
    const db = getDb();
    
    // Pactes actifs proches de l'expiration (1h restante)
    const warningPactes = await db.all(`
        SELECT p.*, GROUP_CONCAT(part.discord_id) as participant_ids
        FROM pactes p
        JOIN participants part ON p.id = part.pacte_id
        WHERE p.status = 'active' 
        AND datetime(p.started_at, '+23 hours') < datetime('now')
        AND datetime(p.started_at, '+24 hours') > datetime('now')
        AND part.signed_at IS NOT NULL
        AND p.warning_sent = 0
        GROUP BY p.id
    `);
    
    for (const pacte of warningPactes) {
        const channel = client.channels.cache.get(pacte.log_channel_id);
        if (channel) {
            const participantMentions = pacte.participant_ids.split(',').map(id => `<@${id}>`).join(' ');
            await channel.send({
                content: `⏰ **ATTENTION** ${participantMentions}\nPlus qu'1 heure pour compléter le pacte #${pacte.id} !\nObjectif: ${pacte.objective} wins | Actuel: ${pacte.current_wins}`
            });
            
            // Envoyer un taunt de temps qui s'écoule
            await sendTimeWarningTaunt(pacte, channel, 1);
        }
        
        // Marquer comme averti
        await db.run('UPDATE pactes SET warning_sent = 1 WHERE id = ?', pacte.id);
    }
}

async function checkMonthlyReset() {
    const db = getDb();
    const lastReset = await db.get('SELECT value FROM config WHERE key = "last_monthly_reset"');
    
    const now = new Date();
    const lastResetDate = lastReset ? new Date(lastReset.value) : new Date(0);
    
    // Si on est dans un nouveau mois
    if (now.getMonth() !== lastResetDate.getMonth() || now.getFullYear() !== lastResetDate.getFullYear()) {
        await resetMonthlyPoints();
        await db.run(
            'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
            ['last_monthly_reset', now.toISOString()]
        );
        logger.info('Monthly points reset completed');
    }
}

async function cleanupOldData() {
    try {
        // Nettoyer l'historique des games (plus de 30 jours)
        const cleanedMatches = await cleanupOldMatchHistory();
        if (cleanedMatches > 0) {
            logger.info(`Cleaned up ${cleanedMatches} old match records`);
        }
        
        // Nettoyer les pactes expirés
        const cleanedPactes = await cleanupExpiredPactes();
        if (cleanedPactes > 0) {
            logger.info(`Cleaned up ${cleanedPactes} expired pactes`);
        }
        
    } catch (error) {
        logger.error('Error during scheduled cleanup:', error);
    }
}

async function initScheduledTasks(client) {
    // Toutes les 5 minutes: vérifier les pactes expirés et envoyer les warnings
    setInterval(() => {
        checkExpiredPactes(client);
        sendWarnings(client);
    }, 5 * 60 * 1000);
    
    // Tous les jours à 00:00: reset mensuel et nettoyage
    setInterval(() => {
        checkMonthlyReset();
        cleanupOldData();
    }, 24 * 60 * 60 * 1000);
    
    // Exécution immédiate au démarrage
    await checkExpiredPactes(client);
    await checkMonthlyReset();
    await cleanupExpiredPactes(); // Nettoyer au démarrage
    
    logger.warn('Scheduled tasks initialized');
}

module.exports = {
    initScheduledTasks,
    checkExpiredPactes,
    sendWarnings,
    checkMonthlyReset,
    cleanupOldData
};;