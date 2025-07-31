const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const { createPacte, getUserByDiscordId, getActiveUserPacte } = require('../services/userManager');
const { PACTE_RULES } = require('../utils/constants');
const { calculatePoints, calculateMalus } = require('../services/pointsCalculator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pacte')
        .setDescription('Gestion des pactes ARAM')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Créer un nouveau pacte')
                .addIntegerOption(option =>
                    option
                        .setName('objectif')
                        .setDescription('Nombre de victoires consécutives')
                        .setRequired(true)
                        .setMinValue(3)
                        .setMaxValue(10))
                .addStringOption(option =>
                    option
                        .setName('joueurs')
                        .setDescription('Mentions des joueurs (@joueur1 @joueur2...)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Voir le statut du pacte en cours'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Quitter le pacte en cours (avec malus)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('join')
                .setDescription('Rejoindre un pacte existant (si 0 victoire)')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch(subcommand) {
            case 'create':
                await handleCreatePacte(interaction);
                break;
            case 'status':
                await handleStatusPacte(interaction);
                break;
            case 'leave':
                await handleLeavePacte(interaction);
                break;
            case 'join':
                await handleJoinPacte(interaction);
                break;
        }
    }
};

async function handleCreatePacte(interaction) {
    const objective = interaction.options.getInteger('objectif');
    const playersString = interaction.options.getString('joueurs');
    
    // Check if creator is registered
    const creator = await getUserByDiscordId(interaction.user.id);
    if (!creator) {
        return interaction.reply({
            content: '❌ Vous devez d\'abord vous enregistrer avec /register',
            ephemeral: true
        });
    }
    
    // Parse mentions from string
    const mentionRegex = /<@!?(\d+)>/g;
    const mentions = [...playersString.matchAll(mentionRegex)];
    
    // Build participants list (including creator)
    const participants = [interaction.user.id];
    const uniqueUsers = new Set([interaction.user.id]);
    
    for (const match of mentions) {
        const userId = match[1];
        
        // Skip duplicates
        if (uniqueUsers.has(userId)) continue;
        
        const dbUser = await getUserByDiscordId(userId);
        if (!dbUser) {
            const user = await interaction.client.users.fetch(userId);
            return interaction.reply({
                content: `❌ ${user.username} n'est pas enregistré. Utilisez /register d'abord.`,
                ephemeral: true
            });
        }
        participants.push(userId);
        uniqueUsers.add(userId);
    }
    
    // Check max 5 participants
    if (participants.length > 5) {
        return interaction.reply({
            content: '❌ Maximum 5 joueurs par pacte (taille d\'une équipe ARAM)',
            ephemeral: true
        });
    }
    
    try {
        // Create pacte
        const pacteId = await createPacte(objective, participants, interaction.channelId);
        
        // Calculate points for display
        const points = calculatePoints(objective, objective);
        const malus = calculateMalus(objective, 0);
        
        // Display pacte rules
        const rulesText = PACTE_RULES
            .replace(/\[X\]/g, objective)
            .replace('[POINTS]', points)
            .replace('[MALUS]', malus);
        
        const rulesEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('PACTE D\'HONNEUR DE L\'ABÎME HURLANT')
            .setDescription(rulesText)
            .addFields(
                {
                    name: '👥 Participants',
                    value: participants.map(id => `<@${id}>`).join('\n'),
                    inline: true
                },
                {
                    name: '📜 Pour signer ce pacte',
                    value: 'Écrivez **"Je signe"** dans ce canal',
                    inline: true
                }
            )
            .setTimestamp()
            .setFooter({ text: `Pacte #${pacteId} • Expire dans 5 minutes` });

        await interaction.reply({ embeds: [rulesEmbed] });
        
        // Note: Plus besoin de timeout ici car nous utilisons la DB comme source de vérité
        // Le système d'expiration est géré dans getPendingPactes() via une requête SQL
        
    } catch (error) {
        await interaction.reply({
            content: `❌ Erreur: ${error.message}`,
            ephemeral: true
        });
    }
}

async function handleStatusPacte(interaction) {
    const activePacte = await getActiveUserPacte(interaction.user.id);
    
    if (!activePacte) {
        return interaction.reply({
            content: '❌ Vous n\'avez pas de pacte actif.',
            ephemeral: true
        });
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`📜 Pacte #${activePacte.id}`)
        .addFields(
            { name: '🎯 Objectif', value: `${activePacte.objective} victoires`, inline: true },
            { name: '🏆 Victoires actuelles', value: `${activePacte.current_wins}`, inline: true },
            { name: '🔥 Meilleure série', value: `${activePacte.best_streak_reached}`, inline: true },
            { name: '📊 Statut', value: activePacte.status === 'active' ? '✅ Actif' : '⏳ En attente', inline: true }
        )
        .setTimestamp(new Date(activePacte.created_at))
        .setFooter({ text: 'Pacte ARAM Bot' });
    
    await interaction.reply({ embeds: [embed] });
}

async function handleLeavePacte(interaction) {
    const activePacte = await getActiveUserPacte(interaction.user.id);
    
    if (!activePacte) {
        return interaction.reply({
            content: '❌ Vous n\'avez pas de pacte actif.',
            ephemeral: true
        });
    }
    
    // Calculer le malus
    const malus = calculateMalus(activePacte.objective, activePacte.best_streak_reached);
    
    // Confirmation
    const confirmEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚠️ Quitter le pacte ?')
        .setDescription(`Êtes-vous sûr de vouloir abandonner le pacte #${activePacte.id} ?`)
        .addFields(
            { name: 'Malus', value: `-${malus} points`, inline: true },
            { name: 'Meilleure série', value: `${activePacte.best_streak_reached}/${activePacte.objective}`, inline: true }
        );
    
    await interaction.reply({
        embeds: [confirmEmbed],
        content: 'Répondez "ABANDON" pour confirmer (30 secondes)',
        ephemeral: true
    });
    
    const filter = m => m.author.id === interaction.user.id && m.content.toLowerCase() === 'abandon';
    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
    
    collector.on('collect', async () => {
        try {
            const { leavePacte } = require('../services/userManager');
            const result = await leavePacte(activePacte.id, interaction.user.id, malus);
            
            await interaction.followUp({
                content: `💔 **Vous avez quitté le pacte #${activePacte.id}**\n` +
                        `Malus appliqué : -${malus} points\n` +
                        `Participants restants : ${result.remainingParticipants}`,
                ephemeral: true
            });
            
            // Notifier dans le canal de logs
            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                const statusText = result.pacteStatus === 'failed' ? '💀 **PACTE ÉCHOUÉ**' : '⚠️ **ABANDON**';
                await logChannel.send(
                    `${statusText} - Pacte #${activePacte.id}\n` +
                    `👤 **${result.userName}** a abandonné le pacte\n` +
                    `💸 **Malus :** -${malus} points\n` +
                    `👥 **Participants restants :** ${result.remainingParticipants}\n` +
                    `📊 **Meilleure série atteinte :** ${activePacte.best_streak_reached}/${activePacte.objective}`
                );
            }
            
        } catch (error) {
            logger.error('Error leaving pacte:', error);
            await interaction.followUp({
                content: `❌ Erreur lors de l'abandon : ${error.message}`,
                ephemeral: true
            });
        }
    });
    
    collector.on('end', collected => {
        if (collected.size === 0) {
            interaction.followUp({ content: 'Abandon annulé.', ephemeral: true });
        }
    });
}

async function handleJoinPacte(interaction) {
    const user = await getUserByDiscordId(interaction.user.id);
    if (!user) {
        return interaction.reply({
            content: '❌ Vous devez d\'abord vous enregistrer avec /register',
            ephemeral: true
        });
    }
    
    // Chercher tous les pactes rejoinables dans ce canal
    const { getAllJoinablePactes, joinPacte } = require('../services/userManager');
    const joinablePactes = await getAllJoinablePactes(interaction.channelId);
    
    if (joinablePactes.length === 0) {
        return interaction.reply({
            content: '❌ Aucun pacte rejoinable dans ce canal.\n' +
                    '💡 Les pactes doivent être à 0 victoire et avoir moins de 5 participants.',
            ephemeral: true
        });
    }
    
    if (joinablePactes.length === 1) {
        // Un seul pacte disponible, rejoindre directement
        const pacte = joinablePactes[0];
        try {
            await joinPacte(pacte.id, interaction.user.id);
            
            await interaction.reply({
                content: `✅ **Vous avez rejoint le pacte #${pacte.id} !**\n` +
                        `🎯 **Objectif :** ${pacte.objective} victoires consécutives\n` +
                        `👥 **Participants :** ${pacte.participant_count + 1}/5\n\n` +
                        '✍️ Écrivez **"Je signe"** pour valider votre participation.'
            });
            
        } catch (error) {
            await interaction.reply({
                content: `❌ Erreur: ${error.message}`,
                ephemeral: true
            });
        }
    } else {
        // Plusieurs pactes disponibles, afficher un menu de sélection
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_pacte_to_join')
            .setPlaceholder('Choisissez le pacte à rejoindre...')
            .addOptions(
                joinablePactes.map(pacte => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`Pacte #${pacte.id}`)
                        .setDescription(`${pacte.objective} victoires • ${pacte.participant_count}/5 participants`)
                        .setValue(pacte.id.toString())
                )
            );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('🎯 Pactes disponibles')
            .setDescription('Plusieurs pactes sont disponibles dans ce canal. Choisissez celui que vous souhaitez rejoindre :')
            .addFields(
                joinablePactes.map(pacte => ({
                    name: `Pacte #${pacte.id}`,
                    value: `🎯 **Objectif :** ${pacte.objective} victoires consécutives\n👥 **Participants :** ${pacte.participant_count}/5\n📅 **Statut :** ${pacte.status === 'pending' ? 'En attente de signatures' : 'Actif'}`,
                    inline: true
                }))
            )
            .setFooter({ text: 'Vous avez 30 secondes pour choisir' });
        
        const response = await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
        
        // Écouter la sélection
        try {
            const confirmation = await response.awaitMessageComponent({
                componentType: ComponentType.StringSelect,
                time: 30000,
                filter: i => i.user.id === interaction.user.id
            });
            
            const selectedPacteId = parseInt(confirmation.values[0]);
            const selectedPacte = joinablePactes.find(p => p.id === selectedPacteId);
            
            try {
                await joinPacte(selectedPacteId, interaction.user.id);
                
                await confirmation.update({
                    content: `✅ **Vous avez rejoint le pacte #${selectedPacteId} !**\n` +
                            `🎯 **Objectif :** ${selectedPacte.objective} victoires consécutives\n` +
                            `👥 **Participants :** ${selectedPacte.participant_count + 1}/5\n\n` +
                            '✍️ Écrivez **"Je signe"** dans le canal pour valider votre participation.',
                    embeds: [],
                    components: []
                });
                
            } catch (error) {
                await confirmation.update({
                    content: `❌ Erreur: ${error.message}`,
                    embeds: [],
                    components: []
                });
            }
            
        } catch (error) {
            // Timeout ou erreur
            await interaction.editReply({
                content: '⏰ Temps écoulé ! Utilisez à nouveau `/pacte join` pour rejoindre un pacte.',
                embeds: [],
                components: []
            });
        }
    }
}
