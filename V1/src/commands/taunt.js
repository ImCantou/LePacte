const { SlashCommandBuilder } = require('discord.js');
const { getActiveUserPacte } = require('../services/userManager');
const { TAUNTS } = require('../utils/constants');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('taunt')
        .setDescription('Envoyer un message de taunt personnalisé')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message de taunt personnalisé (optionnel)')
                .setRequired(false)),

    async execute(interaction) {
        const activePacte = await getActiveUserPacte(interaction.user.id);
        
        if (!activePacte) {
            return interaction.reply({
                content: '❌ Vous devez avoir un pacte actif pour utiliser les taunts.',
                ephemeral: true
            });
        }
        
        const customMessage = interaction.options.getString('message');
        let tauntMessage;
        
        if (customMessage) {
            tauntMessage = `💬 **${interaction.user.username}:** ${customMessage}`;
        } else {
            // Utiliser un taunt aléatoire selon la situation
            let taunts;
            if (activePacte.current_wins === 0) {
                taunts = TAUNTS.generic;
            } else if (activePacte.current_wins === activePacte.objective - 1) {
                tauntMessage = TAUNTS.lastOne;
            } else if (activePacte.current_wins > activePacte.objective / 2) {
                taunts = TAUNTS.victory;
            } else {
                taunts = TAUNTS.generic;
            }
            
            if (!tauntMessage && taunts) {
                tauntMessage = `🎭 ${taunts[Math.floor(Math.random() * taunts.length)]}`;
            }
        }
        
        await interaction.reply({
            content: `**Pacte #${activePacte.id}** (${activePacte.current_wins}/${activePacte.objective})\n${tauntMessage}`
        });
    }
};