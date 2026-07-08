import { Client } from 'discord.js';
import { Kazagumo } from 'kazagumo';

/**
 * Smart router to assign a Kazagumo instance and Discord Client based on Voice Channel.
 */
export function getAvailableBot(guildId: string, voiceChannelId?: string): { kazagumo: Kazagumo, client: Client } | null {
    // We import clients dynamically to avoid circular dependencies
    const { client, clientB } = require('../index');
    
    const clientA: Client = client;
    const kazA: Kazagumo = clientA.kazagumo;
    const kazB: Kazagumo | undefined = clientB?.kazagumo;

    // Rule 1: If Bot A is already in THIS voice channel, return Bot A
    if (voiceChannelId) {
        const playerA = kazA.players.get(guildId);
        if (playerA && playerA.voiceId === voiceChannelId) {
            return { kazagumo: kazA, client: clientA };
        }

        // Rule 2: If Bot B is already in THIS voice channel, return Bot B
        if (kazB) {
            const playerB = kazB.players.get(guildId);
            if (playerB && playerB.voiceId === voiceChannelId) {
                return { kazagumo: kazB, client: clientB! };
            }
        }
    }

    // If no specific voice channel matches, check for any active player in the guild
    // This is useful for commands like /skip, /stop that don't pass voiceChannelId initially
    if (!voiceChannelId) {
        const playerA = kazA.players.get(guildId);
        if (playerA) return { kazagumo: kazA, client: clientA };

        if (kazB) {
            const playerB = kazB.players.get(guildId);
            if (playerB) return { kazagumo: kazB, client: clientB! };
        }
    }

    // Rule 3: If creating a NEW player, check if Bot A is entirely free in this guild
    const playerA = kazA.players.get(guildId);
    if (!playerA) {
        return { kazagumo: kazA, client: clientA };
    }

    // Rule 4: If Bot A is busy in another VC, check if Bot B is entirely free in this guild
    if (kazB) {
        const playerB = kazB.players.get(guildId);
        if (!playerB) {
            return { kazagumo: kazB, client: clientB! };
        }
    }

    // Rule 5: Both bots are busy in OTHER VCs in this guild!
    return null;
}
