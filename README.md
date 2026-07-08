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
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Support policy](#support-policy)
- [Credits and attribution](#credits-and-attribution)
- [License](#license)

## Why this exists

Most Discord music bots are either dead (Groovy, Rythm), rate-limited into uselessness, or written by someone who learned JavaScript last Thursday. Krayz exists because the author got tired of every publicly hosted music bot dropping connections, buffering for ten seconds before each track, and dying whenever YouTube changed a query parameter.

This is not a weekend project. It is a production system that runs 24/7 on shared hosting and stays connected through Lavalink restarts, process crashes, and the occasional server migration. If you want to run it yourself, you need to know what you are doing. If you do not know what a Lavalink node is, start there.

## Architecture overview

Krayz runs a dual-client architecture. Two separate discord.js clients log into Discord simultaneously. When a user requests playback, the bot router checks which client is available in that guild and assigns it to the voice session. The user never knows which client is handling their audio. This lets the bot serve multiple voice channels in the same guild without hitting Discord's one-bot-per-channel restriction.

All database access goes through an in-memory cache backed by MySQL. On boot, the bot loads every guild's settings into a `Map`. When a setting changes, the bot writes to MySQL and updates the map at the same time. During normal command execution, the database is never queried directly. This means the bot's response time to commands is limited by Discord's API latency, not by database I/O.

State preservation is handled by a `stateManager` that hooks into process exit signals. When the bot shuts down (or gets killed by PM2, or the hosting panel restarts the container), it serializes the current playback positions, queue contents, and player configurations to a JSON file on disk. On the next boot, it reads that file, recreates the Lavalink players, and seeks each track back to the exact millisecond where it stopped. If you restart the bot mid-song, your listeners will hear a brief pause and then the song picks up where it left off.

```
User Command
    |
    v
Command Handler (slash + prefix)
    |
    v
Bot Router (assigns clientA or clientB)
    |
    v
Kazagumo (player management)
    |
    v
Shoukaku (Lavalink connector)
    |
    v
Lavalink Node(s)
    |
    v
Discord Voice Gateway
```

## Features

### Dual-bot routing

The `botRouter.ts` module initializes two discord.js clients. When a play command fires, the router scans the guild's voice channels, checks which client (if any) already has a player there, and assigns the request to the correct one. If neither client is active, it picks whichever is free. If both are occupied in different channels, it tells the user. All of this happens in a single function call. The user types one command and gets audio. They do not need to know or care that two bots exist.

### Session recovery

Most bots lose their queue when they restart. Krayz does not. The `stateManager` serializes the full player state (current track, seek position, queue, volume, loop mode) to disk on shutdown. On startup, it reads the file, creates fresh Lavalink players, injects the saved queues, and seeks to the exact position. The state file is deleted after a successful restore so it cannot accidentally replay stale data on the next boot.

### 24/7 mode

Guilds can enable persistent voice presence. The bot joins a voice channel and stays there indefinitely, surviving restarts, empty channels, and Lavalink reconnections. The setting is stored per-guild in MySQL and restored on boot. When 24/7 mode is off, the bot waits 30 seconds after the last human leaves the channel before disconnecting.

### Forced disconnect protection

If someone with administrator permissions drags the bot out of a voice channel, the bot detects the forced disconnect through the `voiceStateUpdate` event. It saves the current playback state (track, position, queue), destroys the corrupted player, waits two seconds for Discord's gateway to settle, creates a fresh player in the same channel, and resumes playback. The user hears a brief interruption and the music continues.

### Multi-source playback

Krayz resolves audio from YouTube, YouTube Music, Spotify (tracks, albums, and playlists), SoundCloud, Bandcamp, Twitch, and Vimeo. Spotify resolution works by scraping the embed page for track metadata and then searching the resolved titles on YouTube Music through Lavalink. If the embed scrape fails, the bot falls back to the official Spotify API with client credentials. All external HTTP requests have a 15-second timeout so a slow upstream API cannot hang the bot.

### Guild approval system

The bot will not respond to commands in a guild until the owner explicitly approves it. This prevents random servers from adding the bot and consuming resources. The approval state is stored in MySQL and checked on every command invocation, both slash and prefix.

### Logging system

Administrators can configure a log channel that receives structured embeds for message deletions, message edits, member joins, member departures, role changes, and channel creation/deletion. Each log type (messages, members) can be toggled independently through the `/settings` command. The logging runs through Discord event listeners on the primary client and writes to the configured channel without touching the database on each event (settings are cached in memory).

### Per-guild volume persistence

Volume settings are saved per-guild to the database. When a player is created (whether from a play command, a 24/7 reconnection, or a state restore), the bot reads the guild's saved volume and applies it. The volume formula uses a perceptual curve (`Math.pow(linear / 100, 1.5) * 100`) so that the slider feels more natural at low volumes instead of jumping from silent to loud at 10%.

### Maintenance mode

The bot owner can enable maintenance mode globally or per-guild. When active, all commands except owner commands return a maintenance message. This lets the owner deploy updates or debug issues without random users spamming commands into a half-initialized bot.

### DJ role enforcement

Guilds can designate a DJ role. When set, music control commands (play, skip, stop, pause, 24/7) require the user to have that role or administrator permissions. Users without the role get a message explaining what role they need. The DJ role ID is stored per-guild in MySQL.

## Requirements

You need all of the following. Not some. All.

- **Node.js 18 or later.** The bot uses ES2022 features and native APIs that do not exist in older versions. If you are running Node 16, upgrade.
- **MySQL 8 or a compatible fork.** The bot is tested against TiDB Cloud (a MySQL-compatible distributed database). Any MySQL 8.0.20+ server should work. MariaDB is untested and unsupported.
- **Java 17 or later.** Required to run the Lavalink server. If you do not know what Java is, this project is not for you.
- **A running Lavalink v4 node.** The bot does not include a Lavalink binary. You must host and configure your own Lavalink server. An example configuration file is provided in `lavalink/application.example.yml`.
- **A Discord bot application** with the Message Content privileged intent enabled. The bot supports both slash commands and prefix commands. Without Message Content, prefix commands will silently fail.
- **A Spotify developer application** (optional). Required only if you want Spotify link resolution. Create one at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

## Installation

```bash
git clone https://github.com/Apex57a/Krayz-Music.git
cd Krayz-Music
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
| `OWNER_ID` | Yes | Your Discord user ID. Controls access to owner-only commands (eval, maintenance, approval). |
| `WORKER_TOKEN` | No | Token for the secondary bot client. Leave blank to run in single-bot mode. |
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
| `YOUTUBE_OAUTH_REFRESH_TOKEN` | No | YouTube OAuth refresh token. Helps with age-restricted and rate-limited content. |
| `DEPLOY_COMMANDS` | No | Set to `true` to register slash commands with Discord on boot. Set it back to `false` afterward. |

### Lavalink configuration

An example Lavalink configuration file is provided at `lavalink/application.example.yml`. Copy it to `lavalink/application.yml` and update the passwords and tokens. The example file does not contain any real credentials.

The Lavalink configuration is tuned for shared hosting environments with limited RAM (2 GB). If you are running on a dedicated server with more resources, you can increase the `frameBufferDurationMs` and `bufferDurationMs` values for smoother playback during network jitter.

### Database

The bot automatically creates the `GuildSettings` table on its first boot. You do not need to run any SQL scripts or import schemas. If the table already exists, the bot runs `ALTER TABLE` statements to add any missing columns. This is safe to run repeatedly.

To test your database connection before starting the bot:

```bash
node scripts/init-db.js
```

This script connects to the database using the credentials in your `.env` file, runs a ping, and exits. If it fails, your credentials are wrong or your database is unreachable. The script supports SSL connections for cloud-hosted databases.

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

The production start command uses PM2 via the `ecosystem.config.js` file. PM2 handles process restarts, log rotation, and crash recovery. If you are not using PM2, run `node dist/index.js` directly, but you lose automatic restart on crash.

### First boot

On the first boot, set `DEPLOY_COMMANDS=true` in your `.env` file. This tells the command handler to register all slash commands with Discord's API. Global command registration can take up to one hour to propagate across all servers. After the commands appear, set `DEPLOY_COMMANDS` back to `false` so the bot does not re-register commands on every restart and waste your API rate limit budget.

## Project structure

```
Krayz-Music/
    src/
        index.ts              Main entry point, client initialization, Kazagumo setup
        config.ts             Environment variable loader
        commands/
            247.ts            24/7 voice persistence toggle
            clear.ts          Queue clearing
            nowplaying.ts     Current track display with controls
            own.ts            Owner-only commands (maintenance, eval, approval)
            pause.ts          Playback pause/resume
            play.ts           Track/playlist loading
            purge.ts          Bulk message deletion
            queue.ts          Paginated queue viewer
            settings.ts       Guild configuration panel
            setup.ts          Log channel setup
            skip.ts           Track skipping
            stats.ts          System statistics (latency, memory, uptime)
            stop.ts           Playback stop and disconnect
        events/
            discord/
                interactionCreate.ts   Slash command routing, cooldowns, DJ checks
                messageCreate.ts       Prefix command routing, cooldowns
                ready.ts               Status rotation, boot logging
                voiceStateUpdate.ts    Auto-leave, force-disconnect recovery
            kazagumo/
                playerEmpty.ts         Empty queue timeout handling
                playerStart.ts         Now-playing embed on track start
        handlers/
            commandHandler.ts  Command file loader and slash command registrar
            eventHandler.ts    Event file loader and listener binding
        types/
            Command.ts         Command interface definition
        utils/
            botRouter.ts       Dual-client voice channel assignment
            database.ts        MySQL connection pool, cached CRUD operations
            helpers.ts         Duration formatting, string utilities
            logger.ts          Pino-based structured logging
            loggerService.ts   Discord event-driven audit logging
            maintenance.ts     Global maintenance mode toggle
            music.ts           Play, skip, stop, pause, clear, volume logic
            security.ts        DJ role verification
            spotify.ts         Spotify embed scraping and API fallback
            stateManager.ts    Playback state serialization and restoration
    scripts/
        fix-duplicates.js      Database deduplication utility
        init-db.js             Database connection test with SSL support
        pack.js                Deployment tarball generator with version bumping
        refresh-youtube.js     YouTube OAuth token refresh helper
        register-commands.js   Standalone slash command registration script
    lavalink/
        application.yml            Live Lavalink configuration (gitignored)
        application.example.yml    Example Lavalink configuration (safe to commit)
    ecosystem.config.js    PM2 process manager configuration
    tsconfig.json          TypeScript compiler configuration (strict mode enabled)
```

## Deployment

The `pack.js` script handles deployment packaging. It bumps the patch version in `package.json`, then creates a gzipped tarball containing only the files needed for production:

```bash
npm run build
node scripts/pack.js
```

The resulting `krayz_bot_deploy.tar.gz` contains the compiled `dist/` directory, the PM2 config, the `.env` file, and the utility scripts. Upload the tarball to your hosting panel, extract it, and run:

```bash
npm install --production
pm2 start ecosystem.config.js
```

The tarball does not include the Lavalink directory. Lavalink runs as a separate process on its own server (or the same server, if you feel like living dangerously with your RAM).

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

If you have an actual bug to report, include the full error stack trace, the steps to reproduce the issue, your Node.js version (`node -v`), and your Lavalink version. Without that information, I cannot help you and I will not try to guess.

## Credits and attribution

This project is authored and engineered by **Derek**.

If you fork, modify, or deploy this codebase in any form, you must retain visible attribution to Derek as the original author. This applies to your repository, your documentation, and any public-facing context where the bot's origin is referenced. Removing attribution is not only disrespectful, it is a violation of the license terms.

## License

MIT License. See [LICENSE](LICENSE) for the full text.
