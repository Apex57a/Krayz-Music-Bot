import { Events, Message, Client, EmbedBuilder } from 'discord.js';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { getGuildSettings } from '../../utils/database';
import { isMaintenance } from '../../utils/maintenance';
import { logCommandExecution } from '../../utils/loggerService';
import type { Command } from '../../types/Command';

const cooldowns = new Map<string, number>();

// Sweep stale cooldown entries every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamp] of cooldowns) {
        if (now - timestamp > 10_000) {
            cooldowns.delete(userId);
        }
    }
}, 60_000);

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message, client: Client) {
        if (message.author.bot || !message.guild) return;

        const prefixes = ['!', '?'];
        let matchedPrefix = '';
        for (const p of prefixes) {
            if (message.content.startsWith(p)) {
                matchedPrefix = p;
                break;
            }
        }
        if (!matchedPrefix) return;

        const now = Date.now();
        const lastUsed = cooldowns.get(message.author.id) || 0;
        if (now - lastUsed < 3000) {
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('Slow down. Please wait a few seconds.');
            const msg = await message.reply({ embeds: [embed] }).catch(() => null);
            if (msg) setTimeout(() => msg.delete().catch(() => {}), 10_000);
            return;
        }
        cooldowns.set(message.author.id, now);

        const args = message.content.slice(matchedPrefix.length).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;

        const cmd = client.commands.get(commandName) || 
                    client.commands.find((c: Command) => c.aliases?.includes(commandName));

        if (!cmd) return;

        try {
            const settings = await getGuildSettings(message.guild.id);
            const isOwner = message.author.id === config.ownerId;
            const cmdName = cmd.data ? cmd.data.name : cmd.name;
            const isSetupCommand = cmdName === 'setup' || cmdName === 'setup-logs';

            if (!settings.approved && !(isOwner && isSetupCommand)) {
                const embed = new EmbedBuilder()
                    .setColor(0x111111)
                    .setDescription('This server is not approved. The bot owner must run `/setup` (or `!setup`) to approve this server.');
                const msg = await message.reply({ embeds: [embed] }).catch(() => null);
                if (msg) setTimeout(() => msg.delete().catch(() => {}), 10_000);
                return;
            }

            if (!isOwner && (isMaintenance() || settings.maintenance)) {
                const embed = new EmbedBuilder()
                    .setColor(0x111111)
                    .setTitle('Maintenance Mode')
                    .setDescription('The bot is currently undergoing maintenance in this server or globally. Please check back later.');
                const msg = await message.reply({ embeds: [embed] }).catch(() => null);
                if (msg) setTimeout(() => msg.delete().catch(() => {}), 10_000);
                return;
            }

            const musicCommands = ['play', 'p', 'skip', 's', 'stop', 'pause', 'queue', 'q', 'clear', 'nowplaying', 'np', '247', 'filter'];
            if (musicCommands.includes(commandName) || musicCommands.includes(cmdName)) {
                if (settings.textChannelId && message.channelId !== settings.textChannelId) {
                    message.delete().catch(() => {});
                    const embed = new EmbedBuilder()
                        .setColor(0x111111)
                        .setDescription(`Please use the dedicated music channel: <#${settings.textChannelId}>`);
                    const msg = await message.reply({ embeds: [embed] }).catch(() => null);
                    if (msg) setTimeout(() => msg.delete().catch(() => {}), 7000);
                    return;
                }
            }
        } catch (err: unknown) {
            const message2 = err instanceof Error ? err.message : String(err);
            logger.error('security', `Guild approval/maintenance settings fetch failed: ${message2}`);
        }

        try {
            if (cmd.executePrefix) {
                logger.info('discord', `Executing prefix command "${commandName}" by ${message.author.username} in guild ${message.guild.id}`);
                await cmd.executePrefix(message, args, client);

                logCommandExecution(client, message.guild.id, message.author.id, message.author.username, commandName, args.join(' '));
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0x111111)
                    .setDescription(`This command can only be used as a slash command: \`/${cmd.data ? cmd.data.name : cmd.name}\``);
                const msg = await message.reply({ embeds: [embed] }).catch(() => null);
                if (msg) setTimeout(() => msg.delete().catch(() => {}), 10_000);
            }
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? (error.stack || error.message) : String(error);
            logger.error('discord', `Error executing prefix command "${commandName}": ${errMsg}`);
            message.reply('There was an error trying to execute that command.').catch(() => {});
        }
    },
};
