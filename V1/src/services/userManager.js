const { getDb } = require('../utils/database');
const logger = require('../utils/logger');

async function createUser(discordId, riotPuuid, summonerName) {
    const db = getDb();
    try {
        await db.run(
            'INSERT INTO users (discord_id, riot_puuid, summoner_name) VALUES (?, ?, ?)',
            [discordId, riotPuuid, summonerName]
        );
        logger.info(`User created: ${summonerName} (${discordId})`);
        return true;
    } catch (error) {
        logger.error('Error creating user:', error);
        throw error;
    }
}

async function getUserByDiscordId(discordId) {
    const db = getDb();
    return await db.get('SELECT * FROM users WHERE discord_id = ?', discordId);
}

async function getUserByPuuid(puuid) {
    const db = getDb();
    return await db.get('SELECT * FROM users WHERE riot_puuid = ?', puuid);
}

async function updateUserPoints(discordId, pointsDelta) {
    const db = getDb();
    await db.run(
        `UPDATE users 
         SET points_total = points_total + ?, 
             points_monthly = points_monthly + ? 
         WHERE discord_id = ?`,
        [pointsDelta, pointsDelta, discordId]
    );
}

async function createPacte(objective, participants, channelId) {
    const db = getDb();
    
    // Check if any participant already has an active pacte
    for (const discordId of participants) {
        const activePacte = await getActiveUserPacte(discordId);
        if (activePacte) {
            throw new Error(`<@${discordId}> a déjà un pacte actif !`);
        }
    }
    
    // Create pacte
    const result = await db.run(
        'INSERT INTO pactes (objective, log_channel_id) VALUES (?, ?)',
        [objective, channelId]
    );
    
    const pacteId = result.lastID;
    
    // Add participants
    for (const discordId of participants) {
        await db.run(
            'INSERT INTO participants (pacte_id, discord_id) VALUES (?, ?)',
            [pacteId, discordId]
        );
    }
    
    logger.info(`Pacte created: #${pacteId} with ${participants.length} participants`);
    return pacteId;
}

async function checkIfSigned(pacteId, discordId) {
    const db = getDb();
    const result = await db.get(
        'SELECT signed_at FROM participants WHERE pacte_id = ? AND discord_id = ?',
        [pacteId, discordId]
    );
    return result && result.signed_at !== null;
}

async function signPacte(pacteId, discordId) {
    const db = getDb();
    
    // Vérifier d'abord si déjà signé pour éviter les doublons
    const alreadySigned = await checkIfSigned(pacteId, discordId);
    if (alreadySigned) {
        throw new Error('Utilisateur a déjà signé ce pacte');
    }
    
    await db.run(
        'UPDATE participants SET signed_at = CURRENT_TIMESTAMP WHERE pacte_id = ? AND discord_id = ? AND signed_at IS NULL',
        [pacteId, discordId]
    );
    
    // Check if all signed
    const allParticipants = await db.get(
        'SELECT COUNT(*) as total FROM participants WHERE pacte_id = ?',
        pacteId
    );
    
    const signedParticipants = await db.get(
        'SELECT COUNT(*) as signed FROM participants WHERE pacte_id = ? AND signed_at IS NOT NULL',
        pacteId
    );
    
    if (signedParticipants.signed === allParticipants.total) {
        // All signed, activate pacte
        await db.run(
            'UPDATE pactes SET status = "active", started_at = CURRENT_TIMESTAMP WHERE id = ?',
            pacteId
        );
        return true;
    }
    
    return false;
}

async function getActivePactes() {
    const db = getDb();
    return await db.all(
        `SELECT p.*, GROUP_CONCAT(part.discord_id) as participants
         FROM pactes p
         JOIN participants part ON p.id = part.pacte_id
         WHERE p.status = 'active'
         GROUP BY p.id`
    );
}

async function getActiveUserPacte(discordId) {
    const db = getDb();
    return await db.get(
        `SELECT p.* FROM pactes p
         JOIN participants part ON p.id = part.pacte_id
         WHERE part.discord_id = ? AND p.status IN ('pending', 'active')`,
        discordId
    );
}

async function updatePacteStatus(pacteId, updates) {
    const db = getDb();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(pacteId);
    
    await db.run(
        `UPDATE pactes SET ${fields} WHERE id = ?`,
        values
    );
}

async function completePacte(pacteId, success, pointsPerPlayer) {
    const db = getDb();
    
    // Update pacte status
    await db.run(
        'UPDATE pactes SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [success ? 'success' : 'failed', pacteId]
    );
    
    // Update participants points
    const participants = await db.all(
        'SELECT discord_id FROM participants WHERE pacte_id = ? AND signed_at IS NOT NULL',
        pacteId
    );
    
    for (const participant of participants) {
        await updateUserPoints(participant.discord_id, pointsPerPlayer);
        await db.run(
            'UPDATE participants SET points_gained = ? WHERE pacte_id = ? AND discord_id = ?',
            [pointsPerPlayer, pacteId, participant.discord_id]
        );
    }
    
    logger.info(`Pacte #${pacteId} completed: ${success ? 'SUCCESS' : 'FAILED'} (${pointsPerPlayer} points per player)`);
}

async function getPacteParticipants(pacteId) {
    const db = getDb();
    return await db.all(
        `SELECT u.* FROM users u
         JOIN participants p ON u.discord_id = p.discord_id
         WHERE p.pacte_id = ? AND p.signed_at IS NOT NULL`,
        pacteId
    );
}

async function leavePacte(pacteId, discordId, malus) {
    const db = getDb();
    
    // Marquer comme parti
    await db.run(
        'UPDATE participants SET left_at = CURRENT_TIMESTAMP, points_gained = ? WHERE pacte_id = ? AND discord_id = ?',
        [-malus, pacteId, discordId]
    );
    
    // Appliquer le malus
    await updateUserPoints(discordId, -malus);
    
    // Vérifier s'il reste des participants actifs
    const activeParticipants = await db.get(
        'SELECT COUNT(*) as count FROM participants WHERE pacte_id = ? AND signed_at IS NOT NULL AND left_at IS NULL',
        pacteId
    );
    
    if (activeParticipants.count === 0) {
        // Tous les participants sont partis, échec du pacte
        await db.run(
            'UPDATE pactes SET status = "failed", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
            pacteId
        );
    }
    
    logger.info(`User ${discordId} left pacte #${pacteId} with malus: -${malus}`);
}

async function getJoinablePacte(channelId) {
    const db = getDb();
    return await db.get(
        `SELECT p.* FROM pactes p
         WHERE p.log_channel_id = ? 
         AND p.status = 'active' 
         AND p.current_wins = 0
         AND (SELECT COUNT(*) FROM participants WHERE pacte_id = p.id AND signed_at IS NOT NULL) < 5`,
        channelId
    );
}

async function getAllJoinablePactes(channelId) {
    const db = getDb();
    return await db.all(
        `SELECT p.*, 
                (SELECT COUNT(*) FROM participants WHERE pacte_id = p.id AND signed_at IS NOT NULL) as participant_count
         FROM pactes p
         WHERE p.log_channel_id = ? 
         AND p.status IN ('pending', 'active')
         AND p.current_wins = 0
         AND (SELECT COUNT(*) FROM participants WHERE pacte_id = p.id AND signed_at IS NOT NULL) < 5`,
        channelId
    );
}

async function joinPacte(pacteId, discordId) {
    const db = getDb();
    
    // Vérifier si déjà dans un pacte actif
    const activePacte = await getActiveUserPacte(discordId);
    if (activePacte) {
        throw new Error('Vous avez déjà un pacte actif !');
    }
    
    // Vérifier si déjà dans ce pacte
    const existing = await db.get(
        'SELECT * FROM participants WHERE pacte_id = ? AND discord_id = ?',
        [pacteId, discordId]
    );
    
    if (existing) {
        throw new Error('Vous êtes déjà dans ce pacte !');
    }
    
    // Ajouter comme participant
    await db.run(
        'INSERT INTO participants (pacte_id, discord_id) VALUES (?, ?)',
        [pacteId, discordId]
    );
    
    logger.info(`User ${discordId} joined pacte #${pacteId}`);
}

async function updateBestStreak(discordId, streak) {
    const db = getDb();
    await db.run(
        'UPDATE users SET best_streak_ever = MAX(best_streak_ever, ?) WHERE discord_id = ?',
        [streak, discordId]
    );
}

async function resetMonthlyPoints() {
    const db = getDb();
    await db.run('UPDATE users SET points_monthly = 0');
    logger.info('Monthly points reset');
}

module.exports = {
    createUser,
    getUserByDiscordId,
    getUserByPuuid,
    updateUserPoints,
    createPacte,
    checkIfSigned,
    signPacte,
    getActivePactes,
    getActiveUserPacte,
    updatePacteStatus,
    completePacte,
    getPacteParticipants,
    leavePacte,
    getJoinablePacte,
    getAllJoinablePactes,
    joinPacte,
    updateBestStreak,
    resetMonthlyPoints
};
