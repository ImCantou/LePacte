const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
        
        // Store pacte context for signature collection
        interaction.client.pendingPactes.set(pacteId, {
            channelId: interaction.channelId,
            participants: participants,
            signatures: [],
            objective: objective,
            expires: Date.now() + 300000 // 5 minutes
        });
        
        // Set timeout to clean up if not signed
        setTimeout(() => {
            if (interaction.client.pendingPactes.has(pacteId)) {
                interaction.client.pendingPactes.delete(pacteId);
                interaction.followUp('⏰ Le délai de signature a expiré. Le pacte est annulé.');
            }
        }, 300000);
        
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
    await interaction.reply({
        content: '⚠️ Cette fonctionnalité sera disponible prochainement.',
        ephemeral: true
    });
}

async function handleJoinPacte(interaction) {
    await interaction.reply({
        content: '⚠️ Cette fonctionnalité sera disponible prochainement.',
        ephemeral: true
    });
}
