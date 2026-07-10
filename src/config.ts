import 'dotenv/config';

/**
 * Discover worker tokens from environment variables.
 * Scans all process.env keys matching WORKER_TOKEN_<N> (supports non-sequential numbering).
 * The legacy WORKER_TOKEN (no suffix) is also supported for backwards compatibility.
 * Duplicate tokens are detected and skipped with a warning.
 */
function discoverWorkerTokens(): string[] {
    const seen = new Set<string>();
    const tokens: string[] = [];

    function addToken(token: string, label: string): void {
        if (seen.has(token)) {
            console.warn(`[config] Duplicate worker token detected (${label}), skipping.`);
            return;
        }
        seen.add(token);
        tokens.push(token);
    }

    // Legacy single-worker key (backwards compatible)
    if (process.env.WORKER_TOKEN) {
        addToken(process.env.WORKER_TOKEN, 'WORKER_TOKEN');
    }

    // Scan ALL env keys for WORKER_TOKEN_<N> pattern (non-sequential safe)
    const pattern = /^WORKER_TOKEN_(\d+)$/;
    const numbered = Object.keys(process.env)
        .filter(key => pattern.test(key))
        .sort((a, b) => {
            const numA = parseInt(a.match(pattern)![1], 10);
            const numB = parseInt(b.match(pattern)![1], 10);
            return numA - numB;
        });

    for (const key of numbered) {
        const token = process.env[key];
        if (token) {
            addToken(token, key);
        }
    }

    return tokens;
}

export const config = {
    token: process.env.DISCORD_TOKEN!,
    clientId: process.env.CLIENT_ID!,
    guildId: process.env.GUILD_ID!,
    lavalink: {
        host: process.env.LAVALINK_HOST || 'localhost',
        port: parseInt(process.env.LAVALINK_PORT || '2333'),
        password: process.env.LAVALINK_PASSWORD || '',
        secure: process.env.LAVALINK_SECURE === 'true',
    },
    lavalinkWorker: {
        host: process.env.LAVALINK_WORKER_HOST || '',
        port: parseInt(process.env.LAVALINK_WORKER_PORT || '0'),
        password: process.env.LAVALINK_WORKER_PASSWORD || '',
        secure: process.env.LAVALINK_WORKER_SECURE === 'true',
    },
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID || '',
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    },
    youtube: {
        refreshToken: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN || '',
    },
    ownerId: process.env.OWNER_ID || '',
    version: require('../package.json').version,
    workerTokens: discoverWorkerTokens(),
};

// ─── Environment Validation ──────────────────────────────────────────────────

const REQUIRED_ENV_VARS = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'GUILD_ID',
    'OWNER_ID',
    'LAVALINK_HOST',
    'LAVALINK_PORT',
    'LAVALINK_PASSWORD',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASS',
    'DB_NAME',
] as const;

/**
 * Validates that all required environment variables are set.
 * Logs a clear error for each missing variable.
 * Returns false if any are missing (caller should handle exit).
 */
export function validateEnv(): boolean {
    let valid = true;
    for (const key of REQUIRED_ENV_VARS) {
        if (!process.env[key]) {
            console.error(`[config] Missing required env var: ${key}. Check your .env file.`);
            valid = false;
        }
    }
    return valid;
}
