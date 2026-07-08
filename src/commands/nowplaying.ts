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
import { formatDuration } from '../utils/helpers';
import { getAvailableBot } from '../utils/botRouter';

function getNowPlayingData(player: any) {
    const track = player.queue.current;
    const position = player.position;
    const duration = track.length || 0;

    // --- Progress bar ---
    const barLength = 20;
    const filledLength = duration > 0 ? Math.round((position / duration) * barLength) : 0;
    const bar = '▬'.repeat(Math.max(0, filledLength)) + '●' + '▬'.repeat(Math.max(0, barLength - filledLength));

    // --- Loop status ---
    const loopMode = player.loop === 'track' ? 'Track' : player.loop === 'queue' ? 'Queue' : 'Off';

    // --- Requester ---
    const requester = track.requester as any;
    const requesterName = requester?.globalName || requester?.username || requester?.tag || 'Autoplay';

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setAuthor({ name: 'Now Playing' })
        .setTitle(track.title || 'Unknown Track')
        .setURL(track.uri || '')
        .setThumbnail(track.thumbnail || null)
        .setDescription(
            `${bar}\n\`${formatDuration(position)} / ${formatDuration(duration)}\``,
        )
        .addFields(
            { name: 'Artist', value: track.author || 'Unknown', inline: true },
            { name: 'Volume', value: `${player.volume}%`, inline: true },
            { name: 'Loop', value: loopMode, inline: true },
            { name: 'Queue', value: `${player.queue.size} track(s)`, inline: true },
            { name: 'Requested by', value: requesterName, inline: true },
            { name: 'Status', value: player.paused ? 'Paused' : 'Playing', inline: true },
        )
        .setTimestamp();

    // Control buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('panel_pause')
            .setLabel('⏯️ Pause/Resume')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('panel_skip')
            .setLabel('⏭️ Skip')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('panel_stop')
            .setLabel('⏹️ Stop')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('panel_loop')
            .setLabel('🔁 Loop')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('panel_shuffle')
            .setLabel('🔀 Shuffle')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

export default {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show details about the currently playing track.'),
    aliases: ['np'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const voiceChannel = (interaction.member as any).voice?.channel;
        const router = getAvailableBot(interaction.guild!.id, voiceChannel?.id);
        const player = router ? router.kazagumo.players.get(interaction.guild!.id) : undefined;

        if (!player || !player.queue.current) {
            return interaction.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        }

        const data = getNowPlayingData(player);
        await interaction.reply(data);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const voiceChannel = message.member?.voice?.channel;
        const router = getAvailableBot(message.guild!.id, voiceChannel?.id);
        const player = router ? router.kazagumo.players.get(message.guild!.id) : undefined;

        if (!player || !player.queue.current) {
            return message.reply('Nothing is playing right now.');
        }

        const data = getNowPlayingData(player);
        const reply = await message.reply(data).catch(() => null);
        // Let user see details, don't auto-delete nowplaying replies, or do after 30s
        if (reply) setTimeout(() => reply.delete().catch(() => {}), 30_000);
    }
};
