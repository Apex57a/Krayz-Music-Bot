import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    Message,
    MessageFlags,
} from 'discord.js';
import { updateGuildSettings, getAll247Guilds, getGuildSettings } from '../utils/database';
import { logger } from '../utils/logger';
import { getAvailableBot } from '../utils/botRouter';
import { getOrCreatePlayer } from '../utils/music';
import { CommandContext } from '../utils/context';

const twentyFourSevenGuilds = new Set<string>();

export { twentyFourSevenGuilds };

export async function load247FromDB(client: Client) {
    const guilds = await getAll247Guilds();
    for (const g of guilds) {
        twentyFourSevenGuilds.add(g.guildId);
        
        if (g.voiceChannelId && g.textChannelId) {
            try {
                setTimeout(async () => {
                    try {
                        const router = getAvailableBot(g.guildId, g.voiceChannelId);
                        if (!router) return;
                        await getOrCreatePlayer(router, g.guildId, g.voiceChannelId!, g.textChannelId!);
                    } catch (e: Error | any) {
                        logger.error('music', `Failed to hydrate 24/7 for ${g.guildId}: ${e.message}`);
                    }
                }, 5000);
            } catch (err: Error | any) {
                logger.error('music', `Failed to hydrate 24/7 for ${g.guildId}: ${err.message}`);
            }
        }
    }
    logger.info('database', `Loaded ${guilds.length} guild(s) with 24/7 mode.`);
}

async function handle247(ctx: CommandContext) {
    const voiceChannel = ctx.voiceChannel;

    if (!voiceChannel) {
        const msg = await ctx.reply({ content: 'You need to join a voice channel first.', flags: MessageFlags.Ephemeral });
        if (msg && !ctx.isSlash) setTimeout(() => msg.delete().catch(() => {}), 10_000);
        return;
    }

    const guildId = ctx.guild!.id;

    if (twentyFourSevenGuilds.has(guildId)) {
        twentyFourSevenGuilds.delete(guildId);
        await updateGuildSettings(guildId, { twentyFourSeven: false, voiceChannelId: null });

        const embed = new EmbedBuilder()
            .setColor(0x111111)
            .setDescription('24/7 mode disabled. I will leave when the queue is empty.');

        const reply = await ctx.reply({ embeds: [embed] });
        if (reply && !ctx.isSlash) setTimeout(() => reply.delete().catch(() => {}), 10_000);
    } else {
        twentyFourSevenGuilds.add(guildId);
        await updateGuildSettings(guildId, { 
            twentyFourSeven: true, 
            textChannelId: ctx.textChannel!.id,
            voiceChannelId: voiceChannel.id 
        });

        const router = getAvailableBot(guildId, voiceChannel.id);
        if (!router) {
            const embed = new EmbedBuilder().setColor(0x111111).setDescription('All bots are currently busy in other voice channels in this server!');
            const reply = await ctx.reply({ embeds: [embed] });
            if (reply && !ctx.isSlash) setTimeout(() => reply.delete().catch(() => {}), 10_000);
            return;
        }

        await getOrCreatePlayer(router, guildId, voiceChannel.id, ctx.textChannel!.id);

        const embed = new EmbedBuilder()
            .setColor(0x111111)
            .setDescription(
                '24/7 mode enabled. I will stay in the voice channel.\n' +
                'This setting is saved across restarts.',
            );

        const reply = await ctx.reply({ embeds: [embed] });
        if (reply && !ctx.isSlash) setTimeout(() => reply.delete().catch(() => {}), 10_000);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('247')
        .setDescription('Toggle 24/7 mode — bot stays in voice channel even when idle.'),
    aliases: ['24-7', 'stay'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const ctx = new CommandContext(interaction, true);
        await handle247(ctx);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const ctx = new CommandContext(message, false);
        await handle247(ctx);
    }
};
