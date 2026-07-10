// Spotify track resolution via embed page scraping
// The official API blocks track data for client-credentials on most playlists.
// The embed page always includes track data in __NEXT_DATA__.

import { config } from '../config';
import { logger } from './logger';

const FETCH_TIMEOUT_MS = 15_000;

export interface SpotifyTrackInfo {
    name: string;
    artist: string;
    searchQuery: string;
}

export function parseSpotifyUrl(url: string): { type: 'track' | 'playlist' | 'album'; id: string } | null {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'open.spotify.com') return null;
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
            const type = parts[parts.length - 2] as 'track' | 'playlist' | 'album';
            if (['track', 'playlist', 'album'].includes(type)) {
                return { type, id: parts[parts.length - 1] };
            }
        }
    } catch {}
    return null;
}

const MAX_RETRIES = 2;

/**
 * Wrapper around fetch with automatic retry logic.
 * - HTTP 429: waits Retry-After seconds (capped at 10s), then retries
 * - HTTP 5xx: exponential backoff (1s, 2s)
 * - Network errors (fetch throws): retries once after 1s
 * - Success or 4xx (except 429): returns immediately
 */
async function fetchWithRetry(
    input: string | URL | Request,
    init?: RequestInit,
): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(input, {
                ...init,
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });

            // Success or non-retryable 4xx — return immediately
            if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
                return res;
            }

            // HTTP 429 — rate limited
            if (res.status === 429) {
                if (attempt < MAX_RETRIES) {
                    const retryAfter = Math.min(
                        parseInt(res.headers.get('Retry-After') || '1', 10),
                        10,
                    );
                    logger.warn('spotify', `Rate limited (429), retrying after ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await sleep(retryAfter * 1000);
                    continue;
                }
                return res;
            }

            // HTTP 5xx — server error, exponential backoff
            if (res.status >= 500) {
                if (attempt < MAX_RETRIES) {
                    const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s
                    logger.warn('spotify', `Server error (${res.status}), retrying after ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await sleep(backoff);
                    continue;
                }
                return res;
            }

            return res;
        } catch (err) {
            lastError = err;
            // Network error — retry once after 1s
            if (attempt < MAX_RETRIES) {
                logger.warn('spotify', `Network error, retrying after 1s (attempt ${attempt + 1}/${MAX_RETRIES}): ${err instanceof Error ? err.message : String(err)}`);
                await sleep(1000);
                continue;
            }
        }
    }

    throw lastError;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeEmbedTracks(type: string, id: string): Promise<SpotifyTrackInfo[]> {
    const url = `https://open.spotify.com/embed/${type}/${id}`;
    const res = await fetchWithRetry(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
    });

    if (!res.ok) {
        logger.error('spotify', `Embed fetch failed: ${res.status}`);
        return [];
    }

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
    if (!match) {
        logger.error('spotify', 'No __NEXT_DATA__ found in embed page');
        return [];
    }

    try {
        const data = JSON.parse(match[1]);
        const entity = data?.props?.pageProps?.state?.data?.entity;

        if (!entity) {
            logger.error('spotify', 'No entity found in embed data');
            return [];
        }

        // Single track
        if (type === 'track') {
            const name = entity.name || entity.title || 'Unknown';
            const artist = entity.artists?.map((a: any) => a.name).join(', ')
                || entity.subtitle || 'Unknown';
            return [{ name, artist, searchQuery: `${name} ${artist}` }];
        }

        // Playlist or album — tracks are in trackList
        const trackList = entity.trackList || [];
        return trackList.map((t: any) => {
            const name = t.title || t.name || 'Unknown';
            const artist = t.subtitle || t.artist || 'Unknown';
            return { name, artist, searchQuery: `${name} ${artist}` };
        });
    } catch (err) {
        logger.error('spotify', `Failed to parse embed data: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }
}

// Fallback: use the official API with client credentials
// Works for single tracks and some playlists
interface SpotifyToken {
    accessToken: string;
    expiresAt: number;
}

let cachedToken: SpotifyToken | null = null;

const SPOTIFY_CLIENT_ID = config.spotify.clientId;
const SPOTIFY_CLIENT_SECRET = config.spotify.clientSecret;

export async function getSpotifyToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.accessToken;
    }

    const response = await fetchWithRetry('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
        },
        body: 'grant_type=client_credentials',
    });

interface SpotifyTokenResponse { access_token: string; expires_in: number; }

    if (!response.ok) throw new Error(`Spotify token error: ${response.status}`);

    const data = await response.json() as SpotifyTokenResponse;
    cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return cachedToken.accessToken;
}

interface SpotifyArtist { name: string; }
interface SpotifyTrackResponse { name: string; artists?: SpotifyArtist[]; }
interface SpotifyPlaylistResponse { tracks?: { items: { track?: SpotifyTrackResponse, name?: string, artists?: SpotifyArtist[] }[] }; }

async function apiFallback(type: string, id: string): Promise<SpotifyTrackInfo[]> {
    try {
        const token = await getSpotifyToken();
        const headers = { Authorization: `Bearer ${token}` };

        if (type === 'track') {
            const res = await fetchWithRetry(`https://api.spotify.com/v1/tracks/${id}?market=US`, {
                headers,
            });
            if (!res.ok) return [];
            const track = await res.json() as SpotifyTrackResponse;
            const artist = track.artists?.map(a => a.name).join(', ') || 'Unknown';
            return [{ name: track.name, artist, searchQuery: `${track.name} ${artist}` }];
        }

        // Playlists and albums via API (may 403)
        const endpoint = type === 'playlist'
            ? `https://api.spotify.com/v1/playlists/${id}?market=US`
            : `https://api.spotify.com/v1/albums/${id}?market=US`;

        const res = await fetchWithRetry(endpoint, {
            headers,
        });
        if (!res.ok) return [];
        const data = await res.json() as SpotifyPlaylistResponse;

        const items = data.tracks?.items || [];
        return items.map(item => {
            const t = item.track || item;
            const name = t.name || 'Unknown';
            const artist = t.artists?.map((a: any) => a.name).join(', ') || 'Unknown';
            return { name, artist, searchQuery: `${name} ${artist}` };
        }).filter((t: SpotifyTrackInfo) => t.name !== 'Unknown');
    } catch (err) {
        logger.error('spotify', `API fallback failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
    }
}

export async function fetchSpotifyTracks(url: string): Promise<SpotifyTrackInfo[]> {
    const parsed = parseSpotifyUrl(url);
    if (!parsed) return [];

    // Primary: scrape embed page (works for everything)
    logger.info('spotify', `Fetching ${parsed.type}/${parsed.id} via embed scrape...`);
    let tracks = await scrapeEmbedTracks(parsed.type, parsed.id);

    if (tracks.length > 0) {
        logger.info('spotify', `Got ${tracks.length} tracks from embed`);
        return tracks;
    }

    // Fallback: official API (may 403 for playlists)
    logger.info('spotify', `Embed failed, trying API fallback...`);
    tracks = await apiFallback(parsed.type, parsed.id);
    logger.info('spotify', `API fallback got ${tracks.length} tracks`);
    return tracks;
}

interface SpotifySearchResponse { tracks?: { items: { id: string }[] }; }

export async function resolveSpotifyId(query: string): Promise<string | null> {
    try {
        const token = await getSpotifyToken();
        const res = await fetchWithRetry(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1&market=US`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json() as SpotifySearchResponse;
        if (data.tracks?.items && data.tracks.items.length > 0) {
            return data.tracks.items[0].id;
        }
    } catch (_e) {}
    return null;
}
