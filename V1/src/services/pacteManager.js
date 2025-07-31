const { getCurrentGame, getMatchHistory, getMatchDetails } = require('./riotApi');
const { getActivePactes, updatePacteStatus, completePacte: completeInDb, getPacteParticipants: getFromDb } = require('./userManager');
const { calculatePoints, calculateMalus } = require('./pointsCalculator');
const logger = require('../utils/logger');

let pollingInterval;

async function startPolling(client) {
    logger.info('Starting pacte polling...');
    
    pollingInterval = setInterval(async () => {
        await checkAllPactes(client);
    }, 10000); // Every 10 seconds
}

async function checkAllPactes(client) {
    try {
        const activePactes = await getActivePactes();
        
        for (const pacte of activePactes) {
            await checkPacteProgress(pacte, client);
        }
    } catch (error) {
        logger.error('Error in pacte polling:', error);
    }
}

async function checkPacteProgress(pacte, client) {
    const participants = await getPacteParticipants(pacte.id);
    
    // Check if all participants are in same ARAM
    const currentGame = await checkIfInSameARAM(participants);
    
    if (currentGame) {
        await updatePacteStatus(pacte.id, { in_game: true });
        return;
    }
    
    // If was in game, check result
    if (pacte.in_game) {
        const lastGame = await getLastGameResult(participants);
        
        if (lastGame) {
            await processGameResult(pacte, lastGame, client);
        }
    }
}

async function checkIfInSameARAM(participants) {
    let gameId = null;
    
    for (const participant of participants) {
        const currentGame = await getCurrentGame(participant.riot_puuid);
        
        if (!currentGame) return null;
        if (currentGame.gameQueueConfigId !== 450) return null; // Not ARAM
        
        if (gameId === null) {
            gameId = currentGame.gameId;
        } else if (gameId !== currentGame.gameId) {
            return null; // Not in same game
        }
    }
    
    return gameId;
}

async function getLastGameResult(participants) {
    const matchIds = await getMatchHistory(participants[0].riot_puuid, 1);
    if (matchIds.length === 0) return null;
    
    const matchDetails = await getMatchDetails(matchIds[0]);
    
    const participantPuuids = participants.map(p => p.riot_puuid);
    const gameParticipants = matchDetails.info.participants;
    
    let allInGame = true;
    let won = false;
    
    for (const puuid of participantPuuids) {
        const participant = gameParticipants.find(p => p.puuid === puuid);
        if (!participant) {
            allInGame = false;
            break;
        }
        won = participant.win;
    }
    
    if (!allInGame) return null;
    
    return { win: won, matchId: matchIds[0] };
}

async function processGameResult(pacte, gameResult, client) {
    const channel = client.channels.cache.get(pacte.log_channel_id);
    
    if (gameResult.win) {
        const newWins = pacte.current_wins + 1;
        
        if (newWins >= pacte.objective) {
            // Pacte success
            const points = calculatePoints(pacte.objective, pacte.objective);
            await completePacte(pacte.id, true, points);
            
            await channel.send({
                content: `🎉 **PACTE RÉUSSI !** ${pacte.objective} victoires consécutives ! +${points} points !`
            });
        } else {
            // Continue
            await updatePacteStatus(pacte.id, { 
                current_wins: newWins,
                best_streak_reached: Math.max(pacte.best_streak_reached, newWins),
                in_game: false
            });
            
            await channel.send({
                content: `✅ Victoire ! ${newWins}/${pacte.objective} ${getRandomTaunt(pacte)}`
            });
        }
    } else {
        // Defeat - pacte might fail
        const bestStreak = Math.max(pacte.best_streak_reached, pacte.current_wins);
        
        if (pacte.current_wins === pacte.objective - 1) {
            await channel.send(`💔 Si proche... Défaite à 1 victoire de l'objectif !`);
        }
        
        // Reset or fail based on time
        const hoursElapsed = (Date.now() - new Date(pacte.created_at).getTime()) / 3600000;
        
        if (hoursElapsed >= 24) {
            // Pacte failed
            const points = calculatePoints(pacte.objective, bestStreak);
            const malus = calculateMalus(pacte.objective, bestStreak);
            
            await completePacte(pacte.id, false, points - malus);
            await channel.send({
                content: `❌ **PACTE ÉCHOUÉ** - Temps écoulé. Meilleure série: ${bestStreak}/${pacte.objective}. ${points > 0 ? `+${points}` : `${malus}`} points`
            });
        } else {
            // Reset counter
            await updatePacteStatus(pacte.id, { 
                current_wins: 0,
                best_streak_reached: bestStreak,
                in_game: false
            });
            
            await channel.send({
                content: `💀 Défaite ! Retour à 0/${pacte.objective}. Il reste ${24 - Math.floor(hoursElapsed)}h.`
            });
        }
    }
}

async function completePacte(pacteId, success, points) {
    await completeInDb(pacteId, success, points);
}

async function getPacteParticipants(pacteId) {
    return await getFromDb(pacteId);
}

function getRandomTaunt(pacte) {
    const taunts = [
        "Toujours là ?",
        "La pression monte...",
        "Une de plus ou c'est fini ?",
        "Les dieux de l'ARAM vous observent",
        "L'Abîme Hurlant retient son souffle..."
    ];
    
    if (pacte.current_wins === pacte.objective - 1) {
        return "**C'EST LA DERNIÈRE !**";
    }
    
    return taunts[Math.floor(Math.random() * taunts.length)];
}

module.exports = {
    startPolling,
    checkPacteProgress
};
