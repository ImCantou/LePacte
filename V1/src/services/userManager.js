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

async function signPacte(pacteId, discordId) {
    const db = getDb();
    await db.run(
        'UPDATE participants SET signed_at = CURRENT_TIMESTAMP WHERE pacte_id = ? AND discord_id = ?',
        [pacteId, discordId]
    );
    
    // Check if all signed
    const unsigned = await db.get(
        'SELECT COUNT(*) as count FROM participants WHERE pacte_id = ? AND signed_at IS NULL',
        pacteId
    );
    
    if (unsigned.count === 0) {
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

module.exports = {
    createUser,
    getUserByDiscordId,
    getUserByPuuid,
    updateUserPoints,
    createPacte,
    signPacte,
    getActivePactes,
    getActiveUserPacte,
    updatePacteStatus,
    completePacte,
    getPacteParticipants
};