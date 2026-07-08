require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
    console.log('[INIT] Testing connection to MySQL database...');
    const host = process.env.DB_HOST;
    const port = parseInt(process.env.DB_PORT || '3306');
    const user = process.env.DB_USER;
    const password = process.env.DB_PASS;
    const database = process.env.DB_NAME;

    if (!host || !user || !password || !database) {
        console.error('[FATAL] Missing database configuration. Please set DB_HOST, DB_USER, DB_PASS, and DB_NAME in your .env file.');
        process.exit(1);
    }

    try {
        const connection = await mysql.createConnection({
            host,
            port,
            user,
            password,
            database
        });
        await connection.ping();
        await connection.end();
        console.log('[INIT] MySQL connection test successful.');
    } catch (error) {
        console.error('[FATAL] Database connection failed:', error.message);
        process.exit(1);
    }
}

testConnection();
