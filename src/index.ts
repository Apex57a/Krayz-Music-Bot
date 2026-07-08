import fetch from 'node-fetch';
(global as any).fetch = fetch;

import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { Kazagumo, Plugins } from 'kazagumo';
import { Connectors } from 'shoukaku';
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

process.on('unhandledRejection', (error: any) => {
    logger.error('system', `Unhandled rejection: ${error?.stack || error}`);
});
process.on('uncaughtException', (error: any) => {
    logger.error('system', `Uncaught exception: ${error?.stack || error}`);
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
        GatewayIntentBits.GuildModeration,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember,
    ],
});

let clientB: Client | null = null;
if (process.env.WORKER_TOKEN) {
    clientB = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
        ],
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
    } catch (err: any) {
        logger.error('system', `Failed to start: ${err.message || err}`);
        process.exit(1);
    }
})();

export { clientA as client, clientB };
