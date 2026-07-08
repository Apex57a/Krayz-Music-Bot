import { Client } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

export async function loadEvents(client: Client): Promise<void> {
    // --- Discord Events ---
    const discordEventsPath = join(__dirname, '..', 'events', 'discord');
    const discordEventFiles = readdirSync(discordEventsPath).filter(
        (file) => file.endsWith('.ts') || file.endsWith('.js'),
    );

    for (const file of discordEventFiles) {
        const filePath = join(discordEventsPath, file);
        const event = require(filePath).default;

        if (event.once) {
            client.once(event.name, (...args: any[]) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args: any[]) => event.execute(...args, client));
        }
        logger.info('system', `Loaded Discord event: ${event.name}`);
    }

    // --- Kazagumo (Lavalink) Events ---
    const kazagumoEventsPath = join(__dirname, '..', 'events', 'kazagumo');
    const kazagumoEventFiles = readdirSync(kazagumoEventsPath).filter(
        (file) => file.endsWith('.ts') || file.endsWith('.js'),
    );

    for (const file of kazagumoEventFiles) {
        const filePath = join(kazagumoEventsPath, file);
        const event = require(filePath).default;

        client.kazagumo.on(event.name, (...args: any[]) => event.execute(...args, client));
        
        const { clientB } = require('../index');
        if (clientB && clientB.kazagumo) {
            clientB.kazagumo.on(event.name, (...args: any[]) => event.execute(...args, clientB));
        }

        logger.info('music', `Loaded Kazagumo event: ${event.name}`);
    }
}
