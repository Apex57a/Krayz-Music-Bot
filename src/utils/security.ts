import { GuildMember, PermissionsBitField } from 'discord.js';
import { getGuildSettings } from './database';
import { config } from '../config';

export async function isDJ(member: GuildMember): Promise<boolean> {
    // Owner bypasses all checks
    if (member.user.id === config.ownerId) {
        return true;
    }

    // Administrators and members with Manage Guild permission implicitly have DJ privileges
    if (
        member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
        return true;
    }

    const settings = await getGuildSettings(member.guild.id);
    if (!settings.djRoleId) {
        // If no DJ role is set, anyone can be a DJ
        return true;
    }

    return member.roles.cache.has(settings.djRoleId);
}
