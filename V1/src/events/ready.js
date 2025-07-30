const logger = require('../utils/logger');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        logger.info(`Bot logged in as ${client.user.tag}`);
        const { ActivityType } = require('discord.js');
            
        client.user.setActivity('les pactes ARAM', { type: ActivityType.Watching });        
        // Initialize pending pactes collection
        client.pendingPactes = new Map();
    }
};