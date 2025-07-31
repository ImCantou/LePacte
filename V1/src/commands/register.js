const { SlashCommandBuilder } = require('discord.js');
const { getSummonerByName } = require('../services/riotApi');
const { createUser, getUserByDiscordId } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Lier votre compte League of Legends')
        .addStringOption(option =>
            option.setName('riotid')
                .setDescription('Votre Riot ID complet (format: Pseudo#TAG)')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();
        
        const riotId = interaction.options.getString('riotid');
        const discordId = interaction.user.id;
        
        // Validation du format Riot ID
        if (!riotId.includes('#')) {
            return interaction.editReply({
                content: '❌ **Format invalide !**\n' +
                        'Veuillez utiliser le format complet : `Pseudo#TAG`\n' +
                        '**Exemple :** `MonPseudo#1234`\n\n' +
                        '💡 Vous pouvez trouver votre Riot ID complet dans votre profil League of Legends.'
            });
        }
        
        const [gameName, tagLine] = riotId.split('#');
        if (!gameName.trim() || !tagLine.trim()) {
            return interaction.editReply({
                content: '❌ **Format invalide !**\n' +
                        'Le pseudo et le tag ne peuvent pas être vides.\n' +
                        '**Exemple valide :** `MonPseudo#1234`'
            });
        }
        
        // Check if already registered
        const existingUser = await getUserByDiscordId(discordId);
        if (existingUser) {
            return interaction.editReply({
                content: '❌ **Déjà enregistré !**\n' +
                        `Votre compte est déjà lié à : **${existingUser.summoner_name}**\n\n` +
                        '💡 Utilisez `/unregister` pour supprimer votre compte actuel si vous souhaitez vous réinscrire.'
            });
        }
        
        try {
            // Verify summoner exists using the riot ID
            const summoner = await getSummonerByName(riotId);
            
            // Create user
            await createUser(discordId, summoner.puuid, summoner.name);
            
            await interaction.editReply({
                content: '✅ **Compte lié avec succès !**\n\n' +
                        `🎮 **Invocateur :** ${summoner.name}\n` +
                        `⭐ **Niveau :** ${summoner.summonerLevel}\n` +
                        `👤 **Discord :** ${interaction.user.displayName}\n\n` +
                        '🎯 Vous pouvez maintenant participer aux pactes !'
            });
            
            logger.info(`User registered: ${summoner.name} (${riotId}) by ${interaction.user.tag}`);
            
        } catch (error) {
            if (error.message && error.message.includes('Riot ID')) {
                // Erreur de validation du Riot ID
                await interaction.editReply(`❌ ${error.message}`);
            } else if (error.response?.status === 404) {
                await interaction.editReply({
                    content: '❌ **Riot ID introuvable !**\n' +
                            `Le Riot ID \`${riotId}\` n'existe pas ou est incorrect.\n\n` +
                            '💡 Vérifiez votre Riot ID dans votre profil League of Legends.\n' +
                            '**Format requis :** `Pseudo#TAG`'
                });
            } else {
                await interaction.editReply({
                    content: '❌ **Erreur lors de l\'enregistrement**\n' +
                            'Une erreur technique s\'est produite. Réessayez plus tard.\n\n' +
                            '🔧 Si le problème persiste, contactez un administrateur.'
                });
                logger.error('Registration error:', error);
            }
        }
    }
};