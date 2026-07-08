import 'dotenv/config';

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
};
