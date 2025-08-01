const { signPacte, getPendingPactes } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        if (message.author.bot) return;
        
        if (message.content.trim().toLowerCase() === 'je signe') {
            try {
                // Récupérer TOUS les pactes où l'utilisateur peut signer
                const pendingPactes = await getPendingPactes(message.channel.id);
                
                let foundPacte = null;
                for (const pacte of pendingPactes) {
                    if (pacte.participants.includes(message.author.id) && 
                        !pacte.signed_participants.includes(message.author.id)) {
                        foundPacte = pacte;
                        break;
                    }
                }
                
                if (!foundPacte) {
                    return;
                }
                
                const result = await signPacte(foundPacte.id, message.author.id);
                
                await message.react('✅');
                
                if (!result.allSigned) {
                    await message.reply({
                        content: `✅ **Signature confirmée !** (${result.signedCount}/${result.totalParticipants})\n` +
                                `En attente de ${result.totalParticipants - result.signedCount} signature(s).`,
                        allowedMentions: { repliedUser: false }
                    });
                } else {
                    await message.channel.send('✨ **Pacte scellé !** Que l\'Abîme Hurlant guide vos pas vers la victoire !');
                    
                    const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                    if (logChannel) {
                        await logChannel.send(
                            `⚔️ **PACTE ACTIVÉ** - Pacte #${foundPacte.id}\n` +
                            `🎯 Objectif : ${foundPacte.objective} victoires\n` +
                            `👥 Participants : ${result.participantNames}\n` +
                            `Que la quête commence !`
                        );
                    }
                }
                
            } catch (error) {
                logger.error('Error signing pacte:', error);
                
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
