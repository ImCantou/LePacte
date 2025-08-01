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
    
    // Démarrer une transaction
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Check if any participant already has an active pacte
        for (const discordId of participants) {
            const activePacte = await db.get(
                `SELECT p.id FROM pactes p
                 JOIN participants part ON p.id = part.pacte_id
                 WHERE part.discord_id = ? AND p.status IN ('pending', 'active') AND part.left_at IS NULL`,
                discordId
            );
            
            if (activePacte) {
                await db.run('ROLLBACK');
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
        
        await db.run('COMMIT');
        
        logger.warn(`Pacte created: #${pacteId} with ${participants.length} participants`);
        return pacteId;
        
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
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
    
    // Démarrer une transaction pour éviter les conditions de course
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Vérifier d'abord si déjà signé (avec verrouillage)
        const participant = await db.get(
            'SELECT signed_at FROM participants WHERE pacte_id = ? AND discord_id = ?',
            [pacteId, discordId]
        );
        
        if (!participant) {
            await db.run('ROLLBACK');
            throw new Error('Vous n\'êtes pas participant de ce pacte');
        }
        
        if (participant.signed_at !== null) {
            await db.run('ROLLBACK');
            throw new Error('Utilisateur a déjà signé ce pacte');
        }
        
        // Marquer comme signé
        await db.run(
            'UPDATE participants SET signed_at = CURRENT_TIMESTAMP WHERE pacte_id = ? AND discord_id = ? AND signed_at IS NULL',
            [pacteId, discordId]
        );
        
        // Vérifier si tous ont signé
        const counts = await db.get(
            `SELECT 
                COUNT(*) as total,
                COUNT(signed_at) as signed
             FROM participants 
             WHERE pacte_id = ? AND left_at IS NULL`,
            pacteId
        );
        
        let allSigned = false;
        if (counts.signed === counts.total) {
            // Tous ont signé, activer le pacte
            await db.run(
                'UPDATE pactes SET status = "active", started_at = CURRENT_TIMESTAMP WHERE id = ?',
                pacteId
            );
            allSigned = true;
        }
        
        // Récupérer les noms des participants pour les logs
        const participantNames = await db.all(
            `SELECT u.summoner_name 
             FROM users u 
             JOIN participants p ON u.discord_id = p.discord_id 
             WHERE p.pacte_id = ? AND p.signed_at IS NOT NULL AND p.left_at IS NULL`,
            pacteId
        );
        
        await db.run('COMMIT');
        
        logger.warn(`Pacte #${pacteId}: ${discordId} a signé. Status: ${allSigned ? 'ACTIVÉ' : counts.signed + '/' + counts.total}`);
        
        return {
            allSigned,
            signedCount: counts.signed,
            totalParticipants: counts.total,
            participantNames: participantNames.map(p => p.summoner_name).join(', '),
            isNewParticipant: participant.signed_at === null && counts.signed > 1 // Nouveau si pas déjà signé et pas le premier
        };
        
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function getPendingPactes(channelId) {
    const db = getDb();
    
    const pactes = await db.all(
        `SELECT 
            p.id, 
            p.objective, 
            p.status,
            p.created_at,
            GROUP_CONCAT(DISTINCT part.discord_id) as participants,
            GROUP_CONCAT(CASE WHEN part.signed_at IS NOT NULL THEN part.discord_id END) as signed_participants
         FROM pactes p
         JOIN participants part ON p.id = part.pacte_id
         WHERE p.log_channel_id = ? 
           AND p.status IN ('pending', 'active')  -- Inclure les deux statuts
           AND part.left_at IS NULL
           AND part.kicked_at IS NULL
           AND (
               p.status = 'pending' OR 
               (p.status = 'active' AND p.current_wins = 0)  -- Pacte actif mais pas encore commencé
           )
           AND datetime(p.created_at, '+5 minutes') > datetime('now')
         GROUP BY p.id`,
        channelId
    );
    
    return pactes.map(pacte => ({
        id: pacte.id,
        objective: pacte.objective,
        status: pacte.status,
        created_at: pacte.created_at,
        participants: pacte.participants ? pacte.participants.split(',') : [],
        signed_participants: pacte.signed_participants ? pacte.signed_participants.split(',').filter(Boolean) : []
    }));
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
    
    // Démarrer une transaction pour assurer la cohérence
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Vérifier que l'utilisateur est bien dans le pacte et qu'il ne l'a pas déjà quitté
        const participant = await db.get(
            'SELECT * FROM participants WHERE pacte_id = ? AND discord_id = ? AND left_at IS NULL',
            [pacteId, discordId]
        );
        
        if (!participant) {
            await db.run('ROLLBACK');
            throw new Error('Vous n\'êtes pas dans ce pacte ou l\'avez déjà quitté');
        }
        
        // Récupérer les infos du pacte pour les logs
        const pacte = await db.get('SELECT * FROM pactes WHERE id = ?', pacteId);
        const user = await db.get('SELECT summoner_name FROM users WHERE discord_id = ?', discordId);
        
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
        
        let pacteStatus = 'active';
        if (activeParticipants.count === 0) {
            // Tous les participants sont partis, échec du pacte
            await db.run(
                'UPDATE pactes SET status = "failed", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                pacteId
            );
            pacteStatus = 'failed';
        }
        
        await db.run('COMMIT');
        
        // Log important pour suivi
        logger.warn(`ABANDON - Pacte #${pacteId}: ${user?.summoner_name || discordId} a quitté le pacte. Malus: -${malus} points. Pacte status: ${pacteStatus}. Participants restants: ${activeParticipants.count}`);
        
        return {
            success: true,
            pacteStatus,
            remainingParticipants: activeParticipants.count,
            userName: user?.summoner_name || 'Utilisateur inconnu'
        };
        
    } catch (error) {
        await db.run('ROLLBACK');
        logger.error(`Erreur lors de l'abandon du pacte #${pacteId} par ${discordId}:`, error);
        throw error;
    }
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
    
    // Démarrer une transaction
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Vérifier si déjà dans un pacte actif
        const activePacte = await db.get(
            `SELECT p.id FROM pactes p
             JOIN participants part ON p.id = part.pacte_id
             WHERE part.discord_id = ? AND p.status IN ('pending', 'active') AND part.left_at IS NULL`,
            discordId
        );
        
        if (activePacte) {
            await db.run('ROLLBACK');
            throw new Error('Vous avez déjà un pacte actif !');
        }
        
        // Vérifier si déjà dans ce pacte
        const existing = await db.get(
            'SELECT * FROM participants WHERE pacte_id = ? AND discord_id = ?',
            [pacteId, discordId]
        );
        
        if (existing) {
            await db.run('ROLLBACK');
            throw new Error('Vous êtes déjà dans ce pacte !');
        }
        
        // Vérifier si le pacte peut encore accueillir des participants
        const participantCount = await db.get(
            'SELECT COUNT(*) as count FROM participants WHERE pacte_id = ? AND left_at IS NULL',
            pacteId
        );
        
        if (participantCount.count >= 5) {
            await db.run('ROLLBACK');
            throw new Error('Ce pacte est complet (5 participants maximum) !');
        }
        
        // Ajouter comme participant
        await db.run(
            'INSERT INTO participants (pacte_id, discord_id) VALUES (?, ?)',
            [pacteId, discordId]
        );
        
        await db.run('COMMIT');
        
        logger.warn(`User ${discordId} joined pacte #${pacteId}`);
        
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
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
    logger.warn('Monthly points reset');
}

async function cleanupExpiredPactes() {
    const db = getDb();
    
    // Marquer les pactes en attente expirés comme échoués
    const result = await db.run(
        `UPDATE pactes 
         SET status = 'failed', completed_at = CURRENT_TIMESTAMP 
         WHERE status = 'pending' 
           AND datetime(created_at, '+5 minutes') <= datetime('now')`
    );
    
    if (result.changes > 0) {
        logger.warn(`Cleaned up ${result.changes} expired pactes`);
    }
    
    return result.changes;
}

async function kickParticipant(pacteId, discordId, malus, reason) {
    const db = getDb();
    
    await db.run('BEGIN TRANSACTION');
    
    try {
        // Marquer comme kicked
        await db.run(
            `UPDATE participants 
             SET kicked_at = CURRENT_TIMESTAMP, 
                 points_gained = ?, 
                 kick_reason = ? 
             WHERE pacte_id = ? AND discord_id = ?`,
            [-malus, reason, pacteId, discordId]
        );
        
        // Appliquer le malus
        await updateUserPoints(discordId, -malus);
        
        // Vérifier s'il reste des participants
        const remaining = await db.get(
            `SELECT COUNT(*) as count 
             FROM participants 
             WHERE pacte_id = ? 
               AND signed_at IS NOT NULL 
               AND left_at IS NULL 
               AND kicked_at IS NULL`,
            pacteId
        );
        
        if (remaining.count === 0) {
            await db.run(
                'UPDATE pactes SET status = "failed", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                pacteId
            );
        }
        
        await db.run('COMMIT');
        
        logger.warn(`User ${discordId} kicked from pacte #${pacteId}. Reason: ${reason}. Malus: -${malus}`);
        
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

async function isParticipant(pacteId, discordId) {
    const db = getDb();
    const result = await db.get(
        `SELECT 1 FROM participants 
         WHERE pacte_id = ? AND discord_id = ? 
           AND signed_at IS NOT NULL 
           AND left_at IS NULL 
           AND kicked_at IS NULL`,
        [pacteId, discordId]
    );
    return !!result;
}

module.exports = {
    createUser,
    getUserByDiscordId,
    getUserByPuuid,
    updateUserPoints,
    createPacte,
    checkIfSigned,
    signPacte,
    getPendingPactes,
    getActivePactes,
    getActiveUserPacte,
    updatePacteStatus,
    completePacte,
    getPacteParticipants,
    leavePacte,
    getJoinablePacte,
    resetMonthlyPoints,
    cleanupExpiredPactes,
    kickParticipant,
    isParticipant
};
