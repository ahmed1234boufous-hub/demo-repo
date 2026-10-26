const { 
    Client, 
    GatewayIntentBits, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    ChannelType
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const Datastore = require('nedb-promises');
require('dotenv').config();

// --- DATABASE SETUP ---
const db = Datastore.create({ filename: 'settings.db', autoload: true });
const levelsDb = Datastore.create({ filename: 'levels.db', autoload: true });

// --- DEFAULT EMBED CONFIGURATIONS ---
const defaultSettings = {
    ban: { title: '🔨 Member Banned', color: '#ff0000', thumbnail: '', image: '', description: 'User **{user}** has been banned.\n**Reason:** {reason}' },
    kick: { title: '👢 Member Kicked', color: '#ffa500', thumbnail: '', image: '', description: 'User **{user}** has been kicked.\n**Reason:** {reason}' },
    mute: { title: '🔇 Member Muted', color: '#ffcc00', thumbnail: '', image: '', description: 'User **{user}** has been muted.\n**Reason:** {reason}' },
    unmute: { title: '🔊 Member Unmuted', color: '#00ff00', thumbnail: '', image: '', description: 'User **{user}** has been unmuted.' },
    warn: { title: '⚠️ Member Warned', color: '#ffff00', thumbnail: '', image: '', description: 'User **{user}** has received a warning.\n**Reason:** {reason}' },
    welcome: { 
        title: '👋 Welcome to the Server!', 
        color: '#5865F2', 
        thumbnail: '', 
        image: '',
        description: 'Hey {user}, welcome to **{server}**! We are thrilled to have you here. You are member #{memberCount}.', 
        channelId: '' 
    },
    leveling: {
        title: '🎉 Level Up!',
        color: '#00ffcc',
        thumbnail: '',
        image: '',
        description: 'GG {user}! You just advanced to **Level {level}**!'
    }
};

async function getConfig(key) {
    let setting = await db.findOne({ command: key });
    return setting || defaultSettings[key];
}

// Helper to open the customization modal
function createEmbedModal(key, config) {
    const modal = new ModalBuilder()
        .setCustomId(`modal_${key}`)
        .setTitle(`Customize: ${key.toUpperCase()}`);

    const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel('Embed Title')
        .setStyle(TextInputStyle.Short)
        .setValue(config.title || '')
        .setRequired(true);

    const colorInput = new TextInputBuilder()
        .setCustomId('embed_color')
        .setLabel('Color (Hex, e.g. #5865F2)')
        .setStyle(TextInputStyle.Short)
        .setValue(config.color || '#5865F2')
        .setRequired(true);

    const thumbInput = new TextInputBuilder()
        .setCustomId('embed_thumbnail')
        .setLabel('Thumbnail URL (Optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(config.thumbnail || '')
        .setRequired(false);

    const imageInput = new TextInputBuilder()
        .setCustomId('embed_image')
        .setLabel('Image / GIF URL (Optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(config.image || '')
        .setRequired(false);

    const descInput = new TextInputBuilder()
        .setCustomId('embed_desc')
        .setLabel('Description Content')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(config.description || '')
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(colorInput),
        new ActionRowBuilder().addComponents(thumbInput),
        new ActionRowBuilder().addComponents(imageInput),
        new ActionRowBuilder().addComponents(descInput)
    );

    return modal;
}

// --- DISCORD CLIENT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// --- REGISTER SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Embed dashboard and customization commands')
        .addSubcommand(sub => 
            sub.setName('dashboard')
               .setDescription('Open the interactive embed customization dashboard')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Manage the welcome channel, embed customization, or run a test')
        .addChannelOption(option => 
            option.setName('channel')
                  .setDescription('Set the text channel for welcome greetings')
                  .addChannelTypes(ChannelType.GuildText)
                  .setRequired(false)
        )
        .addStringOption(option => 
            option.setName('action')
                  .setDescription('Configure or preview welcome messages')
                  .setRequired(false)
                  .addChoices(
                      { name: 'Customize Embed', value: 'customize' },
                      { name: 'Test Welcome', value: 'test' }
                  )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .addUserOption(option => option.setName('user').setDescription('The user to ban').setRequired(true))
        .addIntegerOption(option => option.setName('duration').setDescription('Optional duration in minutes for temporary ban').setRequired(false))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the ban').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .addUserOption(option => option.setName('user').setDescription('The user to kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the kick').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout/mute a member')
        .addUserOption(option => option.setName('user').setDescription('The user to mute').setRequired(true))
        .addIntegerOption(option => option.setName('duration').setDescription('Duration in minutes (default 60)').setRequired(false))
        .addStringOption(option => option.setName('reason').setDescription('Reason for the mute').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a member')
        .addUserOption(option => option.setName('user').setDescription('The user to unmute').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issue a warning embed to a member')
        .addUserOption(option => option.setName('user').setDescription('The user to warn').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason for warning').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Check your current level and XP')
        .addUserOption(option => option.setName('user').setDescription('The user to check rank for').setRequired(false)),

    new SlashCommandBuilder()
        .setName('quran')
        .setDescription('Stream 24/7 Quran radio into a voice channel')
        .addSubcommand(sub =>
            sub.setName('start')
               .setDescription('Connect and start streaming Quran radio')
        )
        .addSubcommand(sub =>
            sub.setName('stop')
               .setDescription('Disconnect the Quran radio stream')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands globally.');
    } catch (error) {
        console.error(error);
    }
});

// Helper function to build custom embeds dynamically
async function buildEmbed(key, variables) {
    const config = await getConfig(key);
    let desc = config.description;
    
    for (const [valKey, val] of Object.entries(variables)) {
        desc = desc.replace(new RegExp(`\\{${valKey}\\}`, 'g'), val);
    }

    const embed = new EmbedBuilder()
        .setTitle(config.title)
        .setColor(config.color)
        .setDescription(desc)
        .setTimestamp();

    if (config.thumbnail && config.thumbnail.startsWith('http')) embed.setThumbnail(config.thumbnail);
    if (config.image && config.image.startsWith('http')) embed.setImage(config.image);

    return embed;
}

// --- WELCOME EVENT LISTENER ---
client.on('guildMemberAdd', async (member) => {
    const config = await getConfig('welcome');
    if (!config.channelId) return;

    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) return;

    const embed = await buildEmbed('welcome', {
        user: `<@${member.id}>`,
        server: member.guild.name,
        memberCount: member.guild.memberCount
    });

    // Automatically set the new member's avatar as the thumbnail
    if (!config.thumbnail) {
        embed.setThumbnail(member.user.displayAvatarURL());
    }

    await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
});

// --- LEVELING SYSTEM EVENT LISTENER ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;

    let userXpData = await levelsDb.findOne({ userId, guildId });
    const xpToAdd = Math.floor(Math.random() * 10) + 15;

    if (!userXpData) {
        userXpData = { userId, guildId, xp: xpToAdd, level: 1 };
    } else {
        userXpData.xp += xpToAdd;
    }

    const neededXp = userXpData.level * 100;
    if (userXpData.xp >= neededXp) {
        userXpData.level += 1;
        userXpData.xp -= neededXp;

        const embed = await buildEmbed('leveling', {
            user: `<@${userId}>`,
            level: userXpData.level
        });

        await message.channel.send({ embeds: [embed] }).catch(() => {});
    }

    await levelsDb.update({ userId, guildId }, userXpData, { upsert: true });
});

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    try {
        if (!interaction.isChatInputCommand() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

        // Automatically defer reply to prevent timeouts and show loading states
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }

        // 1. SLASH COMMANDS
        if (interaction.isChatInputCommand()) {
            const { commandName, options } = interaction;

            if (commandName === 'embed') {
                const sub = options.getSubcommand();
                if (sub === 'dashboard') {
                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ Bot Embed Customization Dashboard')
                        .setColor('#5865F2')
                        .setDescription('Select any command or module from the dropdown menu below to fully customize its title, color, thumbnail, image, and description.')
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('dashboard_select')
                            .setPlaceholder('Choose a command/module to customize...')
                            .addOptions([
                                { label: 'Welcome Module', value: 'edit_welcome', description: 'Customize greeting embed, thumbnail, and image' },
                                { label: 'Leveling Module', value: 'edit_leveling', description: 'Customize leveling notification embed' },
                                { label: 'Ban Command', value: 'edit_ban', description: 'Customize the /ban embed' },
                                { label: 'Kick Command', value: 'edit_kick', description: 'Customize the /kick embed' },
                                { label: 'Mute Command', value: 'edit_mute', description: 'Customize the /mute embed' },
                                { label: 'Unmute Command', value: 'edit_unmute', description: 'Customize the /unmute embed' },
                                { label: 'Warn Command', value: 'edit_warn', description: 'Customize the /warn embed' },
                            ])
                    );

                    await interaction.editReply({ embeds: [embed], components: [row] });
                }
            }
            else if (commandName === 'welcome') {
                const targetChannel = options.getChannel('channel');
                const action = options.getString('action');

                if (targetChannel) {
                    let config = await getConfig('welcome');
                    config.channelId = targetChannel.id;
                    await db.update({ command: 'welcome' }, { command: 'welcome', ...config }, { upsert: true });
                    await interaction.editReply({ content: `✅ Welcome channel successfully set to <#${targetChannel.id}>!` });
                    return;
                }

                if (action === 'customize') {
                    const config = await getConfig('welcome');
                    const modal = createEmbedModal('welcome', config);
                    
                    const row = new ActionRowBuilder().addComponents(
                        new require('discord.js').ButtonBuilder()
                            .setCustomId('open_welcome_modal')
                            .setLabel('Open Welcome Customizer')
                            .setStyle(require('discord.js').ButtonStyle.Primary)
                    );
                    await interaction.editReply({ content: 'Click the button below to open your welcome settings modal:', components: [row] });
                    return;
                }

                if (action === 'test') {
                    const embed = await buildEmbed('welcome', {
                        user: `<@${interaction.user.id}>`,
                        server: interaction.guild.name,
                        memberCount: interaction.guild.memberCount
                    });
                    embed.setThumbnail(interaction.user.displayAvatarURL());

                    await interaction.editReply({ content: '🧪 **Welcome Embed Preview:**', embeds: [embed] });
                    return;
                }

                await interaction.editReply({ content: '⚠️ Please select a channel or choose a valid action option for the welcome command.' });
            }
            else if (commandName === 'ban') {
                const member = options.getMember('user');
                const reason = options.getString('reason') || 'No reason provided';
                if (!member.bannable) {
                    await interaction.editReply({ content: "❌ I cannot ban this user." });
                    return;
                }

                await member.ban({ reason });
                const embed = await buildEmbed('ban', { user: member.user.tag, reason });
                await interaction.editReply({ embeds: [embed] });
            }
            else if (commandName === 'kick') {
                const member = options.getMember('user');
                const reason = options.getString('reason') || 'No reason provided';
                if (!member.kickable) {
                    await interaction.editReply({ content: "❌ I cannot kick this user." });
                    return;
                }

                await member.kick(reason);
                const embed = await buildEmbed('kick', { user: member.user.tag, reason });
                await interaction.editReply({ embeds: [embed] });
            }
            else if (commandName === 'mute') {
                const member = options.getMember('user');
                const duration = options.getInteger('duration') || 60;
                const reason = options.getString('reason') || 'No reason provided';

                await member.timeout(duration * 60 * 1000, reason);
                const embed = await buildEmbed('mute', { user: member.user.tag, reason });
                await interaction.editReply({ embeds: [embed] });
            }
            else if (commandName === 'unmute') {
                const member = options.getMember('user');
                await member.timeout(null);
                const embed = await buildEmbed('unmute', { user: member.user.tag });
                await interaction.editReply({ embeds: [embed] });
            }
            else if (commandName === 'warn') {
                const member = options.getMember('user');
                const reason = options.getString('reason');
                const embed = await buildEmbed('warn', { user: member.user.tag, reason });
                await interaction.editReply({ embeds: [embed] });
            }
            else if (commandName === 'rank') {
                const targetUser = options.getUser('user') || interaction.user;
                const userXpData = await levelsDb.findOne({ userId: targetUser.id, guildId: interaction.guild.id }) || { xp: 0, level: 1 };
                
                const rankEmbed = new EmbedBuilder()
                    .setTitle(`📊 Rank Card: ${targetUser.tag}`)
                    .setColor('#00ffcc')
                    .addFields(
                        { name: 'Level', value: `${userXpData.level}`, inline: true },
                        { name: 'XP', value: `${userXpData.xp} / ${userXpData.level * 100}`, inline: true }
                    )
                    .setThumbnail(targetUser.displayAvatarURL());

                await interaction.editReply({ embeds: [rankEmbed] });
            }
            else if (commandName === 'quran') {
                const sub = options.getSubcommand();
                if (sub === 'start') {
                    const voiceChannel = interaction.member.voice.channel;
                    if (!voiceChannel) {
                        await interaction.editReply({ content: '❌ You need to join a voice channel first!' });
                        return;
                    }

                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    });

                    const player = createAudioPlayer();
                    const resource = createAudioResource('https://radio.muslimcentral.com/quran/audio.mp3');

                    player.play(resource);
                    connection.subscribe(player);

                    await interaction.editReply({ content: '📻 Successfully connected and streaming 24/7 Quran Radio into your voice channel!' });
                } 
                else if (sub === 'stop') {
                    const connection = getVoiceConnection(interaction.guild.id);
                    if (connection) {
                        connection.destroy();
                        await interaction.editReply({ content: '🛑 Quran radio stream stopped and disconnected from voice.' });
                    } else {
                        await interaction.editReply({ content: '❌ The bot is not connected to any voice channel.' });
                    }
                }
            }
        }

        // 2. SELECT MENU
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'dashboard_select') {
                const key = interaction.values[0].replace('edit_', '');
                const config = await getConfig(key);
                const modal = createEmbedModal(key, config);
                await interaction.showModal(modal);
            }
        }

        // 3. MODAL SUBMIT
        else if (interaction.isModalSubmit()) {
            const key = interaction.customId.replace('modal_', '');
            const title = interaction.fields.getTextInputValue('embed_title');
            const color = interaction.fields.getTextInputValue('embed_color');
            const thumbnail = interaction.fields.getTextInputValue('embed_thumbnail');
            const image = interaction.fields.getTextInputValue('embed_image');
            const description = interaction.fields.getTextInputValue('embed_desc');

            let currentConfig = await getConfig(key);

            await db.update(
                { command: key },
                { 
                    command: key, 
                    channelId: currentConfig.channelId || '', 
                    title, 
                    color, 
                    thumbnail, 
                    image, 
                    description 
                },
                { upsert: true }
            );

            await interaction.editReply({ 
                content: `✅ Successfully updated the configuration and embed for **${key}**!`, 
                components: [] 
            });
        }
    } catch (err) {
        console.error(err);
        const errorMsg = { content: "❌ An error occurred processing this action.", ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errorMsg).catch(() => {});
        } else {
            await interaction.reply(errorMsg).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
