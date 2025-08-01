const { signPacte, getPendingPactes } = require('../services/userManager');
const { getDb } = require('../utils/database');
const logger = require('../utils/logger');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        if (message.author.bot) return;
        
        if (message.content.trim().toLowerCase() === 'je signe') {
            // Ajouter la réaction ✅ immédiatement
            await message.react('✅');
            
            try {
                const db = getDb();
                
                // Récupérer TOUS les pactes où l'utilisateur peut signer
                const pendingPactes = await getPendingPactes(message.channel.id);
                
                let foundPacte = null;
                for (const pacte of pendingPactes) {
                    if (pacte.participants.includes(message.author.id) && 
                        !pacte.signed_participants.includes(message.author.id)) {
                        
                        // Vérifier que le pacte n'est pas en game
                        const pacteStatus = await db.get('SELECT in_game FROM pactes WHERE id = ?', pacte.id);
                        if (!pacteStatus.in_game) {
                            foundPacte = pacte;
                            break;
                        }
                    }
                }
                
                if (!foundPacte) {
                    // Vérifier si c'est parce que le pacte est en game
                    for (const pacte of pendingPactes) {
                        if (pacte.participants.includes(message.author.id) && 
                            !pacte.signed_participants.includes(message.author.id)) {
                            const pacteStatus = await db.get('SELECT in_game FROM pactes WHERE id = ?', pacte.id);
                            if (pacteStatus.in_game) {
                                // Changer la réaction en ❌ pour les erreurs
                                await message.reactions.removeAll();
                                await message.react('❌');
                                return message.reply({
                                    content: '❌ Impossible de signer pendant qu\'une partie est en cours !',
                                    allowedMentions: { repliedUser: false }
                                });
                            }
                        }
                    }
                    
                    // Aucun pacte à signer trouvé - changer en ❌
                    await message.reactions.removeAll();
                    await message.react('❌');
                    return message.reply({
                        content: '❌ Aucun pacte en attente de signature trouvé.',
                        allowedMentions: { repliedUser: false }
                    });
                }
                
                const result = await signPacte(foundPacte.id, message.author.id);
                
                // Garder la réaction ✅ pour les signatures réussies
                
                if (!result.allSigned) {
                    await message.reply({
                        content: `⚔️ **SIGNATURE SCELLÉE !** (${result.signedCount}/${result.totalParticipants})\n` +
                                `📜 Pacte #${foundPacte.id} - En attente de ${result.totalParticipants - result.signedCount} signature(s).`,
                        allowedMentions: { repliedUser: false }
                    });
                } else {
                    await message.channel.send('✨ **PACTE SCELLÉ !** Que l\'Abîme Hurlant guide vos pas vers la victoire !');
                    
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
                
                // Changer la réaction en ⚠️ pour les erreurs
                await message.reactions.removeAll();
                
                if (error.message.includes('déjà signé')) {
                    await message.react('⚠️');
                    return message.reply({
                        content: '⚠️ Vous avez déjà signé ce pacte !',
                        allowedMentions: { repliedUser: false }
                    });
                }
                
                await message.react('❌');
                await message.reply({
                    content: '❌ Erreur lors de la signature. Veuillez réessayer.',
                    allowedMentions: { repliedUser: false }
                });
            }
        }
    }
};
