import { SlashCommandBuilder, ChatInputCommandInteraction, Client, Message } from 'discord.js';
import { togglePause } from '../utils/music';
import { CommandContext } from '../utils/context';
import { withPlayerGuard } from '../utils/middlewares';

export default {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Toggle pause/resume for the current track.'),
    aliases: ['pa', 'resume'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const ctx = new CommandContext(interaction, true);
        await withPlayerGuard(ctx, { requireDJ: true, requirePlayer: true, useLock: true }, async (player) => {
            await togglePause(ctx, player!);
        });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const ctx = new CommandContext(message, false);
        await withPlayerGuard(ctx, { requireDJ: true, requirePlayer: true, useLock: true }, async (player) => {
            await togglePause(ctx, player!);
        });
    }
};