import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    GuildMember,
    EmbedBuilder,
    Message,
    MessageFlags,
} from 'discord.js';
import { updateGuildSettings, getAll247Guilds, getGuildSettings } from '../utils/database';
import { logger } from '../utils/logger';
import { getAvailableBot } from '../utils/botRouter';
import { pendingPlayerCreations } from '../utils/music';

// In-memory cache of 24/7 guilds — loaded from DB on boot
const twentyFourSevenGuilds = new Set<string>();

export { twentyFourSevenGuilds };

// Called once on bot start to restore state from DB
export async function load247FromDB(client: Client) {
    const guilds = await getAll247Guilds();
    for (const g of guilds) {
        twentyFourSevenGuilds.add(g.guildId);
        
        // If it has voice and text channels, connect!
        if (g.voiceChannelId && g.textChannelId) {
            try {
                // Wait for shoukaku to be ready before creating players
                setTimeout(async () => {
                    try {
                        const router = getAvailableBot(g.guildId, g.voiceChannelId);
                        if (!router) return;
                        let player = router.kazagumo.players.get(g.guildId);
                        
                        if (!player && pendingPlayerCreations.has(g.guildId)) {
                            try {
                                await pendingPlayerCreations.get(g.guildId);
                                player = router.kazagumo.players.get(g.guildId);
                            } catch (e) {}
                        }

                        if (!player) {
                            const settings = await getGuildSettings(g.guildId).catch(() => null);
                            const savedVolume = settings ? settings.volume : 100;
                            const safeVolume = Math.round(Math.pow(savedVolume / 100, 1.5) * 100);

                            const creationPromise = router.kazagumo.createPlayer({
                                guildId: g.guildId,
                                voiceId: g.voiceChannelId!,
                                textId: g.textChannelId!,
                                deaf: true,
                                volume: safeVolume,
                                nodeName: 'Node - 1',
                            });
                            pendingPlayerCreations.set(g.guildId, creationPromise);
                            player = await creationPromise;
                            pendingPlayerCreations.delete(g.guildId);
                            logger.info('music', `Hydrated 24/7 session for ${g.guildId} at volume ${savedVolume}% (safe: ${safeVolume}%)`);
                        }
                    } catch (e: any) {
                        logger.error('music', `Failed to hydrate 24/7 for ${g.guildId}: ${e.message}`);
                    }
                }, 5000); // 5 sec delay to ensure nodes connect
            } catch (err: any) {
                logger.error('music', `Failed to hydrate 24/7 for ${g.guildId}: ${err.message}`);
            }
        }
    }
    logger.info('database', `Loaded ${guilds.length} guild(s) with 24/7 mode.`);
}

export default {
    data: new SlashCommandBuilder()
        .setName('247')
        .setDescription('Toggle 24/7 mode — bot stays in voice channel even when idle.'),
    aliases: ['24-7', 'stay'],

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        const member = interaction.member as GuildMember;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({
                content: 'You need to join a voice channel first.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const guildId = interaction.guild!.id;

        if (twentyFourSevenGuilds.has(guildId)) {
            // --- Disable 24/7 ---
            twentyFourSevenGuilds.delete(guildId);
            await updateGuildSettings(guildId, { twentyFourSeven: false, voiceChannelId: null });

            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('24/7 mode disabled. I will leave when the queue is empty.');

            await interaction.reply({ embeds: [embed] });
        } else {
            // --- Enable 24/7 ---
            twentyFourSevenGuilds.add(guildId);
            await updateGuildSettings(guildId, { 
                twentyFourSeven: true, 
                textChannelId: interaction.channel!.id,
                voiceChannelId: voiceChannel.id 
            });

            const router = getAvailableBot(guildId, voiceChannel.id);
            if (!router) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('All bots are currently busy in other voice channels in this server!');
                return await interaction.reply({ embeds: [embed] });
            }

            let player = router.kazagumo.players.get(guildId);
            
            if (!player && pendingPlayerCreations.has(guildId)) {
                try {
                    await pendingPlayerCreations.get(guildId);
                    player = router.kazagumo.players.get(guildId);
                } catch (e) {}
            }

            if (!player) {
                const settings = await getGuildSettings(guildId).catch(() => null);
                const savedVolume = settings ? settings.volume : 100;
                const safeVolume = Math.round(Math.pow(savedVolume / 100, 1.5) * 100);

                const creationPromise = router.kazagumo.createPlayer({
                    guildId,
                    voiceId: voiceChannel.id,
                    textId: interaction.channel!.id,
                    deaf: true,
                    volume: safeVolume,
                    nodeName: 'Node - 1',
                });
                pendingPlayerCreations.set(guildId, creationPromise);
                player = await creationPromise;
                pendingPlayerCreations.delete(guildId);
            }

            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription(
                    '24/7 mode enabled. I will stay in the voice channel.\n' +
                    'This setting is saved across restarts.',
                );

            await interaction.reply({ embeds: [embed] });
        }
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        const member = message.member as GuildMember;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return message.reply('You need to join a voice channel first.');
        }

        const guildId = message.guild!.id;

        if (twentyFourSevenGuilds.has(guildId)) {
            twentyFourSevenGuilds.delete(guildId);
            await updateGuildSettings(guildId, { twentyFourSeven: false, voiceChannelId: null });

            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription('24/7 mode disabled. I will leave when the queue is empty.');

            const reply = await message.reply({ embeds: [embed] }).catch(() => null);
            if (reply) setTimeout(() => reply.delete().catch(() => {}), 10_000);
        } else {
            twentyFourSevenGuilds.add(guildId);
            await updateGuildSettings(guildId, { 
                twentyFourSeven: true, 
                textChannelId: message.channel.id,
                voiceChannelId: voiceChannel.id 
            });

            const router = getAvailableBot(guildId, voiceChannel.id);
            if (!router) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('All bots are currently busy in other voice channels in this server!');
                const reply = await message.reply({ embeds: [embed] }).catch(() => null);
                if (reply) setTimeout(() => reply.delete().catch(() => {}), 10_000);
                return;
            }

            let player = router.kazagumo.players.get(guildId);
            
            if (!player && pendingPlayerCreations.has(guildId)) {
                try {
                    await pendingPlayerCreations.get(guildId);
                    player = router.kazagumo.players.get(guildId);
                } catch (e) {}
            }

            if (!player) {
                const settings = await getGuildSettings(guildId).catch(() => null);
                const savedVolume = settings ? settings.volume : 100;
                const safeVolume = Math.round(Math.pow(savedVolume / 100, 1.5) * 100);

                const creationPromise = router.kazagumo.createPlayer({
                    guildId,
                    voiceId: voiceChannel.id,
                    textId: message.channel.id,
                    deaf: true,
                    volume: safeVolume,
                    nodeName: 'Node - 1',
                });
                pendingPlayerCreations.set(guildId, creationPromise);
                player = await creationPromise;
                pendingPlayerCreations.delete(guildId);
            }

            const embed = new EmbedBuilder()
                .setColor(0x111111)
                .setDescription(
                    '24/7 mode enabled. I will stay in the voice channel.\n' +
                    'This setting is saved across restarts.',
                );

            const reply = await message.reply({ embeds: [embed] }).catch(() => null);
            if (reply) setTimeout(() => reply.delete().catch(() => {}), 10_000);
        }
    }
};
