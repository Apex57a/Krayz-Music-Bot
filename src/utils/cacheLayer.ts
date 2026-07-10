import fs from 'fs';
import path from 'path';
import { logger } from './logger';

const CACHE_DIR = path.join(process.cwd(), 'cache');
const METADATA_CACHE_FILE = path.join(CACHE_DIR, 'metadata_l3.json');

// L1 Cache: In-memory Map for any object type, including non-serializable ones
const memoryCache = new Map<string, { data: unknown, expiresAt: number }>();

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// L3 Cache: Persistent disk storage for serializable data only
let diskCache: Record<string, { data: unknown, expiresAt: number }> = {};
try {
    if (fs.existsSync(METADATA_CACHE_FILE)) {
        const raw = fs.readFileSync(METADATA_CACHE_FILE, 'utf-8');
        diskCache = JSON.parse(raw);
        logger.info('system', `Loaded ${Object.keys(diskCache).length} entries from disk cache.`);
    }
} catch (err) {
    logger.warn('system', `Could not load disk cache: ${err}`);
}

// Sync serializable entries to disk every 5 minutes
setInterval(() => {
    try {
        const tmpFile = METADATA_CACHE_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(diskCache));
        fs.renameSync(tmpFile, METADATA_CACHE_FILE);
    } catch (err) {
        logger.warn('system', `Disk cache sync failed: ${err}`);
    }
}, 300_000);

// Sweep expired entries every hour
setInterval(() => {
    const now = Date.now();
    let sweptL1 = 0;
    let sweptL3 = 0;

    for (const [key, val] of memoryCache.entries()) {
        if (now > val.expiresAt) {
            memoryCache.delete(key);
            sweptL1++;
        }
    }
    for (const key of Object.keys(diskCache)) {
        if (now > diskCache[key].expiresAt) {
            delete diskCache[key];
            sweptL3++;
        }
    }
    if (sweptL1 > 0 || sweptL3 > 0) {
        logger.debug('system', `Swept expired cache (L1: ${sweptL1}, L3: ${sweptL3})`);
    }
}, 3_600_000);

/**
 * Attempts to serialize a value. Returns the JSON string on success,
 * null if the value contains circular references or is otherwise
 * not serializable.
 */
function trySerialize(data: unknown): string | null {
    try {
        JSON.stringify(data);
        return 'ok';
    } catch {
        return null;
    }
}

/**
 * Retrieve a cached value. Checks L1 (memory) first, then L3 (disk).
 * L3 hits are promoted back into L1 for faster subsequent access.
 */
export function getCache<T>(key: string): T | null {
    const now = Date.now();

    const l1 = memoryCache.get(key);
    if (l1) {
        if (now < l1.expiresAt) return l1.data as T;
        memoryCache.delete(key);
    }

    const l3 = diskCache[key];
    if (l3) {
        if (now < l3.expiresAt) {
            memoryCache.set(key, l3);
            return l3.data as T;
        }
        delete diskCache[key];
    }

    return null;
}

/**
 * Store a value in cache.
 *
 * All values go into L1 (memory). Only values that can survive
 * JSON.stringify go into L3 (disk). Objects with circular references
 * (like KazagumoSearchResult) are kept in L1 only, which means they
 * survive for the current process lifetime but not across restarts.
 *
 * @param ttlMs Time-to-live in milliseconds (default: 48 hours)
 */
export function setCache(key: string, data: unknown, ttlMs: number = 172_800_000): void {
    const expiresAt = Date.now() + ttlMs;
    const entry = { data, expiresAt };

    memoryCache.set(key, entry);

    // Only persist to disk if the data is serializable
    if (trySerialize(data) !== null) {
        diskCache[key] = entry;
    }
}
