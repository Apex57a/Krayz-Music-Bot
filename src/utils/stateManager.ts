import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { KazagumoPlayer } from 'kazagumo';

const STATE_FILE = path.join(process.cwd(), 'state_backup.json');

interface SavedState {
    guildId: string;
    voiceId: string;
    textId: string;
    volume: number;
    currentTrack: any | null;
    currentPosition: number;
    queue: any[];
}

/**
 * Serialize the queues and current playback positions of both bots to disk.
 */
export function saveStateOnExit(kazA: any, kazB: any) {
    try {
        const states: { kazA: SavedState[], kazB: SavedState[] } = {
            kazA: [],
            kazB: []
        };

        if (kazA) {
            for (const player of kazA.players.values()) {
                const p = player as KazagumoPlayer;
                states.kazA.push({
                    guildId: p.guildId,
                    voiceId: p.voiceId!,
                    textId: p.textId!,
                    volume: p.volume,
                    currentTrack: p.queue.current ? p.queue.current.getRaw() : null,
                    currentPosition: p.position || 0,
                    queue: Array.from(p.queue).map(t => (t as any).getRaw ? (t as any).getRaw() : t)
                });
            }
        }

        if (kazB) {
            for (const player of kazB.players.values()) {
                const p = player as KazagumoPlayer;
                states.kazB.push({
                    guildId: p.guildId,
                    voiceId: p.voiceId!,
                    textId: p.textId!,
                    volume: p.volume,
                    currentTrack: p.queue.current ? p.queue.current.getRaw() : null,
                    currentPosition: p.position || 0,
                    queue: Array.from(p.queue).map(t => (t as any).getRaw ? (t as any).getRaw() : t)
                });
            }
        }

        fs.writeFileSync(STATE_FILE, JSON.stringify(states, null, 2), 'utf-8');
        logger.info('system', 'Saved player states to disk.');
    } catch (err: any) {
        logger.error('system', `Failed to save state on exit: ${err.message}`);
    }
}

/**
 * Hydrate the queues and seek playback positions from disk.
 */
export async function restoreStateOnStartup(kazA: any, kazB: any) {
    if (!fs.existsSync(STATE_FILE)) return;

    try {
        const data = fs.readFileSync(STATE_FILE, 'utf-8');
        const states = JSON.parse(data);

        // Restore KazA
        if (kazA && states.kazA) {
            for (const state of states.kazA) {
                await restorePlayer(kazA, state);
            }
        }

        // Restore KazB
        if (kazB && states.kazB) {
            for (const state of states.kazB) {
                await restorePlayer(kazB, state);
            }
        }

        fs.unlinkSync(STATE_FILE); // Delete the state file after successful restoration
        logger.info('system', 'Successfully restored player states from disk.');
    } catch (err: any) {
        logger.error('system', `Failed to restore state on startup: ${err.message}`);
    }
}

async function restorePlayer(kazagumo: any, state: SavedState) {
    try {
        const player = await kazagumo.createPlayer({
            guildId: state.guildId,
            voiceId: state.voiceId,
            textId: state.textId,
            deaf: true,
            volume: state.volume
        });

        // Add queue items first
        for (const track of state.queue) {
            // Kazagumo automatically wraps raw Lavalink track objects if passed to player.queue.add()
            // if we provide the raw lavalink track
            player.queue.add(track);
        }

        // If there was a track playing, play it and seek!
        if (state.currentTrack) {
            player.queue.unshift(state.currentTrack); // Put current track at front
            await player.play();
            if (state.currentPosition > 0) {
                player.seek(state.currentPosition);
            }
        }
    } catch (err: any) {
        logger.error('system', `Could not restore player for guild ${state.guildId}: ${err.message}`);
    }
}
