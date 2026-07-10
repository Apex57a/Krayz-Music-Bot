import { ChatInputCommandInteraction, Message, Guild, GuildMember, User, TextChannel, VoiceChannel } from 'discord.js';

export class CommandContext {
    public readonly isSlash: boolean;
    public readonly interaction?: ChatInputCommandInteraction;
    public readonly message?: Message;

    constructor(interactionOrMessage: ChatInputCommandInteraction | Message, isSlash: boolean) {
        this.isSlash = isSlash;
        if (isSlash) {
            this.interaction = interactionOrMessage as ChatInputCommandInteraction;
        } else {
            this.message = interactionOrMessage as Message;
        }
    }

    get guild(): Guild | null {
        return this.isSlash ? this.interaction?.guild || null : this.message?.guild || null;
    }

    get member(): GuildMember | null {
        return (this.isSlash ? this.interaction?.member : this.message?.member) as GuildMember | null;
    }

    get user(): User {
        return this.isSlash ? this.interaction!.user : this.message!.author;
    }

    get voiceChannel(): VoiceChannel | null {
        return (this.member?.voice?.channel as VoiceChannel) || null;
    }

    get textChannel(): TextChannel | null {
        return (this.isSlash ? this.interaction?.channel : this.message?.channel) as TextChannel | null;
    }

    async reply(options: any): Promise<Message | undefined> {
        if (this.isSlash && this.interaction) {
            if (this.interaction.deferred || this.interaction.replied) {
                return await this.interaction.editReply(options);
            }
            await this.interaction.reply(options);
            return await this.interaction.fetchReply();
        } else if (this.message) {
            return await this.message.reply(options);
        }
    }

    async edit(options: any): Promise<Message | undefined> {
        if (this.isSlash && this.interaction) {
            return await this.interaction.editReply(options);
        } else if (this.message) {
            // For prefix commands, we'd need to track the reply message, but reply() returns it.
            // Simplified here.
            return undefined;
        }
    }
}
