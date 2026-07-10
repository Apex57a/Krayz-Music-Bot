import { Guild } from 'discord.js';
import { removeGuildSettings } from '../../utils/database';
import { logger } from '../../utils/logger';

export default {
    name: 'guildDelete',
    execute(guild: Guild) {
        removeGuildSettings(guild.id);
        logger.info('system', `Bot removed from guild ${guild.id}, cleared settings cache.`);
    },
};
