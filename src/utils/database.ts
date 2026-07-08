import mysql from 'mysql2/promise';
import 'dotenv/config';
import { logger } from './logger';

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 20,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true, minVersion: 'TLSv1.2' } : undefined,
});

const settingsCache = new Map<string, any>();

async function initializeDatabase() {
    try {
        logger.info('database', 'Verifying table schemas...');
        const connection = await pool.getConnection();
        try {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS GuildSettings (
                    guildId VARCHAR(191) PRIMARY KEY,
                    twentyFourSeven TINYINT(1) DEFAULT 0,
                    djRoleId VARCHAR(191),
                    textChannelId VARCHAR(191),
                    voiceChannelId VARCHAR(191),
                    volume INT DEFAULT 100,
                    approved TINYINT(1) DEFAULT 0,
                    logChannelId VARCHAR(191),
                    logMessages TINYINT(1) DEFAULT 0,
                    logMembers TINYINT(1) DEFAULT 0,
                    maintenance TINYINT(1) DEFAULT 0,
                    createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
                    updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
                );
            `);

            const alterColumns = [
                'ALTER TABLE GuildSettings ADD COLUMN approved TINYINT(1) DEFAULT 0;',
                'ALTER TABLE GuildSettings ADD COLUMN logChannelId VARCHAR(191);',
                'ALTER TABLE GuildSettings ADD COLUMN logMessages TINYINT(1) DEFAULT 0;',
                'ALTER TABLE GuildSettings ADD COLUMN logMembers TINYINT(1) DEFAULT 0;',
                'ALTER TABLE GuildSettings ADD COLUMN maintenance TINYINT(1) DEFAULT 0;',
                'ALTER TABLE GuildSettings ADD COLUMN volume INT DEFAULT 100;'
            ];

            for (const query of alterColumns) {
                try {
                    await connection.query(query);
                } catch (_err: unknown) {
                    // Column already exists — expected for existing databases
                }
            }

            logger.info('database', 'Table schemas verified successfully.');
        } finally {
            connection.release();
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('database', `Failed to initialize database tables: ${message}`);
    }
}

initializeDatabase();

export async function preloadGuildSettings() {
    try {
        const [rows]: any = await pool.query('SELECT * FROM GuildSettings');
        for (const g of rows) {
            settingsCache.set(g.guildId, {
                ...g,
                twentyFourSeven: !!g.twentyFourSeven,
                approved: !!g.approved,
                logMessages: !!g.logMessages,
                logMembers: !!g.logMembers,
                maintenance: !!g.maintenance,
                volume: g.volume ?? 100,
            });
        }
        logger.info('database', `Preloaded ${rows.length} guild settings into cache.`);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error('database', `Failed to preload guild settings: ${message}`);
    }
}

export async function getGuildSettings(guildId: string) {
    if (settingsCache.has(guildId)) {
        return settingsCache.get(guildId);
    }

    try {
        const [rows]: any = await pool.execute('SELECT * FROM GuildSettings WHERE guildId = ?', [guildId]);
        if (rows.length > 0) {
            const settings = {
                ...rows[0],
                twentyFourSeven: !!rows[0].twentyFourSeven,
                approved: !!rows[0].approved,
                logMessages: !!rows[0].logMessages,
                logMembers: !!rows[0].logMembers,
                maintenance: !!rows[0].maintenance,
                volume: rows[0].volume ?? 100,
            };
            settingsCache.set(guildId, settings);
            return settings;
        }

        const defaultSettings = {
            guildId,
            twentyFourSeven: false,
            djRoleId: null,
            textChannelId: null,
            voiceChannelId: null,
            volume: 100,
            approved: false,
            logChannelId: null,
            logMessages: false,
            logMembers: false,
            maintenance: false,
        };

        await pool.execute(
            'INSERT IGNORE INTO GuildSettings (guildId, twentyFourSeven, volume, approved, logMessages, logMembers, maintenance) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [guildId, 0, 100, 0, 0, 0, 0]
        );

        settingsCache.set(guildId, defaultSettings);
        return defaultSettings;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('database', `Error fetching settings for guild ${guildId}: ${message}`);
        throw err;
    }
}

export async function updateGuildSettings(
    guildId: string,
    data: {
        twentyFourSeven?: boolean;
        djRoleId?: string | null;
        textChannelId?: string | null;
        voiceChannelId?: string | null;
        volume?: number;
        approved?: boolean;
        logChannelId?: string | null;
        logMessages?: boolean;
        logMembers?: boolean;
        maintenance?: boolean;
    },
) {
    try {
        const current = await getGuildSettings(guildId);
        const merged = { ...current, ...data };

        await pool.execute(
            `INSERT INTO GuildSettings (guildId, twentyFourSeven, djRoleId, textChannelId, voiceChannelId, volume, approved, logChannelId, logMessages, logMembers, maintenance, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
             AS new_row
             ON DUPLICATE KEY UPDATE 
                twentyFourSeven = new_row.twentyFourSeven,
                djRoleId = new_row.djRoleId,
                textChannelId = new_row.textChannelId,
                voiceChannelId = new_row.voiceChannelId,
                volume = new_row.volume,
                approved = new_row.approved,
                logChannelId = new_row.logChannelId,
                logMessages = new_row.logMessages,
                logMembers = new_row.logMembers,
                maintenance = new_row.maintenance,
                updatedAt = NOW(3)`,
            [
                guildId,
                merged.twentyFourSeven ? 1 : 0,
                merged.djRoleId,
                merged.textChannelId,
                merged.voiceChannelId,
                merged.volume ?? 100,
                merged.approved ? 1 : 0,
                merged.logChannelId,
                merged.logMessages ? 1 : 0,
                merged.logMembers ? 1 : 0,
                merged.maintenance ? 1 : 0,
            ]
        );

        settingsCache.set(guildId, merged);
        return merged;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('database', `Error updating settings for guild ${guildId}: ${message}`);
        throw err;
    }
}

export async function getAll247Guilds() {
    try {
        const [rows]: any = await pool.query(
            'SELECT guildId, textChannelId, voiceChannelId FROM GuildSettings WHERE twentyFourSeven = 1'
        );
        return rows;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('database', `Error fetching 24/7 guilds: ${message}`);
        return [];
    }
}

export default pool;
