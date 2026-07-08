import { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { logger } from '../../utils/logger';

export default {
    name: 'playerException',
    async execute(player: KazagumoPlayer, data: any, client: any) {
        const trackTitle = player.queue.current?.title || 'Unknown Track';
        logger.error('music', `Playback exception in guild ${player.guildId} for track "${trackTitle}": ${data?.error?.message || 'Unknown error'}`);

        const channel = client?.channels?.cache?.get(player.textId!) as TextChannel;
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription(`⚠️ **Playback Error**: Could not play **${trackTitle}**.\nAuto-skipping to the next track...`);
            channel.send({ embeds: [embed] }).catch(() => null);
        }

        // Auto-skip to the next track to recover playback
        player.data.delete('lookaheadActive');
        player.data.delete('lookaheadTrack');
        player.skip();
    },
};
