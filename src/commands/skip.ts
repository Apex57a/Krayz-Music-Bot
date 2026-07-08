import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
} from 'discord.js';
import { skipTrack } from '../utils/music';

export default {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track (may require votes).'),
    aliases: ['s'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await skipTrack(client, interaction, interaction.user, true);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        await skipTrack(client, message, message.author, false);
    }
};
