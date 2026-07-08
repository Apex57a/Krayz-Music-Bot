// One-time script to register all slash commands to the dev guild instantly.
// Run: node scripts/register-commands.js

require('dotenv/config');
const { REST, Routes } = require('discord.js');
const { readdirSync } = require('fs');
const { join } = require('path');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);
const commandsPath = join(__dirname, '..', 'dist', 'commands');
const commands = [];

for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(join(commandsPath, file)).default;
    if (cmd && cmd.data && typeof cmd.data.toJSON === 'function') {
        commands.push(cmd.data.toJSON());
    }
}

(async () => {
    console.log(`Registering ${commands.length} commands to guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Done. Commands should appear instantly.');

    console.log(`Also registering ${commands.length} commands globally...`);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Global registration complete (may take up to 1 hour to propagate).');
})();
