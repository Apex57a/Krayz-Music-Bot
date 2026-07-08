import { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
import { logger } from '../../utils/logger';

export default {
    name: 'playerEnd',
    once: false,
    async execute(player: KazagumoPlayer, track: KazagumoTrack) {
        if (!track) return;
        logger.info('music', `Track ended in guild ${player.guildId}.`);
    }
};
