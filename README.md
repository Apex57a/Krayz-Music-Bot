# Krayz Music

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue?style=flat-square&logo=discord)](https://discord.js.org)
[![Lavalink](https://img.shields.io/badge/Lavalink-v4-purple?style=flat-square)](https://github.com/lavalink-devs/Lavalink)
[![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)](LICENSE)

Krayz is a privately hosted Discord bot architecture designed strictly for high-fidelity audio playback. It is built entirely in TypeScript and relies on discord.js v14 and Lavalink v4.

This is a production-grade system that features a custom dual-bot routing layer to bypass Discord's voice channel limits, an in-memory caching system to reduce database load, and aggressive state preservation to survive Lavalink reboots.

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the bot](#running-the-bot)
- [System Architecture](#system-architecture)
- [Support Policy](#support-policy)
- [Deployment](#deployment)
- [Credits & Attribution](#credits--attribution)

## Features

### Core Audio Engine

- **Dual-Bot Routing:** Krayz bypasses the standard Discord limitation of one bot per voice channel. The core `botRouter.ts` initializes two separate discord.js clients. When a user requests music, the router scans the voice channels and silently assigns an idle client to the session. The user never has to manually invite or specify which bot to use.
- **Session Recovery:** Server restarts normally kill voice connections. Krayz uses a `stateManager` that hooks into process exit events. It serializes the exact playback positions and queue states to disk. On reboot, it hydrates the Lavalink players and seeks the audio back to the exact millisecond it stopped.
- **Persistent 24/7 Mode:** The bot can park permanently in a voice channel, surviving Lavalink desynchronizations and server reboots. The state of this setting is saved per-guild to the MySQL database.
- **Multi-Source Support:** Native support for YouTube, YouTube Music, Spotify playlists, and direct HTTP streams through the Kazagumo wrapper.

## Requirements

This repository requires a firm understanding of Node.js and backend server administration.

- Node.js 18 or later
- MySQL 8
- Java 17 or later (Required for Lavalink)
- A Lavalink v4 node
- A Discord bot token with the Message Content Intent enabled.

## Installation

Clone the repository and install the required dependencies:

```bash
git clone https://github.com/Apex57a/Krayz-Music.git
cd Krayz-Music
npm install
```

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

You must provide your Discord bot tokens, Spotify Developer credentials, Lavalink node details, and a MySQL connection string. The bot automatically generates all necessary database tables on its first boot. You do not need to import any manual SQL schemas.

## Running the bot

For local testing and development:

```bash
npm run dev
```

For production deployment:

```bash
npm run build
npm start
```

## System Architecture

Krayz is built for speed. Every database call to MySQL is intercepted by an in-memory `Map` cache inside `database.ts`. The bot loads all guild settings on boot. If an administrator changes a setting, the bot writes to the database and immediately updates the memory map. The bot almost never queries the database directly during standard command execution, completely eliminating I/O bottlenecks during heavy usage.

## Support Policy

Read this carefully before opening an issue.

I do not provide free technical support for basic setup errors. If your bot crashes because you misconfigured your `.env` file, failed to install Node.js correctly, or cannot figure out how to start a Lavalink server, do not open an issue. These are fundamental server administration tasks and fall entirely outside the scope of this project.

Issues are strictly reserved for reproducible bugs in the codebase. Examples of valid issues include routing failures during concurrent cross-client commands, memory leaks in the database cache, or Lavalink desynchronization edge cases. 

If you open an issue asking how to install the bot, why your Discord token is invalid, or requesting a step-by-step video tutorial, the issue will be closed immediately and locked without a response.

## Deployment

To package the bot for a Pterodactyl panel or VPS deployment:

```bash
node scripts/pack.js
```

This script automatically bumps the package version, compiles the TypeScript, and generates a clean `krayz_bot_deploy.tar.gz` archive containing only the files required for production. Upload the tarball, extract it, run `npm install --production`, and start the process manager.

## Credits & Attribution

This project is authored and engineered by **Derek**. 

If you fork, modify, or host this codebase, you must retain these credits. You must visibly attribute the original work to Derek in your repository, documentation, and anywhere the bot's origin is referenced.

## License

MIT License. See LICENSE for details.
