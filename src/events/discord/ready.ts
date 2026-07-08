import { Client, Events, REST, Routes, ActivityType } from 'discord.js';
import { config } from '../../config';
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

        // --- Register slash commands ---
        const rest = new REST({ version: '10' }).setToken(config.token);
        const commands = client.commands.filter((cmd) => cmd.data).map((cmd) => cmd.data.toJSON());

        try {
            logger.info('commands', `Registering ${commands.length} slash command(s)...`);

            // Always register commands globally
            logger.info('commands', 'Registering commands GLOBALLY...');
            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: commands },
            );

            // Clear guild-specific commands from ALL guilds to avoid duplication
            logger.info('commands', 'Clearing any leftover guild-specific commands to prevent duplication...');
            for (const guild of client.guilds.cache.values()) {
                await rest.put(
                    Routes.applicationGuildCommands(config.clientId, guild.id),
                    { body: [] },
                ).catch(() => {});
            }
            logger.info('commands', `All slash commands registered successfully.`);
        } catch (error: any) {
            logger.error('commands', `Failed to register slash commands: ${error.message}`);
        }
    },
};
