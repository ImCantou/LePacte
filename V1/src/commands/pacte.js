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
    
    // Calculer le malus
    const malus = calculateMalus(activePacte.objective, activePacte.best_streak_reached);
    
    // Confirmation
    const confirmEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚔️ Rompre le Pacte Sacré ?')
        .setDescription(`**Guerrier, réfléchissez bien...**\n\n` +
                       `Vous vous apprêtez à trahir le **Pacte #${activePacte.id}** de l'Abîme Hurlant.\n` +
                       `Cette action déshonorera votre nom et celui de vos ancêtres.`)
        .addFields(
            { name: '⚖️ Châtiment', value: `-${malus} points de pénitence`, inline: true },
            { name: '🏆 Exploit perdu', value: `${activePacte.best_streak_reached}/${activePacte.objective} victoires`, inline: true },
            { name: '💀 Conséquences', value: 'Déshonneur éternel', inline: true }
        )
        .setFooter({ text: 'Les anciens esprits vous observent...' });
    
    await interaction.reply({
        embeds: [confirmEmbed],
        content: '🩸 **Écrivez "ABANDON" pour sceller votre trahison** (30 secondes)\n*Ou gardez le silence pour préserver votre honneur...*',
        ephemeral: true
    });
    
    const filter = m => m.author.id === interaction.user.id && m.content.toLowerCase() === 'abandon';
    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
    
    collector.on('collect', async () => {
        try {
            const { leavePacte } = require('../services/userManager');
            const result = await leavePacte(activePacte.id, interaction.user.id, malus);
            
            await interaction.followUp({
                content: `⚔️ **Vous avez rompu le pacte sacré de l'Abîme Hurlant...**\n\n` +
                        `💀 **Le déshonneur vous poursuit** - Votre réputation est ternie\n` +
                        `⚖️ **Pénitence :** -${malus} points de châtiment\n` +
                        `👥 **Compagnons abandonnés :** ${result.remainingParticipants} guerrier(s) restant(s)\n\n` +
                        `*Les anciens esprits de l'Abîme se souviendront de votre trahison...*`,
                ephemeral: true
            });
            
            // Notifier dans le canal de logs
            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                let rpMessage;
                
                if (result.pacteStatus === 'failed') {
                    // Tous ont abandonné - Pacte complètement échoué
                    rpMessage = `🏴‍☠️ **LE PACTE SOMBRE S'EFFONDRE** - Pacte #${activePacte.id}\n\n` +
                               `💀 **${result.userName}** a brisé les derniers liens sacrés\n` +
                               `⚰️ **L'alliance est morte** - Plus aucun guerrier ne tient parole\n` +
                               `🩸 **Châtiment divin :** -${malus} points de pénitence\n` +
                               `📜 **Meilleure tentative :** ${activePacte.best_streak_reached}/${activePacte.objective} victoires\n\n` +
                               `*L'Abîme Hurlant pleure cette trahison ultime...*`;
                } else if (result.remainingParticipants === 1) {
                    // Il ne reste qu'un seul guerrier
                    rpMessage = `⚔️ **DÉSERTION DANS LES RANGS** - Pacte #${activePacte.id}\n\n` +
                               `�️ **${result.userName}** a abandonné ses frères d'armes\n` +
                               `� **Un seul guerrier** résiste encore à l'appel de l'Abîme\n` +
                               `⚖️ **Prix de la lâcheté :** -${malus} points de déshonneur\n` +
                               `� **Exploit perdu :** ${activePacte.best_streak_reached}/${activePacte.objective} victoires\n\n` +
                               `*Le dernier champion devra-t-il combattre seul ?*`;
                } else {
                    // Abandon normal avec plusieurs participants restants
                    rpMessage = `💔 **SERMENT BRISÉ** - Pacte #${activePacte.id}\n\n` +
                               `⚔️ **${result.userName}** a renié son honneur\n` +
                               `🛡️ **${result.remainingParticipants} guerriers** maintiennent encore l'alliance\n` +
                               `⚖️ **Rétribution :** -${malus} points de châtiment\n` +
                               `🏆 **Progression perdue :** ${activePacte.best_streak_reached}/${activePacte.objective} victoires\n\n` +
                               `*Les fidèles continuent leur quête vers la gloire...*`;
                }
                
                await logChannel.send(rpMessage);
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
            interaction.followUp({ 
                content: '🛡️ **Sagesse préservée !** Votre honneur demeure intact.\n*L\'Abîme approuve votre loyauté...*', 
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
            
            // Tenter de signer automatiquement après avoir rejoint
            const { signPacte } = require('../services/userManager');
            const signResult = await signPacte(pacte.id, interaction.user.id);
            
            if (!signResult.allSigned) {
                // Pas encore tous signés, afficher le progrès
                await interaction.reply({
                    content: `✅ **Vous avez rejoint le pacte #${pacte.id} et signé !**\n` +
                            `🎯 **Objectif :** ${pacte.objective} victoires consécutives\n` +
                            `👥 **Participants :** ${pacte.participant_count + 1}/5\n` +
                            `📝 **Signatures :** ${signResult.signedCount}/${signResult.totalParticipants}\n\n` +
                            `⏳ En attente de ${signResult.totalParticipants - signResult.signedCount} signature(s) supplémentaire(s).`
                });
                
                // Log du nouveau participant
                const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(
                        `➕ **NOUVEAU PARTICIPANT** - Pacte #${pacte.id}\n` +
                        `<@${interaction.user.id}> a rejoint le pacte et signé automatiquement !`
                    );
                }
            } else {
                // Tous ont signé, pacte activé
                await interaction.reply({
                    content: `🎉 **Pacte #${pacte.id} ACTIVÉ !**\n` +
                            `Vous avez rejoint et tous les participants ont signé !\n` +
                            `🎯 **Objectif :** ${pacte.objective} victoires consécutives\n` +
                            `👥 **Équipe complète :** ${signResult.participantNames}`
                });
                
                // Log de l'activation
                const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(
                        `🚀 **PACTE ACTIVÉ** - Pacte #${pacte.id}\n` +
                        `Dernier participant : <@${interaction.user.id}>\n` +
                        `Équipe : ${signResult.participantNames}\n` +
                        `Objectif : ${pacte.objective} victoires consécutives`
                    );
                }
            }
            
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
                
                // Tenter de signer automatiquement après avoir rejoint
                const { signPacte } = require('../services/userManager');
                const signResult = await signPacte(selectedPacteId, interaction.user.id);
                
                if (!signResult.allSigned) {
                    // Pas encore tous signés, afficher le progrès
                    await confirmation.update({
                        content: `✅ **Vous avez rejoint le pacte #${selectedPacteId} et signé !**\n` +
                                `🎯 **Objectif :** ${selectedPacte.objective} victoires consécutives\n` +
                                `👥 **Participants :** ${selectedPacte.participant_count + 1}/5\n` +
                                `📝 **Signatures :** ${signResult.signedCount}/${signResult.totalParticipants}\n\n` +
                                `⏳ En attente de ${signResult.totalParticipants - signResult.signedCount} signature(s) supplémentaire(s).`,
                        embeds: [],
                        components: []
                    });
                    
                    // Log du nouveau participant
                    const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                    if (logChannel) {
                        await logChannel.send(
                            `➕ **NOUVEAU PARTICIPANT** - Pacte #${selectedPacteId}\n` +
                            `<@${interaction.user.id}> a rejoint le pacte et signé automatiquement !`
                        );
                    }
                } else {
                    // Tous ont signé, pacte activé
                    await confirmation.update({
                        content: `🎉 **Pacte #${selectedPacteId} ACTIVÉ !**\n` +
                                `Vous avez rejoint et tous les participants ont signé !\n` +
                                `🎯 **Objectif :** ${selectedPacte.objective} victoires consécutives\n` +
                                `👥 **Équipe complète :** ${signResult.participantNames}`,
                        embeds: [],
                        components: []
                    });
                    
                    // Log de l'activation
                    const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                    if (logChannel) {
                        await logChannel.send(
                            `🚀 **PACTE ACTIVÉ** - Pacte #${selectedPacteId}\n` +
                            `Dernier participant : <@${interaction.user.id}>\n` +
                            `Équipe : ${signResult.participantNames}\n` +
                            `Objectif : ${selectedPacte.objective} victoires consécutives`
                        );
                    }
                }
                
            } catch (error) {
                await confirmation.update({
                    content: `❌ Erreur: ${error.message}`,
                    embeds: [],
                    components: []
                });
            }
        } catch (error) {
            // Timeout ou erreur de sélection
            await interaction.editReply({
                content: '⏰ Temps écoulé ! Utilisez à nouveau `/pacte join` pour rejoindre un pacte.',
                embeds: [],
                components: []
            });
        }
}

// Nouvelle fonction handleKickPacte
async function handleKickPacte(interaction) {
    const targetUser = interaction.options.getUser('joueur');
    const voterId = interaction.user.id;
    
    // Vérifier que le votant est dans un pacte actif
    const activePacte = await getActiveUserPacte(voterId);
    if (!activePacte) {
        return interaction.reply({
            content: '❌ Vous n\'avez pas de pacte actif.',
            ephemeral: true
        });
    }
    
    // Vérifier que la cible est dans le même pacte
    const { isParticipant } = require('../services/userManager');
    const targetInPacte = await isParticipant(activePacte.id, targetUser.id);
    
    if (!targetInPacte) {
        return interaction.reply({
            content: '❌ Ce joueur n\'est pas dans votre pacte.',
            ephemeral: true
        });
    }
    
    // Ne pas pouvoir se kick soi-même
    if (voterId === targetUser.id) {
        return interaction.reply({
            content: '❌ Vous ne pouvez pas vous exclure vous-même. Utilisez `/pacte leave`.',
            ephemeral: true
        });
    }
    
    // Récupérer tous les participants actifs sauf la cible
    const participants = await getPacteParticipants(activePacte.id);
    const voters = participants.filter(p => p.discord_id !== targetUser.id);
    
    if (voters.length < 2) {
        return interaction.reply({
            content: '❌ Il faut au moins 2 participants (hors cible) pour lancer un vote.',
            ephemeral: true
        });
    }
    
    // Créer l'embed de vote
    const voteEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🗳️ Vote d\'exclusion')
        .setDescription(`Vote pour exclure **${targetUser.username}** du pacte #${activePacte.id}`)
        .addFields(
            { name: '📊 Votes requis', value: `${voters.length} votes unanimes (tous sauf la cible)`, inline: true },
            { name: '⏱️ Durée du vote', value: '2 minutes', inline: true }
        )
        .setFooter({ text: 'Réagissez avec ✅ pour voter OUI, ❌ pour voter NON' });
    
    const voteMessage = await interaction.reply({
        embeds: [voteEmbed],
        fetchReply: true
    });
    
    await voteMessage.react('✅');
    await voteMessage.react('❌');
    
    // Créer les collecteurs
    const yesFilter = (reaction, user) => reaction.emoji.name === '✅' && voters.some(v => v.discord_id === user.id);
    const noFilter = (reaction, user) => reaction.emoji.name === '❌' && voters.some(v => v.discord_id === user.id);
    
    const yesCollector = voteMessage.createReactionCollector({ filter: yesFilter, time: 120000 });
    const noCollector = voteMessage.createReactionCollector({ filter: noFilter, time: 120000 });
    
    const votes = new Map();
    voters.forEach(v => votes.set(v.discord_id, null));
    
    yesCollector.on('collect', (reaction, user) => {
        votes.set(user.id, true);
        logger.info(`Vote YES from ${user.id} for kicking ${targetUser.id} from pacte #${activePacte.id}`);
    });
    
    noCollector.on('collect', (reaction, user) => {
        votes.set(user.id, false);
        logger.info(`Vote NO from ${user.id} for kicking ${targetUser.id} from pacte #${activePacte.id}`);
    });
    
    yesCollector.on('end', async () => {
        const yesVotes = Array.from(votes.values()).filter(v => v === true).length;
        const noVotes = Array.from(votes.values()).filter(v => v === false).length;
        const abstentions = voters.length - yesVotes - noVotes;
        
        let resultEmbed;
        
        if (yesVotes === voters.length) {
            // Vote unanime - kick
            const { kickParticipant } = require('../services/userManager');
            const malus = calculateMalus(activePacte.objective, activePacte.best_streak_reached);
            
            await kickParticipant(activePacte.id, targetUser.id, malus, 'Vote unanime des participants');
            
            resultEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('⚠️ Exclusion confirmée')
                .setDescription(`${targetUser} a été exclu du pacte #${activePacte.id}`)
                .addFields(
                    { name: '✅ Pour', value: `${yesVotes}`, inline: true },
                    { name: '❌ Contre', value: `${noVotes}`, inline: true },
                    { name: '🤷 Abstention', value: `${abstentions}`, inline: true },
                    { name: '💸 Malus appliqué', value: `-${malus} points`, inline: false }
                );
            
            // Log dans le canal
            const logChannel = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(
                    `👢 **EXCLUSION PAR VOTE** - Pacte #${activePacte.id}\n` +
                    `${targetUser} a été exclu suite à un vote unanime.\n` +
                    `Malus : -${malus} points`
                );
            }
        } else {
            // Vote non unanime - pas de kick
            resultEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Vote rejeté')
                .setDescription(`${targetUser} reste dans le pacte (vote non unanime)`)
                .addFields(
                    { name: '✅ Pour', value: `${yesVotes}`, inline: true },
                    { name: '❌ Contre', value: `${noVotes}`, inline: true },
                    { name: '🤷 Abstention', value: `${abstentions}`, inline: true }
                );
        }
        
        await interaction.followUp({ embeds: [resultEmbed] });
    });
}
}
