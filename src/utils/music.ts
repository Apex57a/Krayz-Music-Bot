import { 
    Client, 
    ChatInputCommandInteraction, 
    Message, 
    EmbedBuilder, 
    GuildMember,
    User,
    TextChannel
} from 'discord.js';
import { KazagumoPlayer, KazagumoTrack, KazagumoSearchResult, Kazagumo } from 'kazagumo';
import { parseSpotifyUrl, fetchSpotifyTracks, SpotifyTrackInfo } from './spotify';
import { formatDuration, createAddedTrackEmbed } from './helpers';
import { isDJ } from './security';
import { twentyFourSevenGuilds } from '../commands/247';
import { updateGuildSettings, getGuildSettings } from './database';
import { logger } from './logger';
import { getAvailableBot } from './botRouter';

const MAX_QUEUE_SIZE = 500;

function safeRequester(user: User): { id: string; username: string; avatar: string | null } {
    return {
        id: user.id,
        username: user.username,
        avatar: user.avatarURL() || null,
    };
}

interface MusicResponse {
    embeds?: EmbedBuilder[];
    content?: string;
}

async function sendResponse(
    context: ChatInputCommandInteraction | Message,
    isSlash: boolean,
    data: MusicResponse,
    deferred = false,
    ephemeral = false,
    voiceChannelId?: string
) {
    try {
        const router = getAvailableBot(context.guild!.id, voiceChannelId);
        const activeClient = router ? router.client : context.client;

        if (isSlash) {
            const interaction = context as ChatInputCommandInteraction;
            if (deferred) {
                return await interaction.editReply(data);
            } else {
                return await interaction.reply({ ...data, ...(ephemeral ? { flags: 64 } : {}) });
            }
        } else {
            const message = context as Message;
            if (activeClient.user?.id !== context.client.user?.id) {
                const channel = activeClient.channels.cache.get(context.channelId) as any;
                if (channel) {
                    return await channel.send({ ...data, reply: { messageReference: message.id } });
                }
            }
            return await message.reply(data);
        }
    } catch (err: unknown) {
        logger.error('music', `Music response helper failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

function scheduleDeletion(context: ChatInputCommandInteraction | Message, responseMessage: any, isSlash: boolean, duration = 10000) {
    if (!responseMessage) return;
    setTimeout(() => {
        try {
            if (isSlash) {
                const interaction = context as ChatInputCommandInteraction;
                interaction.deleteReply().catch(() => null);
            } else {
                responseMessage.delete().catch(() => null);
            }
        } catch {}
    }, duration);
}

// Global lock to prevent concurrent player creation race conditions
export const pendingPlayerCreations = new Map<string, Promise<any>>();

export async function playTrack(
    client: Client,
    context: ChatInputCommandInteraction | Message,
    query: string,
    user: User,
    isSlash: boolean
) {
    const guild = context.guild!;
    const member = context.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('Join a voice channel first.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash, true);
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const permissions = voiceChannel.permissionsFor(guild.members.me!);
    if (!permissions?.has(['Connect', 'Speak'])) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('I need Connect and Speak permissions in your channel.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash, true);
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    let router = getAvailableBot(guild.id, voiceChannel.id);
    if (!router) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('All bots are currently busy in other voice channels in this server! Please wait or use !stop in another channel.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash, true);
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    let activeClient = router.client;
    let kazagumo = router.kazagumo;

    let player = kazagumo.players.get(guild.id);
    
    // Concurrency lock check
    if (!player && pendingPlayerCreations.has(guild.id)) {
        try {
            await pendingPlayerCreations.get(guild.id);
            player = kazagumo.players.get(guild.id);
        } catch (e) {
            // Ignore lock failure, will try to create or fail normally
        }
    }

    if (!player) {
        const settings = await getGuildSettings(guild.id).catch(() => null);
        const savedVolume = settings ? settings.volume : 100;
        const safeVolume = Math.round(Math.pow(savedVolume / 100, 1.5) * 100);

        try {
            const creationPromise = kazagumo.createPlayer({
                guildId: guild.id,
                voiceId: voiceChannel.id,
                textId: context.channel!.id,
                deaf: true,
                volume: safeVolume,
                nodeName: 'Node - 1',
            });
            pendingPlayerCreations.set(guild.id, creationPromise);
            player = await creationPromise;
            pendingPlayerCreations.delete(guild.id);
            logger.info('music', `Created player for guild ${guild.id} at volume ${savedVolume}%`);
        } catch (e: any) {
            pendingPlayerCreations.delete(guild.id);
            logger.error('music', `Kazagumo createPlayer failed: ${e.stack || e.message}`);
            const embed = new EmbedBuilder().setColor(0x111111).setDescription('Failed to connect to the voice channel (Lavalink node error). Please try again.');
            const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash, true);
            scheduleDeletion(context, msg, isSlash);
            return;
        }
    } else if (player.voiceId !== voiceChannel.id) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You need to be in my voice channel.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash, true);
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    if (player.queue.size >= MAX_QUEUE_SIZE) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription(`Queue limit reached (${MAX_QUEUE_SIZE} tracks). Please clear the queue or wait.`);
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash, true);
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    player.data.set('isSearching', true);
    player.data.set('lastPlayRequestTime', Date.now());

    let searchMessage: any = null;
    if (!isSlash) {
        searchMessage = await sendResponse(context, isSlash, {
            embeds: [new EmbedBuilder().setColor(0x111111).setDescription('Searching...')]
        }, false, false, voiceChannel.id);
    }

    try {
        await resolveAndQueue(activeClient, player, query, user, context, isSlash, searchMessage, kazagumo);
    } catch (err: unknown) {
        logger.error('music', `Play command query resolution error: ${err instanceof Error ? err.message : String(err)}`);
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('An error occurred during search. Please try again.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, true);
        scheduleDeletion(context, msg, isSlash);
    } finally {
        if (player) {
            player.data.delete('isSearching');
        }
    }
}

async function resolveAndQueue(
    client: Client,
    player: KazagumoPlayer,
    query: string,
    user: User,
    context: ChatInputCommandInteraction | Message,
    isSlash: boolean,
    searchMessage: any,
    kazagumo?: Kazagumo
) {
    const kaz = kazagumo || client.kazagumo;
    if (query.includes('spotify.com')) {
        try {
            const url = new URL(query);
            query = `${url.origin}${url.pathname}`;
        } catch {}

        let nativeResult: KazagumoSearchResult | null = null;
        try {
            nativeResult = await kaz.search(query, { requester: safeRequester(user) });
        } catch (e: unknown) {
            logger.error('music', `Spotify native resolution failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (nativeResult && nativeResult.tracks.length > 0) {
            handleResult(client, player, nativeResult, user, context, isSlash, searchMessage);
            return;
        }

        const spotifyInfo = parseSpotifyUrl(query);
        if (spotifyInfo) {
            const loadEmbed = new EmbedBuilder().setColor(0x111111).setDescription(`Loading Spotify ${spotifyInfo.type}...`);
            if (isSlash) await sendResponse(context, isSlash, { embeds: [loadEmbed] }, true);
            else if (searchMessage) await searchMessage.edit({ embeds: [loadEmbed] }).catch(() => null);

            const tracks = await fetchSpotifyTracks(query);
            if (!tracks.length) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('Could not load that Spotify link. Check if it is valid and public.');
                const msg = await sendResponse(context, isSlash, { embeds: [embed] }, isSlash);
                scheduleDeletion(context, msg, isSlash);
                return;
            }

            if (spotifyInfo.type === 'track') {
                await resolveFallbackEngines(client, player, tracks[0].searchQuery, user, context, isSlash, searchMessage, kaz);
            } else {
                await hydrateSpotifyPlaylist(client, player, tracks, user, context, isSlash, searchMessage, kaz);
            }
            return;
        }
    }

    let searchEngine: string | undefined = query.startsWith('http') ? undefined : 'youtube_music';
    let result = await kaz.search(query, { requester: safeRequester(user), engine: searchEngine });

    if (!result || !result.tracks.length) {
        const engines = ['spotify', 'soundcloud'];
        for (const engine of engines) {
            try {
                const backupResult = await kaz.search(query, { requester: safeRequester(user), engine });
                if (backupResult && backupResult.tracks.length) {
                    result = backupResult;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!result || !result.tracks.length) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('Failed to find the track on backup engines.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, true);
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    handleResult(client, player, result, user, context, isSlash, searchMessage);
}

function handleResult(
    client: Client,
    player: KazagumoPlayer,
    result: KazagumoSearchResult,
    user: User,
    context: ChatInputCommandInteraction | Message,
    isSlash: boolean,
    searchMessage: any
) {
    if (result.type === 'PLAYLIST') {
        const availableSlots = MAX_QUEUE_SIZE - player.queue.size;
        const tracksToAdd = result.tracks.slice(0, availableSlots);
        
        for (const track of tracksToAdd) {
            player.queue.add(track);
        }
        const embed = new EmbedBuilder()
            .setColor(0x111111)
            .setDescription(`Loaded playlist with ${tracksToAdd.length} tracks. ${result.tracks.length > availableSlots ? `(Truncated due to queue limit of ${MAX_QUEUE_SIZE})` : ''}`);
        
        if (isSlash) {
            sendResponse(context, isSlash, { embeds: [embed] }, true);
        } else if (searchMessage) {
            searchMessage.edit({ embeds: [embed] }).catch((e: any) => logger.error('music', 'Failed to edit search message (Playlist): ' + e));
        }
    } else {
        const track = result.tracks[0];
        player.queue.add(track);
        const embed = createAddedTrackEmbed(player, track, user, client);

        if (isSlash) {
            sendResponse(context, isSlash, { embeds: [embed] }, true);
        } else if (searchMessage) {
            searchMessage.edit({ embeds: [embed] }).catch((e: any) => logger.error('music', 'Failed to edit search message (Track): ' + e));
        }
    }

    if (!player.playing && !player.paused) {
        player.play();
    }
}

async function resolveFallbackEngines(
    client: Client,
    player: KazagumoPlayer,
    query: string,
    user: User,
    context: ChatInputCommandInteraction | Message,
    isSlash: boolean,
    searchMessage: any,
    kazagumo?: Kazagumo
) {
    const kaz = kazagumo || client.kazagumo;
    let result: KazagumoSearchResult | null = null;
    const backupEngines = ['youtube_music', 'spotify', 'soundcloud'];
    for (const engine of backupEngines) {
        try {
            const backupResult = await kaz.search(query, { requester: safeRequester(user), engine });
            if (backupResult && backupResult.tracks.length) {
                result = backupResult;
                break;
            }
        } catch (e) {}
    }

    if (result && result.tracks.length) {
        handleResult(client, player, result, user, context, isSlash, searchMessage);
    } else {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('Could not resolve Spotify track on YouTube or SoundCloud.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] }, true);
        scheduleDeletion(context, msg, isSlash);
    }
}

async function hydrateSpotifyPlaylist(
    client: Client,
    player: KazagumoPlayer,
    tracks: SpotifyTrackInfo[],
    user: User,
    context: ChatInputCommandInteraction | Message,
    isSlash: boolean,
    searchMessage: any,
    kazagumo?: Kazagumo
) {
    const kaz = kazagumo || client.kazagumo;
    const firstTrack = tracks.shift();
    if (firstTrack) {
        let firstResult = await kaz.search(firstTrack.searchQuery, { requester: safeRequester(user), engine: 'youtube_music' });
        if (!firstResult || !firstResult.tracks.length) {
            firstResult = await kaz.search(firstTrack.searchQuery, { requester: safeRequester(user), engine: 'spotify' });
        }
        if (firstResult && firstResult.tracks.length) {
            player.queue.add(firstResult.tracks[0]);
        }
    }

    if (!player.playing && !player.paused) {
        player.play();
    }

    const availableSlots = MAX_QUEUE_SIZE - player.queue.size;
    const tracksToLoad = tracks.slice(0, availableSlots);

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setDescription(`Loading ${tracksToLoad.length} tracks in the background... ${tracks.length > availableSlots ? `(Truncated to ${MAX_QUEUE_SIZE} limit)` : ''}`);
    
    if (isSlash) await sendResponse(context, isSlash, { embeds: [embed] }, true);
    else if (searchMessage) await searchMessage.edit({ embeds: [embed] }).catch(() => null);

    const abortController = new AbortController();
    player.data.set('hydrationController', abortController);

    (async () => {
        const batchSize = 3;
        const guildId = context.guild!.id;
        for (let i = 0; i < tracksToLoad.length; i += batchSize) {
            if (abortController.signal.aborted || !kaz.players.has(guildId)) {
                logger.info('music', `Hydration aborted for guild ${guildId}.`);
                break;
            }

            const batch = tracksToLoad.slice(i, i + batchSize);
            await Promise.all(batch.map(async (track) => {
                try {
                    if (abortController.signal.aborted || !kaz.players.has(guildId)) return;
                    let result = await kaz.search(track.searchQuery, { requester: safeRequester(user), engine: 'youtube_music' });
                    if (!result || !result.tracks.length) {
                        result = await kaz.search(track.searchQuery, { requester: safeRequester(user), engine: 'spotify' });
                    }
                    if (result && result.tracks.length && kaz.players.has(guildId)) {
                        player.queue.add(result.tracks[0]);
                    }
                } catch (e) {}
            }));
            
            if (i + batchSize < tracksToLoad.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        player.data.delete('hydrationController');
    })();
}

export async function skipTrack(
    client: Client,
    context: ChatInputCommandInteraction | Message,
    user: User,
    isSlash: boolean
) {
    const guildId = context.guild!.id;
    const member = context.member as GuildMember;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must join my voice channel to vote.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const router = getAvailableBot(guildId, voiceChannel.id);
    const player = router ? router.kazagumo.players.get(guildId) : undefined;

    if (!player || !player.queue.current) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('Nothing is playing right now.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    if (player.voiceId !== voiceChannel.id) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You need to be in my voice channel.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const listeners = voiceChannel.members.filter((m) => !m.user.bot).size;
    const currentTrack = player.queue.current;
    const isRequester = (currentTrack.requester as { id: string })?.id === user.id;
    const userIsDJ = await isDJ(member);

    if (isRequester || userIsDJ || listeners <= 2) {
        player.data.set('manualSkip', true);
        player.skip();
        player.data.delete('skipVotes');

        const label = userIsDJ ? ' (DJ privilege)' : isRequester ? ' (requester privilege)' : '';
        const embed = new EmbedBuilder()
            .setColor(0x111111)
            .setDescription(`${currentTrack.title} has been skipped by <@${user.id}>${label}.`);
        
        await sendResponse(context, isSlash, { embeds: [embed] });
        return;
    }

    const required = Math.ceil(listeners / 2);
    let votes = player.data.get('skipVotes') as Set<string>;
    if (!votes) {
        votes = new Set<string>();
        player.data.set('skipVotes', votes);
    }

    if (votes.has(user.id)) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription(`You already voted to skip (${votes.size}/${required}).`);
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    votes.add(user.id);

    if (votes.size >= required) {
        player.data.set('manualSkip', true);
        player.skip();
        player.data.delete('skipVotes');

        const embed = new EmbedBuilder().setColor(0x111111).setDescription(`Skip vote passed. Playing next track.`);
        await sendResponse(context, isSlash, { embeds: [embed] });
    } else {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription(`<@${user.id}> voted to skip (${votes.size}/${required}).`);
        await sendResponse(context, isSlash, { embeds: [embed] });
    }
}

export async function togglePause(
    client: Client,
    context: ChatInputCommandInteraction | Message,
    user: User,
    isSlash: boolean
) {
    const member = context.member as GuildMember;
    if (!(await isDJ(member))) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must have the DJ role to use this command.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must join my voice channel first.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const router = getAvailableBot(context.guild!.id, voiceChannel.id);
    const player = router ? router.kazagumo.players.get(context.guild!.id) : undefined;
    if (!player) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('No active player in this guild.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    player.pause(!player.paused);
    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setDescription(`Playback is now ${player.paused ? 'paused' : 'resumed'}.`);
    await sendResponse(context, isSlash, { embeds: [embed] });
}

export async function stopPlayback(
    client: Client,
    context: ChatInputCommandInteraction | Message,
    user: User,
    isSlash: boolean
) {
    const member = context.member as GuildMember;
    if (!(await isDJ(member))) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must have the DJ role to use this command.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const guildId = context.guild!.id;
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must join my voice channel first.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const router = getAvailableBot(guildId, voiceChannel.id);
    const player = router ? router.kazagumo.players.get(guildId) : undefined;
    if (!player) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('No active player in this guild.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    if (twentyFourSevenGuilds.has(guildId)) {
        twentyFourSevenGuilds.delete(guildId);
    }
    await updateGuildSettings(guildId, { twentyFourSeven: false }).catch(() => {});

    const hydrationController = player.data.get('hydrationController') as AbortController | undefined;
    if (hydrationController) {
        hydrationController.abort();
    }

    player.data.set('intentionalDisconnect', true);
    player.destroy();
    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setDescription('Playback stopped and player disconnected.');
    await sendResponse(context, isSlash, { embeds: [embed] });
}

export async function clearQueue(
    client: Client,
    context: ChatInputCommandInteraction | Message,
    user: User,
    isSlash: boolean
) {
    const member = context.member as GuildMember;
    if (!(await isDJ(member))) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must have the DJ role to use this command.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must join my voice channel first.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const router = getAvailableBot(context.guild!.id, voiceChannel.id);
    const player = router ? router.kazagumo.players.get(context.guild!.id) : undefined;
    if (!player) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('No active player in this guild.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    if (player.queue.size === 0) {
        const embed = new EmbedBuilder().setColor(0x111111).setDescription('The queue is already empty.');
        const msg = await sendResponse(context, isSlash, { embeds: [embed] });
        scheduleDeletion(context, msg, isSlash);
        return;
    }

    const count = player.queue.size;
    
    const hydrationController = player.data.get('hydrationController') as AbortController | undefined;
    if (hydrationController) {
        hydrationController.abort();
    }

    player.queue.clear();
    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setDescription(`Cleared ${count} tracks from the queue.`);
    await sendResponse(context, isSlash, { embeds: [embed] });
}
