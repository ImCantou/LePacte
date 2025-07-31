const { getCurrentGame, getMatchHistory, getMatchDetails } = require('./riotApi');
const { getActivePactes, updatePacteStatus, completePacte: completeInDb, getPacteParticipants: getFromDb } = require('./userManager');
const { calculatePoints, calculateMalus } = require('./pointsCalculator');
const { TAUNTS } = require('../utils/constants');
const { 
    isMatchAlreadyProcessed, 
    recordProcessedMatch, 
    validateMatchForProcessing,
    updatePacteLastChecked,
    getPactesToCheck 
} = require('./gameHistoryService');
const { getDb } = require('../utils/database');
const logger = require('../utils/logger');

let pollingInterval;
let pollingCounter = 0; // Compteur pour logs conditionnels

async function startPolling(client) {
    logger.info('Starting pacte polling...');
    
    pollingInterval = setInterval(async () => {
        await checkAllPactes(client);
    }, 10000); // Every 10 seconds
}

async function checkAllPactes(client) {
    try {
        // Utiliser la nouvelle fonction optimisée pour récupérer seulement les pactes qui ont besoin d'être vérifiés
        const pactes = await getPactesToCheck(2); // Vérifier max toutes les 2 minutes
        
        if (pactes.length > 0) {
            // Log uniquement toutes les 10 itérations pour réduire le spam
            if (pollingCounter % 10 === 0) {
                logger.info(`Checking ${pactes.length} active pactes (${pollingCounter} iterations)`);
            }
            
            for (const pacte of pactes) {
                await checkPacteProgress(pacte, client);
                // Mettre à jour le timestamp de vérification
                await updatePacteLastChecked(pacte.id);
            }
        }
        
        pollingCounter++;
    } catch (error) {
        logger.error('Error checking pactes:', error);
    }
}

async function checkPacteProgress(pacte, client) {
    const participants = await getPacteParticipants(pacte.id);
    
    // Check if all participants are in same ARAM
    const currentGame = await checkIfInSameARAM(participants);
    
    if (currentGame) {
        // Nouveau : logger quand on détecte une game
        if (!pacte.in_game) {
            logger.warn(`Game detected for pacte #${pacte.id}`);
            const channel = client.channels.cache.get(pacte.log_channel_id);
            if (channel) {
                await channel.send(`🎮 **Partie détectée !** Pacte #${pacte.id} - Bonne chance dans l'Abîme !`);
            }
        }
        await updatePacteStatus(pacte.id, { in_game: true, last_checked: new Date().toISOString() });
        return;
    }
    
    // Si on était en game, vérifier le résultat
    if (pacte.in_game) {
        // Attendre un peu plus après la fin de game (l'API a du délai)
        const lastChecked = new Date(pacte.last_checked || pacte.created_at);
        const timeSinceLastCheck = Date.now() - lastChecked.getTime();
        
        // Attendre au moins 2 minutes après la détection avant de chercher le résultat
        if (timeSinceLastCheck < 120000) {
            return;
        }
        
        const lastGame = await getLastGameResult(participants, pacte.id);
        
        if (lastGame) {
            await processGameResult(pacte, lastGame, client);
        } else {
            // Si pas de résultat après 10 minutes, remettre in_game à false
            if (timeSinceLastCheck > 600000) {
                logger.warn(`No game result found for pacte #${pacte.id} after 10 minutes`);
                await updatePacteStatus(pacte.id, { in_game: false });
            }
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

async function getLastGameResult(participants, pacteId) {
    // Vérifier les 3 dernières games au lieu d'une seule
    const matchIds = await getMatchHistory(participants[0].riot_puuid, 3);
    if (matchIds.length === 0) return null;
    
    const db = getDb();
    
    for (const matchId of matchIds) {
        // Vérifier si on a déjà traité ce match
        const processed = await db.get('SELECT * FROM game_history WHERE match_id = ?', matchId);
        if (processed) continue;
        
        const matchDetails = await getMatchDetails(matchId);
        
        // Vérifier que la game est récente (moins de 30 minutes)
        const gameEnd = new Date(matchDetails.info.gameEndTimestamp);
        const timeSinceEnd = Date.now() - gameEnd.getTime();
        if (timeSinceEnd > 1800000) continue; // Plus de 30 minutes
        
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
        
        if (!allInGame) continue;
        
        // Marquer comme traité
        await db.run(
            'INSERT INTO game_history (match_id, pacte_id, result) VALUES (?, ?, ?)',
            [matchId, pacteId, won ? 'win' : 'loss']
        );
        
        return { win: won, matchId: matchId };
    }
    
    return null;
}

async function processGameResult(pacte, gameResult, client) {
    const channel = client.channels.cache.get(pacte.log_channel_id);
    const participants = await getPacteParticipants(pacte.id);
    
    // Vérifier si ce match a déjà été traité pour éviter les doublons
    const validation = await validateMatchForProcessing(
        gameResult.matchId, 
        pacte.id, 
        new Date(gameResult.gameEndTimestamp)
    );
    
    if (!validation.valid) {
        logger.info(`Skipping match ${gameResult.matchId} for pacte ${pacte.id}: ${validation.reason}`);
        return;
    }
    
    // Enregistrer le match comme traité
    await recordProcessedMatch(gameResult.matchId, pacte.id, gameResult.win ? 'win' : 'loss');
    
    if (gameResult.win) {
        const newWins = pacte.current_wins + 1;
        
        // Mettre à jour les meilleures séries des joueurs
        const { updateBestStreak } = require('./userManager');
        for (const participant of participants) {
            await updateBestStreak(participant.discord_id, newWins);
        }
        
        if (newWins >= pacte.objective) {
            // Pacte success
            const points = calculatePoints(pacte.objective, pacte.objective);
            await completePacte(pacte.id, true, points);
            
            await channel.send({
                content: `🎉 **PACTE RÉUSSI !** ${pacte.objective} victoires consécutives ! +${points} points ! (Match: ${gameResult.matchId})`
            });
        } else {
            // Continue
            await updatePacteStatus(pacte.id, { 
                current_wins: newWins,
                best_streak_reached: Math.max(pacte.best_streak_reached, newWins),
                in_game: false
            });
            
            await channel.send({
                content: `✅ **Victoire !** ${newWins}/${pacte.objective} (Match: ${gameResult.matchId})`
            });
            
            // Envoyer un taunt automatique après la victoire
            await sendRandomTaunt(pacte, channel, newWins);
        }
    } else {
        // Defeat - pacte might fail
        const bestStreak = Math.max(pacte.best_streak_reached, pacte.current_wins);
        
        if (pacte.current_wins === pacte.objective - 1) {
            await channel.send(`💔 Si proche... Défaite à 1 victoire de l'objectif ! (Match: ${gameResult.matchId})`);
        }
        
        // Reset or fail based on time
        const hoursElapsed = (Date.now() - new Date(pacte.created_at).getTime()) / 3600000;
        
        if (hoursElapsed >= 24) {
            // Pacte failed
            const points = calculatePoints(pacte.objective, bestStreak);
            const malus = calculateMalus(pacte.objective, bestStreak);
            
            await completePacte(pacte.id, false, points - malus);
            await channel.send({
                content: `❌ **PACTE ÉCHOUÉ** - Temps écoulé. Meilleure série: ${bestStreak}/${pacte.objective}. ${points > 0 ? `+${points}` : `${malus}`} points (Match: ${gameResult.matchId})`
            });
        } else {
            // Reset counter
            await updatePacteStatus(pacte.id, { 
                current_wins: 0,
                best_streak_reached: bestStreak,
                in_game: false
            });
            
            await channel.send({
                content: `💀 Défaite ! Retour à 0/${pacte.objective}. Il reste ${24 - Math.floor(hoursElapsed)}h. (Match: ${gameResult.matchId})`
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

async function sendRandomTaunt(pacte, channel, currentWins) {
    let shouldSendTaunt = false;
    let tauntType = 'generic';
    let delay = 5000; // 5 secondes par défaut
    
    // Taunts garantis à certains moments clés
    if (currentWins === 2) {
        // Après 2 wins consécutives
        shouldSendTaunt = true;
        tauntType = 'twoWins';
    } else if (currentWins === Math.ceil(pacte.objective / 2)) {
        // À mi-parcours de l'objectif
        shouldSendTaunt = true;
        tauntType = 'midway';
    } else if (currentWins === pacte.objective - 1) {
        // C'est la dernière !
        shouldSendTaunt = true;
        tauntType = 'lastOne';
        delay = 2000; // Plus rapide pour la tension
    } else {
        // 10% de chance de taunt après chaque autre victoire
        shouldSendTaunt = Math.random() < 0.1;
        tauntType = currentWins > pacte.objective / 2 ? 'victory' : 'generic';
    }
    
    if (shouldSendTaunt) {
        setTimeout(async () => {
            const taunt = getRandomTauntMessage(tauntType, pacte, currentWins);
            await channel.send(`🎭 ${taunt}`);
        }, delay);
    }
}

function getRandomTauntMessage(type, pacte, currentWins) {
    switch (type) {
        case 'twoWins':
            return "L'élan se dessine... Les dieux commencent à vous regarder !";
            
        case 'midway':
            return `🔥 Mi-chemin franchi ! Les anciens murmurent votre nom... (${currentWins}/${pacte.objective})`;
            
        case 'lastOne':
            return TAUNTS.lastOne;
            
        case 'victory':
            const victoryTaunts = TAUNTS.victory;
            return victoryTaunts[Math.floor(Math.random() * victoryTaunts.length)];
            
        case 'generic':
        default:
            const genericTaunts = TAUNTS.generic;
            return genericTaunts[Math.floor(Math.random() * genericTaunts.length)];
    }
}

// Fonction pour envoyer un taunt de temps qui s'écoule (à appeler depuis scheduledTasks)
async function sendTimeWarningTaunt(pacte, channel, hoursLeft) {
    if (hoursLeft <= 1 && pacte.current_wins > 0) {
        const taunt = TAUNTS.timeRunningOut.replace('[HOURS]', hoursLeft);
        await channel.send(`🎭 ${taunt}`);
    }
}

module.exports = {
    startPolling,
    checkPacteProgress,
    sendTimeWarningTaunt
};
