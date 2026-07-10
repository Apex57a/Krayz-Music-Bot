import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../utils/database';
import { isDJ } from '../utils/security';
import { twentyFourSevenGuilds } from './247';

export default {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure the bot settings and logger toggles.')
        .setDefaultMemberPermissions(8), // Administrator permission required

    aliases: ['config'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        if (!interaction.guild) return;

        // Ensure user has Admin or DJ permissions
        if (!interaction.memberPermissions?.has('Administrator') && !(await isDJ(interaction.member as import('discord.js').GuildMember))) {
            return interaction.reply({ content: 'You do not have permission to manage settings.', flags: MessageFlags.Ephemeral });
        }

        await handleSettingsMenu(interaction, interaction.guild.id, client);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        if (!message.guild) return;

        if (!message.member?.permissions.has('Administrator') && !(await isDJ(message.member as import('discord.js').GuildMember))) {
            const reply = await message.reply('You do not have permission to manage settings.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        await handleSettingsMenu(message, message.guild.id, client);
    }
};

async function handleSettingsMenu(context: ChatInputCommandInteraction | Message, guildId: string, client: Client) {
    const settings = await getGuildSettings(guildId);
    
    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle('Server Configuration')
        .setDescription('Select an option below to toggle it on or off.')
        .addFields(
            { name: 'Logging Channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set', inline: true },
            { name: 'Log Messages', value: settings.logMessages ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Log Members', value: settings.logMembers ? 'Enabled' : 'Disabled', inline: true },
            { name: '24/7 Mode', value: settings.twentyFourSeven ? 'Enabled' : 'Disabled', inline: true }
        );

    const menu = new StringSelectMenuBuilder()
        .setCustomId('settings_select')
        .setPlaceholder('Select a setting to toggle')
        .addOptions([
            { label: 'Toggle Message Logs', description: 'Log deleted and edited messages', value: 'toggle_messages' },
            { label: 'Toggle Member Logs', description: 'Log member joins, leaves, and role changes', value: 'toggle_members' },
            { label: 'Toggle 24/7 Mode', description: 'Keep the bot in the voice channel', value: 'toggle_247' },
        ]);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    let responseMessage;
    if (context instanceof ChatInputCommandInteraction) {
        responseMessage = await context.reply({ embeds: [embed], components: [row], fetchReply: true, flags: MessageFlags.Ephemeral });
    } else {
        responseMessage = await context.reply({ embeds: [embed], components: [row] });
    }

    const collector = responseMessage.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 120000,
    });

    collector.on('collect', async (i) => {
        // Ensure only the person who ran the command can interact
        const authorId = context instanceof ChatInputCommandInteraction ? context.user.id : context.author.id;
        if (i.user.id !== authorId) {
            await i.reply({ content: 'You cannot use this menu.', flags: MessageFlags.Ephemeral });
            return;
        }

        const choice = i.values[0];
        const currentSettings = await getGuildSettings(guildId);
        let updateData: Record<string, unknown> = {};
        let feedback = '';

        if (choice === 'toggle_messages') {
            updateData.logMessages = !currentSettings.logMessages;
            feedback = `Message logging ${updateData.logMessages ? 'enabled' : 'disabled'}.`;
        } else if (choice === 'toggle_members') {
            updateData.logMembers = !currentSettings.logMembers;
            feedback = `Member logging ${updateData.logMembers ? 'enabled' : 'disabled'}.`;
        } else if (choice === 'toggle_247') {
            const newState = !currentSettings.twentyFourSeven;
            updateData.twentyFourSeven = newState;

            // Sync the in-memory Set so the bot actually stays/leaves
            if (newState) {
                twentyFourSevenGuilds.add(guildId);
            } else {
                twentyFourSevenGuilds.delete(guildId);
            }

            feedback = `24/7 mode ${newState ? 'enabled' : 'disabled'}.`;
        }

        await updateGuildSettings(guildId, updateData);
        
        // Refresh embed data
        const updatedSettings = await getGuildSettings(guildId);
        embed.setFields(
            { name: 'Logging Channel', value: updatedSettings.logChannelId ? `<#${updatedSettings.logChannelId}>` : 'Not set', inline: true },
            { name: 'Log Messages', value: updatedSettings.logMessages ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Log Members', value: updatedSettings.logMembers ? 'Enabled' : 'Disabled', inline: true },
            { name: '24/7 Mode', value: updatedSettings.twentyFourSeven ? 'Enabled' : 'Disabled', inline: true }
        );

        await i.update({ embeds: [embed], components: [row] });
        
        const feedbackMsg = await i.followUp({ content: feedback, flags: MessageFlags.Ephemeral });
        setTimeout(() => feedbackMsg.delete().catch(() => {}), 3000);
    });

    collector.on('end', () => {
        row.components[0].setDisabled(true);
        if (context instanceof ChatInputCommandInteraction) {
            context.editReply({ components: [row] }).catch(() => {});
        } else {
            responseMessage.edit({ components: [row] }).catch(() => {});
        }
    });
}
