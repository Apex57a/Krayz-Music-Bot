import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
} from 'discord.js';
import { clearQueue } from '../utils/music';

export default {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Wipe the upcoming tracks in the queue.'),
    aliases: ['cl'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await clearQueue(client, interaction, interaction.user, true);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        await clearQueue(client, message, message.author, false);
    }
};
