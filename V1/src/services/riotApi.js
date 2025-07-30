const axios = require('axios');
const logger = require('../utils/logger');

const API_KEY = process.env.RIOT_API_KEY;
const BASE_URL = 'https://europe.api.riotgames.com';

async function getSummonerByName(summonerName, region = 'euw1') {
    try {
        const response = await axios.get(
            `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`,
            {
                headers: { 'X-Riot-Token': API_KEY }
            }
        );
        return response.data;
    } catch (error) {
        logger.error('Error fetching summoner:', error);
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