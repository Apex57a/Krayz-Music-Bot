import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Message,
    Client,
    PermissionsBitField,
    TextChannel
} from 'discord.js';
import { logger } from '../utils/logger';

export default {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk delete messages in the current channel.')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
        
    aliases: ['clearmsgs', 'prune'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: 'You need the **Manage Messages** permission to use this command.', ephemeral: true });
        }

        const amount = interaction.options.getInteger('amount', true);
        const channel = interaction.channel as TextChannel;

        try {
            // Use ephemeral reply so it doesn't clutter the chat
            await interaction.deferReply({ ephemeral: true });
            
            // bulkDelete filters out messages older than 14 days automatically if 2nd param is true
            const deleted = await channel.bulkDelete(amount, true);
            await interaction.editReply(`✅ Successfully deleted ${deleted.size} messages.`);
        } catch (error: Error | any) {
            logger.error('discord', `Purge slash command error: ${error.stack || error.message}`);
            await interaction.editReply('❌ Failed to delete messages. Make sure I have the Manage Messages permission, and note that messages older than 14 days cannot be bulk deleted by bots.');
        }
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            const reply = await message.reply('You need the **Manage Messages** permission to use this command.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        const amount = parseInt(args[0], 10);
        if (isNaN(amount) || amount < 1 || amount > 100) {
            const reply = await message.reply('Please provide a valid number between 1 and 100. Usage: `!purge 10`');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        const channel = message.channel as TextChannel;
        try {
            // Delete the command message itself first
            await message.delete().catch(() => {});
            
            const deleted = await channel.bulkDelete(amount, true);
            
            // Send confirmation and auto-delete it after 5 seconds
            const reply = await channel.send(`✅ Successfully deleted ${deleted.size} messages.`);
            setTimeout(() => reply.delete().catch(() => {}), 5000);
        } catch (error: Error | any) {
            logger.error('discord', `Purge prefix command error: ${error.stack || error.message}`);
            const reply = await channel.send('❌ Failed to delete messages. Make sure I have the Manage Messages permission, and note that messages older than 14 days cannot be bulk deleted by bots.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
        }
    }
};
