const { getDb } = require('./database');
const { resetMonthlyPoints, completePacte } = require('../services/userManager');
const { calculatePoints, calculateMalus } = require('../services/pointsCalculator');
const { sendTimeWarningTaunt } = require('../services/pacteManager');
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

async function initScheduledTasks(client) {
    // Ajouter la colonne warning_sent si elle n'existe pas
    const db = getDb();
    await db.run(`
        ALTER TABLE pactes ADD COLUMN warning_sent INTEGER DEFAULT 0
    `).catch(() => {}); // Ignorer si elle existe déjà
    
    // Créer la table config si elle n'existe pas
    await db.run(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);
    
    // Vérifier toutes les 5 minutes
    setInterval(async () => {
        await checkExpiredPactes(client);
        await sendWarnings(client);
    }, 5 * 60 * 1000);
    
    // Vérifier la réinitialisation mensuelle toutes les heures
    setInterval(async () => {
        await checkMonthlyReset();
    }, 60 * 60 * 1000);
    
    // Vérifier immédiatement au démarrage
    await checkExpiredPactes(client);
    await checkMonthlyReset();
    
    logger.info('Scheduled tasks initialized');
}

module.exports = {
    initScheduledTasks,
    checkExpiredPactes,
    sendWarnings,
    checkMonthlyReset
};