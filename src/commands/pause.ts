import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
} from 'discord.js';
import { togglePause } from '../utils/music';

export default {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Toggle pause/resume for the current track.'),
    aliases: ['pa', 'resume'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await togglePause(client, interaction, interaction.user, true);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        await togglePause(client, message, message.author, false);
    }
};
