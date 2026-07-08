import { Client, Events, ActivityType } from 'discord.js';
import { logger } from '../../utils/logger';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        logger.system('discord', `Krayz is online as ${client.user?.tag}`);
        logger.system('discord', `Serving ${client.guilds.cache.size} guild(s)`);

        // --- Set initial bot status ---
        client.user?.setPresence({
            activities: [
                {
                    name: `/play to start | ${client.guilds.cache.size} server(s)`,
                    type: ActivityType.Listening,
                },
            ],
            status: 'online',
        });

        // --- Rotate status every 30 seconds ---
        let statusIndex = 0;
        setInterval(() => {
            const players = client.kazagumo?.players;
            const activePlayers = players ? [...players.values()].filter(p => p.playing) : [];

            let currentSong = null;
            let totalQueue = 0;
            if (activePlayers.length > 0) {
                currentSong = activePlayers[0].queue.current;
                for (const player of activePlayers) {
                    totalQueue += player.queue.length;
                }
            }

            const dynamicStatuses = [
                { name: currentSong ? `Listening to ${currentSong.title}` : 'Listening to silence', type: ActivityType.Custom },
                { name: 'Heyaaaaaaaaaaaaaa', type: ActivityType.Custom },
                { name: 'Hi I am KrayMusic', type: ActivityType.Custom },
                { name: `${totalQueue} Songs in Que`, type: ActivityType.Custom },
                { name: 'Vibing to music', type: ActivityType.Custom },
                { name: 'Drop a song!', type: ActivityType.Custom },
            ];

            client.user?.setActivity(dynamicStatuses[statusIndex]);
            statusIndex = (statusIndex + 1) % dynamicStatuses.length;
        }, 30_000);

        // Slash commands are now registered exclusively via commandHandler.ts
        // when DEPLOY_COMMANDS=true. No duplicate registration on every boot.
        logger.info('commands', 'Slash command registration is handled by commandHandler.ts (set DEPLOY_COMMANDS=true to register).');
    },
};
