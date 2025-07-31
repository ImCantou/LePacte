const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../utils/database');
const { getActiveUserPacte, getUserByDiscordId } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unregister')
        .setDescription('Supprimer votre compte du bot'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const discordId = interaction.user.id;
        
        // Vérifier si l'utilisateur existe
        const existingUser = await getUserByDiscordId(discordId);
        if (!existingUser) {
            return interaction.editReply('❌ Vous n\'êtes pas encore enregistré !');
        }
        
        // Vérifier pacte actif
        const activePacte = await getActiveUserPacte(discordId);
        if (activePacte) {
            return interaction.editReply({
                content: '❌ Impossible de se désinscrire avec un pacte actif.\n' +
                        `Vous devez d'abord terminer ou quitter votre pacte en cours (ID: #${activePacte.id}).`
            });
        }
        
        try {
            const db = getDb();
            
            // Supprimer l'utilisateur de la base de données
            await db.run('DELETE FROM users WHERE discord_id = ?', discordId);
            
            await interaction.editReply({
                content: '✅ **Compte supprimé avec succès !**\n' +
                        `Votre compte **${existingUser.summoner_name}** a été supprimé du bot.\n` +
                        'Vous pouvez vous réinscrire à tout moment avec `/register`.'
            });
            
            logger.info(`User unregistered: ${existingUser.summoner_name} by ${interaction.user.tag}`);
            
        } catch (error) {
            await interaction.editReply('❌ Erreur lors de la suppression du compte. Réessayez plus tard.');
            logger.error('Unregistration error:', error);
        }
    }
};
