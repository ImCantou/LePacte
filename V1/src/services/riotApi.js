const axios = require('axios');
const logger = require('../utils/logger');

const API_KEY = process.env.RIOT_API_KEY;

// Vérification de la clé au démarrage
if (!API_KEY) {
    logger.error('RIOT_API_KEY not found in environment variables!');
    process.exit(1);
}

logger.info(`API Key loaded: ${API_KEY.substring(0, 10)}...`);

// Mapping des régions pour les différentes APIs
const REGION_TO_ROUTING = {
    'euw1': 'europe',
    'eun1': 'europe',
    'na1': 'americas',
    'br1': 'americas',
    'jp1': 'asia',
    'kr': 'asia',
    'la1': 'americas',
    'la2': 'americas',
    'oc1': 'sea',
    'ru': 'europe',
    'tr1': 'europe'
};

// Configuration axios avec retry et timeout
const axiosConfig = {
    timeout: 10000,
    headers: { 'X-Riot-Token': API_KEY }
};

// Helper pour gérer les rate limits
async function makeApiCall(url, config = {}) {
    try {
        const response = await axios.get(url, { ...axiosConfig, ...config });
        return response;
    } catch (error) {
        if (error.response?.status === 429) {
            // Rate limit - attendre et réessayer
            const retryAfter = error.response.headers['retry-after'] || 10;
            logger.warn(`Rate limited. Waiting ${retryAfter} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return makeApiCall(url, config);
        }
        throw error;
    }
}

async function getSummonerByName(summonerName, region = 'euw1') {
    try {
        let gameName, tagLine;
        
        if (summonerName.includes('#')) {
            [gameName, tagLine] = summonerName.split('#');
        } else {
            throw new Error('Veuillez fournir votre Riot ID complet (ex: Pseudo#TAG)');
        }
        
        // Valider les entrées
        if (!gameName.trim() || !tagLine.trim()) {
            throw new Error('Le pseudo et le tag ne peuvent pas être vides');
        }
        
        // 1. Obtenir le PUUID via l'API Account
        const routing = REGION_TO_ROUTING[region] || 'europe';
        const accountUrl = `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
        
        logger.debug(`Getting account: ${gameName}#${tagLine}`);
        
        const accountResponse = await makeApiCall(accountUrl);
        const puuid = accountResponse.data.puuid;
        
        // 2. Obtenir les données du summoner
        const summonerUrl = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
        
        const summonerResponse = await makeApiCall(summonerUrl);
        
        return {
            ...summonerResponse.data,
            puuid: puuid,
            name: `${gameName}#${tagLine}`,
            region: region
        };
        
    } catch (error) {
        if (error.response?.status === 404) {
            throw new Error(`Riot ID "${summonerName}" introuvable. Vérifiez l'orthographe.`);
        }
        if (error.response?.status === 403) {
            throw new Error('Clé API invalide ou expirée');
        }
        logger.error(`Error getting summoner: ${error.message}`);
        throw error;
    }
}

async function getCurrentGame(puuid, region = 'euw1') {
    try {
        // IMPORTANT: Utiliser la région spécifique pour l'API Spectator
        const spectatorUrl = `https://${region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;
        
        const response = await makeApiCall(spectatorUrl);
        
        // Vérifier si c'est bien un ARAM
        const gameData = response.data;
        if (gameData.gameQueueConfigId === 450) {
            logger.info(`ARAM game detected for PUUID ${puuid.substring(0, 8)}...`);
            return gameData;
        }
        
        return null; // Pas un ARAM
        
    } catch (error) {
        if (error.response?.status === 404) {
            return null; // Pas en game
        }
        logger.error(`Error fetching current game: ${error.message}`);
        throw error;
    }
}

async function getMatchHistory(puuid, count = 5, queueId = 450) {
    try {
        // Déterminer la région de routing pour l'API Match
        const routing = 'europe'; // Pour EUW/EUNE
        const matchUrl = `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`;
        
        const response = await makeApiCall(matchUrl, {
            params: {
                queue: queueId, // 450 = ARAM
                count: count,
                start: 0
            }
        });
        
        const matchIds = response.data;
        logger.debug(`Found ${matchIds.length} recent ARAM matches for PUUID ${puuid.substring(0, 8)}...`);
        return matchIds;
        
    } catch (error) {
        logger.error(`Error fetching match history: ${error.message}`);
        return [];
    }
}

async function getMatchDetails(matchId) {
    try {
        // Extraire la région du matchId (ex: EUW1_123456789)
        const region = matchId.split('_')[0].toLowerCase();
        const routing = REGION_TO_ROUTING[region] || 'europe';
        
        const matchUrl = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
        
        const response = await makeApiCall(matchUrl);
        const matchData = response.data;
        
        // Vérifier que c'est bien un ARAM et pas un remake
        if (matchData.info.queueId !== 450) {
            logger.warn(`Match ${matchId} is not an ARAM`);
            return null;
        }
        
        // Vérifier si c'est un remake (durée < 5 minutes)
        if (matchData.info.gameDuration < 300) {
            logger.info(`Match ${matchId} is a remake (duration: ${matchData.info.gameDuration}s)`);
            return null;
        }
        
        return matchData;
        
    } catch (error) {
        logger.error(`Error fetching match details for ${matchId}: ${error.message}`);
        throw error;
    }
}

/**
 * Obtenir les détails de plusieurs matches en parallèle
 * @param {string[]} matchIds - Array of match IDs
 * @returns {Promise<Object[]>} - Array of match details
 */
async function getMultipleMatchDetails(matchIds) {
    const results = await Promise.allSettled(
        matchIds.map(id => getMatchDetails(id))
    );
    
    return results
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);
}

/**
 * Vérifier si tous les participants étaient dans une game
 * @param {Object} matchDetails - Détails du match
 * @param {string[]} puuids - PUUIDs à vérifier
 * @returns {Object} - { allInGame: boolean, won: boolean, participants: Object[] }
 */
function checkParticipantsInMatch(matchDetails, puuids) {
    const gameParticipants = matchDetails.info.participants;
    const result = {
        allInGame: true,
        won: false,
        participants: []
    };
    
    for (const puuid of puuids) {
        const participant = gameParticipants.find(p => p.puuid === puuid);
        if (!participant) {
            result.allInGame = false;
            break;
        }
        result.participants.push(participant);
        result.won = participant.win;
    }
    
    return result;
}

/**
 * Obtenir le dernier match ARAM valide pour un groupe
 * @param {string[]} puuids - PUUIDs des participants
 * @param {number} checkCount - Nombre de matches à vérifier
 * @returns {Promise<Object|null>} - Détails du match ou null
 */
async function getLastValidGroupMatch(puuids, checkCount = 5) {
    try {
        // Récupérer l'historique du premier joueur
        const matchIds = await getMatchHistory(puuids[0], checkCount);
        
        if (matchIds.length === 0) {
            logger.debug('No recent matches found');
            return null;
        }
        
        // Vérifier chaque match
        for (const matchId of matchIds) {
            const matchDetails = await getMatchDetails(matchId);
            if (!matchDetails) continue;
            
            const check = checkParticipantsInMatch(matchDetails, puuids);
            
            if (check.allInGame) {
                logger.info(`Found valid group match: ${matchId}`);
                return {
                    matchId: matchId,
                    win: check.won,
                    gameEndTimestamp: matchDetails.info.gameEndTimestamp,
                    gameDuration: matchDetails.info.gameDuration,
                    participants: check.participants
                };
            }
        }
        
        return null;
        
    } catch (error) {
        logger.error('Error getting last valid group match:', error);
        return null;
    }
}

module.exports = {
    getSummonerByName,
    getCurrentGame,
    getMatchHistory,
    getMatchDetails,
    getMultipleMatchDetails,
    checkParticipantsInMatch,
    getLastValidGroupMatch
};
