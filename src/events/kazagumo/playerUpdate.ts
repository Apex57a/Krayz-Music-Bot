import { KazagumoPlayer } from 'kazagumo';

export const playerStateCache = new Map<string, { trackUri: string; position: number }>();

export default {
    name: 'playerUpdate',
    async execute(player: KazagumoPlayer) {
        if (player.playing && player.queue.current) {
            playerStateCache.set(player.guildId, {
                trackUri: player.queue.current.uri || player.queue.current.identifier,
                position: player.position,
            });
        }
    },
};
