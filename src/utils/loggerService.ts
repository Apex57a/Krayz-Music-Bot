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
} from 'discord.js';
import { getGuildSettings } from './database';
import { logger } from './logger';

function getLogChannel(guild: any, channelId: string): TextChannel | null {
    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
        return channel as TextChannel;
    }
    return null;
}

export function setupLoggerEvents(client: Client) {
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

        logChannel.send({ embeds: [embed] }).catch(() => null);
    });

    client.on('messageUpdate', async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
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
}
