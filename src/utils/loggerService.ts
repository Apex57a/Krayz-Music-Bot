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
    AttachmentBuilder,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getGuildSettings } from './database';
import { logger } from './logger';

const TEMP_DIR = path.join(process.cwd(), 'temp-musicbot');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function getLogChannel(guild: Guild, channelId: string): TextChannel | null {
    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
        return channel as TextChannel;
    }
    return null;
}

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

/**
 * Downloads an attachment to the local disk, returning the local file path.
 * The filename is sanitized and made unique to prevent collisions or exploits.
 */
async function downloadAttachmentToDisk(url: string, originalName: string): Promise<{ localPath: string, safeName: string } | null> {
    try {
        const ext = path.extname(originalName) || '.bin';
        const cleanName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '').replace(ext, '');
        const hash = crypto.randomBytes(4).toString('hex');
        const safeName = `${cleanName.substring(0, 30)}_${hash}${ext}`;
        const localPath = path.join(TEMP_DIR, safeName);

        const res = await fetch(url);
        if (!res.ok) return null;

        const buffer = await res.arrayBuffer();
        fs.writeFileSync(localPath, Buffer.from(buffer));
        
        return { localPath, safeName };
    } catch (err) {
        logger.error('logger', `Failed to download attachment: ${err}`);
        return null;
    }
}

export function setupLoggerEvents(client: Client): void {
    // --- Message Delete ---
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

        const filesToSend: AttachmentBuilder[] = [];
        const localFilesToDelete: string[] = [];
        const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

        if (message.attachments && message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (attachment.size > 25 * 1024 * 1024) {
                    embed.addFields({ name: `Attachment (too large)`, value: `${attachment.name} (${(attachment.size / 1024 / 1024).toFixed(1)}MB)` });
                    continue;
                }
                const downloadUrl = attachment.proxyURL || attachment.url;
                const downloaded = await downloadAttachmentToDisk(downloadUrl, attachment.name);
                if (downloaded) {
                    const attBuilder = new AttachmentBuilder(downloaded.localPath, { name: downloaded.safeName });
                    filesToSend.push(attBuilder);
                    localFilesToDelete.push(downloaded.localPath);

                    // Embed the first image directly inside the embed
                    const ext = path.extname(downloaded.safeName).toLowerCase();
                    if (IMAGE_EXTS.includes(ext) && !embed.data.image) {
                        embed.setImage(`attachment://${downloaded.safeName}`);
                    }
                } else {
                    embed.addFields({ name: 'Attachment (download failed)', value: attachment.name });
                }
            }
        }

        try {
            const auditLogs = await message.guild.fetchAuditLogs({
                type: AuditLogEvent.MessageDelete,
                limit: 1,
            });
            const entry = auditLogs.entries.first();
            if (entry && entry.target && entry.createdTimestamp > Date.now() - 5000) {
                if (entry.target.id === message.author?.id && entry.executor && entry.executor.id !== message.author?.id) {
                    embed.addFields({ name: 'Deleted by Moderator', value: `${entry.executor.tag} (${entry.executor.id})` });
                }
            }
        } catch {}

        try {
            await logChannel.send({ embeds: [embed], files: filesToSend });
        } catch (err) {
            logger.error('logger', `Failed to send messageDelete log: ${err}`);
        } finally {
            for (const file of localFilesToDelete) {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            }
        }
    });

    // --- Message Delete Bulk (Purge) ---
    client.on('messageDeleteBulk', async (messages: any, channel: any) => {
        const guild = channel.guild;
        const settings = await getGuildSettings(guild.id);
        if (!settings.logChannelId || !settings.logMessages) return;

        const logChannel = getLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        let executorName = 'Unknown Moderator';
        try {
            const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageBulkDelete, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.createdTimestamp > Date.now() - 5000 && entry.executor) {
                executorName = entry.executor.username || 'Unknown Moderator';
            }
        } catch {}

        const messagesArr = Array.from(messages.values() as IterableIterator<Message | PartialMessage>);
        const sorted = messagesArr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        let transcript = `Transcript of ${messages.size} purged messages in #${channel.name}\nPurged by: ${executorName}\nTime: ${new Date().toUTCString()}\n\n`;

        for (const msg of sorted) {
            const time = new Date(msg.createdTimestamp).toISOString();
            const author = msg.author ? `${msg.author.username} (${msg.author.id})` : 'Unknown User';
            const content = msg.content || '[No Text / Embeds / Attachments]';
            transcript += `[${time}] ${author}: ${content}\n`;
        }

        const safeExecutorName = executorName.replace(/[^a-zA-Z0-9_\-]/g, '');
        const filename = `purge-${safeExecutorName}-${Date.now()}-${messages.size}.txt`;
        const filepath = path.join(TEMP_DIR, filename);

        fs.writeFileSync(filepath, transcript, 'utf-8');

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('Bulk Message Delete (Purge)')
            .setDescription(`**${messages.size} messages** were purged in <#${channel.id}> by **${executorName}**. Transcript attached.`)
            .setTimestamp();

        try {
            const attachment = new AttachmentBuilder(filepath, { name: filename });
            await logChannel.send({ embeds: [embed], files: [attachment] });
        } catch (err) {
            logger.error('logger', `Failed to send purge log: ${err}`);
        } finally {
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        }
    });

    // --- Message Update ---
    client.on('messageUpdate', async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
        // Safe to ignore partial messages because they were sent before the bot started.
        if (oldMessage.partial) return;
        if (!oldMessage.guild || oldMessage.author?.bot) return;

        // True unfurl detection: If content didn't change AND editedTimestamp is identical, it's just an embed/link unfurl.
        if (oldMessage.content === newMessage.content && oldMessage.editedTimestamp === newMessage.editedTimestamp) return;

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

        const filesToSend: AttachmentBuilder[] = [];
        const localFilesToDelete: string[] = [];

        // If attachments were removed or changed during edit, download old attachments
        if (oldMessage.attachments && oldMessage.attachments.size > 0 && oldMessage.attachments.size !== newMessage.attachments.size) {
            for (const attachment of oldMessage.attachments.values()) {
                if (!newMessage.attachments.has(attachment.id)) {
                    const downloaded = await downloadAttachmentToDisk(attachment.url, attachment.name);
                    if (downloaded) {
                        filesToSend.push(new AttachmentBuilder(downloaded.localPath, { name: `deleted_${downloaded.safeName}` }));
                        localFilesToDelete.push(downloaded.localPath);
                    }
                }
            }
        }

        try {
            await logChannel.send({ embeds: [embed], files: filesToSend });
        } catch (err) {
            logger.error('logger', `Failed to send messageUpdate log: ${err}`);
        } finally {
            for (const file of localFilesToDelete) {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            }
        }
    });

    // --- Guild Member Remove (Leaves & Kicks) ---
    client.on('guildMemberRemove', async (member: GuildMember | PartialGuildMember) => {
        const settings = await getGuildSettings(member.guild.id);
        if (!settings.logChannelId || !settings.logMembers) return;

        const logChannel = getLogChannel(member.guild, settings.logChannelId);
        if (!logChannel) return;

        const joinedAt = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown';

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `Member Left / Kicked`,
                iconURL: member.user?.displayAvatarURL() || undefined
            })
            .setColor(0xFF0000)
            .setDescription(`<@${member.id}> ${member.user?.username || 'Unknown User'}`)
            .addFields({ name: 'Joined Server', value: joinedAt })
            .setTimestamp();

        try {
            const auditLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.target?.id === member.id && entry.createdTimestamp > Date.now() - 5000) {
                embed.setTitle('Member Kicked');
                embed.addFields({ name: 'Kicked by', value: `<@${entry.executor?.id}> (${entry.executor?.username})` });
                if (entry.reason) embed.addFields({ name: 'Reason', value: entry.reason });
            }
        } catch {}

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Guild Member Update (Roles, Nicknames, Timeouts) ---
    client.on('guildMemberUpdate', async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
        const settings = await getGuildSettings(newMember.guild.id);
        if (!settings.logChannelId || !settings.logMembers) return;

        const logChannel = getLogChannel(newMember.guild, settings.logChannelId);
        if (!logChannel) return;

        // Roles Update
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

            try {
                const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 });
                const entry = auditLogs.entries.first();
                if (entry && entry.target?.id === newMember.id && entry.createdTimestamp > Date.now() - 5000) {
                    embed.addFields({ name: 'Updated by', value: `<@${entry.executor?.id}> (${entry.executor?.username})` });
                }
            } catch {}

            logChannel.send({ embeds: [embed] }).catch(() => null);
        }

        // Nickname Update
        if (oldMember.nickname !== newMember.nickname) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: newMember.user.username, iconURL: newMember.user.displayAvatarURL() })
                .setColor(0x00FFFF)
                .setDescription(`<@${newMember.id}> changed nickname.\n**Before:** ${oldMember.nickname || '*None*'}\n**After:** ${newMember.nickname || '*None*'}`)
                .setTimestamp();
            logChannel.send({ embeds: [embed] }).catch(() => null);
        }

        // Timeout (communicationDisabledUntil) Update
        if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: newMember.user.username, iconURL: newMember.user.displayAvatarURL() })
                .setTimestamp();

            if (newMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp > Date.now()) {
                embed.setColor(0xFF8800);
                embed.setTitle('Member Timed Out');
                embed.setDescription(`<@${newMember.id}> was timed out until <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>.`);
            } else {
                embed.setColor(0x00FF00);
                embed.setTitle('Timeout Removed');
                embed.setDescription(`<@${newMember.id}>'s timeout was removed.`);
            }

            try {
                const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 1 });
                const entry = auditLogs.entries.first();
                if (entry && entry.target?.id === newMember.id && entry.createdTimestamp > Date.now() - 5000) {
                    embed.addFields({ name: 'Moderator', value: `<@${entry.executor?.id}> (${entry.executor?.username})` });
                    if (entry.reason) embed.addFields({ name: 'Reason', value: entry.reason });
                }
            } catch {}

            logChannel.send({ embeds: [embed] }).catch(() => null);
        }
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

        try {
            const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.target?.id === channel.id && entry.createdTimestamp > Date.now() - 5000) {
                embed.addFields({ name: 'Created by', value: `<@${entry.executor?.id}> (${entry.executor?.username})` });
            }
        } catch {}

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

        try {
            const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.target?.id === channel.id && entry.createdTimestamp > Date.now() - 5000) {
                embed.addFields({ name: 'Deleted by', value: `<@${entry.executor?.id}> (${entry.executor?.username})` });
            }
        } catch {}

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    // --- Voice State Update (Mutes, Deafens, Moves) ---
    client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
        const guild = newState.guild;
        const member = newState.member;
        if (!member) return;

        const settings = await getGuildSettings(guild.id);
        if (!settings.logChannelId) return;

        const logChannel = getLogChannel(guild, settings.logChannelId);
        if (!logChannel) return;

        const user = member.user;
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username} (ID: ${user.id})`, iconURL: user.displayAvatarURL() })
            .setTimestamp();

        let shouldLog = false;

        // Join / Leave / Move
        if (!oldState.channel && newState.channel) {
            embed.setColor(0x00FF00).setDescription(`Joined voice channel <#${newState.channel.id}>`);
            shouldLog = true;
        } else if (oldState.channel && !newState.channel) {
            if (user.id === client.user?.id) embed.setDescription(`Bot was disconnected from <#${oldState.channel.id}>`);
            else embed.setDescription(`Left voice channel <#${oldState.channel.id}>`);
            embed.setColor(0xFF0000);
            shouldLog = true;
        } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            embed.setColor(0xFFFF00).setDescription(`Moved from <#${oldState.channel.id}> to <#${newState.channel.id}>`);
            shouldLog = true;
        }

        // Server Mute
        if (!oldState.serverMute && newState.serverMute) {
            embed.setColor(0xFF8800).setDescription(`<@${user.id}> was server muted in <#${newState.channel?.id}>`);
            shouldLog = true;
            try {
                const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 1 });
                const entry = logs.entries.first();
                if (entry && entry.target?.id === user.id && entry.createdTimestamp > Date.now() - 5000) {
                    embed.addFields({ name: 'Muted by', value: `<@${entry.executor?.id}>` });
                }
            } catch {}
        } else if (oldState.serverMute && !newState.serverMute) {
            embed.setColor(0x00FF00).setDescription(`<@${user.id}> was server unmuted in <#${newState.channel?.id}>`);
            shouldLog = true;
        }

        // Server Deafen
        if (!oldState.serverDeaf && newState.serverDeaf) {
            embed.setColor(0xFF8800).setDescription(`<@${user.id}> was server deafened in <#${newState.channel?.id}>`);
            shouldLog = true;
            try {
                const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 1 });
                const entry = logs.entries.first();
                if (entry && entry.target?.id === user.id && entry.createdTimestamp > Date.now() - 5000) {
                    embed.addFields({ name: 'Deafened by', value: `<@${entry.executor?.id}>` });
                }
            } catch {}
        } else if (oldState.serverDeaf && !newState.serverDeaf) {
            embed.setColor(0x00FF00).setDescription(`<@${user.id}> was server undeafened in <#${newState.channel?.id}>`);
            shouldLog = true;
        }

        if (shouldLog) {
            logChannel.send({ embeds: [embed] }).catch(() => null);
        }
    });

    // --- Guild Ban Add / Remove ---
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

        try {
            const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.executor) {
                embed.addFields({ name: 'Banned by', value: `${entry.executor.tag} (${entry.executor.id})` });
                if (entry.reason) embed.addFields({ name: 'Reason', value: entry.reason });
            }
        } catch {}

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

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

        try {
            const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.executor) {
                embed.addFields({ name: 'Unbanned by', value: `${entry.executor.tag} (${entry.executor.id})` });
            }
        } catch {}

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });
}
