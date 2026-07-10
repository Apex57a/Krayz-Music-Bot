import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { KazagumoPlayer, KazagumoTrack, Kazagumo } from 'kazagumo';

const STATE_FILE = path.join(process.cwd(), 'state_backup.json');
const STATE_VERSION = 1;
const MAX_STATE_AGE_MS = parseInt(process.env.MAX_STATE_AGE_MS || '86400000', 10); // default 24 hours

interface SavedState {
    guildId: string;
    voiceId: string;
    textId: string;
    volume: number;
    currentTrack: any | null;
    currentPosition: number;
    queue: any[];
}

interface SavedStates {
    version: number;
    savedAt: number;
    /** Each index maps to allClients[index]. Index 0 = primary, 1+ = workers */
    pools: SavedState[][];
}

function isValidSavedStates(data: unknown): data is SavedStates {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
        typeof obj.version === 'number' &&
        typeof obj.savedAt === 'number' &&
        Array.isArray(obj.pools) &&
        obj.pools.every((p: unknown) => Array.isArray(p))
    );
}

/**
 * Attempt to migrate legacy state formats ({kazA, kazB} or missing version) to current format.
 * Returns null if migration is not possible.
 */
function migrateLegacyState(data: unknown): SavedStates | null {
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;

    // Legacy {kazA, kazB} format
    if (Array.isArray(obj.kazA) || Array.isArray(obj.kazB)) {
        const pools: SavedState[][] = [];
        if (Array.isArray(obj.kazA)) pools.push(obj.kazA as SavedState[]);
        else pools.push([]);
        if (Array.isArray(obj.kazB)) pools.push(obj.kazB as SavedState[]);
        logger.info('system', 'Migrated legacy {kazA, kazB} state format to pools format.');
        return { version: STATE_VERSION, savedAt: Date.now(), pools };
    }

    // Has pools but missing version/savedAt (partial migration)
    if (Array.isArray(obj.pools) && (obj.pools as unknown[]).every((p: unknown) => Array.isArray(p))) {
        logger.info('system', 'Migrated state file missing version field.');
        return {
            version: STATE_VERSION,
            savedAt: typeof obj.savedAt === 'number' ? obj.savedAt : Date.now(),
            pools: obj.pools as SavedState[][],
        };
    }

    return null;
}

/**
 * Wrap a raw Lavalink track object (from JSON) back into a proper KazagumoTrack
 * with all methods intact. Without this, player.play() crashes because the
 * raw object doesn't have setKazagumo().
 */
function wrapRawTrack(raw: any): KazagumoTrack {
    return new KazagumoTrack(raw, raw.requester ?? undefined);
}

/**
 * Serialize the queues and current playback positions for all bots to disk.
 * Uses atomic write (write to .tmp then rename) to prevent corruption.
 */
export function saveStateOnExit(kazagumos: Kazagumo[]) {
    try {
        const states: SavedStates = {
            version: STATE_VERSION,
            savedAt: Date.now(),
            pools: [],
        };

        for (const kaz of kazagumos) {
            const pool: SavedState[] = [];
            if (kaz) {
                for (const player of kaz.players.values()) {
                    const p = player as KazagumoPlayer;
                    pool.push({
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
            states.pools.push(pool);
        }

        const tmpFile = STATE_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(states, null, 2), 'utf-8');
        fs.renameSync(tmpFile, STATE_FILE);
        logger.info('system', `Saved player states to disk (${kazagumos.length} pool(s)).`);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('system', `Failed to save state on exit: ${message}`);
    }
}

/**
 * Hydrate the queues and seek playback positions from disk.
 */
export async function restoreStateOnStartup(kazagumos: Kazagumo[]) {
    if (!fs.existsSync(STATE_FILE)) return;

    try {
        const data = fs.readFileSync(STATE_FILE, 'utf-8');
        let states: SavedStates;
        const parsed: unknown = JSON.parse(data);

        if (isValidSavedStates(parsed)) {
            states = parsed;
        } else {
            // Attempt backwards-compatible migration
            const migrated = migrateLegacyState(parsed);
            if (!migrated) {
                logger.warn('system', 'State backup file has invalid structure, skipping restore.');
                try { fs.unlinkSync(STATE_FILE); } catch {}
                return;
            }
            states = migrated;
        }

        // Check state age
        const age = Date.now() - states.savedAt;
        if (age > MAX_STATE_AGE_MS) {
            logger.warn('system', `State backup is ${Math.round(age / 3600000)}h old (max ${MAX_STATE_AGE_MS / 3600000}h). Skipping restore.`);
            try { fs.unlinkSync(STATE_FILE); } catch {}
            return;
        }

        for (let i = 0; i < states.pools.length; i++) {
            const kaz = kazagumos[i];
            if (!kaz) {
                // Worker was removed from .env, redistribute orphaned players
                for (const state of states.pools[i]) {
                    const availableKaz = kazagumos.find(k => k && !k.players.get(state.guildId));
                    if (availableKaz) {
                        await restorePlayer(availableKaz, state);
                        logger.info('system', `Redistributed orphaned player from pool ${i} to available bot for guild ${state.guildId}`);
                    } else {
                        logger.warn('system', `Could not restore player for guild ${state.guildId}: no available bot (pool ${i} no longer exists)`);
                    }
                }
                continue;
            }
            for (const state of states.pools[i]) {
                await restorePlayer(kaz, state);
            }
        }

        try {
            fs.unlinkSync(STATE_FILE);
        } catch (_err) {
            logger.warn('system', 'Could not delete state backup file after restore.');
        }

        logger.info('system', 'Successfully restored player states from disk.');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('system', `Failed to restore state on startup: ${message}`);
    }
}

async function restorePlayer(kazagumo: Kazagumo, state: SavedState) {
    try {
        if (!state.guildId || !state.voiceId || !state.textId) {
            logger.warn('system', `Skipping restore for invalid state entry (missing required fields).`);
            return;
        }

        const player = await kazagumo.createPlayer({
            guildId: state.guildId,
            voiceId: state.voiceId,
            textId: state.textId,
            deaf: true,
            volume: state.volume
        });

        // Wrap raw track data back into proper KazagumoTrack instances
        for (const rawTrack of state.queue) {
            try {
                const track = wrapRawTrack(rawTrack);
                player.queue.add(track);
            } catch (e) {
                logger.warn('system', `Skipped unrestorable queue track in guild ${state.guildId}`);
            }
        }

        // Restore current playing track
        if (state.currentTrack) {
            try {
                const currentTrack = wrapRawTrack(state.currentTrack);
                player.queue.unshift(currentTrack);
                await player.play();
                if (state.currentPosition > 0) {
                    player.seek(state.currentPosition);
                }
                logger.info('system', `Restored playback at ${state.currentPosition}ms for guild ${state.guildId}`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.warn('system', `Could not restore current track for guild ${state.guildId}: ${msg}`);
            }
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('system', `Could not restore player for guild ${state.guildId}: ${message}`);
    }
}
