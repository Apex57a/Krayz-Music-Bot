import { EmbedBuilder } from 'discord.js';
import { KazagumoTrack } from 'kazagumo';

// Shared utility functions for the bot

/**
 * Returns the original public URL for a track, falling back to the
 * (possibly cache-rewritten) uri. Every embed that displays a track
 * link should call this instead of reading track.uri directly.
 */
export function getTrackDisplayUri(track: KazagumoTrack): string {
    return (track as any).originalUri || track.uri || '';
}

export function formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseTimeToMs(time: string): number | null {
    const parts = time.split(':').map(Number);
    if (parts.some(isNaN)) return null;

    if (parts.length === 2) {
        return (parts[0] * 60 + parts[1]) * 1000;
    } else if (parts.length === 3) {
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    return null;
}

export function createAddedTrackEmbed(player: any, track: any, user: any, activeClient?: any): EmbedBuilder {
    let estimatedMs = 0;
    if (player.queue.current) {
        estimatedMs += Math.max(0, (player.queue.current.length || 0) - player.position);
    }
    const queueTracks = [...player.queue];
    // Sum length of all tracks in queue except the last one (which is the newly added track)
    for (let i = 0; i < queueTracks.length - 1; i++) {
        estimatedMs += queueTracks[i].length || 0;
    }

    const positionInUpcoming = player.queue.size === 1 ? 'Next' : String(player.queue.size);
    const positionInQueue = String(player.queue.size);

    const displayUri = getTrackDisplayUri(track);

    const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle('Track Added')
        .setThumbnail(track.thumbnail || null)
        .addFields(
            { name: 'Track', value: `[${track.title}](${displayUri}) by ${track.author || 'Unknown'}` },
            { name: 'Estimated time until played', value: formatDuration(estimatedMs), inline: true },
            { name: 'Track Length', value: formatDuration(track.length || 0), inline: true },
            { name: 'Position in upcoming', value: positionInUpcoming, inline: true },
            { name: 'Position in queue', value: positionInQueue, inline: true }
        )
        .setFooter({ text: `Requested by ${user.username}` });

    return embed;
}

/**
 * Strips Discord markdown injection patterns and truncates to a safe length.
 * Removes triple backticks, @everyone, and @here mentions.
 */
export function sanitizeEmbed(text: string, maxLength = 1024): string {
    let cleaned = text
        .replace(/```/g, '')
        .replace(/@everyone/gi, '@\u200Beveryone')
        .replace(/@here/gi, '@\u200Bhere');

    if (cleaned.length > maxLength) {
        cleaned = cleaned.slice(0, maxLength - 3) + '...';
    }
    return cleaned;
}

/**
 * Truncates text to a maximum length, appending '...' if exceeded.
 */
export function truncateField(text: string, maxLength = 256): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}

