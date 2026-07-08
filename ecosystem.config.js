// PM2 ecosystem deployment configuration
module.exports = {
    apps: [
        {
            name: 'krayz-bot',
            script: 'index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            env: {
                NODE_ENV: 'production',
            },
        },
    ],
};
