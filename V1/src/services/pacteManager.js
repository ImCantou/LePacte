const { 
    getCurrentGame, 
    getLastValidGroupMatch 
} = require('./riotApi');
const { 
    getActivePactes, 
    updatePacteStatus, 
    completePacte,
    getPacteParticipants,
    updateBestStreak 
} = require('./userManager');
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
let pollingCounter = 0;

async function startPolling(client) {
    logger.info('Starting pacte polling system...');
    
    // Vérification initiale immédiate
    await checkAllPactes(client);
    
    // Puis toutes les 10 secondes
    pollingInterval = setInterval(async () => {
        await checkAllPactes(client);
    }, 10000);
}

async function checkAllPactes(client) {
    try {
        // Utiliser la fonction optimisée qui ne récupère que les pactes à vérifier
        const pactes = await getPactesToCheck(0.5); // Check toutes les 30 secondes minimum
        
        if (pactes.length > 0) {
            logger.debug(`Polling: checking ${pactes.length} active pacte(s)`);
            
            for (const pacte of pactes) {
                try {
                    await checkPacteProgress(pacte, client);
                    // Mise à jour du last_checked après chaque vérification réussie
                    await updatePacteLastChecked(pacte.id);
                } catch (error) {
                    logger.error(`Error checking pacte #${pacte.id}:`, error);
                }
            }
        }
        
        pollingCounter++;
        
        // Log de santé toutes les 5 minutes
        if (pollingCounter % 30 === 0) {
            const db = getDb();
            const stats = await db.get(
                'SELECT COUNT(*) as count FROM pactes WHERE status = "active"'
            );
            logger.info(`Polling health: ${stats.count} active pactes total`);
        }
        
    } catch (error) {
        logger.error('Critical error in polling loop:', error);
    }
}

async function checkPacteProgress(pacte, client) {
    try {
        const participants = await getPacteParticipants(pacte.id);
        if (!participants || participants.length === 0) return;
        
        // Étape 1 : Vérifier si en game actuellement
        const currentGame = await checkIfInSameARAM(participants);
        
        if (currentGame) {
            // Game en cours détectée
            if (!pacte.in_game) {
                logger.info(`ARAM detected for pacte #${pacte.id} - Game ID: ${currentGame}`);
                await updatePacteStatus(pacte.id, { 
                    in_game: true,
                    current_game_id: currentGame
                });
                
                // Une seule notification dans le canal principal
                const channel = client.channels.cache.get(pacte.log_channel_id);
                if (channel) {
                    const mentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
                    await channel.send(
                        `🎮 **PARTIE DÉTECTÉE !**\n` +
                        `${mentions}\n` +
                        `Pacte #${pacte.id} - ${pacte.current_wins}/${pacte.objective}\n` +
                        `Bonne chance dans l'Abîme ! 🎯`
                    );
                }
                
                // Log discret dans le canal de logs
                const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(`🎮 Partie lancée - Pacte #${pacte.id}`);
                }
            }
            return; // Attendre la fin de la game
        }
        
        // Étape 2 : Si on était en game mais plus maintenant, la partie est finie
        if (pacte.in_game) {
            logger.info(`Game ended for pacte #${pacte.id}, fetching result...`);
            
            // Marquer comme plus en game
            await updatePacteStatus(pacte.id, { 
                in_game: false,
                current_game_id: null
            });
            
            // Initialiser fetch_attempts si nécessaire
            const currentAttempts = pacte.fetch_attempts || 0;
            
            if (currentAttempts < 18) { // Essayer pendant 3 minutes
                await updatePacteStatus(pacte.id, { 
                    fetch_attempts: currentAttempts + 1 
                });
                
                // Essayer de récupérer le résultat
                const puuids = participants.map(p => p.riot_puuid);
                const lastGame = await getLastValidGroupMatch(puuids, 10);
                
                if (lastGame) {
                    // Vérifier si ce n'est pas un match déjà traité
                    const alreadyProcessed = await isMatchAlreadyProcessed(lastGame.matchId, pacte.id);
                    if (!alreadyProcessed) {
                        logger.info(`Found match result: ${lastGame.matchId} - ${lastGame.win ? 'WIN' : 'LOSS'}`);
                        await processGameResult(pacte, lastGame, participants, client);
                        
                        // Reset fetch_attempts
                        await updatePacteStatus(pacte.id, { fetch_attempts: 0 });
                    } else {
                        logger.debug(`Match ${lastGame.matchId} already processed, resetting state`);
                        await updatePacteStatus(pacte.id, { fetch_attempts: 0 });
                    }
                } else {
                    logger.debug(`No result yet for pacte #${pacte.id}, attempt ${currentAttempts + 1}/18`);
                }
            } else {
                // Après 3 minutes, abandonner
                logger.error(`Could not fetch result for pacte #${pacte.id} after 18 attempts`);
                
                const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(
                        `⚠️ **Impossible de récupérer le résultat** - Pacte #${pacte.id}\n` +
                        `Le suivi reprendra à la prochaine partie.`
                    );
                }
                
                // Reset
                await updatePacteStatus(pacte.id, { fetch_attempts: 0 });
            }
        }
        
        // Étape 3 : Vérifier l'expiration du pacte (24h)
        const startTime = new Date(pacte.started_at || pacte.created_at).getTime();
        const hoursElapsed = (Date.now() - startTime) / 3600000;
        
        if (hoursElapsed >= 24) {
            logger.info(`Pacte #${pacte.id} has timed out after 24h`);
            await handlePacteTimeout(pacte, participants, client);
        }
        
    } catch (error) {
        logger.error(`Error checking pacte #${pacte.id}:`, error);
    }
}

async function checkIfInSameARAM(participants) {
    let gameId = null;
    let allInSame = true;
    
    for (const participant of participants) {
        try {
            const currentGame = await getCurrentGame(participant.riot_puuid, 'euw1');
            
            if (!currentGame) {
                allInSame = false;
                break;
            }
            
            if (gameId === null) {
                gameId = currentGame.gameId;
            } else if (gameId !== currentGame.gameId) {
                allInSame = false;
                break;
            }
        } catch (error) {
            logger.error(`Error checking game for ${participant.summoner_name}:`, error.message);
            allInSame = false;
            break;
        }
    }
    
    return allInSame ? gameId : null;
}

async function processGameResult(pacte, gameResult, participants, client) {
    const channel = client.channels.cache.get(pacte.log_channel_id);
    const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
    
    // Enregistrer le match comme traité
    await recordProcessedMatch(gameResult.matchId, pacte.id, gameResult.win ? 'win' : 'loss');
    
    // Calculer la durée de la partie
    const gameDurationMin = Math.floor(gameResult.gameDuration / 60);
    
    if (gameResult.win) {
        // VICTOIRE
        const newWins = pacte.current_wins + 1;
        
        // Mettre à jour les meilleures séries
        for (const participant of participants) {
            await updateBestStreak(participant.discord_id, newWins);
        }
        
        if (newWins >= pacte.objective) {
            // PACTE RÉUSSI !
            const points = calculatePoints(pacte.objective, pacte.objective);
            await completePacte(pacte.id, true, points);
            
            logger.info(`PACTE SUCCESS #${pacte.id}: ${pacte.objective} wins achieved! +${points} points`);
            
            if (channel) {
                const mentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
                
                await channel.send(
                    `🎉🎉🎉 **PACTE RÉUSSI !** 🎉🎉🎉\n\n` +
                    `🏆 **GLOIRE ÉTERNELLE AUX CHAMPIONS !** 🏆\n\n` +
                    `${mentions}\n\n` +
                    `📜 Pacte #${pacte.id} - ${pacte.objective} victoires consécutives\n` +
                    `⏱️ Dernière partie : ${gameDurationMin}min\n` +
                    `💎 **+${points} POINTS**\n\n` +
                    `*Vos noms seront gravés dans les annales de l'Abîme Hurlant !*`
                );
            }
            
            // Log simplifié
            if (logChannel) {
                await logChannel.send(
                    `✅ **PACTE RÉUSSI** - #${pacte.id}\n` +
                    `${pacte.objective} victoires atteintes ! +${points} points`
                );
            }
        } else {
            // Continuer le pacte
            await updatePacteStatus(pacte.id, { 
                current_wins: newWins,
                best_streak_reached: Math.max(pacte.best_streak_reached, newWins)
            });
            
            if (channel) {
                let message = `✅ **VICTOIRE !** ${newWins}/${pacte.objective} (${gameDurationMin}min)`;
                
                if (newWins === pacte.objective - 1) {
                    message = `🔥🔥 **MATCH POINT !** 🔥🔥\n**LA PROCHAINE EST LA DERNIÈRE !**\n*(${gameDurationMin}min de pure domination)*`;
                }
                
                await channel.send(message);
                
                // Taunt automatique
                await sendRandomTaunt(pacte, channel, newWins);
            }
            
            // Log dans le canal de logs
            if (logChannel) {
                await logChannel.send(
                    `✅ **Victoire** - Pacte #${pacte.id}\n` +
                    `Progression: ${pacte.current_wins} → ${newWins}/${pacte.objective} (${gameDurationMin}min)`
                );
            }
        }
    } else {
        // DÉFAITE
        const bestStreak = Math.max(pacte.best_streak_reached, pacte.current_wins);
        const wasAtObjective = pacte.current_wins === pacte.objective - 1;
        
        // Calculer le temps restant
        const hoursElapsed = (Date.now() - new Date(pacte.started_at || pacte.created_at).getTime()) / 3600000;
        const hoursLeft = Math.floor(24 - hoursElapsed);
        
        if (hoursElapsed >= 24) {
            // Temps écoulé
            await handlePacteTimeout(pacte, participants, client);
        } else {
            // Reset mais le pacte continue
            await updatePacteStatus(pacte.id, { 
                current_wins: 0,
                best_streak_reached: bestStreak
            });
            
            if (channel) {
                let message = `💀 **DÉFAITE !** (${gameDurationMin}min)\nRetour à 0/${pacte.objective}\n`;
                
                if (wasAtObjective) {
                    message = `💔 **SI PROCHE...** 💔\nDéfaite à 1 victoire de l'objectif ! (${gameDurationMin}min)\n`;
                }
                
                message += `⏰ Temps restant : ${hoursLeft}h\n`;
                message += `🏆 Meilleure série : ${bestStreak} victoires`;
                
                await channel.send(message);
                
                // Message de motivation
                if (hoursLeft > 2) {
                    setTimeout(async () => {
                        const motivationMsg = wasAtObjective ? 
                            "💪 *Si proche de la gloire... L'Abîme vous donne une seconde chance !*" :
                            "💪 *L'Abîme pardonne... mais n'oublie pas. Relevez-vous, champions !*";
                        await channel.send(motivationMsg);
                    }, 3000);
                }
            }
        }
    }
}

async function handlePacteTimeout(pacte, participants, client) {
    const points = calculatePoints(pacte.objective, pacte.best_streak_reached);
    const malus = calculateMalus(pacte.objective, pacte.best_streak_reached);
    const totalPoints = points - malus;
    
    await completePacte(pacte.id, false, totalPoints);
    
    logger.info(`PACTE TIMEOUT #${pacte.id}: Failed after 24h. Best: ${pacte.best_streak_reached}/${pacte.objective}. Points: ${totalPoints}`);
    
    const channel = client.channels.cache.get(pacte.log_channel_id);
    if (channel) {
        const mentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
        
        await channel.send(
            `⏰ **TEMPS ÉCOULÉ - PACTE ÉCHOUÉ** ⏰\n\n` +
            `${mentions}\n\n` +
            `📜 Pacte #${pacte.id}\n` +
            `🎯 Objectif manqué : ${pacte.best_streak_reached}/${pacte.objective}\n` +
            `💔 Points : ${totalPoints > 0 ? '+' : ''}${totalPoints} (${points > 0 ? `+${points}` : '0'} -${malus})\n\n` +
            `*L'Abîme se souviendra de votre tentative...*`
        );
    }
}

async function sendRandomTaunt(pacte, channel, currentWins) {
    let shouldSendTaunt = false;
    let tauntType = 'generic';
    let delay = 5000;
    
    if (currentWins === 2) {
        shouldSendTaunt = true;
        tauntType = 'twoWins';
    } else if (currentWins === Math.ceil(pacte.objective / 2)) {
        shouldSendTaunt = true;
        tauntType = 'midway';
    } else if (currentWins === pacte.objective - 1) {
        shouldSendTaunt = true;
        tauntType = 'lastOne';
        delay = 2000;
    } else if (Math.random() < 0.3) {
        shouldSendTaunt = true;
        tauntType = currentWins > pacte.objective / 2 ? 'victory' : 'generic';
    }
    
    if (shouldSendTaunt) {
        setTimeout(async () => {
            const taunt = getRandomTauntMessage(tauntType, pacte, currentWins);
            await channel.send(`🎭 *${taunt}*`);
        }, delay);
    }
}

function getRandomTauntMessage(type, pacte, currentWins) {
    switch (type) {
        case 'twoWins':
            return "L'élan se dessine... Les dieux de l'ARAM commencent à vous regarder !";
            
        case 'midway':
            return `🔥 Mi-chemin franchi ! Les anciens murmurent votre nom... (${currentWins}/${pacte.objective})`;
            
        case 'lastOne':
            return "**C'EST LA DERNIÈRE ! L'ABÎME RETIENT SON SOUFFLE !** 🔥🔥🔥";
            
        case 'victory':
            const victoryTaunts = TAUNTS.victory || [
                "Les étoiles s'alignent ! ⭐",
                "L'Abîme chante votre gloire ! 🎵",
                "Un pas de plus vers la légende... 👑",
                "Les anciens approuvent ! 🙏"
            ];
            return victoryTaunts[Math.floor(Math.random() * victoryTaunts.length)];
            
        case 'generic':
        default:
            const genericTaunts = TAUNTS.generic || [
                "L'Abîme vous observe...",
                "Continuez, champions !",
                "La gloire vous attend..."
            ];
            return genericTaunts[Math.floor(Math.random() * genericTaunts.length)];
    }
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        logger.info('Pacte polling stopped');
    }
}

module.exports = {
    startPolling,
    stopPolling,
    checkPacteProgress,
    sendRandomTaunt,
    handlePacteTimeout
};