import { Client } from 'discord.js';

class BotPool {
    private clients: Client[] = [];

    register(client: Client) {
        if (!this.clients.includes(client)) {
            this.clients.push(client);
        }
    }

    getAll(): Client[] {
        return this.clients;
    }

    getPrimary(): Client | undefined {
        return this.clients[0];
    }
}

export const botPool = new BotPool();
