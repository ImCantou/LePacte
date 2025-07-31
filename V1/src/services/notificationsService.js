const { EmbedBuilder } = require('discord.js');
const { TAUNTS } = require('../utils/constants');
const logger = require('../utils/logger');

class NotificationService {
    constructor(client) {
        this.client = client;
    }
    
    async sendPacteCreated(pacte, participants, channelId) {
        const logChannel = await this.getLogChannel(channelId);
        if (!logChannel) return;
        
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('📜 Nouveau Pacte Créé')
            .setDescription(`Pacte #${pacte.id}`)
            .addFields(
                { name: '🎯 Objectif', value: `${pacte.objective} victoires`, inline: true },
                { name: '👥 Participants', value: `${participants.length} joueurs`, inline: true },
                { name: '📍 Canal', value: `<#${channelId}>`, inline: true }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendPacteActivated(pacteId, objective, participants) {
        const logChannel = await this.getLogChannel();
        if (!logChannel) return;
        
        const participantMentions = participants.map(id => `<@${id}>`).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('⚔️ PACTE ACTIVÉ')
            .setDescription(`Pacte #${pacteId} - Que la quête commence !`)
            .addFields(
                { name: '🎯 Objectif', value: `${objective} victoires consécutives`, inline: false },
                { name: '👥 Champions', value: participantMentions, inline: false }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendGameDetected(pacte, participants) {
        const logChannel = await this.getLogChannel(pacte.log_channel_id);
        if (!logChannel) return;
        
        const embed = new EmbedBuilder()
            .setColor(0xffff00)
            .setTitle('🎮 Partie Détectée')
            .setDescription(`Pacte #${pacte.id} - Les champions entrent dans l'Abîme !`)
            .addFields(
                { name: '📊 Progression', value: `${pacte.current_wins}/${pacte.objective}`, inline: true },
                { name: '🔥 Série actuelle', value: `${pacte.current_wins} victoires`, inline: true }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendVictory(pacte, newWins) {
        const logChannel = await this.getLogChannel(pacte.log_channel_id);
        if (!logChannel) return;
        
        let color = 0x00ff00;
        let title = '✅ VICTOIRE !';
        let description = `${newWins}/${pacte.objective}`;
        
        if (newWins === pacte.objective - 1) {
            color = 0xff9900;
            title = '🔥 MATCH POINT !';
            description = `**LA PROCHAINE EST LA DERNIÈRE !**`;
        }
        
        const taunt = this.getContextualTaunt(pacte, newWins);
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .addFields(
                { name: '💬 Message', value: taunt, inline: false }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendDefeat(pacte, wasAtObjective = false) {
        const logChannel = await this.getLogChannel(pacte.log_channel_id);
        if (!logChannel) return;
        
        let title = '💀 DÉFAITE';
        let description = `Retour à 0/${pacte.objective}`;
        let color = 0xff0000;
        
        if (wasAtObjective) {
            title = '💔 SI PROCHE...';
            description = `Défaite à 1 victoire de l'objectif !`;
            color = 0x8b0000;
        }
        
        const hoursLeft = 24 - Math.floor((Date.now() - new Date(pacte.created_at).getTime()) / 3600000);
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .addFields(
                { name: '⏰ Temps restant', value: `${hoursLeft} heures`, inline: true },
                { name: '🏆 Meilleure série', value: `${pacte.best_streak_reached} victoires`, inline: true }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendPacteSuccess(pacte, points, participants) {
        const logChannel = await this.getLogChannel(pacte.log_channel_id);
        if (!logChannel) return;
        
        const participantMentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
        
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('🎉 PACTE RÉUSSI !')
            .setDescription(`**GLOIRE ÉTERNELLE AUX CHAMPIONS !**`)
            .addFields(
                { name: '📜 Pacte', value: `#${pacte.id}`, inline: true },
                { name: '🎯 Objectif atteint', value: `${pacte.objective} victoires`, inline: true },
                { name: '💎 Points gagnés', value: `+${points}`, inline: true },
                { name: '👥 Champions', value: participantMentions, inline: false }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
        
        // Message épique
        await logChannel.send(`🏆 **${participantMentions}** 🏆\n*Vos noms seront gravés dans les annales de l'Abîme Hurlant !*`);
    }
    
    async sendPacteFailed(pacte, points, participants) {
        const logChannel = await this.getLogChannel(pacte.log_channel_id);
        if (!logChannel) return;
        
        const participantMentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
        
        const embed = new EmbedBuilder()
            .setColor(0x8b0000)
            .setTitle('❌ PACTE ÉCHOUÉ')
            .setDescription(`L'Abîme a eu raison de votre détermination...`)
            .addFields(
                { name: '📜 Pacte', value: `#${pacte.id}`, inline: true },
                { name: '🎯 Objectif manqué', value: `${pacte.best_streak_reached}/${pacte.objective}`, inline: true },
                { name: '💔 Points', value: `${points > 0 ? '+' : ''}${points}`, inline: true },
                { name: '👥 Participants', value: participantMentions, inline: false }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendRecordBroken(user, newRecord, oldRecord) {
        const logChannel = await this.getLogChannel();
        if (!logChannel) return;
        
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('🌟 NOUVEAU RECORD PERSONNEL !')
            .setDescription(`<@${user.discord_id}> vient de battre son record !`)
            .addFields(
                { name: '📈 Nouveau record', value: `${newRecord} victoires`, inline: true },
                { name: '📊 Ancien record', value: `${oldRecord} victoires`, inline: true }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }
    
    async sendServerRecord(pacte, participants) {
        const logChannel = await this.getLogChannel(pacte.log_channel_id);
        if (!logChannel) return;
        
        const participantMentions = participants.map(p => `<@${p.discord_id}>`).join(' ');
        
        await logChannel.send(`🌟 **RECORD DU SERVEUR EN VUE !** 🌟\n${participantMentions} sont à ${pacte.current_wins} victoires ! Encore un effort !`);
    }
    
    getContextualTaunt(pacte, currentWins) {
        const progress = currentWins / pacte.objective;
        
        if (currentWins === pacte.objective - 1) {
            return TAUNTS.lastOne;
        }
        
        let taunts;
        if (progress < 0.3) {
            taunts = TAUNTS.generic;
        } else if (progress < 0.7) {
            taunts = [...TAUNTS.generic, ...TAUNTS.victory];
        } else {
            taunts = TAUNTS.victory;
        }
        
        return taunts[Math.floor(Math.random() * taunts.length)];
    }
    
    async getLogChannel(preferredChannelId = null) {
        const channelId = preferredChannelId || process.env.LOG_CHANNEL_ID;
        if (!channelId) {
            logger.warn('No log channel configured');
            return null;
        }
        
        try {
            return await this.client.channels.fetch(channelId);
        } catch (error) {
            logger.error(`Failed to fetch log channel ${channelId}:`, error);
            return null;
        }
    }
}

module.exports = NotificationService;