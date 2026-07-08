import { Events, Message, Client, EmbedBuilder } from 'discord.js';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { getGuildSettings } from '../../utils/database';
import { isMaintenance } from '../../utils/maintenance';

const cooldowns = new Map<string, number>();

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
                    client.commands.find((c: any) => c.aliases && c.aliases.includes(commandName));

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
        } catch (err: any) {
            logger.error('security', `Guild approval/maintenance settings fetch failed: ${err.message}`);
        }

        try {
            if (cmd.executePrefix) {
                logger.info('discord', `Executing prefix command "${commandName}" by ${message.author.tag} in guild ${message.guild.id}`);
                await cmd.executePrefix(message, args, client);
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0x111111)
                    .setDescription(`This command can only be used as a slash command: \`/${cmd.data ? cmd.data.name : cmd.name}\``);
                const msg = await message.reply({ embeds: [embed] }).catch(() => null);
                if (msg) setTimeout(() => msg.delete().catch(() => {}), 10_000);
            }
        } catch (error: any) {
            logger.error('discord', `Error executing prefix command "${commandName}": ${error.stack || error.message}`);
            message.reply('There was an error trying to execute that command.').catch(() => {});
        }
    },
};
