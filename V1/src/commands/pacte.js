const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const { createPacte, getUserByDiscordId, getActiveUserPacte, getPacteParticipants } = require('../services/userManager');
const { PACTE_RULES } = require('../utils/constants');
const { calculatePoints, calculateMalus } = require('../services/pointsCalculator');
const { getDb } = require('../utils/database'); // Ajouter cet import
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
    
    // Calculer le temps écoulé depuis le début du pacte
    const startTime = new Date(activePacte.started_at || activePacte.created_at);
    const hoursElapsed = Math.floor((Date.now() - startTime) / 3600000);
    const minutesElapsed = Math.floor(((Date.now() - startTime) % 3600000) / 60000);
    
    // Récupérer le nombre de parties jouées
    const db = getDb();
    const gamesPlayed = await db.get(
        'SELECT COUNT(*) as count FROM game_history WHERE pacte_id = ?',
        activePacte.id
    );
    
    const embed = new EmbedBuilder()
        .setColor(activePacte.current_wins > 0 ? 0x00ff00 : 0x0099ff)
        .setTitle(`📜 Pacte #${activePacte.id}`)
        .addFields(
            { name: '🎯 Objectif', value: `${activePacte.objective} victoires`, inline: true },
            { name: '🏆 Victoires actuelles', value: `${activePacte.current_wins}`, inline: true },
            { name: '🔥 Meilleure série', value: `${activePacte.best_streak_reached}`, inline: true },
            { name: '📊 Statut', value: activePacte.status === 'active' ? '✅ Actif' : '⏳ En attente', inline: true },
            { name: '🎮 Parties jouées', value: `${gamesPlayed?.count || 0}`, inline: true },
            { name: '⏱️ Temps écoulé', value: `${hoursElapsed}h ${minutesElapsed}min`, inline: true }
        );
    
    // Ajouter un message contextuel
    if (hoursElapsed >= 24) {
        embed.setDescription('⚠️ **TEMPS ÉCOULÉ !** Ce pacte a dépassé les 24h limite.');
        embed.setColor(0xff0000);
    } else if (activePacte.current_wins === activePacte.objective - 1) {
        embed.setDescription('🔥 **MATCH POINT !** Une victoire de plus pour la gloire !');
        embed.setColor(0xffa500);
    } else if (activePacte.current_wins > 0) {
        embed.setDescription(`💪 En bonne voie ! Plus que ${activePacte.objective - activePacte.current_wins} victoires !`);
    } else if (gamesPlayed?.count > 0) {
        embed.setDescription('💀 Retour à zéro... Mais il n\'est jamais trop tard pour recommencer !');
    } else {
        embed.setDescription('🎯 Pacte prêt ! Lancez votre première partie ARAM !');
    }
    
    embed.setTimestamp(startTime)
        .setFooter({ text: 'Pacte démarré le' });
    
    await interaction.reply({ embeds: [embed] });
}

async function handleLeavePacte(interaction) {
    const db = getDb();
    const activePacte = await getActiveUserPacte(interaction.user.id);
    
    if (!activePacte) {
        return interaction.reply({
            content: '❌ Vous n\'avez pas de pacte actif.',
            ephemeral: true
        });
    }
    
    // Vérifier si le pacte est en game
    const pacteStatus = await db.get('SELECT in_game FROM pactes WHERE id = ?', activePacte.id);
    if (pacteStatus.in_game) {
        return interaction.reply({
            content: '❌ **Impossible de quitter pendant une partie !**\n' +
                    'Attendez la fin de la partie en cours pour quitter le pacte.',
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
            // Double vérification au moment de l'abandon
            const currentStatus = await db.get('SELECT in_game FROM pactes WHERE id = ?', activePacte.id);
            if (currentStatus.in_game) {
                await interaction.followUp({
                    content: '❌ Une partie a commencé entre temps ! Abandon annulé.',
                    ephemeral: true
                });
                return;
            }
            
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
    const db = getDb();
    
    // Récupérer les pactes joinables
    const joinablePactes = await getAllJoinablePactes(interaction.channelId);
    
    if (joinablePactes.length === 0) {
        return interaction.reply({
            content: '❌ Aucun pacte rejoinable dans ce canal.',
            ephemeral: true
        });
    }
    
    // Filtrer les pactes qui sont en game
    const availablePactes = [];
    for (const pacte of joinablePactes) {
        const pacteStatus = await db.get('SELECT in_game FROM pactes WHERE id = ?', pacte.id);
        if (!pacteStatus.in_game) {
            availablePactes.push(pacte);
        }
    }
    
    if (availablePactes.length === 0) {
        return interaction.reply({
            content: '❌ Tous les pactes sont actuellement en partie. Attendez la fin des parties en cours.',
            ephemeral: true
        });
    }
    
    if (availablePactes.length === 1) {
        const pacte = availablePactes[0];
        try {
            // Rejoindre en mode "pending signature"
            await joinPacte(pacte.id, interaction.user.id);
            
            await interaction.reply({
                content: `📜 **Vous êtes invité au Pacte #${pacte.id} !**\n` +
                        `🎯 Objectif : ${pacte.objective} victoires\n` +
                        `👥 Participants : ${pacte.participant_count + 1}/5\n\n` +
                        `⚔️ **ÉCRIVEZ "Je signe" POUR SCELLER VOTRE ENGAGEMENT !**\n` +
                        `*Sans signature, vous ne participez pas au pacte.*`
            });
            
            // Log
            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(
                    `📝 **INVITATION PACTE** - #${pacte.id}\n` +
                    `<@${interaction.user.id}> invité (en attente de signature)`
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
                availablePactes.map(pacte => ({
                    label: `Pacte #${pacte.id}`,
                    description: `${pacte.objective} wins • ${pacte.participant_count}/5 joueurs`,
                    value: pacte.id.toString()
                }))
            );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        await interaction.reply({
            content: '🎯 Pactes disponibles (non en partie) :',
            components: [row],
            ephemeral: true
        });
    }
}
