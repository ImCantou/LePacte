const { getDb } = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Service pour gérer l'historique des games et éviter les doublons
 */

/**
 * Vérifier si un match a déjà été traité pour un pacte donné
 * @param {string} matchId - ID du match Riot
 * @param {number} pacteId - ID du pacte
 * @returns {Promise<boolean>} - true si déjà traité
 */
async function isMatchAlreadyProcessed(matchId, pacteId) {
    const db = getDb();
    
    const existing = await db.get(
        'SELECT match_id FROM game_history WHERE match_id = ? AND pacte_id = ?',
        [matchId, pacteId]
    );
    
    return !!existing;
}

/**
 * Enregistrer un match comme traité
 * @param {string} matchId - ID du match Riot
 * @param {number} pacteId - ID du pacte
 * @param {string} result - 'win' ou 'loss'
 */
async function recordProcessedMatch(matchId, pacteId, result) {
    const db = getDb();
    
    try {
        await db.run(
            'INSERT OR IGNORE INTO game_history (match_id, pacte_id, result) VALUES (?, ?, ?)',
            [matchId, pacteId, result]
        );
        
        logger.info(`Match ${matchId} recorded for pacte ${pacteId}: ${result}`);
    } catch (error) {
        logger.error(`Error recording match ${matchId}:`, error);
        throw error;
    }
}

/**
 * Obtenir l'historique des matches d'un pacte
 * @param {number} pacteId - ID du pacte
 * @returns {Promise<Array>} - Liste des matches traités
 */
async function getPacteMatchHistory(pacteId) {
    const db = getDb();
    
    return await db.all(
        'SELECT * FROM game_history WHERE pacte_id = ? ORDER BY processed_at DESC',
        [pacteId]
    );
}

/**
 * Nettoyer l'historique des matches anciens (plus de 30 jours)
 * @returns {Promise<number>} - Nombre de records supprimés
 */
async function cleanupOldMatchHistory() {
    const db = getDb();
    
    const result = await db.run(
        'DELETE FROM game_history WHERE processed_at < datetime("now", "-30 days")'
    );
    
    if (result.changes > 0) {
        logger.info(`Cleaned up ${result.changes} old match records`);
    }
    
    return result.changes;
}

/**
 * Obtenir les statistiques de l'historique des matches
 * @returns {Promise<Object>} - Statistiques
 */
async function getMatchHistoryStats() {
    const db = getDb();
    
    const stats = await db.get(`
        SELECT 
            COUNT(*) as total_matches,
            COUNT(CASE WHEN result = 'win' THEN 1 END) as wins,
            COUNT(CASE WHEN result = 'loss' THEN 1 END) as losses,
            COUNT(DISTINCT pacte_id) as unique_pactes,
            MIN(processed_at) as oldest_record,
            MAX(processed_at) as newest_record
        FROM game_history
    `);
    
    return {
        ...stats,
        win_rate: stats.total_matches > 0 ? ((stats.wins / stats.total_matches) * 100).toFixed(2) : 0
    };
}

/**
 * Vérifier si un match est valide pour être traité
 * @param {string} matchId - ID du match
 * @param {number} pacteId - ID du pacte
 * @param {Date} gameEndTime - Date de fin du match
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function validateMatchForProcessing(matchId, pacteId, gameEndTime) {
    // Vérifier si déjà traité
    if (await isMatchAlreadyProcessed(matchId, pacteId)) {
        return {
            valid: false,
            reason: 'Match already processed'
        };
    }
    
    // Vérifier si le match n'est pas trop ancien (plus de 2 heures)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (gameEndTime < twoHoursAgo) {
        return {
            valid: false,
            reason: 'Match too old (more than 2 hours)'
        };
    }
    
    // Vérifier si le match n'est pas dans le futur
    if (gameEndTime > new Date()) {
        return {
            valid: false,
            reason: 'Match in the future'
        };
    }
    
    return { valid: true };
}

/**
 * Mettre à jour le timestamp last_checked d'un pacte
 * @param {number} pacteId - ID du pacte
 */
async function updatePacteLastChecked(pacteId) {
    const db = getDb();
    
    await db.run(
        'UPDATE pactes SET last_checked = CURRENT_TIMESTAMP WHERE id = ?',
        [pacteId]
    );
}

/**
 * Obtenir les pactes qui ont besoin d'être vérifiés (optimisation du polling)
 * @param {number} checkIntervalMinutes - Intervalle minimum entre les vérifications
 * @returns {Promise<Array>} - Liste des pactes à vérifier
 */
async function getPactesToCheck(checkIntervalMinutes = 0.5) {
    const db = getDb();
    
    // Prioriser les pactes in_game ou jamais vérifiés
    return await db.all(`
        SELECT p.*, GROUP_CONCAT(part.discord_id) as participants
        FROM pactes p
        JOIN participants part ON p.id = part.pacte_id
        WHERE p.status = 'active'
        AND part.signed_at IS NOT NULL
        AND part.left_at IS NULL
        AND part.kicked_at IS NULL
        AND (
            p.in_game = 1  -- Toujours vérifier si en game
            OR p.last_checked IS NULL  -- Jamais vérifié
            OR datetime(p.last_checked, '+${checkIntervalMinutes} minutes') <= datetime('now')
        )
        GROUP BY p.id
        ORDER BY 
            p.in_game DESC,  -- Priorité aux parties en cours
            p.last_checked ASC  -- Puis les plus anciens
    `);
}

module.exports = {
    isMatchAlreadyProcessed,
    recordProcessedMatch,
    getPacteMatchHistory,
    cleanupOldMatchHistory,
    getMatchHistoryStats,
    validateMatchForProcessing,
    updatePacteLastChecked,
    getPactesToCheck
};
