const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { kickParticipant, getKickInfo, getPacteKickHistory, unkickParticipant } = require('../services/kickService');
const { getUserByDiscordId, getActiveUserPacte } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Gestion des exclusions de pactes')
        .addSubcommand(subcommand =>
            subcommand
                .setName('player')
                .setDescription('Exclure un joueur du pacte actuel')
                .addUserOption(option =>
                    option
                        .setName('joueur')
                        .setDescription('Joueur à exclure')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('raison')
                        .setDescription('Raison de l\'exclusion')
                        .setRequired(true)
                        .addChoices(
                            { name: 'AFK / Abandon en game', value: 'afk_abandon' },
                            { name: 'Comportement toxique', value: 'toxic_behavior' },
                            { name: 'Troll / Sabotage', value: 'trolling' },
                            { name: 'Inactif trop longtemps', value: 'inactive' },
                            { name: 'Autre (préciser)', value: 'other' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('history')
                .setDescription('Voir l\'historique des exclusions d\'un pacte')
                .addIntegerOption(option =>
                    option
                        .setName('pacte_id')
                        .setDescription('ID du pacte (laisser vide pour le pacte actuel)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('undo')
                .setDescription('Annuler une exclusion (admin seulement)')
                .addUserOption(option =>
                    option
                        .setName('joueur')
                        .setDescription('Joueur à réintégrer')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option
                        .setName('pacte_id')
                        .setDescription('ID du pacte')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        try {
            switch (subcommand) {
                case 'player':
                    await handleKickPlayer(interaction);
                    break;
                case 'history':
                    await handleKickHistory(interaction);
                    break;
                case 'undo':
                    await handleUndoKick(interaction);
                    break;
            }
        } catch (error) {
            logger.error('Error in kick command:', error);
            await interaction.reply({
                content: `❌ Erreur: ${error.message}`,
                ephemeral: true
            });
        }
    }
};

async function handleKickPlayer(interaction) {
    const targetUser = interaction.options.getUser('joueur');
    const reason = interaction.options.getString('raison');
    
    // Vérifier que l'utilisateur qui fait la commande est enregistré
    const kicker = await getUserByDiscordId(interaction.user.id);
    if (!kicker) {
        return interaction.reply({
            content: '❌ Vous devez d\'abord vous enregistrer avec /register',
            ephemeral: true
        });
    }
    
    // Vérifier que la cible est enregistrée
    const target = await getUserByDiscordId(targetUser.id);
    if (!target) {
        return interaction.reply({
            content: '❌ Ce joueur n\'est pas enregistré.',
            ephemeral: true
        });
    }
    
    // Vérifier que l'utilisateur a un pacte actif
    const activePacte = await getActiveUserPacte(interaction.user.id);
    if (!activePacte) {
        return interaction.reply({
            content: '❌ Vous n\'avez pas de pacte actif.',
            ephemeral: true
        });
    }
    
    // Vérifier que la cible est dans le même pacte
    const targetActivePacte = await getActiveUserPacte(targetUser.id);
    if (!targetActivePacte || targetActivePacte.id !== activePacte.id) {
        return interaction.reply({
            content: '❌ Ce joueur n\'est pas dans votre pacte actif.',
            ephemeral: true
        });
    }
    
    // Ne pas permettre de s'exclure soi-même
    if (targetUser.id === interaction.user.id) {
        return interaction.reply({
            content: '❌ Vous ne pouvez pas vous exclure vous-même. Utilisez `/pacte leave` à la place.',
            ephemeral: true
        });
    }
    
    // Demander une raison personnalisée si "other" est sélectionné
    if (reason === 'other') {
        await interaction.reply({
            content: '📝 Veuillez préciser la raison de l\'exclusion dans les 30 secondes :',
            ephemeral: true
        });
        
        const filter = m => m.author.id === interaction.user.id && m.content.length > 0;
        const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
        
        collector.on('collect', async (msg) => {
            const customReason = msg.content.slice(0, 200); // Limiter à 200 caractères
            await processKick(interaction, targetUser, activePacte.id, customReason);
            await msg.delete().catch(() => {}); // Supprimer le message de raison
        });
        
        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.followUp({ 
                    content: '⏰ Temps écoulé. Exclusion annulée.', 
                    ephemeral: true 
                });
            }
        });
        
        return;
    }
    
    // Mapper les raisons prédéfinies
    const reasonMap = {
        'afk_abandon': 'AFK/Abandon en partie',
        'toxic_behavior': 'Comportement toxique',
        'trolling': 'Troll/Sabotage',
        'inactive': 'Inactif trop longtemps'
    };
    
    const finalReason = reasonMap[reason] || reason;
    await processKick(interaction, targetUser, activePacte.id, finalReason);
}

async function processKick(interaction, targetUser, pacteId, reason) {
    try {
        const result = await kickParticipant(pacteId, targetUser.id, interaction.user.id, reason);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('⚠️ Joueur exclu du pacte')
            .addFields(
                { name: '👤 Joueur exclu', value: result.kickedUser, inline: true },
                { name: '👮 Exclu par', value: result.kickerUser, inline: true },
                { name: '📝 Raison', value: reason, inline: false },
                { name: '💸 Malus appliqué', value: `-${result.malus} points`, inline: true },
                { name: '👥 Participants restants', value: `${result.remainingParticipants}`, inline: true }
            )
            .setTimestamp();
        
        if (result.pacteStatus === 'failed') {
            embed.addFields({
                name: '💀 Statut du pacte',
                value: 'Le pacte a échoué (pas assez de participants restants)',
                inline: false
            });
        }
        
        await interaction.editReply({ embeds: [embed], ephemeral: false });
        
        // Notifier le joueur exclu
        try {
            const targetUserObj = await interaction.client.users.fetch(targetUser.id);
            await targetUserObj.send({
                content: `⚠️ **Vous avez été exclu du pacte #${pacteId}**\n` +
                        `**Raison :** ${reason}\n` +
                        `**Malus appliqué :** -${result.malus} points\n` +
                        `**Exclu par :** ${result.kickerUser}`
            });
        } catch (error) {
            // Ignore si on ne peut pas envoyer de MP
        }
        
    } catch (error) {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: `❌ Erreur lors de l'exclusion : ${error.message}`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: `❌ Erreur lors de l'exclusion : ${error.message}`,
                ephemeral: true
            });
        }
    }
}

async function handleKickHistory(interaction) {
    let pacteId = interaction.options.getInteger('pacte_id');
    
    // Si pas d'ID fourni, utiliser le pacte actuel
    if (!pacteId) {
        const activePacte = await getActiveUserPacte(interaction.user.id);
        if (!activePacte) {
            return interaction.reply({
                content: '❌ Vous n\'avez pas de pacte actif. Spécifiez un ID de pacte.',
                ephemeral: true
            });
        }
        pacteId = activePacte.id;
    }
    
    const kickHistory = await getPacteKickHistory(pacteId);
    
    if (kickHistory.length === 0) {
        return interaction.reply({
            content: `ℹ️ Aucune exclusion enregistrée pour le pacte #${pacteId}.`,
            ephemeral: true
        });
    }
    
    const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle(`📋 Historique des exclusions - Pacte #${pacteId}`)
        .setDescription(`Total : ${kickHistory.length} exclusion(s)`)
        .setTimestamp();
    
    // Limiter à 10 exclusions les plus récentes
    const recentKicks = kickHistory.slice(0, 10);
    
    for (const kick of recentKicks) {
        const kickDate = new Date(kick.kicked_at);
        embed.addFields({
            name: `👤 ${kick.summoner_name}`,
            value: `**Raison :** ${kick.kick_reason}\n` +
                  `**Date :** ${kickDate.toLocaleDateString('fr-FR')} ${kickDate.toLocaleTimeString('fr-FR')}\n` +
                  `**Malus :** ${kick.points_gained} points`,
            inline: true
        });
    }
    
    if (kickHistory.length > 10) {
        embed.setFooter({ text: `... et ${kickHistory.length - 10} autre(s) exclusion(s)` });
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleUndoKick(interaction) {
    // Vérifier les permissions (uniquement pour les admins ou rôles spéciaux)
    const hasAdminRole = interaction.member.permissions.has('ADMINISTRATOR') || 
                        interaction.member.roles.cache.some(role => 
                            ['Admin', 'Modérateur', 'Bot Admin'].includes(role.name)
                        );
    
    if (!hasAdminRole) {
        return interaction.reply({
            content: '❌ Seuls les administrateurs peuvent annuler une exclusion.',
            ephemeral: true
        });
    }
    
    const targetUser = interaction.options.getUser('joueur');
    const pacteId = interaction.options.getInteger('pacte_id');
    
    try {
        // Vérifier que le joueur a bien été exclu de ce pacte
        const kickInfo = await getKickInfo(pacteId, targetUser.id);
        if (!kickInfo) {
            return interaction.reply({
                content: '❌ Ce joueur n\'a pas été exclu de ce pacte.',
                ephemeral: true
            });
        }
        
        const result = await unkickParticipant(pacteId, targetUser.id, interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Exclusion annulée')
            .addFields(
                { name: '👤 Joueur réintégré', value: result.userName, inline: true },
                { name: '👮 Annulé par', value: result.adminName, inline: true },
                { name: '💰 Points remboursés', value: `+${result.refundedPoints}`, inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        // Notifier le joueur réintégré
        try {
            const targetUserObj = await interaction.client.users.fetch(targetUser.id);
            await targetUserObj.send({
                content: `✅ **Votre exclusion du pacte #${pacteId} a été annulée**\n` +
                        `**Points remboursés :** +${result.refundedPoints}\n` +
                        `**Annulé par :** ${result.adminName}\n\n` +
                        `Vous pouvez maintenant écrire "Je signe" pour rejoindre à nouveau le pacte.`
            });
        } catch (error) {
            // Ignore si on ne peut pas envoyer de MP
        }
        
    } catch (error) {
        await interaction.reply({
            content: `❌ Erreur lors de l'annulation : ${error.message}`,
            ephemeral: true
        });
    }
}
