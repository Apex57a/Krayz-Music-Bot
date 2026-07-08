import { Client, Collection, GatewayIntentBits, Partials, Options } from 'discord.js';
import { Kazagumo } from 'kazagumo';
import { Connectors } from 'shoukaku';

// Polyfill global fetch with node-fetch for hosting compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetch = require('node-fetch');
(global as any).fetch = fetch;

import { loadEvents } from './handlers/eventHandler';
import { loadCommands } from './handlers/commandHandler';
import { config } from './config';
import { load247FromDB } from './commands/247';
import { preloadGuildSettings } from './utils/database';
import { logger } from './utils/logger';
import { setupLoggerEvents } from './utils/loggerService';
import { saveStateOnExit, restoreStateOnStartup } from './utils/stateManager';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const key of required) {
    if (!process.env[key]) {
        logger.error('system', `Missing env var: ${key}. Check your .env file.`);
        process.exit(1);
    }
}

process.on('unhandledRejection', (error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    logger.error('system', `Unhandled rejection: ${message}`);
});
process.on('uncaughtException', (error: Error) => {
    logger.error('system', `Uncaught exception: ${error.stack || error.message}`);
});

declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
        kazagumo: Kazagumo;
    }
}

const clientA = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
    ],
    sweepers: {
        messages: { interval: 300, lifetime: 600 },
    },
    makeCache: Options.cacheWithLimits({
        MessageManager: 50,
        PresenceManager: 0,
        ReactionManager: 0,
        GuildMemberManager: {
            maxSize: 50,
            keepOverLimit: (member) => member.id === member.client.user?.id,
        },
    }),
});

let clientB: Client | null = null;
if (process.env.WORKER_TOKEN) {
    clientB = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
        ],
        sweepers: {
            messages: { interval: 300, lifetime: 600 },
        },
        makeCache: Options.cacheWithLimits({
            MessageManager: 0,
            PresenceManager: 0,
            ReactionManager: 0,
            GuildMemberManager: {
                maxSize: 10,
                keepOverLimit: (member) => member.id === member.client.user?.id,
            },
        }),
    });
}

clientA.commands = new Collection();

// Track which client is handling which guild's voice connection (Legacy, kept for compatibility if needed, but not used by Kazagumo internally anymore)
export const orchestratorAssignments = new Map<string, string>(); 

const nodes = [
    {
        name: 'Node - 1',
        url: `${config.lavalink.host}:${config.lavalink.port}`,
        auth: config.lavalink.password,
        secure: config.lavalink.secure,
    },
    ...(config.lavalinkWorker.host ? [{
        name: 'Node - 2',
        url: `${config.lavalinkWorker.host}:${config.lavalinkWorker.port}`,
        auth: config.lavalinkWorker.password,
        secure: config.lavalinkWorker.secure,
    }] : [])
];

const kazagumoA = new Kazagumo({
    defaultSearchEngine: 'youtube_music',
    send: (guildId, payload) => {
        const guild = clientA.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
    },
}, new Connectors.DiscordJS(clientA), nodes);

clientA.kazagumo = kazagumoA;

let kazagumoB: Kazagumo | undefined;
if (clientB) {
    kazagumoB = new Kazagumo({
        defaultSearchEngine: 'youtube_music',
        send: (guildId, payload) => {
            const guild = clientB!.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
    }, new Connectors.DiscordJS(clientB), nodes);
    clientB.kazagumo = kazagumoB;
}

function bindKazagumoEvents(kaz: Kazagumo, prefix: string) {
    kaz.shoukaku.on('error', (name, error) => {
        logger.error('music', `[${prefix}] Node "${name}" error: ${error.message || error}`);
    });
    kaz.shoukaku.on('close', (name, code, reason) => {
        logger.warn('music', `[${prefix}] Node "${name}" closed: ${code} - ${reason}`);
    });
    kaz.shoukaku.on('disconnect', (name, count) => {
        logger.warn('music', `[${prefix}] Node "${name}" disconnected. Active players: ${count}`);
    });
    kaz.shoukaku.on('ready', (name) => {
        logger.info('music', `[${prefix}] Node "${name}" connected.`);
    });
    kaz.shoukaku.on('debug', (name, info) => {
        if (info.toLowerCase().includes('rest') || info.toLowerCase().includes('fetch')) {
            logger.system('music', `[${prefix}] [Node: ${name}] ${info}`);
        }
    });
}

bindKazagumoEvents(kazagumoA, 'Primary');
if (kazagumoB) bindKazagumoEvents(kazagumoB, 'Worker');

// Hook process exit for state preservation
function shutdown() {
    logger.info('system', 'Shutting down... Preserving queues.');
    saveStateOnExit(kazagumoA, kazagumoB);
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown); // Nodemon restart


(async () => {
    try {
        await preloadGuildSettings();
        await loadCommands(clientA);
        await loadEvents(clientA);
        setupLoggerEvents(clientA);

        await clientA.login(config.token);
        logger.info('system', `Starting Krayz-Music v${config.version}`);
        logger.info('system', `Primary Bot ${clientA.user?.tag} connected.`);

        if (clientB && process.env.WORKER_TOKEN) {
            await clientB.login(process.env.WORKER_TOKEN);
            logger.info('system', `Worker Bot ${clientB.user?.tag} connected in standby mode.`);
        }

        setTimeout(() => {
            restoreStateOnStartup(clientA.kazagumo, clientB?.kazagumo);
        }, 3000); // Wait 3 seconds for Lavalink nodes to be fully ready before restoring

        await load247FromDB(clientA);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('system', `Failed to start: ${message}`);
        process.exit(1);
    }
})();

export { clientA as client, clientB };
