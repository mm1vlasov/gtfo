const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const config = require('./config');
const { MessageFlags } = require('discord.js');
const { RESIGN_CHANNEL_ID, getSetupContent: getResignSetupContent, handleResignInteraction } = require('./resign.js');
const { PROMOTION_CHANNEL_ID, getSetupContent: getPromotionSetupContent, handlePromotionInteraction } = require('./promotion.js');
const { UPRANK_REQUEST_CHANNEL_ID, getSetupContent: getUprankRequestSetupContent, handleUprankRequestInteraction } = require('./uprankRequest.js');
const { FACTION_TRANSFER_CHANNEL_ID, getSetupContent: getFactionTransferSetupContent, handleFactionTransferInteraction } = require('./factionTransfer.js');
const { startRosterScheduler } = require('./roster.js');
const { sendOrUpdateBotInfo } = require('./botInfo.js');

const commandsDir = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

const commandsData = [];
const executeCommand = {};

for (const file of commandFiles) {
  const cmd = require(path.join(commandsDir, file));
  if (cmd.data && cmd.run) {
    commandsData.push({ data: cmd.data });
    executeCommand[cmd.data.name] = cmd.run;
  }
}

const baseIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];
if (config.usePrivilegedIntents === true) {
  baseIntents.push(GatewayIntentBits.GuildMembers);
}
const client = new Client({ intents: baseIntents });

client.once(Events.ClientReady, async () => {
  const readyAt = new Date().toISOString();
  console.log(`[Старт] Бот ${client.user.username} (${client.user.id}) запущен в ${readyAt}`);

  const rest = new REST().setToken(config.token);
  const commands = commandsData.map((c) => c.data.toJSON());

  try {
    if (config.guildId) {
      await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
      console.log('Слэш-команды зарегистрированы для гильдии (дубликаты глобальных команд удалены).');
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
      console.log('Слэш-команды зарегистрированы глобально.');
    }
  } catch (err) {
    console.error('Ошибка регистрации команд:', err);
  }

  async function ensureSetupMessage(channel, getSetupContent, embedTitle, logName) {
    if (!channel) {
      console.warn(logName + ': канал не найден (проверьте ID и доступ бота).');
      return;
    }
    const setup = getSetupContent();
    const existing = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const setupMsg = existing?.find((m) => m.author.id === client.user.id && m.embeds[0]?.title === embedTitle);
    try {
      if (setupMsg) {
        await setupMsg.edit(setup);
        console.log(logName + ': сообщение с кнопкой обновлено.');
      } else {
        await channel.send(setup);
        console.log(logName + ': новое сообщение с кнопкой отправлено.');
      }
    } catch (err) {
      console.error(logName + ': не удалось отправить/обновить сообщение в канал:', err);
    }
  }

  const resignChannel = RESIGN_CHANNEL_ID ? await client.channels.fetch(RESIGN_CHANNEL_ID).catch(() => null) : null;
  await ensureSetupMessage(resignChannel, getResignSetupContent, 'Заявление на увольнение', 'Рапорт на увольнение');

  const promotionChannel = PROMOTION_CHANNEL_ID ? await client.channels.fetch(PROMOTION_CHANNEL_ID).catch(() => null) : null;
  await ensureSetupMessage(promotionChannel, getPromotionSetupContent, 'Запрос на повышение', 'Запрос на повышение');

  const uprankRequestChannel = UPRANK_REQUEST_CHANNEL_ID ? await client.channels.fetch(UPRANK_REQUEST_CHANNEL_ID).catch(() => null) : null;
  await ensureSetupMessage(uprankRequestChannel, getUprankRequestSetupContent, 'Запрос на повышение (со скриншотами)', 'Запрос на повышение (скриншоты)');

  const factionTransferChannel = FACTION_TRANSFER_CHANNEL_ID ? await client.channels.fetch(FACTION_TRANSFER_CHANNEL_ID).catch(() => null) : null;
  await ensureSetupMessage(factionTransferChannel, getFactionTransferSetupContent, 'Переводы фракций', 'Переводы фракций');

  if (config.usePrivilegedIntents && (config.roster?.highStaff?.channelId || config.roster?.departments?.length)) {
    startRosterScheduler(client);
  } else if (config.roster?.highStaff?.channelId || config.roster?.departments?.length) {
    console.warn('[Roster] Составы отключены: включите usePrivilegedIntents в config.json и Server Members Intent в Discord Developer Portal.');
  }

  await sendOrUpdateBotInfo(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
    try {
      const handledResign = await handleResignInteraction(interaction);
      if (handledResign) return;
      const handledPromotion = await handlePromotionInteraction(interaction);
      if (handledPromotion) return;
      const handledUprankRequest = await handleUprankRequestInteraction(interaction);
      if (handledUprankRequest) return;
      const handledFactionTransfer = await handleFactionTransferInteraction(interaction);
      if (handledFactionTransfer) return;
    } catch (err) {
      console.error(err);
      const reply = { content: 'Произошла ошибка.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  // Для /uninvite доступ проверяется только внутри команды (только Старший состав; MA не может).
  const allowedRoles = config.roles?.commands || [];
  if (allowedRoles.length > 0 && interaction.commandName !== 'uninvite') {
    const member = interaction.member;
    const hasRole = member?.roles?.cache?.some((r) => allowedRoles.includes(r.id));
    if (!hasRole) {
      await interaction.reply({
        content:
          'У вас нет прав на использование кадровых команд. Требуется роль «Старший состав» или «MA | Millitary Academy».',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
  }

  const handler = executeCommand[interaction.commandName];
  if (handler) {
    try {
      await handler(interaction);
    } catch (err) {
      console.error(err);
      const reply = { content: 'Произошла ошибка.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  }
});

if (!config.token) {
  console.error('Токен не задан. Укажите BOT_TOKEN (или DISCORD_TOKEN) в переменных окружения или token в config.json.');
  process.exit(1);
}

console.log('[Старт] Подключение к Discord...');
client.login(config.token);
