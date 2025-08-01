const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const { createPacte, getUserByDiscordId, getActiveUserPacte, getPacteParticipants } = require('../services/userManager');
const { PACTE_RULES } = require('../utils/constants');
const { calculatePoints, calculateMalus } = require('../services/pointsCalculator');
const logger = require('../utils/logger');

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
                .setDescription('Rejoindre un pacte existant (si 0 victoire)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('kick')
                .setDescription('Voter pour exclure un participant du pacte')
                .addUserOption(option =>
                    option
                        .setName('joueur')
                        .setDescription('Le joueur à exclure')
                        .setRequired(true))),

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
            case 'kick':
                await handleKickPacte(interaction);
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
    
    const malus = calculateMalus(activePacte.objective, activePacte.best_streak_reached);
    
    const confirmEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚔️ Rompre le Pacte ?')
        .setDescription(`Vous allez quitter le **Pacte #${activePacte.id}**`)
        .addFields(
            { name: '⚖️ Malus', value: `-${malus} points`, inline: true },
            { name: '🏆 Progression', value: `${activePacte.best_streak_reached}/${activePacte.objective}`, inline: true }
        );
    
    await interaction.reply({
        embeds: [confirmEmbed],
        content: 'Écrivez **"ABANDON"** pour confirmer (30 secondes)',
        ephemeral: true
    });
    
    const filter = m => m.author.id === interaction.user.id && m.content.toLowerCase() === 'abandon';
    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
    
    collector.on('collect', async () => {
        try {
            const { leavePacte } = require('../services/userManager');
            const result = await leavePacte(activePacte.id, interaction.user.id, malus);
            
            await interaction.followUp({
                content: `💀 Vous avez quitté le pacte. **-${malus} points**`,
                ephemeral: true
            });
            
            // ENVOYER LE LOG
            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(
                    `💔 **ABANDON** - Pacte #${activePacte.id}\n` +
                    `${result.userName} a quitté le pacte\n` +
                    `Malus : -${malus} points\n` +
                    `Participants restants : ${result.remainingParticipants}`
                );
            }
            
        } catch (error) {
            logger.error('Error leaving pacte:', error);
            await interaction.followUp({
                content: `❌ Erreur : ${error.message}`,
                ephemeral: true
            });
        }
    });
    
    collector.on('end', collected => {
        if (collected.size === 0) {
            interaction.followUp({ 
                content: '✅ Abandon annulé.', 
                ephemeral: true 
            });
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
    
    const { getAllJoinablePactes, joinPacte } = require('../services/userManager');
    const joinablePactes = await getAllJoinablePactes(interaction.channelId);
    
    if (joinablePactes.length === 0) {
        return interaction.reply({
            content: '❌ Aucun pacte rejoinable dans ce canal.',
            ephemeral: true
        });
    }
    
    if (joinablePactes.length === 1) {
        // Un seul pacte disponible
        const pacte = joinablePactes[0];
        try {
            await joinPacte(pacte.id, interaction.user.id);
            
            await interaction.reply({
                content: `✅ **Vous avez rejoint le pacte #${pacte.id} !**\n` +
                        `🎯 Objectif : ${pacte.objective} victoires\n` +
                        `👥 Participants : ${pacte.participant_count + 1}/5\n\n` +
                        `📝 **Écrivez "Je signe" pour valider votre participation**`
            });
            
            // Log
            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(
                    `➕ **NOUVEAU PARTICIPANT** - Pacte #${pacte.id}\n` +
                    `<@${interaction.user.id}> a rejoint le pacte (en attente de signature)`
                );
            }
            
        } catch (error) {
            await interaction.reply({
                content: `❌ Erreur: ${error.message}`,
                ephemeral: true
            });
        }
    } else {
        // Menu de sélection pour plusieurs pactes
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_pacte_join')
            .setPlaceholder('Choisissez un pacte...')
            .addOptions(
                joinablePactes.map(pacte => ({
                    label: `Pacte #${pacte.id}`,
                    description: `${pacte.objective} wins • ${pacte.participant_count}/5 joueurs`,
                    value: pacte.id.toString()
                }))
            );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        await interaction.reply({
            content: '🎯 Plusieurs pactes disponibles :',
            components: [row],
            ephemeral: true
        });
    }
}

async function handleKickPacte(interaction) {
    const targetUser = interaction.options.getUser('joueur');
    
    // Vérifications de base
    const activePacte = await getActiveUserPacte(interaction.user.id);
    if (!activePacte) {
        return interaction.reply({
            content: '❌ Vous n\'avez pas de pacte actif.',
            ephemeral: true
        });
    }
    
    // Vérifier que la cible est dans le pacte
    const targetInPacte = await getUserByDiscordId(targetUser.id);
    const targetPacte = await getActiveUserPacte(targetUser.id);
    
    if (!targetInPacte || !targetPacte || targetPacte.id !== activePacte.id) {
        return interaction.reply({
            content: '❌ Ce joueur n\'est pas dans votre pacte.',
            ephemeral: true
        });
    }
    
    if (targetUser.id === interaction.user.id) {
        return interaction.reply({
            content: '❌ Utilisez `/pacte leave` pour quitter.',
            ephemeral: true
        });
    }
    
    // Simple kick direct (pas de vote complexe)
    const malus = calculateMalus(activePacte.objective, activePacte.best_streak_reached);
    
    const confirmEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('👢 Exclure un joueur')
        .setDescription(`Exclure **${targetUser.username}** du pacte ?`)
        .addFields(
            { name: 'Malus pour le joueur', value: `-${malus} points`, inline: true }
        );
    
    await interaction.reply({
        embeds: [confirmEmbed],
        content: 'Réagissez avec ✅ pour confirmer (30 secondes)',
        fetchReply: true
    });
    
    const message = await interaction.fetchReply();
    await message.react('✅');
    
    const filter = (reaction, user) => reaction.emoji.name === '✅' && user.id === interaction.user.id;
    
    try {
        await message.awaitReactions({ filter, max: 1, time: 30000, errors: ['time'] });
        
        // Effectuer le kick
        const { kickParticipant } = require('../services/userManager');
        await kickParticipant(activePacte.id, targetUser.id, malus, `Exclu par ${interaction.user.username}`);
        
        await interaction.editReply({
            content: `✅ ${targetUser.username} a été exclu du pacte. Malus : -${malus} points`,
            embeds: []
        });
        
        // Log
        const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
            await logChannel.send(
                `👢 **EXCLUSION** - Pacte #${activePacte.id}\n` +
                `${targetUser} exclu par ${interaction.user}\n` +
                `Malus : -${malus} points`
            );
        }
        
    } catch (error) {
        await interaction.editReply({
            content: '⏰ Temps écoulé. Exclusion annulée.',
            embeds: []
        });
    }
}
