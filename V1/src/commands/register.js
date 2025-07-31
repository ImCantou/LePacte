const { SlashCommandBuilder } = require('discord.js');
const { getSummonerByName } = require('../services/riotApi');
const { createUser, getUserByDiscordId } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Lier votre compte League of Legends')
        .addStringOption(option =>
            option.setName('pseudo')
                .setDescription('Votre pseudo League of Legends')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();
        
        const summonerName = interaction.options.getString('pseudo');
        const discordId = interaction.user.id;
        
        // Check if already registered
        const existingUser = await getUserByDiscordId(discordId);
        if (existingUser) {
            return interaction.editReply('❌ Vous êtes déjà enregistré !');
        }
        
        try {
            // Verify summoner exists
            const summoner = await getSummonerByName(summonerName);
            
            // Create user
            await createUser(discordId, summoner.puuid, summoner.name);
            
            await interaction.editReply({
                content: `✅ Compte lié avec succès !\n**Invocateur:** ${summoner.name}\n**Niveau:** ${summoner.summonerLevel}`
            });
            
            logger.info(`User registered: ${summoner.name} by ${interaction.user.tag}`);
            
        } catch (error) {
            if (error.response?.status === 404) {
                await interaction.editReply('❌ Invocateur introuvable. Vérifiez le pseudo.');
            } else {
                await interaction.editReply('❌ Erreur lors de l\'enregistrement. Réessayez plus tard.');
                logger.error('Registration error:', error);
            }
        }
    }
};