const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Voir l\'historique des pactes')
        .addUserOption(option =>
            option.setName('joueur')
                .setDescription('Historique d\'un joueur spécifique')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('limite')
                .setDescription('Nombre de pactes à afficher')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('joueur');
        const limit = interaction.options.getInteger('limite') || 10;
        const db = getDb();
        
        let query;
        let params;
        let title;
        
        if (targetUser) {
            // Historique d'un joueur spécifique
            query = `
                SELECT p.*, part.points_gained,
                    GROUP_CONCAT(u.summoner_name) as all_participants
                FROM pactes p
                JOIN participants part ON p.id = part.pacte_id
                JOIN participants all_part ON p.id = all_part.pacte_id
                JOIN users u ON all_part.discord_id = u.discord_id
                WHERE part.discord_id = ? AND part.signed_at IS NOT NULL
                GROUP BY p.id
                ORDER BY p.created_at DESC
                LIMIT ?
            `;
            params = [targetUser.id, limit];
            title = `📜 Historique des pactes de ${targetUser.username}`;
        } else {
            // Historique global
            query = `
                SELECT p.*,
                    GROUP_CONCAT(u.summoner_name) as all_participants,
                    COUNT(part.discord_id) as participant_count
                FROM pactes p
                JOIN participants part ON p.id = part.pacte_id
                JOIN users u ON part.discord_id = u.discord_id
                WHERE part.signed_at IS NOT NULL
                GROUP BY p.id
                ORDER BY p.created_at DESC
                LIMIT ?
            `;
            params = [limit];
            title = '📜 Historique des pactes';
        }
        
        const pactes = await db.all(query, params);
        
        if (pactes.length === 0) {
            return interaction.reply({
                content: '❌ Aucun pacte trouvé.',
                ephemeral: true
            });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(title)
            .setTimestamp()
            .setFooter({ text: `Affichage de ${pactes.length} pactes` });
        
        for (const pacte of pactes) {
            let status;
            switch(pacte.status) {
                case 'success': status = '✅ Réussi'; break;
                case 'failed': status = '❌ Échoué'; break;
                case 'active': status = '⚔️ En cours'; break;
                default: status = '⏳ En attente';
            }
            
            const participants = pacte.all_participants.split(',').slice(0, 3).join(', ');
            const moreParticipants = pacte.all_participants.split(',').length > 3 ? '...' : '';
            
            let value = `Objectif: **${pacte.objective}** wins\n`;
            value += `Meilleure série: **${pacte.best_streak_reached}**\n`;
            value += `Statut: ${status}\n`;
            
            if (targetUser && pacte.points_gained !== null) {
                value += `Points: **${pacte.points_gained > 0 ? '+' : ''}${pacte.points_gained}**\n`;
            }
            
            value += `Participants: ${participants}${moreParticipants}`;
            
            embed.addFields({
                name: `Pacte #${pacte.id} - ${new Date(pacte.created_at).toLocaleDateString('fr-FR')}`,
                value: value,
                inline: false
            });
        }
        
        await interaction.reply({ embeds: [embed] });
    }
};