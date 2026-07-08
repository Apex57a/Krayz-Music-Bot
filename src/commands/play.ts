import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
    EmbedBuilder,
} from 'discord.js';
import { playTrack } from '../utils/music';

export default {
    name: 'play',
    aliases: ['p'],

    async executePrefix(message: Message, args: string[], client: Client) {
        const query = args.join(' ').trim();
        if (!query) {
            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('Provide a song name or URL.');
            const msg = await message.reply({ embeds: [embed] }).catch(() => null);
            if (msg) setTimeout(() => msg.delete().catch(() => {}), 10_000);
            return;
        }
        await playTrack(client, message, query, message.author, false);
    }
};
