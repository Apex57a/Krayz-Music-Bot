// Fix: clear guild commands to remove duplicates. Keep global only.
require('dotenv/config');
const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    console.log(`Clearing guild commands from ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
    console.log('Guild commands cleared. Only global commands remain.');
})();
