import { Client, Message, 
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
    TextChannel,
} from 'discord.js';
import { KazagumoPlayer } from 'kazagumo';
import { config } from '../config';
import { isMaintenance, setMaintenance } from '../utils/maintenance';
import { getGuildSettings, updateGuildSettings } from '../utils/database';
import { getSettingsCacheSize } from '../utils/database';
import { logger } from '../utils/logger';

export let maintenanceReason = '';

export default {
    data: new SlashCommandBuilder()
        .setName('own')
        .setDescription('Owner only management panel'),

    async execute(interaction: ChatInputCommandInteraction, client: Client) {
        if (interaction.user.id !== config.ownerId) {
            return interaction.reply({ content: 'You are not authorized to use this command.', flags: MessageFlags.Ephemeral });
        }

        const embed = new EmbedBuilder()
            .setColor(0x111111)
            .setTitle('Owner Management Panel')
            .setDescription('Select an action from the dropdown below.');

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('own_menu')
                .setPlaceholder('Select an option...')
                .addOptions([
                    {
                        label: 'Toggle Global Maintenance',
                        description: 'Enable or disable maintenance mode for all servers.',
                        value: 'global_maint',
                    },
                    {
                        label: 'Toggle Guild Maintenance',
                        description: 'Enable or disable maintenance for a specific guild.',
                        value: 'guild_maint',
                    },
                    {
                        label: 'Switch Lavalink Node',
                        description: 'Instantly move all active players to another node.',
                        value: 'switch_node',
                    },
                    {
                        label: 'System Diagnostics',
                        description: 'Deep internal health check and metrics.',
                        value: 'diag',
                    },
                    {
                        label: 'Set Maintenance Reason',
                        description: 'Set a custom maintenance message.',
                        value: 'maint_reason',
                    },
                ])
        );

        const response = await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 300000,
        });

        collector.on('collect', async (i: StringSelectMenuInteraction) => {
            if (i.user.id !== config.ownerId) return;

            const value = i.values[0];

            if (value === 'global_maint') {
                const newState = !isMaintenance();
                setMaintenance(newState);
                await i.update({
                    content: `Global maintenance mode is now **${newState ? 'ENABLED' : 'DISABLED'}**.`,
                    embeds: [],
                    components: [],
                });
            } 
            else if (value === 'guild_maint') {
                const modal = new ModalBuilder()
                    .setCustomId('guild_maint_modal')
                    .setTitle('Guild Maintenance Mode');

                const guildIdInput = new TextInputBuilder()
                    .setCustomId('guild_id')
                    .setLabel('Enter the Guild ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(guildIdInput);
                modal.addComponents(firstActionRow);

                await i.showModal(modal);

                try {
                    const submitted: ModalSubmitInteraction = await i.awaitModalSubmit({
                        time: 60000,
                        filter: (mi) => mi.user.id === config.ownerId && mi.customId === 'guild_maint_modal',
                    });

                    const targetGuildId = submitted.fields.getTextInputValue('guild_id');
                    try {
                        const settings = await getGuildSettings(targetGuildId);
                        const newState = !settings.maintenance;
                        await updateGuildSettings(targetGuildId, { maintenance: newState });

                        await submitted.reply({
                            content: `Maintenance mode for guild \`${targetGuildId}\` is now **${newState ? 'ENABLED' : 'DISABLED'}**.`,
                            flags: MessageFlags.Ephemeral,
                        });
                        await i.editReply({ components: [] });
                    } catch (err) {
                        await submitted.reply({ content: 'Failed to fetch/update guild settings. Ensure the ID is valid.', flags: MessageFlags.Ephemeral });
                    }
                } catch {
                    // Modal timeout
                }
            }
            else if (value === 'switch_node') {
                const nodes = Array.from(client.kazagumo.shoukaku.nodes.values());
                if (nodes.length === 0) {
                    await i.update({ content: 'No Lavalink nodes are currently connected.', embeds: [], components: [] });
                    return;
                }

                const nodeOptions = nodes.map((n: any) => ({
                    label: n.name,
                    description: `Active players: ${n.stats?.players || 0}`,
                    value: `move_to_${n.name}`,
                }));

                const nodeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('node_select_menu')
                        .setPlaceholder('Select target node...')
                        .addOptions(nodeOptions)
                );

                await i.update({
                    content: 'Select the Lavalink node you want to move all active players to:',
                    embeds: [],
                    components: [nodeRow],
                });

                const nodeCollector = response.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    time: 60000,
                    filter: (nci) => nci.user.id === config.ownerId && nci.customId === 'node_select_menu',
                });

                nodeCollector.on('collect', async (nodeInter) => {
                    const targetNodeName = nodeInter.values[0].replace('move_to_', '');
                    
                    const { allClients } = require('../index');
                                        const players: KazagumoPlayer[] = [];
                    for (const c of allClients) {
                        if (c.kazagumo) {
                            players.push(...(Array.from(c.kazagumo.players.values()) as KazagumoPlayer[]));
                        }
                    }

                    await nodeInter.deferUpdate();
                    
                    let moved = 0;
                    for (const player of players ) {
                        if (player.shoukaku.node.name !== targetNodeName) {
                            try {
                                player.shoukaku.move(targetNodeName);
                                moved++;
                                // Inform users in the text channel
                                if (player.textId) {
                                    const channel = client.channels.cache.get(player.textId);
                                    if (channel && 'send' in channel) {
                                        const embed = new EmbedBuilder()
                                            .setDescription('The audio connection has been migrated to a backup node for optimal performance.');
                                        (channel as TextChannel).send({ embeds: [embed] }).catch(() => {});
                                    }
                                }
                            } catch (e: Error | any) {
                                logger.error('system', `Failed to move player ${player.guildId} to node ${targetNodeName}: ${e.message}`);
                            }
                        }
                    }

                    await nodeInter.editReply({
                        content: `Successfully moved **${moved}** active players to node \`${targetNodeName}\`.`,
                        components: [],
                    });
                });
            }
            else if (value === 'diag') {
                const { allClients } = require('../index');
                const primaryClient = allClients[0];

                // Memory
                const mem = process.memoryUsage();
                const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

                // Uptime
                const uptimeSec = process.uptime();
                const d = Math.floor(uptimeSec / 86400);
                const h = Math.floor((uptimeSec % 86400) / 3600);
                const m = Math.floor((uptimeSec % 3600) / 60);
                const s = Math.floor(uptimeSec % 60);
                const uptimeStr = `${d}d ${h}h ${m}m ${s}s`;

                // Bot pool
                const poolLines: string[] = [];
                for (let idx = 0; idx < allClients.length; idx++) {
                    const c = allClients[idx];
                    const label = idx === 0 ? 'Primary' : `Worker-${idx}`;
                    const username = c.user?.username ?? 'unknown';
                    const ready = c.isReady() ? 'Yes' : 'No';
                    const ping = c.ws?.ping ?? -1;
                    const wsStatus = c.ws?.status ?? -1;
                    const guilds = c.guilds?.cache?.size ?? 0;
                    const kazaPlayers = c.kazagumo?.players?.size ?? 0;
                    poolLines.push(
                        `${label}: ${username} | ready=${ready} ping=${ping}ms ws=${wsStatus} guilds=${guilds} players=${kazaPlayers}`
                    );
                }

                // Lavalink nodes
                const nodeLines: string[] = [];
                const stateMap: Record<number, string> = {
                    0: 'CONNECTING',
                    1: 'CONNECTED',
                    2: 'DISCONNECTING',
                    3: 'DISCONNECTED',
                };
                if (primaryClient?.kazagumo?.shoukaku?.nodes) {
                    for (const [name, node] of primaryClient.kazagumo.shoukaku.nodes as Map<string, { state: number, stats?: { players?: number, uptime?: number } }>) {
                        const state = stateMap[node.state as number] ?? `UNKNOWN(${node.state})`;
                        const activePlayers = node.stats?.players ?? 0;
                        const nodeUpSec = node.stats?.uptime ? Math.floor(node.stats.uptime / 1000) : 0;
                        const nd = Math.floor(nodeUpSec / 86400);
                        const nh = Math.floor((nodeUpSec % 86400) / 3600);
                        const nm = Math.floor((nodeUpSec % 3600) / 60);
                        nodeLines.push(
                            `${name}: state=${state} players=${activePlayers} uptime=${nd}d ${nh}h ${nm}m`
                        );
                    }
                }

                // Database cache
                let cacheSize = 0;
                try {
                    cacheSize = getSettingsCacheSize();
                } catch {
                    // fallback if not yet available
                }

                const diagEmbed = new EmbedBuilder()
                    .setColor(0x111111)
                    .setTitle('System Diagnostics')
                    .addFields(
                        {
                            name: 'Memory',
                            value: [
                                '```',
                                `RSS:           ${mb(mem.rss)}`,
                                `Heap Used:     ${mb(mem.heapUsed)}`,
                                `Heap Total:    ${mb(mem.heapTotal)}`,
                                `External:      ${mb(mem.external)}`,
                                `Array Buffers: ${mb(mem.arrayBuffers)}`,
                                '```',
                            ].join('\n'),
                        },
                        {
                            name: 'Process',
                            value: [
                                '```',
                                `Node.js: ${process.version}`,
                                `PID:     ${process.pid}`,
                                `Uptime:  ${uptimeStr}`,
                                '```',
                            ].join('\n'),
                        },
                        {
                            name: 'Bot Pool',
                            value: '```\n' + (poolLines.length > 0 ? poolLines.join('\n') : 'No clients') + '\n```',
                        },
                        {
                            name: 'Lavalink Nodes',
                            value: '```\n' + (nodeLines.length > 0 ? nodeLines.join('\n') : 'No nodes') + '\n```',
                        },
                        {
                            name: 'Database',
                            value: `\`\`\`\nCache entries: ${cacheSize}\n\`\`\``,
                        },
                        {
                            name: 'Version',
                            value: `\`\`\`\n${config.version}\n\`\`\``,
                        },
                    );

                await i.update({
                    embeds: [diagEmbed],
                    components: [],
                });
            }
            else if (value === 'maint_reason') {
                const modal = new ModalBuilder()
                    .setCustomId('maint_reason_modal')
                    .setTitle('Set Maintenance Reason');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('maint_reason_input')
                    .setLabel('Maintenance reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500);

                const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
                modal.addComponents(actionRow);

                await i.showModal(modal);

                try {
                    const submitted: ModalSubmitInteraction = await i.awaitModalSubmit({
                        time: 60000,
                        filter: (mi) => mi.user.id === config.ownerId && mi.customId === 'maint_reason_modal',
                    });

                    const reason = submitted.fields.getTextInputValue('maint_reason_input');
                    maintenanceReason = reason;
                    setMaintenance(true);

                    await submitted.reply({
                        content: `Maintenance enabled with reason: **${reason}**`,
                        flags: MessageFlags.Ephemeral,
                    });
                    await i.editReply({ components: [] });
                } catch {
                    // Modal timeout
                }
            }
        });
    },

    async executePrefix(message: Message, args: string[], client: Client) {
        // Mock a basic interaction-like object so the code logic works for prefix too,
        // or just advise them to use slash command since it relies heavily on UI components.
        message.reply('This command requires UI components and must be executed as a slash command (`/own`).');
    }
};
