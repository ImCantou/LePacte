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
        
        const db = getDb();
        
        // Get pacte stats with more details
        const pacteStats = await db.get(`
            SELECT 
                COUNT(DISTINCT p.id) as total_pactes,
                SUM(CASE WHEN p.status = 'success' THEN 1 ELSE 0 END) as pactes_success,
                SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as pactes_failed,
                MAX(p.best_streak_reached) as best_streak,
                SUM(part.points_gained) as points_from_pactes,
                AVG(p.objective) as avg_objective
            FROM pactes p
            JOIN participants part ON p.id = part.pacte_id
            WHERE part.discord_id = ? AND part.signed_at IS NOT NULL
        `, targetUser.id);
        
        // Get last pacte info
        const lastPacte = await db.get(`
            SELECT p.*, part.points_gained
            FROM pactes p
            JOIN participants part ON p.id = part.pacte_id
            WHERE part.discord_id = ? AND part.signed_at IS NOT NULL
            ORDER BY p.created_at DESC
            LIMIT 1
        `, targetUser.id);
        
        // Calculate win rate
        const winRate = pacteStats.total_pactes > 0 
            ? Math.round((pacteStats.pactes_success / pacteStats.total_pactes) * 100) 
            : 0;
        
        // Format registration date (with fallback for missing created_at)
        const regDate = user.created_at ? new Date(user.created_at) : new Date();
        const daysSinceReg = user.created_at ? Math.floor((Date.now() - regDate) / (1000 * 60 * 60 * 24)) : 0;
        
        // Build embed
        const embed = new EmbedBuilder()
            .setColor(winRate >= 50 ? 0x00ff00 : winRate >= 25 ? 0xffaa00 : 0xff0000)
            .setTitle(`📊 Statistiques de ${user.summoner_name}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '🏆 Points Total', value: `${user.points_total}`, inline: true },
                { name: '📅 Points du Mois', value: `${user.points_monthly}`, inline: true },
                { name: '🔥 Meilleure Série', value: `${user.best_streak_ever} victoires`, inline: true },
                { name: '📜 Pactes Totaux', value: `${pacteStats.total_pactes || 0}`, inline: true },
                { name: '✅ Taux de Réussite', value: `${winRate}%`, inline: true },
                { name: '💎 Record Personnel', value: `${pacteStats.best_streak || 0} wins`, inline: true },
                { name: '📆 Inscrit depuis', value: user.created_at ? `${daysSinceReg} jours\n(${regDate.toLocaleDateString('fr-FR')})` : 'Date inconnue', inline: true },
                { name: '📈 Objectif moyen', value: `${Math.round(pacteStats.avg_objective || 0)} wins`, inline: true },
                { name: '� Points totaux gagnés', value: `${pacteStats.points_from_pactes || 0}`, inline: true }
            );
        
        // Add last pacte info if exists
        if (lastPacte) {
            let lastPacteStatus;
            switch(lastPacte.status) {
                case 'success': lastPacteStatus = '✅ Réussi'; break;
                case 'failed': lastPacteStatus = '❌ Échoué'; break;
                case 'active': lastPacteStatus = '⚔️ En cours'; break;
                default: lastPacteStatus = '⏳ En attente';
            }
            
            const lastPacteDate = new Date(lastPacte.created_at);
            const pointsDisplay = lastPacte.points_gained > 0 
                ? `+${lastPacte.points_gained}` 
                : `${lastPacte.points_gained}`;
            
            embed.addFields({
                name: '📍 Dernier Pacte',
                value: `Pacte #${lastPacte.id} (${lastPacteDate.toLocaleDateString('fr-FR')})\n` +
                       `Objectif: ${lastPacte.objective} wins | ${lastPacteStatus}\n` +
                       `Meilleure série: ${lastPacte.best_streak_reached} | Points: ${pointsDisplay}`,
                inline: false
            });
        }
        
        // Add motivational footer based on performance
        let footerText;
        if (winRate >= 75) {
            footerText = '🌟 Légende de l\'Abîme !';
        } else if (winRate >= 50) {
            footerText = '💪 Champion confirmé !';
        } else if (winRate >= 25) {
            footerText = '📈 En progression !';
        } else {
            footerText = '🎯 La persévérance paie toujours !';
        }
        
        embed.setTimestamp()
            .setFooter({ text: footerText });
        
        await interaction.reply({ embeds: [embed] });
    }
};