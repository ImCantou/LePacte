const logger = require('../utils/logger');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                logger.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                logger.error(`Error executing ${interaction.commandName}:`, error);
                
                const errorReply = {
                    content: '❌ Une erreur est survenue lors de l\'exécution de cette commande.',
                    ephemeral: true
                };
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorReply);
                } else {
                    await interaction.reply(errorReply);
                }
            }
        }
        
        // Handle button interactions
        else if (interaction.isButton()) {
            try {
                const customId = interaction.customId;
                
                // Handle ladder pagination buttons
                if (customId.startsWith('ladder_')) {
                    const [, type, pageStr] = customId.split('_');
                    const page = parseInt(pageStr);
                    
                    const { showLadder } = require('../commands/ladder');
                    await showLadder(interaction, type, page);
                }
                
            } catch (error) {
                logger.error(`Error handling button interaction:`, error);
                
                const errorReply = {
                    content: '❌ Une erreur est survenue lors du traitement de cette interaction.',
                    ephemeral: true
                };
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorReply);
                } else {
                    await interaction.reply(errorReply);
                }
            }
        }
    }
};