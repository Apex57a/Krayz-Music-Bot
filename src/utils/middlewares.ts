import { EmbedBuilder } from 'discord.js';
import { KazagumoPlayer } from 'kazagumo';
import { CommandContext } from './context';
import { getAvailableBot } from './botRouter';
import { isDJ } from './security';
import { actionLocks } from './music';

export interface PlayerGuardOptions {
    requireDJ?: boolean;
    requirePlayer?: boolean;
    useLock?: boolean;
}

export async function withPlayerGuard(
    context: CommandContext,
    options: PlayerGuardOptions,
    callback: (player: KazagumoPlayer | undefined) => Promise<void>
) {
    const guildId = context.guild?.id;
    if (!guildId) return;

    if (options.useLock) {
        if (actionLocks.has(guildId)) return;
        actionLocks.add(guildId);
    }

    try {
        if (options.requireDJ) {
            const member = context.member;
            if (!member || !(await isDJ(member))) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must have the DJ role to use this command.');
                const msg = await context.reply({ embeds: [embed] });
                if (msg && !context.isSlash) {
                    setTimeout(() => msg.delete().catch(() => {}), 10000);
                }
                return;
            }
        }

        const voiceChannel = context.voiceChannel;
        let player: KazagumoPlayer | undefined;

        if (options.requirePlayer) {
            if (!voiceChannel) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('You must join my voice channel first.');
                const msg = await context.reply({ embeds: [embed] });
                if (msg && !context.isSlash) setTimeout(() => msg.delete().catch(() => {}), 10000);
                return;
            }

            const router = getAvailableBot(guildId, voiceChannel.id);
            player = router ? router.kazagumo.players.get(guildId) : undefined;
            
            if (!player) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('No active player in this guild.');
                const msg = await context.reply({ embeds: [embed] });
                if (msg && !context.isSlash) setTimeout(() => msg.delete().catch(() => {}), 10000);
                return;
            }

            if (player.voiceId !== voiceChannel.id) {
                const embed = new EmbedBuilder().setColor(0x111111).setDescription('You need to be in my voice channel.');
                const msg = await context.reply({ embeds: [embed] });
                if (msg && !context.isSlash) setTimeout(() => msg.delete().catch(() => {}), 10000);
                return;
            }
        }

        await callback(player);
    } finally {
        if (options.useLock) {
            actionLocks.delete(guildId);
        }
    }
}
