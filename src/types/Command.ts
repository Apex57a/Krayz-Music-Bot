import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    Client,
    Message,
} from 'discord.js';

export interface Command {
    name?: string;
    data?: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
    aliases?: string[];
    execute?: (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;
    executePrefix?: (message: Message, args: string[], client: Client) => Promise<void>;
}
