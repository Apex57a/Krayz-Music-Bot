# Changelog

All notable changes to Krayz Music are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), because structure is nice when you are trying to figure out what broke after an update.

## [1.0.4-BETA] - 2026-07-13

This release strips out the local audio download system, overhauls the server logging module, and fixes the track skip delay that plagued Spotify playlists. If you are upgrading from 1.0.3, rebuild everything and delete your `cache/metadata_l3.json` file.

### Added

- **Advanced audit logging** (`src/utils/loggerService.ts`). A full rewrite of the event logging system. Now covers: message delete (with native attachment re-upload), message edit (with unfurl detection so link previews don't trigger false edits), bulk delete / purge (generates a `.txt` transcript file named `purge-username-timestamp-count.txt`), member join/leave, kicks, bans/unbans, role changes, nickname changes, timeouts, server mute/deafen, channel create/delete, and voice state changes. Every moderation action pulls the executor from the audit log so you can see *who* did it, not just what happened.
- **Attachment rendering inside embeds**. When a deleted message had an image, GIF, or video, the bot now downloads the file, re-uploads it, and sets it as the embed's image using Discord's `attachment://` protocol. The attachment shows up inside the log embed instead of floating above it as a separate file. Files are sanitized, renamed, and deleted from disk immediately after upload.
- **`/setup-logs` command**. Lets admins configure the log channel per server without editing the database manually.
- **Pre-resolve skip optimization** (`preResolveNextTracks` in `music.ts`). While a track is playing, the bot silently asks Lavalink to resolve the stream URLs for the next 2-3 tracks in the queue. When someone skips, the next track starts instantly instead of waiting 2-4 seconds for resolution. Called automatically on every `playerStart` event and during Spotify playlist hydration.
- **YouTube cookie authentication** (`config.ts`). Support for a `YOUTUBE_COOKIES_FILE` environment variable pointing to a Netscape-format cookies file. Passed to the Lavalink YouTube plugin to bypass "sign in to confirm you're not a bot" blocks on restricted content.

### Changed

- **Dropped local audio caching entirely**. The `cacheManager.ts` download system (`downloadAndCache`, `cacheTrackAudio`, `preCacheNextTracks`) has been removed. Lavalink already streams audio with 20-second pre-buffering and maximum Opus encoding quality, so downloading tracks locally was redundant overhead that added disk I/O, introduced buffering during downloads, and created a dependency on `yt-dlp` that required constant maintenance to keep working against YouTube's bot detection. The `cache/` directory is now used only for metadata.
- **Disk cache no longer stores search results**. `KazagumoSearchResult` objects contain class instances (`KazagumoTrack`) that lose their prototype chain when serialized to JSON. Previously, these were written to `cache/metadata_l3.json` and loaded on restart as plain objects, which crashed playback with `setKazagumo is not a function` the moment the bot tried to play a cached track. Search results now live in L1 memory only and expire with the process. Metadata that actually serializes cleanly (Spotify track info, etc.) still persists to disk.
- **`loggerService.ts` import cleanup**. Removed unused `Collection` import. Added `path` module usage for attachment extension detection.

### Fixed

- **`setKazagumo is not a function` crash on skip**. Root cause: the disk cache (`metadata_l3.json`) stored `KazagumoSearchResult` objects from previous sessions. On restart, these loaded as plain JSON objects without the `KazagumoTrack` prototype. When the player called `track.setKazagumo()` during playback, it threw because the method did not exist on the deserialized object. Fixed by excluding any object with a `tracks` array from L3 disk persistence.
- **Skip delay on Spotify playlists**. When skipping a track from a Spotify playlist, the bot had to resolve the next track's YouTube stream URL before it could start playing. This took 2-4 seconds. The pre-resolver now handles this in the background so the next track is ready before the user even thinks about skipping.
- **Attachment logs showing CDN links instead of rendered media**. Images and GIFs sent in deleted messages were logged as clickable URLs or separate file uploads instead of rendering inside the embed. Fixed by using `embed.setImage('attachment://filename.ext')` to embed the first image directly.

### Removed

- `cacheTrackAudio()` function from `music.ts`.
- `preCacheNextTracks()` function from `music.ts`.
- `downloadAndCache` import from `music.ts`.
- All `cacheTrackAudio` calls from `hydrateSpotifyPlaylist`.
- All `preCacheNextTracks` calls from `playerStart.ts` and the hydration loop (replaced by `preResolveNextTracks`).

### Upcoming

- Pokemon minigame. Details TBD.

---

## [1.0.3] - 2026-07-10

This release is a full architectural overhaul. The command system, caching, and error handling were rewritten from scratch. If you are upgrading from 1.0.2, rebuild everything (`npm run build`) and restart both the bot and Lavalink.

### Added

- **Middleware system** (`src/utils/middlewares.ts`). Every music command now goes through `withPlayerGuard`, which handles DJ verification, voice channel presence, action locking (prevents skip + stop firing at the same time and leaving the player in a corrupted state), and player lookup. Commands used to do all of this inline. Now they do not. This removed roughly 400 lines of copy-pasted boilerplate, which is 400 lines that can no longer go out of sync with each other.
- **CommandContext** (`src/utils/context.ts`). A wrapper that normalizes prefix commands (`Message`) and slash commands (`ChatInputCommandInteraction`) into a single interface. Commands no longer need two separate code paths. Write the logic once, call it from both.
- **Centralized player creation** (`getOrCreatePlayer` in `music.ts`). Uses a global `pendingPlayerCreations` lock so that two concurrent `!p` commands in the same guild cannot both try to create a player. The second command waits for the first to finish, then reuses the result. Before this, the second command would throw a "player already exists" error, which is the kind of bug that only shows up when two people are excited about the same song.
- **Bot pool registry** (`src/utils/botPool.ts`). A `Map` of all Discord clients indexed by label. Replaces the old `require('../index')` pattern that caused circular dependency headaches.
- **Metadata cache** (`src/utils/cacheLayer.ts`). Two-tier cache. L1 is an in-memory `Map` for any object type. L3 is a JSON file on disk that survives restarts. Only serializable data goes to L3 (Kazagumo search results have circular references and will blow up `JSON.stringify`, which is exactly what happened before this fix). The disk file syncs every 5 minutes using atomic writes. Default TTL is 48 hours. Expired entries are swept hourly.
- **Dedicated music channel enforcement**. Server admins can now restrict music commands to a single channel via `/settings`. Prefix commands sent elsewhere are deleted with a 7-second warning. Slash commands get an ephemeral redirect. This keeps general chat clean.
- **`getTrackDisplayUri` helper** (`src/utils/helpers.ts`). Returns the original YouTube/Spotify URL instead of the local cache path. Used in every embed that shows a track link, because showing users `file://D:\cache\pIWaVJPl0-c.flac` as a clickable link is the kind of thing that makes a bot look like it was written by someone who has never tested their own product.
- **`guildDelete` event handler**. Cleans up the settings cache when the bot gets removed from a server. Before this, the cache held stale entries for servers the bot was no longer in.
- **Environment validation** (`validateEnv()` in `config.ts`). Checks all required environment variables on startup and logs a clear error for each missing one. Exits with code 1 instead of crashing three seconds later with an unhelpful TypeError.
- **Worker token discovery rewrite**. Config now scans all env keys matching `WORKER_TOKEN_<N>` instead of looping from 1 to 50 and stopping at the first gap. Supports non-sequential numbering. Detects and skips duplicate tokens.
- **Stale player cleanup** (`index.ts`). Runs every 5 minutes. Finds players whose `voiceId` does not match the bot's actual voice state (orphaned by gateway disconnects or Discord being Discord) and destroys them.
- **Shutdown lock** (`index.ts`). Prevents the shutdown handler from running twice when multiple SIGINT/SIGTERM signals arrive. Which happens more often than you would think on shared hosting.
- **System diagnostics** in `/own`. Memory usage (RSS, heap, external, array buffers), process info (Node.js version, PID, formatted uptime), bot pool status (each client's username, ready state, WebSocket ping, guild count, player count), Lavalink node health (connection state, active players, node uptime), database cache size, and bot version. Everything you need to debug a problem without SSH access.
- **Maintenance reason** in `/own`. The owner can set a custom maintenance message via a modal instead of just toggling it on and off.
- **Health checks** in `botRouter.ts`. The bot router now filters out clients that are not ready or have no connected Shoukaku nodes. Before this, it could assign a play request to a client whose Lavalink connection had died, which resulted in a silent failure.

### Changed

- Refactored all music commands (`skip.ts`, `stop.ts`, `pause.ts`, `clear.ts`, `queue.ts`, `nowplaying.ts`, `247.ts`) to use `CommandContext` and `withPlayerGuard`. Each command went from 60-100 lines to 15-30.
- Replaced `any` types across `database.ts`, `spotify.ts`, and `stateManager.ts` with strict TypeScript interfaces.
- All `fetch()` calls in `spotify.ts` now go through `fetchWithRetry`, which handles HTTP 429 (respects `Retry-After`), HTTP 5xx (exponential backoff), and network errors.
- `parseSpotifyUrl` now validates the hostname. Only `open.spotify.com` is accepted.
- State manager writes atomically (temp file + rename), includes a version number and timestamp, rejects state files older than 24 hours, and handles backwards-compatible migration from the old `{kazA, kazB}` format.
- Logger accepts an optional metadata object and redacts sensitive fields automatically.

### Fixed

- **URI leak in embeds.** The "Now Playing" embed in `playerStart.ts` and the `/nowplaying` command were displaying the local cache path (`file://D:\...\cache\pIWaVJPl0-c.flac`) instead of the original YouTube URL. This happened because `track.uri` gets overwritten when the audio is downloaded locally, and nobody was reading `originalUri` in the embed code. Fixed by introducing `getTrackDisplayUri` and using it everywhere.
- **L3 cache crash.** The disk cache sync was blowing up with `RangeError: Maximum call stack size exceeded` because Kazagumo search results have circular references. `JSON.stringify` does not appreciate that. Fixed by testing serializability before writing to L3.
- **Memory leak in the search cache.** The old `Map` in `music.ts` was swept every 10 minutes but could grow unbounded between sweeps. Replaced with `cacheLayer.ts` which has proper TTL tracking and hourly sweeps.
- **Memory leak in `playerUpdate.ts`.** An unused state tracking map was never cleaned up on player disconnect.
- **Unhandled rejection in `hydrateSpotifyPlaylist`.** The background hydration loop could throw without a `.catch()`.

### Removed

- ~400 lines of duplicated DJ check, voice channel check, and player lookup boilerplate.
- Circular `require('../index')` imports (replaced by `botPool.ts`).
- The standalone search cache `Map` and its sweeper interval (replaced by `cacheLayer.ts`).

---

## [1.0.2] - 2026-06-15

### Added

- Multi-bot worker pooling. Two discord.js clients can now serve the same guild in different voice channels.
- Kazagumo and Shoukaku integration for Lavalink player management.
- Spotify metadata scraping via the embed page (`__NEXT_DATA__`), with API fallback using client credentials.
- Local audio caching via youtube-dl. Tracks downloaded as FLAC and served from disk on repeat plays.
- 24/7 mode with database persistence.
- Vote-to-skip with DJ override.
- 30-second idle disconnect (unless 24/7 is on).
- State save/restore on shutdown and startup.

### Fixed

- Audio stutters caused by Lavalink under-buffering. Increased `bufferDurationMs` to 20000 and `frameBufferDurationMs` to 15000.

---

## [1.0.1] - 2026-05-20

### Added

- Slash command support alongside prefix commands.
- Per-guild settings (DJ role, volume) stored in MySQL.
- Server approval system.
- Internal logging service (posts command executions to a Discord channel).

---

## [1.0.0] - 2026-04-01

### Added

- Initial release. Single-bot, prefix-only. Play, skip, stop, pause, queue, nowplaying. YouTube search via Lavalink. It worked. Mostly.
