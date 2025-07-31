const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        await showLadder(interaction, type, 0);
    }
};

async function showLadder(interaction, type, page) {
    const db = getDb();
    const itemsPerPage = 10;
    const offset = page * itemsPerPage;
    
    const field = type === 'total' ? 'points_total' : 'points_monthly';
    const title = type === 'total' ? 'Classement Total' : 'Classement Mensuel';
    
    // Get total count for pagination
    const totalCount = await db.get(
        `SELECT COUNT(*) as count FROM users WHERE ${field} > 0`
    );
    
    // Get current page rankings (simplified query for now)
    const rankings = await db.all(`
        SELECT 
            u.discord_id, 
            u.summoner_name, 
            u.${field} as points, 
            u.best_streak_ever,
            u.points_monthly as current_monthly
        FROM users u
        WHERE u.${field} > 0
        ORDER BY u.${field} DESC 
        LIMIT ? OFFSET ?
    `, itemsPerPage, offset);
    
    if (rankings.length === 0 && page === 0) {
        return interaction.reply('Aucun joueur n\'a encore de points !');
    }
    
    const medals = ['🥇', '🥈', '🥉'];
    const description = rankings.map((user, index) => {
        const globalRank = offset + index;
        const medal = globalRank < 3 ? medals[globalRank] : `**${globalRank + 1}.**`;
        
        // Calculate monthly delta if showing monthly ladder (simplified for now)
        let deltaDisplay = '';
        // Note: Delta functionality will be implemented when monthly_history is fully ready
        
        // Highlight the user who made the command
        const isCurrentUser = user.discord_id === interaction.user.id;
        const userLine = `${medal} <@${user.discord_id}> - **${user.points}** pts${deltaDisplay} (Record: ${user.best_streak_ever})`;
        
        return isCurrentUser ? `>>> ${userLine}` : userLine;
    }).join('\n');
    
    // Get user's rank if not in current page
    const userRank = await db.get(`
        SELECT COUNT(*) + 1 as rank 
        FROM users 
        WHERE ${field} > (SELECT ${field} FROM users WHERE discord_id = ?)
    `, interaction.user.id);
    
    const userInCurrentPage = rankings.some(r => r.discord_id === interaction.user.id);
    
    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`🏆 ${title} - Page ${page + 1}`)
        .setDescription(description || 'Aucun joueur sur cette page.');
    
    // Add user's position if not visible
    if (!userInCurrentPage && userRank) {
        const userData = await db.get(
            `SELECT ${field} as points FROM users WHERE discord_id = ?`,
            interaction.user.id
        );
        
        if (userData && userData.points > 0) {
            embed.addFields({
                name: '📍 Votre position',
                value: `Rang #${userRank.rank} avec ${userData.points} points`,
                inline: false
            });
        }
    }
    
    const totalPages = Math.ceil(totalCount.count / itemsPerPage);
    embed.setFooter({ 
        text: `Page ${page + 1}/${totalPages} • ${totalCount.count} joueurs classés` 
    });
    
    // Create pagination buttons
    const row = new ActionRowBuilder();
    
    if (page > 0) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`ladder_${type}_${page - 1}`)
                .setLabel('◀️ Précédent')
                .setStyle(ButtonStyle.Primary)
        );
    }
    
    if (page < totalPages - 1) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`ladder_${type}_${page + 1}`)
                .setLabel('Suivant ▶️')
                .setStyle(ButtonStyle.Primary)
        );
    }
    
    // Switch type button
    const switchType = type === 'total' ? 'monthly' : 'total';
    const switchLabel = type === 'total' ? '📅 Mensuel' : '🏆 Total';
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`ladder_${switchType}_0`)
            .setLabel(switchLabel)
            .setStyle(ButtonStyle.Secondary)
    );
    
    const replyOptions = {
        embeds: [embed],
        components: row.components.length > 0 ? [row] : []
    };
    
    // Handle initial reply vs update
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply(replyOptions);
    } else {
        await interaction.reply(replyOptions);
    }
}

// Export for button handler
module.exports.showLadder = showLadder;