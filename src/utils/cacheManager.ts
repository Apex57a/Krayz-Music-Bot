import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { logger } from './logger';

const cacheDir = path.join(process.cwd(), 'cache');

if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

const downloadLocks = new Map<string, Promise<string>>();

export async function downloadAndCache(url: string, trackId: string): Promise<string> {
    const safeId = trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(cacheDir, `${safeId}.flac`);

    if (fs.existsSync(filePath)) {
        return filePath;
    }

    if (downloadLocks.has(safeId)) {
        return downloadLocks.get(safeId)!;
    }

    const downloadPromise = (async () => {
        try {
            const options: Record<string, unknown> = {
                extractAudio: true,
                audioFormat: 'flac',
                audioQuality: '0', // 0 is best
                output: filePath,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                ffmpegLocation: ffmpegPath || undefined,
                extractorArgs: 'youtube:player_client=android,web', // Bypass web client bot blocks
                addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0']
            };

            // Import config here to avoid circular dependency issues if any
            const { config } = require('../config');
            if (config.youtube.cookiesFile && fs.existsSync(config.youtube.cookiesFile)) {
                options.cookies = config.youtube.cookiesFile;
            }

            await youtubedl(url, options);
            return filePath;
        } catch (e: unknown) {
            logger.error('cacheManager', `Youtube-dl execution failed: ${e instanceof Error ? e.message : String(e)}`);
            throw e;
        } finally {
            downloadLocks.delete(safeId);
        }
    })();

    downloadLocks.set(safeId, downloadPromise);
    return downloadPromise;
}

export function cleanupCache(): void {
    try {
        if (!fs.existsSync(cacheDir)) return;
        const files = fs.readdirSync(cacheDir);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;
        const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB limit
        const TARGET_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // Drop to 4GB when exceeded

        let totalSize = 0;
        const fileStats: { path: string, mtime: number, size: number, name: string }[] = [];

        // Pass 1: Delete files older than 24h and stat remaining files
        for (const file of files) {
            const filePath = path.join(cacheDir, file);
            const stats = fs.statSync(filePath);
            
            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
                logger.info('cacheManager', `Deleted old cache file: ${file} (age limit)`);
            } else {
                fileStats.push({ path: filePath, mtime: stats.mtimeMs, size: stats.size, name: file });
                totalSize += stats.size;
            }
        }

        // Pass 2: Size limit enforcement
        if (totalSize > MAX_SIZE_BYTES) {
            logger.info('cacheManager', `Cache size (${(totalSize / 1024 / 1024 / 1024).toFixed(2)}GB) exceeds 5GB limit. Starting size eviction...`);
            fileStats.sort((a, b) => a.mtime - b.mtime); // Oldest first
            
            for (const file of fileStats) {
                if (totalSize <= TARGET_SIZE_BYTES) break;
                
                try {
                    fs.unlinkSync(file.path);
                    totalSize -= file.size;
                    logger.info('cacheManager', `Deleted cache file: ${file.name} (size eviction)`);
                } catch (e) {
                    logger.error('cacheManager', `Failed to delete file during size eviction: ${file.path}`);
                }
            }
        }
    } catch (e: unknown) {
        logger.error('cacheManager', `Cache cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

setInterval(cleanupCache, 6 * 60 * 60 * 1000);
