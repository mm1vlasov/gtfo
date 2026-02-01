const config = require('./config');
const { EmbedBuilder } = require('discord.js');

const EMBED_COLOR = 0x2b2d31;
const EMBED_FIELD_VALUE_MAX = 1024;

function roleMentions(roleIds) {
  if (!roleIds?.length) return '—';
  return roleIds.map((id) => `<@&${id}>`).join(', ');
}

function channelMention(channelId) {
  return channelId ? `<#${channelId}>` : '—';
}

function truncate(text) {
  if (!text || text.length <= EMBED_FIELD_VALUE_MAX) return text;
  return text.slice(0, EMBED_FIELD_VALUE_MAX - 3) + '...';
}

function buildBotInfoEmbeds() {
  const r = config.roles || {};
  const c = config.channels || {};
  const roster = config.roster || {};

  const embeds = [];

  const embed1 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Информация о боте')
    .setDescription(
      'Ниже описаны все права доступа, проверки и каналы бота. Роли и каналы задаются в `config.json`.'
    )
    .addFields(
      {
        name: '**Слэш-команды (кадровые)**',
        value: truncate(
          `**Кто имеет доступ:** ${roleMentions(r.commands)}\n\n` +
          'Команды: `/invite`, `/uprank`, `/downrank`, `/transfer` (для /uninvite — отдельная проверка, см. ниже).\n' +
          'Проверка: у участника должна быть хотя бы одна из указанных ролей. Без доступа бот отвечает: «У вас нет прав на использование кадровых команд».'
        ),
        inline: false,
      },
      {
        name: '**Команда /invite (принятие)**',
        value: truncate(
          `**Кто может использовать:** ${roleMentions(r.commands)}\n` +
          `**Какие роли выдаются новому участнику:** ${roleMentions(r.inviteRoles)}\n` +
          `**Куда отправляется запись:** ${channelMention(c.invite)}\n\n` +
          'Проверка: право на команды (см. выше). Бот выдаёт выбранному пользователю роли из `inviteRoles` и отправляет эмбед в канал аудита.'
        ),
        inline: false,
      },
      {
        name: '**Команда /uninvite (увольнение)**',
        value: truncate(
          `**Кто может использовать:** только ${roleMentions(r.uninvite && r.uninvite.length ? r.uninvite : [])} (Старший состав).\n` +
          `**Куда отправляется запись:** ${channelMention(c.uninvite)}\n\n` +
          'Действие: снимает у выбранного участника **все** роли. Роль бота должна быть выше ролей участника.'
        ),
        inline: false,
      },
      {
        name: '**Команда /transfer (перевод в отдел)**',
        value: truncate(
          `**Кто может использовать:** ${roleMentions(r.commands)}\n` +
          `**Куда отправляется запись:** ${channelMention(c.transfer)}\n\n` +
          'Проверка: роли «из отдела» и «в отдел» должны быть из списка `roles.departments` в конфиге (только разрешённые отделы). Бот снимает одну роль и выдаёт другую.'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed1);

  const embed2 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Рапорт на увольнение')
    .addFields(
      {
        name: '**Канал**',
        value: channelMention(c.resign),
        inline: false,
      },
      {
        name: '**Кто может подать заявление (кнопка)**',
        value: roleMentions(r.resignPromotionSubmit),
        inline: false,
      },
      {
        name: '**Кто может одобрить / отклонить**',
        value: roleMentions(r.resignPromotionApprove),
        inline: false,
      },
      {
        name: '**Проверки**',
        value: truncate(
          '• При нажатии «Подать заявление» проверяется роль из `resignPromotionSubmit` (SANG).\n' +
          '• При одобрении/отклонении проверяется роль из `resignPromotionApprove` (Старший состав).\n' +
          '• При одобрении бот снимает у участника все роли и отправляет запись в канал увольнений.'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed2);

  const embed3 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Запрос на повышение (кнопка в канале)')
    .addFields(
      {
        name: '**Канал**',
        value: channelMention(c.promotion),
        inline: false,
      },
      {
        name: '**Кто может подать запрос (кнопка)**',
        value: roleMentions(r.resignPromotionSubmit),
        inline: false,
      },
      {
        name: '**Кто может одобрить / отклонить**',
        value: roleMentions(r.resignPromotionApprove),
        inline: false,
      },
      {
        name: '**Проверки**',
        value: truncate(
          '• При нажатии «Запрос на повышение» проверяется роль из `resignPromotionSubmit`.\n' +
          '• При одобрении/отклонении проверяется роль из `resignPromotionApprove`. Упоминание роли Старший состав в сообщении.'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed3);

  const embed4 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Отчёты хай ранг (запрос на повышение со скриншотами)')
    .addFields(
      {
        name: '**Канал**',
        value: channelMention(c.uprankRequest),
        inline: false,
      },
      {
        name: '**Кто может подать заявку (кнопка)**',
        value: roleMentions(r.resignPromotionSubmit),
        inline: false,
      },
      {
        name: '**Кто может одобрить / отклонить / отправить в кадровый аудит**',
        value: roleMentions(r.uprankRequestApprove),
        inline: false,
      },
      {
        name: '**Проверки**',
        value: truncate(
          '• Подать заявку может участник с ролью из `resignPromotionSubmit` (SANG).\n' +
          '• Одобрять, отклонять и нажимать «Отправить кадровый аудит» может только роль из `uprankRequestApprove` (Генерал-лейтенант).\n' +
          '• После одобрения и отправки в аудит запись уходит в канал `channels.uprank`.'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed4);

  const embed5 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Переводы фракций')
    .addFields(
      {
        name: '**Канал**',
        value: channelMention(c.factionTransfer),
        inline: false,
      },
      {
        name: '**Кто может подать заявку (кнопка)**',
        value: roleMentions(r.factionTransferSubmit),
        inline: false,
      },
      {
        name: '**Кто может одобрить / отклонить**',
        value: roleMentions(r.factionTransferApprove),
        inline: false,
      },
      {
        name: '**Проверки**',
        value: truncate(
          '• Подать заявку может участник с ролью из `factionTransferSubmit` (SANG).\n' +
          '• Одобрять и отклонять может только роль из `factionTransferApprove` (Генерал).'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed5);

  const embed6 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Составы отделов и хай стафф')
    .addFields(
      {
        name: '**Хай стафф (канал)**',
        value: roster.highStaff?.channelId ? channelMention(roster.highStaff.channelId) : '—',
        inline: false,
      },
      {
        name: '**Отделы (каналы составов)**',
        value: truncate(
          roster.departments?.length
            ? roster.departments.map((d) => `${d.shortName}: ${channelMention(d.channelId)}`).join('\n')
            : '—'
        ),
        inline: false,
      },
      {
        name: '**Обновление**',
        value: `Каждые **${roster.updateIntervalMinutes ?? 30}** мин. Сообщения обновляются, новые создаются только при отсутствии в канале.`,
        inline: false,
      },
      {
        name: '**Исключение из составов отделов**',
        value: truncate(
          'Участники с ролями из `roster.excludeFromDepartmentRoster` (например, Генерал-лейтенант) **не показываются** в составах отделов (Curator, Head, Deputy Head, Instructor, Staff). В хай стаффе они учитываются.'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed6);

  const embed7 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Прочее')
    .addFields(
      {
        name: '**Каналы аудита**',
        value: truncate(
          `Приём/увольнение/повышение: ${channelMention(c.invite)}\n` +
          `Переводы отделов: ${channelMention(c.transfer)}\n` +
          `Запросы на повышение (слэш): ${channelMention(c.uprank)}`
        ),
        inline: false,
      },
      {
        name: '**Привилегированные интенты**',
        value: truncate(
          '`usePrivilegedIntents: true` в конфиге включает интент участников (Server Members Intent в портале). Нужен для: составы отделов, приветствие в welcome при входе нового участника.'
        ),
        inline: false,
      }
    )
    .setTimestamp();
  embeds.push(embed7);

  return embeds;
}

async function findBotInfoMessage(channel) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  return messages.find(
    (m) =>
      m.author.id === channel.client.user.id &&
      m.embeds?.length > 0 &&
      m.embeds[0]?.title === 'Информация о боте'
  ) ?? null;
}

async function sendOrUpdateBotInfo(client) {
  const channelId = config.channels?.botInfo;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.warn('[BotInfo] Канал информации о боте не найден.');
    return;
  }
  const embeds = buildBotInfoEmbeds();
  const existing = await findBotInfoMessage(channel);
  try {
    if (existing) {
      await existing.edit({ embeds });
      console.log('[BotInfo] Сообщение с информацией о боте обновлено.');
    } else {
      await channel.send({ embeds });
      console.log('[BotInfo] Сообщение с информацией о боте отправлено.');
    }
  } catch (err) {
    console.error('[BotInfo] Не удалось отправить/обновить сообщение:', err);
  }
}

module.exports = {
  buildBotInfoEmbeds,
  sendOrUpdateBotInfo,
};
