const { 
    getCurrentGame, 
    getLastValidGroupMatch 
} = require('./riotApi');
const { 
    getActivePactes, 
    updatePacteStatus, 
    completePacte: completeInDb, 
    getPacteParticipants: getFromDb,
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
    logger.warn('Starting pacte polling system...');
    
    // Vérification initiale immédiate
    await checkAllPactes(client);
    
    // Puis toutes les 10 secondes
    pollingInterval = setInterval(async () => {
        await checkAllPactes(client);
    }, 10000);
}

async function checkAllPactes(client) {
    try {
        // Optimisation : ne vérifier que les pactes qui ont besoin
        const pactes = await getPactesToCheck(1); // Check toutes les minutes minimum
        
        if (pactes.length > 0) {
            // Log conditionnel pour éviter le spam
            if (pollingCounter % 6 === 0) { // Log toutes les minutes
                logger.info(`Polling: ${pactes.length} active pacte(s)`);
            }
            
            for (const pacte of pactes) {
                await checkPacteProgress(pacte, client);
                await updatePacteLastChecked(pacte.id);
            }
        }
        
        pollingCounter++;
    } catch (error) {
        logger.error('Error in polling loop:', error);
    }
}

async function checkPacteProgress(pacte, client) {
    try {
        const participants = await getPacteParticipants(pacte.id);
        if (!participants || participants.length === 0) return;
        
        // Étape 1 : Vérifier si en game actuellement
        const currentGame = await checkIfInSameARAM(participants);
        
        if (currentGame) {
            // Nouvelle game détectée
            if (!pacte.in_game) {
                logger.warn(`ARAM detected for pacte #${pacte.id} - Game ID: ${currentGame}`);
                await updatePacteStatus(pacte.id, { 
                    in_game: true,
                    current_game_id: currentGame,
                    last_checked: new Date().toISOString()
                });
                
                // Notification
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
            }
            return; // Attendre la fin de la game
        }
        
        // Étape 2 : Si on était en game, chercher le résultat
        if (pacte.in_game) {
            // Délai progressif : plus on attend, plus on augmente le délai
            const lastChecked = new Date(pacte.last_checked || pacte.created_at);
            const timeSinceLastCheck = Date.now() - lastChecked.getTime();
            
            // Délai adaptatif : 30s puis 1min puis 2min puis 5min
            const minWaitTime = timeSinceLastCheck < 120000 ? 30000 : 
                              timeSinceLastCheck < 300000 ? 60000 : 
                              timeSinceLastCheck < 600000 ? 120000 : 300000;
            
            if (timeSinceLastCheck < minWaitTime) {
                return;
            }
            
            logger.debug(`Checking game result for pacte #${pacte.id} (waited ${Math.floor(timeSinceLastCheck/1000)}s)`);
            
            // Chercher le résultat de la dernière game
            const puuids = participants.map(p => p.riot_puuid);
            const lastGame = await getLastValidGroupMatch(puuids, 5);
            
            if (lastGame) {
                // Vérifier si déjà traité
                const alreadyProcessed = await isMatchAlreadyProcessed(lastGame.matchId, pacte.id);
                if (!alreadyProcessed) {
                    await processGameResult(pacte, lastGame, participants, client);
                } else {
                    // Déjà traité, remettre in_game à false
                    await updatePacteStatus(pacte.id, { 
                        in_game: false,
                        current_game_id: null 
                    });
                }
            } else {
                // Pas de résultat après plusieurs minutes, reset avec avertissement
                if (timeSinceLastCheck > 600000) { // 10 minutes
                    logger.warn(`No result found for pacte #${pacte.id} after 10 minutes, resetting`);
                    
                    const channel = client.channels.cache.get(pacte.log_channel_id);
                    if (channel) {
                        await channel.send(
                            `⚠️ **Impossible de détecter le résultat de votre dernière partie**\n` +
                            `Pacte #${pacte.id} remis en attente.\n` +
                            `*Si vous avez joué, merci de signaler le résultat manuellement.*`
                        );
                    }
                    
                    await updatePacteStatus(pacte.id, { 
                        in_game: false,
                        current_game_id: null 
                    });
                }
            }
        }
        
        // Étape 3 : Vérifier si le pacte a expiré (24h)
        const startTime = new Date(pacte.started_at || pacte.created_at).getTime();
        const hoursElapsed = (Date.now() - startTime) / 3600000;
        
        if (hoursElapsed >= 24) {
            logger.info(`Pacte #${pacte.id} has timed out after 24h`);
            await handlePacteTimeout(pacte, participants, client);
            return;
        }
        
        // Avertissement à 2h restantes si pas encore envoyé
        if (!pacte.warning_sent && hoursElapsed >= 22) {
            const channel = client.channels.cache.get(pacte.log_channel_id);
            if (channel) {
                const mentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
                await channel.send(
                    `⏰ **DERNIÈRES HEURES !** ⏰\n\n` +
                    `${mentions}\n\n` +
                    `🔥 Plus que 2 heures pour réussir votre pacte #${pacte.id} !\n` +
                    `📊 Progression : ${pacte.current_wins}/${pacte.objective}\n` +
                    `🏆 Meilleure série : ${pacte.best_streak_reached}\n\n` +
                    `*L'Abîme n'attend pas... Foncez !*`
                );
                
                // Marquer l'avertissement comme envoyé
                await updatePacteStatus(pacte.id, { warning_sent: true });
            }
        }
        
    } catch (error) {
        logger.error(`Error checking pacte #${pacte.id}:`, error);
        // En cas d'erreur répétée, reset le state pour éviter de bloquer
        if (pacte.in_game) {
            const lastChecked = new Date(pacte.last_checked || pacte.created_at);
            const timeSinceLastCheck = Date.now() - lastChecked.getTime();
            
            if (timeSinceLastCheck > 900000) { // 15 minutes d'erreurs
                logger.warn(`Resetting pacte #${pacte.id} due to persistent errors`);
                await updatePacteStatus(pacte.id, { 
                    in_game: false,
                    current_game_id: null 
                });
            }
        }
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
    
    // Enregistrer le match comme traité
    await recordProcessedMatch(gameResult.matchId, pacte.id, gameResult.win ? 'win' : 'loss');
    
    // Calculer la durée de la partie pour contexte
    const gameDurationMin = Math.floor(gameResult.gameDuration / 60);
    
    if (gameResult.win) {
        // VICTOIRE
        const newWins = pacte.current_wins + 1;
        
        // Mettre à jour les meilleures séries des joueurs
        for (const participant of participants) {
            await updateBestStreak(participant.discord_id, newWins);
        }
        
        if (newWins >= pacte.objective) {
            // PACTE RÉUSSI !
            const points = calculatePoints(pacte.objective, pacte.objective);
            await completePacte(pacte.id, true, points);
            
            logger.warn(`PACTE SUCCESS #${pacte.id}: ${pacte.objective} wins achieved! +${points} points`);
            
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
        } else {
            // Continuer le pacte
            await updatePacteStatus(pacte.id, { 
                current_wins: newWins,
                best_streak_reached: Math.max(pacte.best_streak_reached, newWins),
                in_game: false,
                current_game_id: null
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
        }
    } else {
        // DÉFAITE
        const bestStreak = Math.max(pacte.best_streak_reached, pacte.current_wins);
        const wasAtObjective = pacte.current_wins === pacte.objective - 1;
        
        // Calculer le temps restant
        const hoursElapsed = (Date.now() - new Date(pacte.started_at || pacte.created_at).getTime()) / 3600000;
        const hoursLeft = Math.floor(24 - hoursElapsed);
        
        if (hoursElapsed >= 24) {
            // Temps écoulé - Pacte échoué
            await handlePacteTimeout(pacte, participants, client);
        } else {
            // Reset mais le pacte continue
            await updatePacteStatus(pacte.id, { 
                current_wins: 0,
                best_streak_reached: bestStreak,
                in_game: false,
                current_game_id: null
            });
            
            if (channel) {
                let message = `💀 **DÉFAITE !** (${gameDurationMin}min)\nRetour à 0/${pacte.objective}\n`;
                
                if (wasAtObjective) {
                    message = `💔 **SI PROCHE...** 💔\nDéfaite à 1 victoire de l'objectif ! (${gameDurationMin}min)\n`;
                }
                
                message += `⏰ Temps restant : ${hoursLeft}h\n`;
                message += `🏆 Meilleure série : ${bestStreak} victoires`;
                
                await channel.send(message);
                
                // Message de motivation contextuel
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
    
    logger.warn(`PACTE TIMEOUT #${pacte.id}: Failed after 24h. Best: ${pacte.best_streak_reached}/${pacte.objective}. Points: ${totalPoints}`);
    
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

async function completePacte(pacteId, success, points) {
    await completeInDb(pacteId, success, points);
}

async function getPacteParticipants(pacteId) {
    return await getFromDb(pacteId);
}

async function sendRandomTaunt(pacte, channel, currentWins) {
    let shouldSendTaunt = false;
    let tauntType = 'generic';
    let delay = 5000;
    
    // Déterminer le type de taunt
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
    } else if (Math.random() < 0.3) { // 30% de chance
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
                "Les anciens approuvent ! 🙏",
                "La victoire a le goût de l'éternité ! ✨"
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

async function sendTimeWarningTaunt(pacte, channel, hoursLeft) {
    if (hoursLeft <= 1 && pacte.current_wins > 0) {
        const taunt = `⏰ Plus que ${hoursLeft}h ! L'Abîme n'attend pas...`;
        await channel.send(`🎭 *${taunt}*`);
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
    sendTimeWarningTaunt,
    handlePacteTimeout
};
