const { getRiotAPI } = require('./riotApi');
const { getActivePactes, updatePacteStatus } = require('./userManager');
const { calculatePoints } = require('./pointsCalculator');
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
        pacte.inGame = true;
        await updatePacteStatus(pacte.id, { in_game: true });
        return;
    }
    
    // If was in game, check result
    if (pacte.inGame) {
        const lastGame = await getLastGameResult(participants);
        
        if (lastGame) {
            await processGameResult(pacte, lastGame, client);
        }
    }
}

async function processGameResult(pacte, gameResult, client) {
    const channel = client.channels.cache.get(pacte.logChannelId);
    
    if (gameResult.win) {
        pacte.currentWins++;
        
        if (pacte.currentWins >= pacte.objective) {
            // Pacte success
            const points = calculatePoints(pacte.objective, pacte.objective);
            await completePacte(pacte, true, points);
            
            await channel.send({
                content: `🎉 **PACTE RÉUSSI !** ${pacte.objective} victoires consécutives ! +${points} points !`
            });
        } else {
            // Continue
            await updatePacteStatus(pacte.id, { 
                current_wins: pacte.currentWins,
                best_streak: Math.max(pacte.bestStreak, pacte.currentWins)
            });
            
            await channel.send({
                content: `✅ Victoire ! ${pacte.currentWins}/${pacte.objective} ${getRandomTaunt(pacte)}`
            });
        }
    } else {
        // Defeat - pacte might fail
        const bestStreak = Math.max(pacte.bestStreak, pacte.currentWins);
        
        if (pacte.currentWins === pacte.objective - 1) {
            await channel.send(`💔 Si proche... Défaite à 1 victoire de l'objectif !`);
        }
        
        // Reset or fail based on time
        const hoursElapsed = (Date.now() - pacte.createdAt) / 3600000;
        
        if (hoursElapsed >= 24) {
            // Pacte failed
            const points = calculatePoints(pacte.objective, bestStreak);
            const malus = calculateMalus(pacte.objective, bestStreak);
            
            await completePacte(pacte, false, points - malus);
            await channel.send({
                content: `❌ **PACTE ÉCHOUÉ** - Temps écoulé. Meilleure série: ${bestStreak}/${pacte.objective}. ${points > 0 ? `+${points}` : `${malus}`} points`
            });
        } else {
            // Reset counter
            await updatePacteStatus(pacte.id, { 
                current_wins: 0,
                best_streak: bestStreak
            });
            
            await channel.send({
                content: `💀 Défaite ! Retour à 0/${pacte.objective}. Il reste ${24 - Math.floor(hoursElapsed)}h.`
            });
        }
    }
}

function getRandomTaunt(pacte) {
    const taunts = [
        "Toujours là ?",
        "La pression monte...",
        "Une de plus ou c'est fini ?",
        "Les dieux de l'ARAM vous observent",
        "L'Abîme Hurlant retient son souffle..."
    ];
    
    if (pacte.currentWins === pacte.objective - 1) {
        return "**C'EST LA DERNIÈRE !**";
    }
    
    return taunts[Math.floor(Math.random() * taunts.length)];
}

module.exports = {
    startPolling,
    checkPacteProgress
};