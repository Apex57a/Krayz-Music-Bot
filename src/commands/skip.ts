import { SlashCommandBuilder, ChatInputCommandInteraction, Client, Message } from 'discord.js';
import { skipTrack } from '../utils/music';
import { CommandContext } from '../utils/context';
import { withPlayerGuard } from '../utils/middlewares';

export default {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track (may require votes).'),
    aliases: ['s'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const ctx = new CommandContext(interaction, true);
        await withPlayerGuard(ctx, { requirePlayer: true, useLock: true }, async (player) => {
            await skipTrack(ctx, player!);
        });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const ctx = new CommandContext(message, false);
        await withPlayerGuard(ctx, { requirePlayer: true, useLock: true }, async (player) => {
            await skipTrack(ctx, player!);
        });
    }
};