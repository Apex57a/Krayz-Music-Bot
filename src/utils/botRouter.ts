import { Client } from 'discord.js';
import { Kazagumo } from 'kazagumo';
import { botPool } from './botPool';

/**
 * Smart router to assign a Kazagumo instance and Discord Client based on voice channel availability.
 * Iterates through the entire bot pool (primary + all workers) to find the best match.
 * Only considers clients that are ready and have at least one connected Shoukaku node.
 */
export function getAvailableBot(guildId: string, voiceChannelId?: string): { kazagumo: Kazagumo, client: Client } | null {
    const allClients = botPool.getAll();

    // Filter to only ready clients
    const clients: Client[] = (allClients as Client[]).filter(c => c.isReady());

    if (clients.length === 0) return null;

    // Rule 1: If a specific voice channel was requested, check if any bot is already there
    if (voiceChannelId) {
        for (const c of clients) {
            const player = c.kazagumo?.players.get(guildId);
            if (player && player.voiceId === voiceChannelId) {
                return { kazagumo: c.kazagumo, client: c };
            }
        }
    }

    // Rule 2: If no specific VC, find any bot that already has an active player in this guild
    // (used by commands like /skip, /stop that don't pass voiceChannelId)
    if (!voiceChannelId) {
        for (const c of clients) {
            const player = c.kazagumo?.players.get(guildId);
            if (player) {
                return { kazagumo: c.kazagumo, client: c };
            }
        }
    }

    // Rule 3: Assign the first bot that is completely free in this guild AND has a connected Shoukaku node
    for (const c of clients) {
        const player = c.kazagumo?.players.get(guildId);
        if (!player) {
            const hasConnectedNode = c.kazagumo.shoukaku.nodes.size > 0
                && Array.from(c.kazagumo.shoukaku.nodes.values()).some((n: any) => n.state === 1);
            if (hasConnectedNode) {
                return { kazagumo: c.kazagumo, client: c };
            }
        }
    }

    // Rule 4: All bots are occupied or unhealthy
    return null;
}
