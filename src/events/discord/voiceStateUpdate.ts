import { Client, Events, VoiceState } from 'discord.js';
import { twentyFourSevenGuilds } from '../../commands/247';
import { logger } from '../../utils/logger';

export default {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState: VoiceState, newState: VoiceState, client: Client) {
        // --- Auto-Leave when channel is empty (and not 24/7) ---
        const guildId = oldState.guild.id;
        const botPlayer = client.kazagumo.players.get(guildId);
        if (botPlayer && botPlayer.voiceId) {
            const botChannel = oldState.guild.channels.cache.get(botPlayer.voiceId);
            if (botChannel && botChannel.isVoiceBased()) {
                const humanMembers = botChannel.members.filter(m => !m.user.bot).size;
                const is247 = twentyFourSevenGuilds.has(guildId);

                if (humanMembers === 0 && !is247) {
                    let leaveTimeout = botPlayer.data.get('leaveTimeout') as NodeJS.Timeout;
                    if (!leaveTimeout) {
                        leaveTimeout = setTimeout(() => {
                            const currentPlayer = client.kazagumo.players.get(guildId);
                            if (currentPlayer && currentPlayer.voiceId) {
                                const currentChannel = oldState.guild.channels.cache.get(currentPlayer.voiceId);
                                if (currentChannel && currentChannel.isVoiceBased()) {
                                    const currentHumans = currentChannel.members.filter(m => !m.user.bot).size;
                                    if (currentHumans === 0) {
                                        logger.info('music', `Leaving empty channel ${currentChannel.name} in guild ${guildId}`);
                                        currentPlayer.data.set('intentionalDisconnect', true);
                                        currentPlayer.destroy();
                                    }
                                }
                                currentPlayer.data.delete('leaveTimeout');
                            }
                        }, 30_000);
                        botPlayer.data.set('leaveTimeout', leaveTimeout);
                    }
                } else if (humanMembers > 0) {
                    const leaveTimeout = botPlayer.data.get('leaveTimeout') as NodeJS.Timeout;
                    if (leaveTimeout) {
                        clearTimeout(leaveTimeout);
                        botPlayer.data.delete('leaveTimeout');
                    }
                }
            }
        }

        // Only care about the bot being disconnected below
        if (oldState.id !== client.user?.id) return;

        // Bot was in a channel and got disconnected (moved to null)
        if (oldState.channel && !newState.channel) {
            const existingPlayer = client.kazagumo.players.get(guildId);
            // If the player still exists, it means the bot was forcefully disconnected (not via !stop).
            // We should always protect the session and restore it.
            if (existingPlayer) {
                // If this is an intentional disconnect (e.g. from !stop or panel action), ignore it
                if (existingPlayer.data.get('intentionalDisconnect')) {
                    logger.info('music', `Intentional disconnect for guild ${guildId}. Skipping auto-rejoin restoration.`);
                    return;
                }

                logger.info('music', `Bot forcefully disconnected from ${oldState.channel.name} in ${guildId} — protecting session and rejoining...`);

                const textId = existingPlayer.textId || oldState.channel.id;
                const volume = existingPlayer.volume || 100;
                const loopMode = existingPlayer.loop || 'none';

                // Copy queue details
                const queueTracks = [...existingPlayer.queue];
                const currentTrack = existingPlayer.queue.current;
                const previousTracks = [...(existingPlayer.queue.previous || [])];
                const position = existingPlayer.position || 0;
                const wasPlaying = existingPlayer.playing || false;
                const wasPaused = existingPlayer.paused || false;
                const customData = new Map(existingPlayer.data);

                // Destroy old player IMMEDIATELY so Shoukaku cleans up the old connection
                try { existingPlayer.destroy(); } catch {}

                setTimeout(async () => {
                    try {
                        const channel = oldState.channel;
                        if (!channel || !channel.isVoiceBased()) return;

                        // Create fresh player
                        const player = await client.kazagumo.createPlayer({
                            guildId,
                            voiceId: channel.id,
                            textId,
                            deaf: true,
                            volume,
                        });

                        logger.info('music', `Rejoined ${channel.name} in ${guildId} after force disconnect`);

                        // Restore loop mode
                        player.setLoop(loopMode);

                        // Restore custom data
                        for (const [key, val] of customData.entries()) {
                            player.data.set(key, val);
                        }

                        // Restore queue
                        if (previousTracks.length > 0) {
                            player.queue.previous = previousTracks;
                        }
                        if (queueTracks.length > 0) {
                            player.queue.add(queueTracks);
                        }

                        // Resume playback
                        if (wasPlaying && currentTrack) {
                            await player.play(currentTrack, { position });
                            logger.info('music', `Resumed playback at ${position}ms`);
                        } else if (wasPaused && currentTrack) {
                            await player.play(currentTrack, { position, paused: true });
                            logger.info('music', `Resumed paused state at ${position}ms`);
                        }
                    } catch (err: any) {
                        logger.error('music', `Failed to restore session in ${guildId}: ${err.message}`);
                    }
                }, 2000);
            }
        }
    },
};
