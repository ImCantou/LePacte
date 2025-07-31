const axios = require('axios');
const logger = require('../utils/logger');

const API_KEY = process.env.RIOT_API_KEY;

// DEBUG: Afficher les 10 premiers caractères de la clé
logger.info(`API Key loaded: ${API_KEY ? API_KEY.substring(0, 15) + '...' : 'NOT FOUND'}`);

const BASE_URL = 'https://europe.api.riotgames.com';

// Mapping des régions pour l'API Match
const REGION_TO_CONTINENT = {
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

async function getSummonerByName(summonerName, region = 'euw1') {
    try {
        // For now, require the full Riot ID with tag
        let gameName, tagLine;
        
        if (summonerName.includes('#')) {
            [gameName, tagLine] = summonerName.split('#');
        } else {
            // If no tag provided, we can't look up the account
            throw new Error('Veuillez fournir votre Riot ID complet (ex: Pseudo#TAG)');
        }
        
        // First, get account by riot ID (using europe routing)
        const accountUrl = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
        
        logger.info(`Calling Riot Account API: ${accountUrl}`);
        
        const accountResponse = await axios.get(accountUrl, {
            headers: { 'X-Riot-Token': API_KEY }
        });
        
        // Then get summoner data using puuid
        const summonerUrl = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountResponse.data.puuid}`;
        
        logger.info(`Calling Riot Summoner API: ${summonerUrl}`);
        
        const summonerResponse = await axios.get(summonerUrl, {
            headers: { 'X-Riot-Token': API_KEY }
        });
        
        return {
            ...summonerResponse.data,
            puuid: accountResponse.data.puuid,
            name: `${gameName}#${tagLine}`
        };
    } catch (error) {
        // DEBUG: Log détaillé de l'erreur
        if (error.response) {
            logger.error(`Riot API Error ${error.response.status}: ${error.response.statusText}`);
            logger.error('Response headers:', error.response.headers);
            logger.error('Response data:', error.response.data);
        }
        throw error;
    }
}

async function getCurrentGame(puuid) {
    try {
        const response = await axios.get(
            `${BASE_URL}/lol/spectator/v5/active-games/by-summoner/${puuid}`,
            {
                headers: { 'X-Riot-Token': API_KEY }
            }
        );
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) {
            return null; // Not in game
        }
        throw error;
    }
}

async function getMatchHistory(puuid, count = 5) {
    try {
        const response = await axios.get(
            `${BASE_URL}/lol/match/v5/matches/by-puuid/${puuid}/ids`,
            {
                params: {
                    queue: 450, // ARAM only
                    count: count
                },
                headers: { 'X-Riot-Token': API_KEY }
            }
        );
        return response.data;
    } catch (error) {
        logger.error('Error fetching match history:', error);
        throw error;
    }
}

async function getMatchDetails(matchId) {
    try {
        const response = await axios.get(
            `${BASE_URL}/lol/match/v5/matches/${matchId}`,
            {
                headers: { 'X-Riot-Token': API_KEY }
            }
        );
        return response.data;
    } catch (error) {
        logger.error('Error fetching match details:', error);
        throw error;
    }
}

module.exports = {
    getSummonerByName,
    getCurrentGame,
    getMatchHistory,
    getMatchDetails
};