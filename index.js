// Terohost/Pterodactyl entrypoint compatibility file

console.log('[BOOT] Loading environment variables...');
require('dotenv').config();

if (!process.env.DATABASE_URL && process.env.DB_USER) {
    process.env.DATABASE_URL = `mysql://${encodeURIComponent(process.env.DB_USER || '')}:${encodeURIComponent(process.env.DB_PASS || '')}@${process.env.DB_HOST || ''}:${process.env.DB_PORT || ''}/${process.env.DB_NAME || ''}`;
}

// This forwards the execution to the compiled bot code.
require('./dist/index.js');
