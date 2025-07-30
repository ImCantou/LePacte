const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserByDiscordId } = require('../services/userManager');
const { getDb } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Voir les statistiques d\'un joueur')
        .addUserOption(option =>
            option.setName('joueur')
                .setDescription('Le joueur dont vous voulez voir les stats')
                .setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('joueur') || interaction.user;
        const user = await getUserByDiscordId(targetUser.id);
        
        if (!user) {
            return interaction.reply({
                content: '❌ Utilisateur non enregistré.',
                ephemeral: true
            });
        }
        
        // Get pacte stats
        const db = getDb();
        const pacteStats = await db.get(`
            SELECT 
                COUNT(DISTINCT p.id) as total_pactes,
                SUM(CASE WHEN p.status = 'success' THEN 1 ELSE 0 END) as pactes_success,
                MAX(p.best_streak_reached) as best_streak,
                SUM(part.points_gained) as points_from_pactes
            FROM pactes p
            JOIN participants part ON p.id = part.pacte_id
            WHERE part.discord_id = ? AND part.signed_at IS NOT NULL
        `, targetUser.id);
        
        const winRate = pacteStats.total_pactes > 0 
            ? Math.round((pacteStats.pactes_success / pacteStats.total_pactes) * 100) 
            : 0;
        
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`📊 Statistiques de ${user.summoner_name}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '🏆 Points Total', value: `${user.points_total}`, inline: true },
                { name: '📅 Points du Mois', value: `${user.points_monthly}`, inline: true },
                { name: '🔥 Meilleure Série', value: `${user.best_streak_ever} victoires`, inline: true },
                { name: '📜 Pactes Totaux', value: `${pacteStats.total_pactes}`, inline: true },
                { name: '✅ Pactes Réussis', value: `${pacteStats.pactes_success} (${winRate}%)`, inline: true },
                { name: '💎 Record Personnel', value: `${pacteStats.best_streak || 0} wins`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Pacte ARAM Bot' });
        
        await interaction.reply({ embeds: [embed] });
    }
};