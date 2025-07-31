const { signPacte, getPendingPactes } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        if (message.author.bot) return;
        
        // Check for "Je signe" message
        if (message.content.trim().toLowerCase() === 'je signe') {
            const client = message.client;
            
            try {
                // Récupérer les pactes en attente depuis la DB (source de vérité)
                const pendingPactes = await getPendingPactes(message.channel.id);
                
                // Chercher un pacte que cet utilisateur peut signer
                let foundPacte = null;
                for (const pacte of pendingPactes) {
                    // Vérifier si l'utilisateur est participant et n'a pas encore signé
                    if (pacte.participants.includes(message.author.id) && 
                        !pacte.signed_participants.includes(message.author.id)) {
                        foundPacte = pacte;
                        break;
                    }
                }
                
                if (!foundPacte) {
                    // Pas de pacte à signer pour cet utilisateur
                    return;
                }
                
                // Tenter la signature
                const result = await signPacte(foundPacte.id, message.author.id);
                
                await message.react('✅');
                
                if (!result.allSigned) {
                    // Pas encore tous signés, afficher le progrès
                    await message.reply({
                        content: `✅ **Signature confirmée !** (${result.signedCount}/${result.totalParticipants})\n` +
                                `En attente de ${result.totalParticipants - result.signedCount} signature(s) supplémentaire(s).`,
                        allowedMentions: { repliedUser: false }
                    });
                } else {
                    // Tous ont signé, pacte activé
                    
                    // Nettoyer la mémoire
                    if (client.pendingPactes) {
                        client.pendingPactes.delete(foundPacte.id);
                    }
                    
                    // Notification dans le canal de logs
                    const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                    if (logChannel) {
                        await logChannel.send({
                            content: `⚔️ **PACTE ACTIVÉ** - Pacte #${foundPacte.id}\n` +
                                    `🎯 Objectif : ${foundPacte.objective} victoires consécutives\n` +
                                    `👥 Participants : ${result.participantNames || result.totalParticipants + ' joueurs'}\n` +
                                    `Que la quête commence !`
                        });
                    }
                    
                    await message.channel.send('✨ **Pacte scellé !** Que l\'Abîme Hurlant guide vos pas vers la victoire !');
                }
                
            } catch (error) {
                logger.error('Error signing pacte:', error);
                
                // Si l'erreur indique que l'utilisateur a déjà signé
                if (error.message.includes('déjà signé')) {
                    await message.react('⚠️');
                    return message.reply({
                        content: '⚠️ Vous avez déjà signé ce pacte !',
                        allowedMentions: { repliedUser: false }
                    });
                }
                
                await message.reply({
                    content: '❌ Erreur lors de la signature. Veuillez réessayer.',
                    allowedMentions: { repliedUser: false }
                });
            }
        }
    }
};
