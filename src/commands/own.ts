import {
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
} from 'discord.js';
import { config } from '../config';
import { isMaintenance, setMaintenance } from '../utils/maintenance';
import { getGuildSettings, updateGuildSettings } from '../utils/database';
import { logger } from '../utils/logger';

export default {
    data: new SlashCommandBuilder()
        .setName('own')
        .setDescription('Owner only management panel'),

    async execute(interaction: ChatInputCommandInteraction, client: any) {
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
                    
                    const { clientB } = require('../index');
                    const players = Array.from(client.kazagumo.players.values());
                    if (clientB && clientB.kazagumo) {
                        players.push(...Array.from(clientB.kazagumo.players.values()));
                    }

                    await nodeInter.deferUpdate();
                    
                    let moved = 0;
                    for (const player of players as any[]) {
                        if (player.shoukaku.node.name !== targetNodeName) {
                            try {
                                player.shoukaku.move(targetNodeName);
                                moved++;
                                // Inform users in the text channel
                                if (player.textId) {
                                    const channel = client.channels.cache.get(player.textId);
                                    if (channel && channel.isTextBased()) {
                                        const embed = new EmbedBuilder()
                                            .setDescription('The audio connection has been migrated to a backup node for optimal performance.');
                                        channel.send({ embeds: [embed] }).catch(() => {});
                                    }
                                }
                            } catch (e: any) {
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
        });
    },

    async executePrefix(message: any, args: string[], client: any) {
        // Mock a basic interaction-like object so the code logic works for prefix too,
        // or just advise them to use slash command since it relies heavily on UI components.
        message.reply('This command requires UI components and must be executed as a slash command (`/own`).');
    }
};
