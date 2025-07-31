const { getDb } = require('../utils/database');
const { updateUserPoints } = require('./userManager');
const { calculateMalus } = require('./pointsCalculator');
const logger = require('../utils/logger');

/**
 * Service pour gérer les kicks/exclusions de participants
 */

/**
 * Exclure un participant d'un pacte
 * @param {number} pacteId - ID du pacte
 * @param {string} discordId - ID Discord du participant à exclure
 * @param {string} kickerDiscordId - ID Discord de celui qui fait l'exclusion
 * @param {string} reason - Raison de l'exclusion
 * @returns {Promise<Object>} - Résultat de l'exclusion
 */
async function kickParticipant(pacteId, discordId, kickerDiscordId, reason) {
    const db = getDb();
    
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Vérifier que l'utilisateur est bien dans le pacte et actif
        const participant = await db.get(
            'SELECT * FROM participants WHERE pacte_id = ? AND discord_id = ? AND left_at IS NULL AND kicked_at IS NULL',
            [pacteId, discordId]
        );
        
        if (!participant) {
            await db.run('ROLLBACK');
            throw new Error('Ce participant n\'est pas dans le pacte ou a déjà été exclu/parti');
        }
        
        // Vérifier que le kicker est aussi dans le pacte (optionnel, selon les règles)
        const kicker = await db.get(
            'SELECT * FROM participants WHERE pacte_id = ? AND discord_id = ? AND left_at IS NULL AND kicked_at IS NULL',
            [pacteId, kickerDiscordId]
        );
        
        if (!kicker) {
            await db.run('ROLLBACK');
            throw new Error('Vous devez être participant du pacte pour exclure quelqu\'un');
        }
        
        // Récupérer les infos du pacte pour calculer le malus
        const pacte = await db.get('SELECT * FROM pactes WHERE id = ?', pacteId);
        const user = await db.get('SELECT summoner_name FROM users WHERE discord_id = ?', discordId);
        const kickerUser = await db.get('SELECT summoner_name FROM users WHERE discord_id = ?', kickerDiscordId);
        
        // Calculer le malus pour exclusion (peut-être plus sévère qu'un abandon volontaire)
        const malus = calculateMalus(pacte.objective, pacte.best_streak_reached) * 1.5; // 50% de malus supplémentaire
        
        // Marquer comme exclu
        await db.run(
            'UPDATE participants SET kicked_at = CURRENT_TIMESTAMP, kick_reason = ?, points_gained = ? WHERE pacte_id = ? AND discord_id = ?',
            [reason, -malus, pacteId, discordId]
        );
        
        // Appliquer le malus
        await updateUserPoints(discordId, -malus);
        
        // Vérifier s'il reste des participants actifs
        const activeParticipants = await db.get(
            'SELECT COUNT(*) as count FROM participants WHERE pacte_id = ? AND signed_at IS NOT NULL AND left_at IS NULL AND kicked_at IS NULL',
            pacteId
        );
        
        let pacteStatus = pacte.status;
        if (activeParticipants.count === 0) {
            // Tous les participants sont partis/exclus, échec du pacte
            await db.run(
                'UPDATE pactes SET status = "failed", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                pacteId
            );
            pacteStatus = 'failed';
        } else if (activeParticipants.count === 1) {
            // Un seul participant restant, on peut considérer l'échec du pacte
            await db.run(
                'UPDATE pactes SET status = "failed", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                pacteId
            );
            pacteStatus = 'failed';
        }
        
        await db.run('COMMIT');
        
        // Log important pour suivi
        logger.warn(`KICK - Pacte #${pacteId}: ${user?.summoner_name || discordId} exclu par ${kickerUser?.summoner_name || kickerDiscordId}. Raison: ${reason}. Malus: -${malus} points. Pacte status: ${pacteStatus}. Participants restants: ${activeParticipants.count}`);
        
        return {
            success: true,
            pacteStatus,
            remainingParticipants: activeParticipants.count,
            kickedUser: user?.summoner_name || 'Utilisateur inconnu',
            kickerUser: kickerUser?.summoner_name || 'Utilisateur inconnu',
            malus,
            reason
        };
        
    } catch (error) {
        await db.run('ROLLBACK');
        logger.error(`Erreur lors de l'exclusion du participant ${discordId} du pacte #${pacteId}:`, error);
        throw error;
    }
}

/**
 * Vérifier si un utilisateur a été exclu d'un pacte
 * @param {number} pacteId - ID du pacte
 * @param {string} discordId - ID Discord du participant
 * @returns {Promise<Object|null>} - Infos sur l'exclusion ou null
 */
async function getKickInfo(pacteId, discordId) {
    const db = getDb();
    
    return await db.get(
        'SELECT kicked_at, kick_reason FROM participants WHERE pacte_id = ? AND discord_id = ? AND kicked_at IS NOT NULL',
        [pacteId, discordId]
    );
}

/**
 * Obtenir l'historique des exclusions d'un pacte
 * @param {number} pacteId - ID du pacte
 * @returns {Promise<Array>} - Liste des exclusions
 */
async function getPacteKickHistory(pacteId) {
    const db = getDb();
    
    return await db.all(`
        SELECT p.discord_id, p.kicked_at, p.kick_reason, p.points_gained, u.summoner_name
        FROM participants p
        JOIN users u ON p.discord_id = u.discord_id
        WHERE p.pacte_id = ? AND p.kicked_at IS NOT NULL
        ORDER BY p.kicked_at DESC
    `, [pacteId]);
}

/**
 * Obtenir les statistiques d'exclusions d'un utilisateur
 * @param {string} discordId - ID Discord de l'utilisateur
 * @returns {Promise<Object>} - Statistiques d'exclusions
 */
async function getUserKickStats(discordId) {
    const db = getDb();
    
    const stats = await db.get(`
        SELECT 
            COUNT(*) as total_kicks,
            COUNT(CASE WHEN kick_reason LIKE '%afk%' OR kick_reason LIKE '%AFK%' THEN 1 END) as afk_kicks,
            COUNT(CASE WHEN kick_reason LIKE '%toxique%' OR kick_reason LIKE '%toxic%' THEN 1 END) as toxic_kicks,
            SUM(CASE WHEN kicked_at IS NOT NULL THEN -points_gained ELSE 0 END) as total_kick_malus,
            MAX(kicked_at) as last_kick
        FROM participants 
        WHERE discord_id = ? AND kicked_at IS NOT NULL
    `, [discordId]);
    
    return stats;
}

/**
 * Obtenir les raisons d'exclusion les plus fréquentes
 * @returns {Promise<Array>} - Statistiques des raisons
 */
async function getKickReasonsStats() {
    const db = getDb();
    
    return await db.all(`
        SELECT 
            kick_reason,
            COUNT(*) as count,
            SUM(-points_gained) as total_malus
        FROM participants 
        WHERE kicked_at IS NOT NULL 
        GROUP BY kick_reason 
        ORDER BY count DESC
        LIMIT 10
    `);
}

/**
 * Annuler une exclusion (dans certains cas exceptionnels)
 * @param {number} pacteId - ID du pacte
 * @param {string} discordId - ID Discord du participant
 * @param {string} adminDiscordId - ID Discord de l'admin qui annule
 * @returns {Promise<Object>} - Résultat de l'annulation
 */
async function unkickParticipant(pacteId, discordId, adminDiscordId) {
    const db = getDb();
    
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Vérifier que l'utilisateur a bien été exclu
        const participant = await db.get(
            'SELECT * FROM participants WHERE pacte_id = ? AND discord_id = ? AND kicked_at IS NOT NULL',
            [pacteId, discordId]
        );
        
        if (!participant) {
            await db.run('ROLLBACK');
            throw new Error('Ce participant n\'a pas été exclu ou n\'existe pas');
        }
        
        // Vérifier que le pacte est encore actif
        const pacte = await db.get('SELECT * FROM pactes WHERE id = ? AND status IN ("pending", "active")', pacteId);
        
        if (!pacte) {
            await db.run('ROLLBACK');
            throw new Error('Ce pacte n\'est plus actif, impossible d\'annuler l\'exclusion');
        }
        
        // Rembourser le malus
        const malus = -participant.points_gained;
        await updateUserPoints(discordId, malus);
        
        // Annuler l'exclusion
        await db.run(
            'UPDATE participants SET kicked_at = NULL, kick_reason = NULL, points_gained = 0 WHERE pacte_id = ? AND discord_id = ?',
            [pacteId, discordId]
        );
        
        await db.run('COMMIT');
        
        const user = await db.get('SELECT summoner_name FROM users WHERE discord_id = ?', discordId);
        const admin = await db.get('SELECT summoner_name FROM users WHERE discord_id = ?', adminDiscordId);
        
        logger.warn(`UNKICK - Pacte #${pacteId}: Exclusion de ${user?.summoner_name || discordId} annulée par ${admin?.summoner_name || adminDiscordId}. Malus remboursé: +${malus} points`);
        
        return {
            success: true,
            refundedPoints: malus,
            userName: user?.summoner_name || 'Utilisateur inconnu',
            adminName: admin?.summoner_name || 'Admin inconnu'
        };
        
    } catch (error) {
        await db.run('ROLLBACK');
        logger.error(`Erreur lors de l'annulation de l'exclusion du participant ${discordId} du pacte #${pacteId}:`, error);
        throw error;
    }
}

module.exports = {
    kickParticipant,
    getKickInfo,
    getPacteKickHistory,
    getUserKickStats,
    getKickReasonsStats,
    unkickParticipant
};
