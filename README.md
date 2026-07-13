# Krayz Music

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue?style=flat-square&logo=discord)](https://discord.js.org)
[![Lavalink](https://img.shields.io/badge/Lavalink-v4-purple?style=flat-square)](https://github.com/lavalink-devs/Lavalink)
[![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)](LICENSE)

Krayz is a privately hosted Discord music bot. It plays audio in voice channels. That is what it does, and it does it without crashing every fifteen minutes, which already puts it ahead of most open-source alternatives.

The entire system is written in TypeScript and runs on discord.js v14, Lavalink v4, and a MySQL database. It is not a general-purpose Discord bot. There are no economy commands, no leveling systems, no reaction roles, and no plans to add any of that. If you are looking for a bot that does everything poorly, look elsewhere.

## Table of contents

- [Why this exists](#why-this-exists)
- [Architecture overview](#architecture-overview)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the bot](#running-the-bot)
- [Commands](#commands)
- [Caching and metadata](#caching-and-metadata)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Upcoming](#upcoming)
- [Support policy](#support-policy)
- [Credits and attribution](#credits-and-attribution)
- [License](#license)

## Why this exists

Most Discord music bots are either dead (Groovy, Rythm), rate-limited into uselessness, or written by someone who learned JavaScript last Thursday. Krayz exists because the author got tired of every publicly hosted music bot dropping connections, buffering for ten seconds before each track, and dying whenever YouTube changed a query parameter.

This is not a weekend project. It is a production system that runs 24/7 on shared hosting with 1 GB of RAM and 10 GB of NVMe storage, and it stays connected through Lavalink restarts, process crashes, and the occasional server migration. If you want to run it yourself, you need to know what you are doing. If you do not know what a Lavalink node is, start there.

## Architecture overview

Krayz runs a multi-client bot pool. A primary discord.js client and any number of worker clients log into Discord simultaneously. When a user requests playback, the bot router checks which client is available in that guild and assigns it to the voice session. The user never knows which client is handling their audio. This lets the bot serve multiple voice channels in the same guild without hitting Discord's one-bot-per-channel restriction.

The routing logic lives in `botRouter.ts`. It checks three things in order: is there already a player in this guild (reuse that client), is the user in a channel that a client already occupies (use that one), or is there a free client with at least one healthy Lavalink node (assign it). If every client is occupied in different channels in the same guild, it tells the user to wait. Nobody gets a half-initialized player or a silent voice connection.

All database access goes through an in-memory cache backed by MySQL. On boot, the bot loads every guild's settings into a `Map`. When a setting changes, the bot writes to MySQL and updates the map at the same time. During normal command execution, the database is never queried directly. This means the bot's response time to commands is limited by Discord's API latency, not by database I/O.

State preservation is handled by a `stateManager` that hooks into process exit signals. When the bot shuts down (or gets killed by PM2, or the hosting panel restarts the container), it serializes the current playback positions, queue contents, and player configurations to a JSON file on disk. On the next boot, it reads that file, recreates the Lavalink players, and seeks each track back to the exact millisecond where it stopped. If you restart the bot mid-song, your listeners will hear a brief pause and then the song picks up where it left off. The state file includes a version number and a timestamp. Files older than 24 hours are ignored because nobody wants to hear what was playing yesterday.

Every music command goes through `withPlayerGuard`, a middleware function that handles DJ role verification, voice channel presence checks, action locking (so two people cannot skip and stop at the same time and leave the player in a corrupted state), and player lookup. Commands themselves are typically 15-30 lines of actual logic. The middleware does the boring stuff.

```
User Command
    |
    v
CommandContext (normalizes slash + prefix)
    |
    v
withPlayerGuard (DJ check, voice check, action lock, player lookup)
    |
    v
music.ts (playTrack, skipTrack, stopPlayback, clearQueue, togglePause)
    |
    +--> botRouter.ts (assigns a client from the pool)
    +--> cacheLayer.ts (L1 memory + L3 disk metadata cache)
    +--> spotify.ts (embed scraping + API fallback)
    |
    v
Kazagumo / Shoukaku --> Lavalink --> Discord Voice
```

## Features

### Multi-bot worker pooling

The `botRouter.ts` module manages a pool of Discord clients. The primary client handles all command interactions and guild management. Worker clients carry their own Lavalink connections and join voice channels independently. Add as many workers as you want by setting `WORKER_TOKEN_1`, `WORKER_TOKEN_2`, etc. in your `.env`. The numbering does not need to be sequential because the discovery logic scans all environment keys matching the pattern instead of iterating from 1 to 50 and stopping at the first gap. The legacy `WORKER_TOKEN` (no suffix) still works for single-worker setups, and duplicate tokens are detected and skipped with a console warning.

#### Lavalink-native audio streaming

All audio playback is handled by Lavalink with no local downloads. The Lavalink server is configured with a 20-second audio pre-buffer, maximum Opus encoding quality (10), `HIGH` resampling quality, and Koe high-priority UDP packets. This setup absorbs network jitter and delivers consistent playback without the overhead of downloading files, managing disk space, or fighting YouTube's bot detection on every `yt-dlp` invocation.

Earlier versions of the bot downloaded tracks as FLAC files to a local `cache/` directory. That system was removed in v1.0.4 because Lavalink's streaming pipeline already handles buffering, encoding, and delivery. The download layer added disk I/O latency, created a `yt-dlp` maintenance burden, and caused skip delays when the bot had to finish writing a file before playing the next track.

### Pre-resolved track skipping

While a track is playing, the bot silently asks Lavalink to resolve the stream URLs for the next 2-3 tracks in the queue. When someone skips, the next track starts without any resolution delay. This runs automatically on every `playerStart` event and during Spotify playlist hydration.

### Metadata caching

Search results, Spotify metadata, and track resolution lookups are cached in a two-tier system inside `cacheLayer.ts`:

- **L1 (memory)**: An in-memory `Map` that holds any object type, including Kazagumo search results with class instances that cannot survive JSON serialization. Fast, but gone when the process dies.
- **L3 (disk)**: A JSON file at `cache/metadata_l3.json` that is synced every 5 minutes using atomic writes (write to a temp file, then rename). Only data that survives `JSON.stringify` *and* does not contain a `tracks` array goes to L3. Search results stay in L1 only because `KazagumoTrack` instances lose their prototype chain through serialization, which causes `setKazagumo is not a function` crashes if they get loaded back from disk.

Expired entries are swept hourly. Default TTL is 48 hours.

### Session recovery

Most bots lose their queue when they restart. Krayz does not. The `stateManager` serializes the full player state (current track, seek position, queue, volume, loop mode) to disk on shutdown. On startup, it reads the file, creates fresh Lavalink players, injects the saved queues, and seeks to the exact position. The state file is deleted after a successful restore so it cannot accidentally replay stale data on the next boot.

### 24/7 mode

Guilds can enable persistent voice presence. The bot joins a voice channel and stays there indefinitely, surviving restarts, empty channels, and Lavalink reconnections. The setting is stored per-guild in MySQL and restored on boot via `load247FromDB()`. When 24/7 mode is off, the bot waits 30 seconds after the queue empties before disconnecting. Running `/stop` disables 24/7 mode for that guild.

### Forced disconnect protection

If someone with administrator permissions drags the bot out of a voice channel, the bot detects the forced disconnect through the `voiceStateUpdate` event. It saves the current playback state (track, position, queue), destroys the corrupted player, waits two seconds for Discord's gateway to settle, creates a fresh player in the same channel, and resumes playback. The user hears a brief interruption and the music continues. This is the kind of feature that sounds unnecessary until an admin accidentally clicks the wrong button and kills your 50-track queue.

### Multi-source playback

Krayz resolves audio from YouTube, YouTube Music, Spotify (tracks, albums, and playlists), SoundCloud, Bandcamp, Twitch, and Vimeo. Spotify resolution works by scraping the embed page for track metadata and then searching the resolved titles on YouTube Music through Lavalink. If the embed scrape fails, the bot falls back to the official Spotify API with client credentials. All external HTTP requests use `fetchWithRetry`, which handles HTTP 429 (respects `Retry-After`, capped at 10 seconds), HTTP 5xx (exponential backoff), and network errors (one retry after 1 second). The hostname is validated to prevent someone from passing a crafted URL and making the bot fetch arbitrary domains.

### Dedicated music channels

Server admins can restrict music commands to a single text channel via `/settings`. When configured, prefix commands sent outside the designated channel are silently deleted and the user gets a 7-second warning. Slash commands get an ephemeral redirect. This keeps your general chat clean instead of turning it into a wall of "Now Playing" embeds that nobody asked for.

### DJ role enforcement

Guilds can designate a DJ role through `/settings`. When set, music control commands (play, skip, stop, pause, 24/7) require the user to have that role or server administrator permissions. The skip command has an exception: if you requested the currently playing track, or you are the only non-bot listener in the channel, you can skip without the DJ role. Everyone else votes. A majority of listeners must agree before the skip goes through. This prevents the one person who hates your music from ruining it for everyone else.

### Guild approval system

The bot will not respond to commands in a guild until the owner explicitly approves it via `/setup`. This prevents random servers from adding the bot and consuming resources on a shared hosting plan with 1 GB of RAM. The approval state is stored in MySQL and checked on every command invocation.

### Maintenance mode

The bot owner can enable maintenance mode globally or per-guild, with an optional custom reason message. When active, all commands except owner commands return a maintenance message. This lets the owner deploy updates or debug issues without random users spamming commands into a half-initialized bot.

### Per-guild volume persistence

Volume settings are saved per-guild to the database. When a player is created (whether from a play command, a 24/7 reconnection, or a state restore), the bot reads the guild's saved volume and applies it. The volume formula uses a perceptual curve (`Math.pow(linear / 100, 1.5) * 100`) so that the slider feels more natural at low volumes instead of jumping from silent to loud at 10%.

### Server audit logging

The logging service (`loggerService.ts`) monitors Discord events and posts formatted embeds to a configured log channel. Covered events: message delete (with native attachment re-upload inside the embed), message edit (with unfurl detection), bulk delete (generates a text transcript), member join/leave, kicks, bans/unbans, role changes, nickname changes, timeouts, server mute/deafen, channel create/delete, and voice state changes. Every moderation action pulls the executor from the audit log. Admins configure the log channel with `/setup-logs`.

### Stale player cleanup

A background interval runs every 5 minutes and checks for players whose `voiceId` no longer matches the bot's actual voice state. These orphaned players (left behind by gateway disconnects, race conditions, or Discord being Discord) are destroyed automatically. Without this, the bot accumulates ghost players that hold Lavalink resources and block the bot router from assigning new sessions.

### Structured logging

All diagnostic output goes through a pino-based structured logger. No `console.log` calls. Sensitive fields (`token`, `password`, `secret`, `authorization`) are automatically redacted in log output. Log functions accept an optional metadata object for structured context. The internal logging service can also post command executions to a configured Discord channel as formatted embeds.

## Requirements

You need all of the following. Not some. All.

- **Node.js 18 or later.** The bot uses ES2022 features and native APIs that do not exist in older versions. If you are running Node 16, upgrade.
- **MySQL 8 or a compatible fork.** MariaDB works. TiDB Cloud works. Anything that supports InnoDB and parameterized queries works.
- **Java 17 or later.** Required to run the Lavalink server. If you do not know what Java is, this project is not for you.
- **A running Lavalink v4 node** with the `youtube-plugin` (v1.18.1) and `lavasrc-plugin` (v4.8.2). The bot does not include a Lavalink binary. You must host and configure your own. An example configuration is provided in `lavalink/application.example.yml`.
- **A Discord bot application** with the Message Content privileged intent enabled. Without it, prefix commands silently fail and you will spend an hour wondering why `!p` does nothing.
- **A Spotify developer application** (optional). Required only if you want Spotify link resolution. Create one at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

## Installation

```bash
git clone https://github.com/Apex57a/Krayz-Music-Bot.git
cd Krayz-Music-Bot
npm install
```

That is the entire installation process. If `npm install` fails, your Node.js installation is broken or your network is blocking npm. Fix that before opening an issue.

## Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

The `.env` file contains every configurable value the bot reads at startup. Here is what each variable does:

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | The bot token for the primary client. Get it from the Discord Developer Portal. |
| `CLIENT_ID` | Yes | The application ID of the primary bot. |
| `GUILD_ID` | Yes | Your private/development guild ID. Used for guild-scoped command registration during development. |
| `OWNER_ID` | Yes | Your Discord user ID. Controls access to owner-only commands (maintenance, approval, diagnostics). |
| `WORKER_TOKEN_1`, `WORKER_TOKEN_2`, ... | No | Tokens for worker bot clients. Add as many as you want. The bot discovers them by scanning env keys matching `WORKER_TOKEN_<N>`. Non-sequential numbering works. The legacy `WORKER_TOKEN` (no suffix) still works. |
| `LAVALINK_HOST` | Yes | Hostname or IP of your primary Lavalink node. |
| `LAVALINK_PORT` | Yes | Port your Lavalink node listens on. Default is usually 2333 or 9001. |
| `LAVALINK_PASSWORD` | Yes | The password configured in your Lavalink `application.yml`. |
| `LAVALINK_SECURE` | No | Set to `true` if your Lavalink node uses HTTPS/WSS. Default is `false`. |
| `LAVALINK_WORKER_HOST` | No | Hostname for a second Lavalink node. Leave blank if you only run one. |
| `LAVALINK_WORKER_PORT` | No | Port for the second Lavalink node. |
| `LAVALINK_WORKER_PASSWORD` | No | Password for the second Lavalink node. |
| `LAVALINK_WORKER_SECURE` | No | HTTPS/WSS flag for the second node. |
| `DB_HOST` | Yes | MySQL server hostname. |
| `DB_PORT` | Yes | MySQL server port. Default is 3306. |
| `DB_USER` | Yes | MySQL username. |
| `DB_PASS` | Yes | MySQL password. |
| `DB_NAME` | Yes | MySQL database name. The bot creates all tables automatically on first boot. |
| `DB_SSL` | No | Set to `true` if your MySQL server requires SSL (e.g., TiDB Cloud). |
| `SPOTIFY_CLIENT_ID` | No | Spotify application client ID. Required for Spotify link resolution. |
| `SPOTIFY_CLIENT_SECRET` | No | Spotify application client secret. |
| `YOUTUBE_OAUTH_REFRESH_TOKEN` | No | YouTube OAuth refresh token. Helps with age-restricted and rate-limited content. Generate one using `node scripts/refresh-youtube.js`. |
| `DEPLOY_COMMANDS` | No | Set to `true` to register slash commands with Discord on boot. Set it back to `false` afterward. |

The bot validates all required environment variables on startup and logs a clear error for each missing one. If any are missing, it exits with code 1 instead of crashing three seconds later with an unhelpful `TypeError: Cannot read properties of undefined`.

### Lavalink configuration

An example Lavalink configuration is provided at `lavalink/application.example.yml`. Copy it to `lavalink/application.yml` and update the passwords and tokens. The example file does not contain real credentials, because committing secrets to a public repository is the kind of decision that should disqualify someone from writing software.

The included configuration is tuned for high-fidelity playback on shared hosting:

- 20-second audio pre-buffer and 15-second frame buffer to absorb network jitter
- Opus encoding quality set to maximum (10)
- Resampling quality set to `HIGH`
- High packet priority enabled via Koe
- Track stuck threshold at 10 seconds

If you are running on a dedicated server with more resources, you can increase the buffer values further. If you are running on something with less than 2 GB of RAM, reconsider your life choices and then reduce them.

### Database

The bot automatically creates the `guild_settings` table on its first boot and runs `ALTER TABLE` to add any missing columns on subsequent boots. You do not need to run any SQL scripts or import schemas. This is safe to run repeatedly.

To test your database connection before starting the bot:

```bash
node scripts/init-db.js
```

This connects, runs a ping, and exits. If it fails, your credentials are wrong or your database is unreachable.

## Running the bot

For development (auto-restart on file changes):

```bash
npm run dev
```

For production:

```bash
npm run build
npm start
```

The `prestart` script in `package.json` runs `init-db.js` automatically before launch, so the database schema is always current.

### First boot

On the first boot, set `DEPLOY_COMMANDS=true` in your `.env`. This registers all slash commands with Discord's API. Global command registration can take up to one hour to propagate across all servers, which is Discord's fault, not ours. After the commands appear, set `DEPLOY_COMMANDS` back to `false` so the bot does not re-register on every restart and waste your API rate limit budget.

## Commands

### Music commands

These can be restricted to a dedicated channel via `/settings`.

| Command | Aliases | What it does |
|---|---|---|
| `/play <query>` | `!p <query>` | Play a track or playlist from YouTube, Spotify, or SoundCloud. Accepts URLs and search queries. For Spotify playlists, the first track starts immediately and the rest hydrate in the background in batches of three. |
| `/skip` | `!s`, `!skip` | Vote to skip. DJs, the track requester, and solo listeners skip instantly. Everyone else needs a majority vote from the channel. |
| `/stop` | `!stop` | Stop playback, clear the queue, disable 24/7 mode, and disconnect. The nuclear option. |
| `/pause` | `!pause` | Toggle pause/resume. |
| `/queue` | `!q`, `!queue` | Show the current queue with pagination. |
| `/clear` | `!clear` | Clear all queued tracks without stopping the current one. |
| `/nowplaying` | `!np` | Current track info with a progress bar, volume, loop mode, and interactive control buttons (pause, skip, stop, loop, shuffle). |
| `/247` | `!247` | Toggle 24/7 mode. The bot stays in the voice channel after the queue empties instead of leaving after 30 seconds. |

### Configuration commands

| Command | What it does |
|---|---|
| `/settings` | Configure the DJ role and dedicated music channel for the server. |
| `/stats` | Bot memory usage, uptime, Lavalink node status, and cache statistics. |
| `/purge <count>` | Bulk-delete messages (requires Manage Messages). |

### Owner-only commands

| Command | What it does |
|---|---|
| `/own` | Management panel. Toggle global/per-guild maintenance, set a custom maintenance reason, switch Lavalink nodes for all active players, and view full system diagnostics (memory, process info, bot pool status, node health, database cache size, version). |
| `/setup` | Approve a server to use the bot. Unapproved servers cannot use any commands. |

## Caching and metadata

The metadata cache (`cacheLayer.ts`) stores search results and Spotify lookups. L1 is an in-memory `Map` (fast, ephemeral). L3 is a JSON file on disk (slower, survives restarts). Objects containing `KazagumoTrack` instances (search results) stay in L1 only because their class prototype chain does not survive JSON serialization. Everything else that can be stringified goes to L3.

Audio is streamed directly by Lavalink. There is no local file cache.

## Project structure

```
src/
    index.ts              Entry point. Client factory. Kazagumo setup. Boot sequence.
    config.ts             Env vars, worker token discovery, validation.
    commands/
        247.ts            24/7 voice persistence toggle
        clear.ts          Queue clearing
        nowplaying.ts     Current track display with interactive buttons
        own.ts            Owner management panel (maintenance, diagnostics, node switching)
        pause.ts          Playback pause/resume
        play.ts           Play command (delegates to music.ts)
        purge.ts          Bulk message deletion
        queue.ts          Paginated queue viewer
        settings.ts       Guild configuration (DJ role, music channel)
        setup.ts          Server approval (owner only)
        skip.ts           Skip with voting
        stats.ts          System statistics
        stop.ts           Stop and disconnect
    events/
        discord/
            clientReady.ts         Status rotation, boot logging
            guildDelete.ts         Settings cache cleanup on bot removal
            interactionCreate.ts   Slash command routing, music channel enforcement
            messageCreate.ts       Prefix command routing, music channel enforcement
            voiceStateUpdate.ts    Auto-leave, forced disconnect recovery
        kazagumo/
            playerEmpty.ts         Empty queue timeout (30s before disconnect)
            playerEnd.ts           Track end handling
            playerException.ts     Playback error recovery (auto-skip)
            playerResolveError.ts  Track resolution failure handling
            playerStart.ts         "Now Playing" embed on track start
            playerUpdate.ts        Player position tracking
    handlers/
        commandHandler.ts  Command file loader and slash command registrar
        eventHandler.ts    Event file loader and listener binding
    types/
        Command.ts         TypeScript interface for command modules
    utils/
        botPool.ts         Global registry of all Discord clients
        botRouter.ts       Multi-client voice channel assignment with health checks
        cacheLayer.ts      L1/L3 metadata cache (memory + disk JSON)
        cacheManager.ts    (legacy, unused) Audio download stubs
        context.ts         CommandContext wrapper (normalizes prefix and slash)
        database.ts        MySQL connection pool, settings cache, CRUD operations
        helpers.ts         Duration formatting, embed builders, getTrackDisplayUri
        logger.ts          Pino-based structured logging with redaction
        loggerService.ts   Discord event-driven audit logging
        maintenance.ts     Global maintenance mode flag
        middlewares.ts     withPlayerGuard (DJ, voice, lock, player checks)
        music.ts           Core playback logic (play, skip, stop, clear, pause, queue)
        security.ts        DJ role verification
        spotify.ts         Spotify embed scraping, API fallback, fetchWithRetry
        stateManager.ts    Playback state serialization and restoration
scripts/
    fix-duplicates.js      Database deduplication utility
    init-db.js             Database connection test and schema init
    pack.js                Deployment tarball generator
    refresh-youtube.js     YouTube OAuth token refresh helper
    register-commands.js   Standalone slash command registration
lavalink/
    application.yml            Live Lavalink configuration (gitignored)
    application.example.yml    Example Lavalink configuration
ecosystem.config.js    PM2 process manager configuration
tsconfig.json          TypeScript compiler configuration (strict mode)
```

## Deployment

The `pack.js` script handles deployment packaging. It creates a gzipped tarball containing only the files needed for production:

```bash
npm run build
node scripts/pack.js
```

The resulting `krayz_bot_deploy.tar.gz` contains the compiled `dist/` directory, the PM2 config, the `.env` file, and the utility scripts. Upload the tarball to your hosting panel, extract it, and run:

```bash
npm install --production
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

The tarball does not include the Lavalink directory. Lavalink runs as a separate process on its own server (or the same server, if you feel like living dangerously with your RAM).

## Troubleshooting

**The bot connects but does not play audio.**
Check the Lavalink console. If the bot logs say "No available nodes," the Lavalink connection failed. Verify that `LAVALINK_HOST`, `LAVALINK_PORT`, and `LAVALINK_PASSWORD` in your `.env` match your `application.yml`. Also verify that Lavalink is actually running. This sounds obvious, and yet.

**Slash commands are not showing up in Discord.**
Set `DEPLOY_COMMANDS=true` in your `.env` and restart. Global registration takes up to one hour to propagate. If you changed `GUILD_ID`, you may need to re-register.

**YouTube tracks fail with 403 or "sign in to confirm" errors.**
Run `node scripts/refresh-youtube.js` to generate an OAuth token and add it to your `.env` as `YOUTUBE_OAUTH_REFRESH_TOKEN`. This authenticates the YouTube plugin and bypasses most restrictions. Without it, age-restricted content and rate-limited searches will fail.

**The "Now Playing" embed shows a file path instead of a YouTube link.**
This was a bug in versions before v1.0.3 where the locally cached file path overwrote `track.uri` and was never replaced by the original URL in embeds. It is fixed now. Run `npm run build` and restart.

**The bot logs `Failed to sync L3 Disk Cache: Maximum call stack size exceeded`.**
This was a bug where Kazagumo search results (which contain circular references) were being passed to `JSON.stringify`. Fixed in v1.0.3. The cache layer now tests serializability before writing to disk.

**Cache is using too much disk space.**
The cleanup runs every 6 hours and enforces a 5 GB cap. You can clear `cache/` manually at any time without breaking anything. The bot will re-download tracks as needed.

**Database connection errors on startup.**
Make sure MySQL is running and the credentials in `.env` are correct. Run `node scripts/init-db.js` manually to test the connection in isolation.

## Upcoming

- Pokemon minigame integration. More info soon.

## Support policy

Read this section before opening an issue. All of it.

The issue tracker is for bugs in the code. A bug means you followed the setup instructions correctly, the bot compiled without errors, all your credentials are valid, your Lavalink node is running and reachable, and something still breaks in a way that is reproducible. That is a bug, and I want to hear about it.

The following are not bugs, and issues about them will be closed without a response:

- You cannot figure out how to install Node.js.
- Your `.env` file has a typo and the bot crashes on boot.
- Your Lavalink server will not start because you installed Java 8 instead of Java 17.
- You want a step-by-step video tutorial.
- You want the bot to do something unrelated to music playback.
- You copied the `.env.example` file without changing any values and are surprised it does not work.

If you have an actual bug to report, include the full error stack trace, the steps to reproduce it, your Node.js version (`node -v`), and your Lavalink version. Without that information, I cannot help you and I will not try to guess.

## Credits and attribution

This project is authored and engineered by **Derek**.

If you fork, modify, or deploy this codebase in any form, you must retain visible attribution to Derek as the original author. This applies to your repository, your documentation, and any public-facing context where the bot's origin is referenced. Removing attribution is not only disrespectful, it is a violation of the license terms.

## License

MIT License. See [LICENSE](LICENSE) for the full text.
