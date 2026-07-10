import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    Message,
    MessageFlags,
} from 'discord.js';
import { formatDuration } from '../utils/helpers';
import { CommandContext } from '../utils/context';
import { withPlayerGuard } from '../utils/middlewares';

import { KazagumoPlayer, KazagumoTrack } from 'kazagumo';
function getQueueData(player: KazagumoPlayer, page: number) {
    const queue = player.queue;
    const tracks = Array.from(queue);
    const totalPages = Math.ceil(tracks.length / 10) || 1;
    const current = queue.current;
    const start = page * 10;
    const end = start + 10;
    const currentTracks = tracks.slice(start, end);

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setDescription(`**Now Playing:**\n[${current?.title}](${current?.uri}) - \`${formatDuration(current?.length || 0)}\``);

    if (currentTracks.length > 0) {
        const trackList = currentTracks.map((t: KazagumoTrack, i) => {
            return `\`${start + i + 1}.\` [${t.title}](${t.uri}) - \`${formatDuration(t.length || 0)}\``;
        }).join('\n');

        embed.addFields({ name: 'Up Next', value: trackList });
    } else {
        embed.addFields({ name: 'Up Next', value: '*Queue is empty*' });
    }

    embed.setFooter({ text: `Page ${page + 1} of ${totalPages} • ${tracks.length} tracks total` });

    const components = totalPages > 1 ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('prev_page')
                .setLabel('Prev')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('next_page')
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1 || totalPages === 0)
        )
    ] : [];

    return { embed, components, totalPages };
}

async function handleQueue(ctx: CommandContext, player: KazagumoPlayer) {
    if (!player.queue.current) {
        const msg = await ctx.reply({ content: 'Nothing is currently playing.', flags: MessageFlags.Ephemeral });
        if (msg && !ctx.isSlash) setTimeout(() => msg.delete().catch(() => {}), 10_000);
        return;
    }

    let currentPage = 0;
    const { embed, components, totalPages } = getQueueData(player, 0);

    const message = await ctx.reply({ embeds: [embed], components, fetchReply: true });

    if (totalPages > 1 && message) {
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== ctx.user.id) {
                await i.reply({ content: 'These buttons are not for you.', flags: MessageFlags.Ephemeral });
                return;
            }

            if (i.customId === 'prev_page') currentPage--;
            else if (i.customId === 'next_page') currentPage++;

            const nextData = getQueueData(player, currentPage);
            await i.update({
                embeds: [nextData.embed],
                components: nextData.components,
            });
        });

        collector.on('end', () => {
            const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('prev_page').setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('next_page').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            if (ctx.isSlash && ctx.interaction) {
                ctx.interaction.editReply({ components: [disabledRow] }).catch(() => {});
            } else if (message.editable) {
                message.edit({ components: [disabledRow] }).catch(() => {});
            }
        });
    }

    if (ctx.isSlash && ctx.interaction) {
        setTimeout(() => ctx.interaction!.deleteReply().catch(() => {}), 60_000);
    } else if (message) {
        setTimeout(() => message.delete().catch(() => {}), 60_000);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue.'),
    aliases: ['q'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const ctx = new CommandContext(interaction, true);
        await withPlayerGuard(ctx, { requirePlayer: true }, async (player) => {
            if (!player) return;
            await handleQueue(ctx, player);
        });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const ctx = new CommandContext(message, false);
        await withPlayerGuard(ctx, { requirePlayer: true }, async (player) => {
            if (!player) return;
            await handleQueue(ctx, player);
        });
    }
};
