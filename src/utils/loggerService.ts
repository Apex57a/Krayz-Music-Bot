import {
    Client,
    Message,
    PartialMessage,
    GuildMember,
    PartialGuildMember,
    EmbedBuilder,
    Channel,
    TextChannel,
    GuildChannel,
    Guild,
    VoiceState,
    GuildBan,
    AuditLogEvent,
} from 'discord.js';
import { getGuildSettings } from './database';
import { logger } from './logger';

function getLogChannel(guild: Guild, channelId: string): TextChannel | null {
    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
        return channel as TextChannel;
    }
    return null;
}

// Exported so interactionCreate.ts and messageCreate.ts can call it directly.
export async function logCommandExecution(
    client: Client,
    guildId: string,
    userId: string,
    username: string,
    commandName: string,
    args: string
): Promise<void> {
    logger.info('command', `User ${username} (ID: ${userId}) in guild ${guildId} ran command "${commandName}" with args: ${args || 'none'}`);
}

export function setupLoggerEvents(client: Client): void {
    // --- Message Delete (with moderator detection via audit log) ---
    client.on('messageDelete', async (message: Message | PartialMessage) => {
        if (!message.guild || message.author?.bot) return;

        const settings = await getGuildSettings(message.guild.id);
        if (!settings.logChannelId || !settings.logMessages) return;

        const logChannel = getLogChannel(message.guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `${message.author?.username} (ID: ${message.author?.id})`,
                iconURL: message.author?.displayAvatarURL() || undefined
            })
            .setColor(0xFF0000)
            .setDescription(`**Message deleted in <#${message.channel.id}>**\n${message.content || '*No text content*'}`)
            .setTimestamp();

        if (message.attachments && message.attachments.size > 0) {
            const attachmentUrls = message.attachments.map(a => a.url).join('\n');
            embed.addFields({ name: 'Attachments', value: attachmentUrls });
        }

        // Try to identify the moderator who deleted the message.
        // Only trust audit log entries created within the last 5 seconds to
        // avoid attributing stale entries to the wrong deletion.
        try {
            const auditLogs = await message.guild.fetchAuditLogs({
                type: AuditLogEvent.MessageDelete,
                limit: 1,
            });
            const entry = auditLogs.entries.first();
            if (entry && entry.target && entry.createdTimestamp > Date.now() - 5000) {
                if (entry.target.id === message.author?.id && entry.executor && entry.executor.id !== message.author?.id) {
                    embed.addFields({ name: 'Deleted by', value: `${entry.executor.tag} (${entry.executor.id})` });
                }
            }
        } catch {
            // Missing audit log permissions; skip moderator attribution.
        }

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Message Update ---
    client.on('messageUpdate', async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        if (oldMessage.partial) return;
        if (!oldMessage.guild || oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;

        const settings = await getGuildSettings(oldMessage.guild.id);
        if (!settings.logChannelId || !settings.logMessages) return;

        const logChannel = getLogChannel(oldMessage.guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `${oldMessage.author?.username} (ID: ${oldMessage.author?.id})`,
                iconURL: oldMessage.author?.displayAvatarURL() || undefined
            })
            .setColor(0xFFFF00)
            .setDescription(`**Message edited in <#${oldMessage.channel.id}>** [Jump to Message](${newMessage.url})`)
            .addFields(
                { name: 'Before', value: oldMessage.content?.substring(0, 1024) || '*Empty*' },
                { name: 'After', value: newMessage.content?.substring(0, 1024) || '*Empty*' }
            )
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Guild Member Add ---
    client.on('guildMemberAdd', async (member: GuildMember) => {
        const settings = await getGuildSettings(member.guild.id);
        if (!settings.logChannelId || !settings.logMembers) return;

        const logChannel = getLogChannel(member.guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `Member Joined`,
                iconURL: member.user.displayAvatarURL()
            })
            .setColor(0x00FF00)
            .setDescription(`<@${member.id}> ${member.user.username}`)
            .addFields(
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
                { name: 'Member Count', value: `${member.guild.memberCount}` }
            )
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Guild Member Remove ---
    client.on('guildMemberRemove', async (member: GuildMember | PartialGuildMember) => {
        const settings = await getGuildSettings(member.guild.id);
        if (!settings.logChannelId || !settings.logMembers) return;

        const logChannel = getLogChannel(member.guild, settings.logChannelId);
        if (!logChannel) return;

        const joinedAt = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown';

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `Member Left`,
                iconURL: member.user?.displayAvatarURL() || undefined
            })
            .setColor(0xFF0000)
            .setDescription(`<@${member.id}> ${member.user?.username || 'Unknown User'}`)
            .addFields(
                { name: 'Joined Server', value: joinedAt }
            )
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Guild Member Update (role changes) ---
    client.on('guildMemberUpdate', async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
        const settings = await getGuildSettings(newMember.guild.id);
        if (!settings.logChannelId || !settings.logMembers) return;

        const logChannel = getLogChannel(newMember.guild, settings.logChannelId);
        if (!logChannel) return;

        // Check for role changes
        if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

            let desc = `<@${newMember.id}> roles updated.\n`;
            if (addedRoles.size > 0) desc += `**Added:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}\n`;
            if (removedRoles.size > 0) desc += `**Removed:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}`;

            const embed = new EmbedBuilder()
                .setAuthor({ name: newMember.user.username, iconURL: newMember.user.displayAvatarURL() })
                .setColor(0x0000FF)
                .setDescription(desc)
                .setTimestamp();

            logChannel.send({ embeds: [embed] }).catch(() => null);
        }
    });

    // --- Channel Create ---
    client.on('channelCreate', async (channel: Channel) => {
        if (!('guild' in channel)) return;
        const guildChannel = channel as GuildChannel;
        const guild = guildChannel.guild;
        const settings = await getGuildSettings(guild.id);
        if (!settings.logChannelId) return;

        const logChannel = getLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setDescription(`**Channel Created:** <#${channel.id}> (${guildChannel.name})`)
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Channel Delete ---
    client.on('channelDelete', async (channel: Channel) => {
        if (!('guild' in channel)) return;
        const guildChannel = channel as GuildChannel;
        const guild = guildChannel.guild;
        const settings = await getGuildSettings(guild.id);
        if (!settings.logChannelId) return;

        const logChannel = getLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setDescription(`**Channel Deleted:** ${guildChannel.name}`)
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Voice State Update ---
    client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
        const guild = newState.guild;
        const member = newState.member;
        if (!member) return;

        const settings = await getGuildSettings(guild.id);
        if (!settings.logChannelId) return;

        const logChannel = getLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const user = member.user;
        const authorData = {
            name: `${user.username} (ID: ${user.id})`,
            iconURL: user.displayAvatarURL(),
        };

        const oldChannel = oldState.channel;
        const newChannel = newState.channel;

        let description: string | null = null;
        let color: number = 0x00FF00;

        if (!oldChannel && newChannel) {
            // User joined a voice channel
            description = `Joined voice channel <#${newChannel.id}>`;
            color = 0x00FF00;
        } else if (oldChannel && !newChannel) {
            // User left a voice channel (or was disconnected)
            const isBotDisconnect = user.id === client.user?.id;
            if (isBotDisconnect) {
                description = `Bot was disconnected from <#${oldChannel.id}>`;
                color = 0xFF0000;
            } else {
                description = `Left voice channel <#${oldChannel.id}>`;
                color = 0xFF0000;
            }
        } else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
            // User switched voice channels
            description = `Moved from <#${oldChannel.id}> to <#${newChannel.id}>`;
            color = 0xFFFF00;
        }

        if (!description) return;

        const embed = new EmbedBuilder()
            .setAuthor(authorData)
            .setColor(color)
            .setDescription(description)
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Guild Ban Add ---
    client.on('guildBanAdd', async (ban: GuildBan) => {
        const settings = await getGuildSettings(ban.guild.id);
        if (!settings.logChannelId) return;

        const logChannel = getLogChannel(ban.guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `${ban.user.username} (ID: ${ban.user.id})`,
                iconURL: ban.user.displayAvatarURL(),
            })
            .setColor(0xFF0000)
            .setDescription(`**${ban.user.username}** was banned from the server.`)
            .setTimestamp();

        // Try to identify the moderator who issued the ban.
        try {
            const auditLogs = await ban.guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 1,
            });
            const entry = auditLogs.entries.first();
            if (entry && entry.executor) {
                embed.addFields({ name: 'Banned by', value: `${entry.executor.tag} (${entry.executor.id})` });
                if (entry.reason) {
                    embed.addFields({ name: 'Reason', value: entry.reason });
                }
            }
        } catch {
            // Missing audit log permissions; skip moderator attribution.
        }

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Guild Ban Remove ---
    client.on('guildBanRemove', async (ban: GuildBan) => {
        const settings = await getGuildSettings(ban.guild.id);
        if (!settings.logChannelId) return;

        const logChannel = getLogChannel(ban.guild, settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `${ban.user.username} (ID: ${ban.user.id})`,
                iconURL: ban.user.displayAvatarURL(),
            })
            .setColor(0x00FF00)
            .setDescription(`**${ban.user.username}** was unbanned from the server.`)
            .setTimestamp();

        // Try to identify the moderator who removed the ban.
        try {
            const auditLogs = await ban.guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanRemove,
                limit: 1,
            });
            const entry = auditLogs.entries.first();
            if (entry && entry.executor) {
                embed.addFields({ name: 'Unbanned by', value: `${entry.executor.tag} (${entry.executor.id})` });
            }
        } catch {
            // Missing audit log permissions; skip moderator attribution.
        }

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });
}
