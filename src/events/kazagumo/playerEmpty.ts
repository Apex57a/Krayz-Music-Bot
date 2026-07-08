import { KazagumoPlayer } from 'kazagumo';
import { EmbedBuilder, TextChannel, Client } from 'discord.js';
import { twentyFourSevenGuilds } from '../../commands/247';
import { logger } from '../../utils/logger';

export const emptyTimeouts = new Map<string, NodeJS.Timeout>();

export default {
    name: 'playerEmpty',
    async execute(player: KazagumoPlayer, activeClient: Client) {
        if (emptyTimeouts.has(player.guildId)) {
            clearTimeout(emptyTimeouts.get(player.guildId));
            emptyTimeouts.delete(player.guildId);
        }

        const channel = activeClient?.channels?.cache?.get(player.textId!) as TextChannel;
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('No songs left to play.');
            await channel.send({ embeds: [embed] }).catch(() => null);
        }

        player.data.delete('manualSkip');

        if (twentyFourSevenGuilds.has(player.guildId)) {
            logger.info('music', `Queue empty in ${player.guildId}, but 24/7 is enabled. Staying in voice channel.`);
            return;
        }

        const timeout = setTimeout(() => {
            emptyTimeouts.delete(player.guildId);
            if (player.queue.size === 0 && !player.playing) {
                try {
                    const activePlayer = (activeClient as any).kazagumo.players.get(player.guildId);
                    if (activePlayer) {
                        logger.info('music', `Disconnecting from ${player.guildId} due to inactivity.`);
                        activePlayer.data.set('intentionalDisconnect', true);
                        activePlayer.destroy();
                    }
                } catch (err: any) {
                    logger.error('music', `Error destroying player in empty timeout: ${err.message}`);
                }
            }
        }, 30_000); // 30 seconds

        emptyTimeouts.set(player.guildId, timeout);
    },
};
