import { Client, Collection, GatewayIntentBits, Partials, Options } from 'discord.js';
import { Kazagumo } from 'kazagumo';
import { Connectors } from 'shoukaku';

// Polyfill global fetch with node-fetch for hosting compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetch = require('node-fetch');
(global as any).fetch = fetch;

import { loadEvents } from './handlers/eventHandler';
import { loadCommands } from './handlers/commandHandler';
import { config, validateEnv } from './config';
import { load247FromDB } from './commands/247';
import { preloadGuildSettings } from './utils/database';
import { botPool } from './utils/botPool';
import { logger } from './utils/logger';
import { setupLoggerEvents } from './utils/loggerService';
import { saveStateOnExit, restoreStateOnStartup } from './utils/stateManager';

// Validate environment before doing anything else
if (!validateEnv()) {
    process.exit(1);
}

let isShuttingDown = false;

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

// ─── Client Factory ───────────────────────────────────────────────────────────

/**
 * Create a worker client with stripped-down intents and minimal cache.
 * Workers only need Guilds and GuildVoiceStates to handle audio.
 */
function createWorkerClient(): Client {
    return new Client({
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

// ─── Primary Client ───────────────────────────────────────────────────────────

const primaryClient = new Client({
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

primaryClient.commands = new Collection();

// ─── Worker Clients (driven by .env) ──────────────────────────────────────────

const workerClients: Client[] = [];
for (const _token of config.workerTokens) {
    workerClients.push(createWorkerClient());
}

if (workerClients.length > 0) {
    logger.info('system', `Discovered ${workerClients.length} worker token(s) in .env`);
} else {
    logger.info('system', 'No worker tokens found. Running in single-bot mode.');
}

/**
 * Unified array of all clients: [primary, worker1, worker2, ...]
 * Used by botRouter, stats, own, eventHandler, and stateManager.
 */
export const allClients: Client[] = [primaryClient, ...workerClients];
allClients.forEach(c => botPool.register(c));

// Legacy exports for backwards compatibility
export const client = primaryClient;
export const clientB = workerClients.length > 0 ? workerClients[0] : null;

// ─── Lavalink Nodes ───────────────────────────────────────────────────────────

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

// ─── Kazagumo Instances ───────────────────────────────────────────────────────

function createKazagumo(targetClient: Client): Kazagumo {
    return new Kazagumo({
        defaultSearchEngine: 'youtube_music',
        send: (guildId, payload) => {
            const guild = targetClient.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
    }, new Connectors.DiscordJS(targetClient), nodes);
}

// Primary Kazagumo
primaryClient.kazagumo = createKazagumo(primaryClient);

// Worker Kazagumo instances
for (const wc of workerClients) {
    wc.kazagumo = createKazagumo(wc);
}

// ─── Kazagumo Event Binding ───────────────────────────────────────────────────

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

bindKazagumoEvents(primaryClient.kazagumo, 'Primary');
workerClients.forEach((wc, i) => {
    bindKazagumoEvents(wc.kazagumo, `Worker-${i + 1}`);
});

// ─── Shutdown & State Preservation ────────────────────────────────────────────

function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('system', 'Shutting down... Preserving queues.');
    const allKazagumos = allClients.map(c => c.kazagumo);
    saveStateOnExit(allKazagumos);
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown); // Nodemon restart

// ─── Stale Player Cleanup ─────────────────────────────────────────────────────

const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function cleanupStalePlayers() {
    for (const c of allClients) {
        if (!c.kazagumo) continue;
        for (const [guildId, player] of c.kazagumo.players) {
            if (!player.voiceId) continue;

            const guild = c.guilds.cache.get(guildId);
            const botVoiceChannelId = guild?.members.me?.voice.channelId;

            if (!botVoiceChannelId) {
                logger.warn('system', `Stale player detected in guild ${guildId} (bot not in VC). Destroying.`);
                player.destroy();
            }
        }
    }
}

// ─── Boot Sequence ────────────────────────────────────────────────────────────

(async () => {
    try {
        await preloadGuildSettings();
        await loadCommands(primaryClient);
        await loadEvents(primaryClient);
        setupLoggerEvents(primaryClient);

        await primaryClient.login(config.token);
        logger.info('system', `Starting Krayz-Music v${config.version}`);
        logger.info('system', `Primary Bot ${primaryClient.user?.username} connected.`);

        // Login all workers
        for (let i = 0; i < workerClients.length; i++) {
            await workerClients[i].login(config.workerTokens[i]);
            logger.info('system', `Worker-${i + 1} Bot ${workerClients[i].user?.username} connected.`);
        }

        // Wait for Lavalink nodes to be fully ready before restoring state
        setTimeout(() => {
            const allKazagumos = allClients.map(c => c.kazagumo);
            restoreStateOnStartup(allKazagumos);
        }, 3000);

        await load247FromDB(primaryClient);

        logger.info('system', `Bot pool ready: 1 primary + ${workerClients.length} worker(s) = ${allClients.length} total clients`);

        // Start stale player cleanup after boot
        setInterval(cleanupStalePlayers, STALE_CLEANUP_INTERVAL_MS);
        logger.info('system', `Stale player cleanup scheduled every ${STALE_CLEANUP_INTERVAL_MS / 60000} minutes.`);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('system', `Failed to start: ${message}`);
        process.exit(1);
    }
})();
