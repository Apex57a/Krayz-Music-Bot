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
import { getAvailableBot } from '../utils/botRouter';

function getQueueData(player: any, page: number) {
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
        const trackList = currentTracks.map((t: any, i) => {
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

export default {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue.'),
    aliases: ['q'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const voiceChannel = (interaction.member as any).voice?.channel;
        const router = getAvailableBot(interaction.guild!.id, voiceChannel?.id);
        const player = router ? router.kazagumo.players.get(interaction.guild!.id) : undefined;

        if (!player || !player.queue.current) {
            const msg = await interaction.reply({ content: 'Nothing is currently playing.', flags: MessageFlags.Ephemeral, fetchReply: true }).catch(() => null);
            if (msg) setTimeout(() => interaction.deleteReply().catch(() => {}), 10_000);
            return;
        }

        let currentPage = 0;
        const { embed, components, totalPages } = getQueueData(player, 0);

        const message = await interaction.reply({
            embeds: [embed],
            components,
            fetchReply: true,
        });

        if (totalPages > 1) {
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000,
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
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
                interaction.editReply({ components: [disabledRow] }).catch(() => {});
            });
        }

        setTimeout(() => interaction.deleteReply().catch(() => {}), 60_000);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const voiceChannel = message.member?.voice?.channel;
        const router = getAvailableBot(message.guild!.id, voiceChannel?.id);
        const player = router ? router.kazagumo.players.get(message.guild!.id) : undefined;

        if (!player || !player.queue.current) {
            const reply = await message.reply('Nothing is currently playing.').catch(() => null);
            if (reply) setTimeout(() => reply.delete().catch(() => {}), 10_000);
            return;
        }

        let currentPage = 0;
        const { embed, components, totalPages } = getQueueData(player, 0);

        const reply = await message.reply({
            embeds: [embed],
            components,
        });

        if (totalPages > 1) {
            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000,
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== message.author.id) {
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
                reply.edit({ components: [disabledRow] }).catch(() => {});
            });
        }

        setTimeout(() => reply.delete().catch(() => {}), 60_000);
    }
};
