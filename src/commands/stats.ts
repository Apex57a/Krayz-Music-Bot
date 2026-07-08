import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
    EmbedBuilder,
} from 'discord.js';
import { config } from '../config';

export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View detailed bot and audio delivery statistics.'),
    aliases: ['ping'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        await interaction.deferReply();
        const reply = await interaction.fetchReply();
        const ping = reply.createdTimestamp - interaction.createdTimestamp;
        await sendStats(client, interaction, ping, true);
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const reply = await message.reply('Fetching statistics...');
        const ping = reply.createdTimestamp - message.createdTimestamp;
        await sendStats(client, message, ping, false, reply);
    }
};

async function sendStats(client: Client, context: any, ping: number, isSlash: boolean, prefixReply?: Message) {
    const memory = process.memoryUsage();
    const heapUsed = (memory.heapUsed / 1024 / 1024).toFixed(2);
    const rss = (memory.rss / 1024 / 1024).toFixed(2);
    
    const { client: clientA, clientB } = require('../index');

    let totalPlayers = clientA.kazagumo.players.size;
    let wsPingA = clientA.ws.ping;
    let wsPingB = clientB ? clientB.ws.ping : 'N/A';

    if (clientB && clientB.kazagumo) {
        totalPlayers += clientB.kazagumo.players.size;
    }

    // Process uptime
    const uptime = `<t:${Math.floor(Date.now() / 1000 - process.uptime())}:R>`;

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle('📊 Real-Time System Statistics')
        .addFields(
            { name: 'Primary Latency', value: `\`${wsPingA}ms\``, inline: true },
            { name: 'Worker Latency', value: clientB ? `\`${wsPingB}ms\`` : '`Offline`', inline: true },
            { name: 'Roundtrip Latency', value: `\`${ping}ms\``, inline: true },
            { name: 'Uptime', value: uptime, inline: true },
            { name: 'Memory (RSS / Heap)', value: `\`${rss} MB / ${heapUsed} MB\``, inline: true },
            { name: 'Active VCs', value: `\`${totalPlayers} streaming\``, inline: true },
            { name: 'Version', value: `\`v${config.version}\``, inline: true }
        );

    if (isSlash) {
        await context.editReply({ embeds: [embed] });
    } else if (prefixReply) {
        await prefixReply.edit({ content: null, embeds: [embed] });
    }
}
