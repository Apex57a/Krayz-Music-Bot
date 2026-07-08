import { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { logger } from '../../utils/logger';

export default {
    name: 'playerResolveError',
    async execute(player: KazagumoPlayer, track: KazagumoTrack, message: string, client: any) {
        logger.error('music', `Resolve error in guild ${player.guildId} for track "${track?.title || 'Unknown'}": ${message || 'Unknown error'}`);

        const channel = client?.channels?.cache?.get(player.textId!) as TextChannel;
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription(`⚠️ **Resolution Error**: Failed to resolve **${track?.title || 'Unknown Track'}**.\nAuto-skipping to the next track...`);
            channel.send({ embeds: [embed] }).catch(() => null);
        }

        // Auto-skip to the next track to recover playback
        player.data.delete('lookaheadActive');
        player.data.delete('lookaheadTrack');
        player.skip();
    },
};
