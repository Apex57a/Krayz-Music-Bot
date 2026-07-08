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
                'ALTER TABLE GuildSettings ADD COLUMN maintenance TINYINT(1) DEFAULT 0;'
            ];

            for (const query of alterColumns) {
                try {
                    await connection.query(query);
                } catch (err: any) {}
            }

            logger.info('database', 'Table schemas verified successfully.');
        } finally {
            connection.release();
        }
    } catch (err: any) {
        logger.error('database', `Failed to initialize database tables: ${err.message}`);
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
            });
        }
        logger.info('database', `Preloaded ${rows.length} guild settings into cache.`);
    } catch (e: any) {
        logger.error('database', `Failed to preload guild settings: ${e.message}`);
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
            approved: false,
            logChannelId: null,
            logMessages: false,
            logMembers: false,
            maintenance: false,
        };

        await pool.execute(
            'INSERT IGNORE INTO GuildSettings (guildId, twentyFourSeven, approved, logMessages, logMembers, maintenance) VALUES (?, ?, ?, ?, ?, ?)',
            [guildId, 0, 0, 0, 0, 0]
        );

        settingsCache.set(guildId, defaultSettings);
        return defaultSettings;
    } catch (err: any) {
        logger.error('database', `Error fetching settings for guild ${guildId}: ${err.message}`);
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
            `INSERT INTO GuildSettings (guildId, twentyFourSeven, djRoleId, textChannelId, voiceChannelId, approved, logChannelId, logMessages, logMembers, maintenance, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
             ON DUPLICATE KEY UPDATE 
                twentyFourSeven = VALUES(twentyFourSeven),
                djRoleId = VALUES(djRoleId),
                textChannelId = VALUES(textChannelId),
                voiceChannelId = VALUES(voiceChannelId),
                approved = VALUES(approved),
                logChannelId = VALUES(logChannelId),
                logMessages = VALUES(logMessages),
                logMembers = VALUES(logMembers),
                maintenance = VALUES(maintenance),
                updatedAt = NOW(3)`,
            [
                guildId,
                merged.twentyFourSeven ? 1 : 0,
                merged.djRoleId,
                merged.textChannelId,
                merged.voiceChannelId,
                merged.approved ? 1 : 0,
                merged.logChannelId,
                merged.logMessages ? 1 : 0,
                merged.logMembers ? 1 : 0,
                merged.maintenance ? 1 : 0,
            ]
        );

        settingsCache.set(guildId, merged);
        return merged;
    } catch (err: any) {
        logger.error('database', `Error updating settings for guild ${guildId}: ${err.message}`);
        throw err;
    }
}

export async function getAll247Guilds() {
    try {
        const [rows]: any = await pool.query(
            'SELECT guildId, textChannelId, voiceChannelId FROM GuildSettings WHERE twentyFourSeven = 1'
        );
        return rows;
    } catch (err: any) {
        logger.error('database', `Error fetching 24/7 guilds: ${err.message}`);
        return [];
    }
}

export default pool;
