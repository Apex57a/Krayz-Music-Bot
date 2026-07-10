import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
    EmbedBuilder,
} from 'discord.js';
import { config } from '../config';
import { CommandContext } from '../utils/context';

export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View detailed bot and audio delivery statistics.'),
    aliases: ['ping'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await interaction.deferReply();
        const reply = await interaction.fetchReply();
        const ping = reply.createdTimestamp - interaction.createdTimestamp;
        const ctx = new CommandContext(interaction, true);
        await sendStats(client, ctx, ping);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const reply = await message.reply('Fetching statistics...');
        const ping = reply.createdTimestamp - message.createdTimestamp;
        const ctx = new CommandContext(message, false);
        await sendStats(client, ctx, ping, reply);
    }
};

async function sendStats(client: Client, context: CommandContext, ping: number, prefixReply?: Message) {
    const memory = process.memoryUsage();
    const heapUsed = (memory.heapUsed / 1024 / 1024).toFixed(2);
    const rss = (memory.rss / 1024 / 1024).toFixed(2);

    const { allClients } = require('../index');
    const clients: Client[] = allClients;

    const primary = clients[0];
    const workers = clients.slice(1);

    let totalPlayers = 0;
    for (const c of clients) {
        if (c.kazagumo) {
            totalPlayers += c.kazagumo.players.size;
        }
    }

    // Process uptime
    const uptime = `<t:${Math.floor(Date.now() / 1000 - process.uptime())}:R>`;

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle('Real-Time System Statistics')
        .addFields(
            { name: 'Primary Latency', value: `\`${primary.ws.ping}ms\``, inline: true },
        );

    // Show each worker's latency
    if (workers.length === 1) {
        // Single worker: keep the old "Worker Latency" label
        embed.addFields({ name: 'Worker Latency', value: `\`${workers[0].ws.ping}ms\``, inline: true });
    } else if (workers.length > 1) {
        // Multiple workers: label each one
        for (let i = 0; i < workers.length; i++) {
            const wPing = workers[i].isReady() ? `\`${workers[i].ws.ping}ms\`` : '`Offline`';
            embed.addFields({ name: `Worker-${i + 1} Latency`, value: wPing, inline: true });
        }
    }

    embed.addFields(
        { name: 'Roundtrip Latency', value: `\`${ping}ms\``, inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Memory (RSS / Heap)', value: `\`${rss} MB / ${heapUsed} MB\``, inline: true },
        { name: 'Active VCs', value: `\`${totalPlayers} streaming\``, inline: true },
        { name: 'Bot Pool', value: `\`1 primary + ${workers.length} worker(s)\``, inline: true },
        { name: 'Version', value: `\`v${config.version}\``, inline: true }
    );

    if (context.isSlash) {
        await context.edit({ embeds: [embed] });
    } else if (prefixReply) {
        await prefixReply.edit({ content: null, embeds: [embed] });
    }
}
