const { signPacte } = require('../services/userManager');
const logger = require('../utils/logger');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        if (message.author.bot) return;
        
        // Check for "Je signe" message
        if (message.content.toLowerCase() === 'je signe') {
            const client = message.client;
            
            // Find pending pacte in this channel
            let foundPacte = null;
            for (const [pacteId, pacteData] of client.pendingPactes) {
                if (pacteData.channelId === message.channel.id && 
                    pacteData.participants.includes(message.author.id) &&
                    Date.now() < pacteData.expires) {
                    foundPacte = { id: pacteId, data: pacteData };
                    break;
                }
            }
            
            if (!foundPacte) return;
            
            // Check if already signed
            if (foundPacte.data.signatures.includes(message.author.id)) {
                return message.reply('Vous avez déjà signé ce pacte !');
            }
            
            // Add signature
            foundPacte.data.signatures.push(message.author.id);
            
            try {
                const allSigned = await signPacte(foundPacte.id, message.author.id);
                
                await message.react('✅');
                
                if (allSigned) {
                    // All participants signed
                    client.pendingPactes.delete(foundPacte.id);
                    
                    const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
                    await logChannel.send({
                        content: `⚔️ **PACTE ACTIVÉ** - Pacte #${foundPacte.id}\nQue la quête commence ! Objectif : ${foundPacte.data.objective} victoires consécutives.`
                    });
                    
                    await message.channel.send('✨ **Pacte scellé !** Que l\'Abîme Hurlant guide vos pas vers la victoire !');
                }
            } catch (error) {
                logger.error('Error signing pacte:', error);
                await message.reply('❌ Erreur lors de la signature.');
            }
        }
    }
};