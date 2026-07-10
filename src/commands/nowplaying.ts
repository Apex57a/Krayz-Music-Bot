import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    Message,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { formatDuration, getTrackDisplayUri } from '../utils/helpers';
import { CommandContext } from '../utils/context';
import { withPlayerGuard } from '../utils/middlewares';

import { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
function getNowPlayingData(player: KazagumoPlayer, track: KazagumoTrack) {
    const position = player.position;
    const duration = track.length || 0;

    const barLength = 20;
    const filledLength = duration > 0 ? Math.round((position / duration) * barLength) : 0;
    const bar = '▬'.repeat(Math.max(0, filledLength)) + '●' + '▬'.repeat(Math.max(0, barLength - filledLength));

    const loopMode = player.loop === 'track' ? 'Track' : player.loop === 'queue' ? 'Queue' : 'Off';

    const requester = track.requester as { globalName?: string, username?: string, tag?: string };
    const requesterName = requester?.globalName || requester?.username || requester?.tag || 'Autoplay';

    const displayUri = getTrackDisplayUri(track);

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'Now Playing' })
        .setTitle(track.title || 'Unknown Track')
        .setURL(displayUri)
        .setThumbnail(track.thumbnail || null)
        .setDescription(`${bar}\n\`${formatDuration(position)} / ${formatDuration(duration)}\``)
        .addFields(
            { name: 'Artist', value: track.author || 'Unknown', inline: true },
            { name: 'Volume', value: `${player.volume}%`, inline: true },
            { name: 'Loop', value: loopMode, inline: true },
            { name: 'Queue', value: `${player.queue.size} track(s)`, inline: true },
            { name: 'Requested by', value: requesterName, inline: true },
            { name: 'Status', value: player.paused ? 'Paused' : 'Playing', inline: true },
        )
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('panel_pause').setLabel('⏯️ Pause/Resume').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('panel_loop').setLabel('🔁 Loop').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

async function handleNowPlaying(ctx: CommandContext, player: KazagumoPlayer) {
    const track = player.queue.current;
    if (!track) {
        const msg = await ctx.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        if (msg && !ctx.isSlash) setTimeout(() => msg.delete().catch(() => {}), 10_000);
        return;
    }

    const data = getNowPlayingData(player, track);
    const msg = await ctx.reply(data);
    if (msg && !ctx.isSlash) setTimeout(() => msg.delete().catch(() => {}), 30_000);
}

export default {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show details about the currently playing track.'),
    aliases: ['np'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const ctx = new CommandContext(interaction, true);
        await withPlayerGuard(ctx, { requirePlayer: true }, async (player) => {
            if (!player) return;
            await handleNowPlaying(ctx, player);
        });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const ctx = new CommandContext(message, false);
        await withPlayerGuard(ctx, { requirePlayer: true }, async (player) => {
            if (!player) return;
            await handleNowPlaying(ctx, player);
        });
    }
};
