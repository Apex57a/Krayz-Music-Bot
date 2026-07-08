import { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { EmbedBuilder, TextChannel, Client } from 'discord.js';
import { logger } from '../../utils/logger';
import { formatDuration } from '../../utils/helpers';

export default {
    name: 'playerStart',
    once: false,
    async execute(player: KazagumoPlayer, track: KazagumoTrack, activeClient: Client) {
        if (!track) return;
        logger.info('music', `Now playing: ${track.title} in guild ${player.guildId}`);

        if (player.textId) {
            const channel = activeClient.channels.cache.get(player.textId) as TextChannel;
            if (channel) {
                const requesterId = (track.requester as any)?.id;
                const embed = new EmbedBuilder()
                    .setColor(0x111111)
                    .setTitle('Now Playing')
                    .setDescription(`[${track.title}](${track.uri})`)
                    .addFields(
                        { name: 'Author', value: track.author || 'Unknown', inline: true },
                        { name: 'Duration', value: track.isStream ? 'LIVE' : formatDuration(track.length || 0), inline: true },
                        { name: 'Requested by', value: requesterId ? `<@${requesterId}>` : 'Unknown', inline: true }
                    );

                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        }
    }
};
