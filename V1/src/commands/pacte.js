const { SlashCommandBuilder } = require('discord.js');
const { createPacte, getUserByDiscordId } = require('../services/userManager');
const { PACTE_RULES } = require('../utils/constants');

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
                .setDescription('Voir le statut du pacte en cours')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            await handleCreatePacte(interaction);
        } else if (subcommand === 'status') {
            await handleStatusPacte(interaction);
        }
    }
};

async function handleCreatePacte(interaction) {
    const objective = interaction.options.getInteger('objectif');
    const mentions = interaction.message.mentions.users;
    
    // Verify all mentioned users are registered
    const participants = [interaction.user.id];
    for (const [userId, user] of mentions) {
        const dbUser = await getUserByDiscordId(userId);
        if (!dbUser) {
            return interaction.reply({
                content: `❌ ${user.username} n'est pas enregistré. Utilisez /register d'abord.`,
                ephemeral: true
            });
        }
        participants.push(userId);
    }

    // Create pacte
    const pacteId = await createPacte(objective, participants);
    
    // Display pacte rules
    const rulesEmbed = {
        color: 0x0099ff,
        title: 'PACTE D\'HONNEUR DE L\'ABÎME HURLANT',
        description: PACTE_RULES.replace('[X]', objective),
        fields: [
            {
                name: 'Participants',
                value: participants.map(id => `<@${id}>`).join('\n')
            },
            {
                name: 'Pour signer ce pacte',
                value: 'Écrivez **"Je signe"** dans ce canal'
            }
        ],
        timestamp: new Date(),
        footer: {
            text: `Pacte #${pacteId} • Expire dans 5 minutes`
        }
    };

    await interaction.reply({ embeds: [rulesEmbed] });
    
    // Store pacte context for signature collection
    interaction.client.pendingPactes.set(pacteId, {
        channelId: interaction.channelId,
        participants: participants,
        signatures: [],
        expires: Date.now() + 300000 // 5 minutes
    });
}