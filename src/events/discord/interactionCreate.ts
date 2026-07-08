import { Events, Interaction, Client, GuildMember, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildSettings } from '../../utils/database';
import { isMaintenance } from '../../utils/maintenance';
import { isDJ } from '../../utils/security';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const DJ_COMMANDS = new Set([
    'play', 'skip', 'stop', 'pause', '247',
]);

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
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction: Interaction, client: Client) {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.guildId) {
            try {
                const settings = await getGuildSettings(interaction.guildId);
                const isOwner = interaction.user.id === config.ownerId;
                const isSetupCommand = interaction.commandName === 'setup' || interaction.commandName === 'setup-logs';

                if (!settings.approved && !(isOwner && isSetupCommand)) {
                    const embed = new EmbedBuilder()
                        .setColor(0x111111)
                        .setDescription('❌ This server is not approved. The bot owner must run `/setup` to approve this server.');
                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }

                if (!isOwner && (isMaintenance() || settings.maintenance)) {
                    const embed = new EmbedBuilder()
                        .setColor(0x111111)
                        .setTitle('🛠️ Maintenance Mode')
                        .setDescription('The bot is currently undergoing maintenance in this server or globally. Please check back later.');
                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error('security', `Guild approval/maintenance settings fetch failed: ${message}`);
            }
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) {
            logger.warn('discord', `Unknown command: ${interaction.commandName}`);
            return;
        }

        const now = Date.now();
        const lastUsed = cooldowns.get(interaction.user.id) || 0;
        if (now - lastUsed < 3000) {
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('Slow down! Please wait a few seconds before using another command.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        cooldowns.set(interaction.user.id, now);

        if (interaction.guild && DJ_COMMANDS.has(interaction.commandName)) {
            try {
                const member = interaction.member as GuildMember;
                if (!(await isDJ(member))) {
                    const settings = await getGuildSettings(interaction.guild.id);
                    const embed = new EmbedBuilder()
                        .setColor(0x111111)
                        .setDescription(`You need the <@&${settings.djRoleId}> role (or DJ privileges) to use this command.`);
                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error('security', `DJ role check failed: ${message}`);
            }
        }

        try {
            await command.execute(interaction, client);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('discord', `Error executing /${interaction.commandName}: ${message}`);
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('Something went wrong while executing this command.');
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            } catch {}
        }
    },
};
