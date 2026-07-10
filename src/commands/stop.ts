import { SlashCommandBuilder, ChatInputCommandInteraction, Client, Message } from 'discord.js';
import { stopPlayback } from '../utils/music';
import { CommandContext } from '../utils/context';
import { withPlayerGuard } from '../utils/middlewares';

export default {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music, clear the queue, and leave the voice channel.'),
    aliases: ['st'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const ctx = new CommandContext(interaction, true);
        await withPlayerGuard(ctx, { requireDJ: true, requirePlayer: true, useLock: true }, async (player) => {
            await stopPlayback(ctx, player!);
        });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const ctx = new CommandContext(message, false);
        await withPlayerGuard(ctx, { requireDJ: true, requirePlayer: true, useLock: true }, async (player) => {
            await stopPlayback(ctx, player!);
        });
    }
};