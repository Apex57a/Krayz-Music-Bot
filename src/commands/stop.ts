import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
} from 'discord.js';
import { stopPlayback } from '../utils/music';

export default {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music, clear the queue, and leave the voice channel.'),
    aliases: ['st'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await stopPlayback(client, interaction, interaction.user, true);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        await stopPlayback(client, message, message.author, false);
    }
};
