import { Client, Collection, REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { Command } from '../types/Command';
import { logger } from '../utils/logger';

export async function loadCommands(client: Client): Promise<void> {
    const commandsPath = join(__dirname, '..', 'commands');
    const commandFiles = readdirSync(commandsPath).filter(
        (file) => file.endsWith('.ts') || file.endsWith('.js'),
    );

    const commandsToDeploy = [];

    for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const command: Command = require(filePath).default;

        const cmdName = command.data ? command.data.name : command.name;

        if (cmdName && (command.execute || command.executePrefix)) {
            client.commands.set(cmdName, command);
            if (command.data) {
                commandsToDeploy.push(command.data.toJSON());
                logger.info('command', `Loaded Slash Command: /${cmdName}`);
            } else {
                logger.info('command', `Loaded Prefix Command: !${cmdName}`);
            }
        } else {
            logger.warn('command', `Skipped ${file} — missing "data"/"name" or "execute"/"executePrefix".`);
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    if (process.env.DEPLOY_COMMANDS === 'true') {
        try {
            logger.info('command', `Started refreshing ${commandsToDeploy.length} application (/) commands.`);

            // Clear guild commands to prevent duplication
            if (process.env.GUILD_ID) {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID!),
                    { body: [] },
                );
                logger.info('command', `Cleared guild-specific commands to avoid duplication.`);
            }

            // Register globally
            const data: any = await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID!),
                { body: commandsToDeploy },
            );

            logger.info('command', `Successfully reloaded ${data.length} global application (/) commands.`);
        } catch (error: any) {
            logger.error('command', `Failed to deploy commands: ${error.message}`);
        }
    } else {
        logger.info('command', `Skipped global slash command deployment (DEPLOY_COMMANDS is not 'true').`);
    }
}
