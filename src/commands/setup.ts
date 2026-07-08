import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
    ChannelType,
    MessageFlags,
} from 'discord.js';
import { updateGuildSettings } from '../utils/database';
import { isDJ } from '../utils/security';

export default {
    data: new SlashCommandBuilder()
        .setName('setup-logs')
        .setDescription('Set the channel where Action Logs will be sent.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The text channel for logs')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(8),

    aliases: ['setuplogs'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        if (!interaction.guild) return;

        if (!interaction.memberPermissions?.has('Administrator') && !(await isDJ(interaction.member as any))) {
            return interaction.reply({ content: 'You do not have permission to manage logs.', flags: MessageFlags.Ephemeral });
        }

        const channel = interaction.options.getChannel('channel', true);
        await updateGuildSettings(interaction.guild.id, { logChannelId: channel.id });

        await interaction.reply({ content: `✅ Log channel has been successfully set to <#${channel.id}>. Use \`/settings\` to toggle what gets logged.`, flags: MessageFlags.Ephemeral });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        if (!message.guild) return;

        if (!message.member?.permissions.has('Administrator') && !(await isDJ(message.member as any))) {
            const reply = await message.reply('You do not have permission to manage logs.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        const channelId = args[0]?.replace(/[<#>]/g, '');
        const channel = message.guild.channels.cache.get(channelId);

        if (!channel || channel.type !== ChannelType.GuildText) {
            const reply = await message.reply('Please mention a valid text channel. Usage: `!setup-logs #channel`');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        await updateGuildSettings(message.guild.id, { logChannelId: channel.id });
        await message.reply(`✅ Log channel has been successfully set to <#${channel.id}>. Use \`!settings\` to toggle what gets logged.`);
    }
};
