const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ladder')
        .setDescription('Voir le classement des joueurs')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type de classement')
                .setRequired(false)
                .addChoices(
                    { name: 'Total', value: 'total' },
                    { name: 'Mensuel', value: 'monthly' }
                )),

    async execute(interaction) {
        const type = interaction.options.getString('type') || 'total';
        const db = getDb();
        
        const field = type === 'total' ? 'points_total' : 'points_monthly';
        const title = type === 'total' ? 'Classement Total' : 'Classement Mensuel';
        
        const rankings = await db.all(
            `SELECT discord_id, summoner_name, ${field} as points, best_streak_ever
             FROM users 
             WHERE ${field} > 0
             ORDER BY ${field} DESC 
             LIMIT 10`
        );
        
        if (rankings.length === 0) {
            return interaction.reply('Aucun joueur n\'a encore de points !');
        }
        
        const medals = ['🥇', '🥈', '🥉'];
        const description = rankings.map((user, index) => {
            const medal = medals[index] || `**${index + 1}.**`;
            return `${medal} <@${user.discord_id}> - **${user.points}** pts (Record: ${user.best_streak_ever} wins)`;
        }).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`🏆 ${title}`)
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: 'Pacte ARAM Bot' });
        
        await interaction.reply({ embeds: [embed] });
    }
};