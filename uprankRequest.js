const config = require('./config');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { isValidPassport, getDisplayName, getChannelId, FOLDER } = require('./utils.js');

const UPRANK_REQUEST_CHANNEL_ID = config.channels?.uprankRequest;
const EMBED_COLOR = 0x2b2d31;
const SETUP_EMBED_COLOR = 0x3498db; // синяя полоска, как в канале увольнений
const COLLECTOR_TIME_MS = 60_000;
const BUTTON_LABEL_MAX = 80;

const pendingRequest = new Map();
const pendingByMessage = new Map();

function truncateLabel(text, max = BUTTON_LABEL_MAX) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function getSetupContent() {
  return {
    content: null,
    embeds: [
      new EmbedBuilder()
        .setColor(SETUP_EMBED_COLOR)
        .setTitle('Запрос на повышение (со скриншотами)')
        .setDescription('Чтобы подать запрос на повышение с доказательствами работы, вам нужно нажать кнопку ниже, заполнить анкету и отправить 3 скриншота из игры!'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('uprank_req_open_form')
          .setLabel('Подать запрос на повышение')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildFormModal() {
  const modal = new ModalBuilder()
    .setCustomId('uprank_req_form_modal')
    .setTitle('Запрос на повышение');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('uprank_req_passport')
        .setLabel('Номер паспорта (StaticID), только цифры')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('uprank_req_current_rank')
        .setLabel('Текущий ранг (цифра)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('uprank_req_new_rank')
        .setLabel('На какой ранг повыситься (цифра)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
    )
  );

  return modal;
}

function buildReportEmbed(applicantUser, applicantDisplayName, passport, currentRank, newRank) {
  const filledBy = `${applicantUser} | ${applicantDisplayName}`;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Запрос на повышение`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${filledBy}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Текущий ранг**', value: `• ${currentRank}`, inline: false },
      { name: '**Новый ранг**', value: `• ${newRank}`, inline: false },
      { name: '**Доказательства**', value: '• 3 скриншота из игры (вложения ниже)', inline: false }
    )
    .setTimestamp();
}

function getActionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('uprank_req_approve')
        .setLabel('Одобрить')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('uprank_req_decline')
        .setLabel('Отклонить')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function downloadAttachment(attachment) {
  const res = await fetch(attachment.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = attachment.name && /\.(png|jpe?g|gif|webp)$/i.test(attachment.name) ? attachment.name : 'proof.png';
  return { attachment: buf, name };
}

function hasRole(member, roleIds) {
  if (!member?.roles?.cache) return false;
  const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
  return ids.some((id) => member.roles.cache.has(id));
}

const allowedApproveRoles = () => config.roles?.uprankRequestApprove || [];

async function handleOpenForm(interaction) {
  if (interaction.customId !== 'uprank_req_open_form') return false;

  const allowedRoles = config.roles?.uprankRequestSubmit || config.roles?.resignPromotionSubmit || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Подавать запрос на повышение может только участник с соответствующей ролью.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildFormModal());
  return true;
}

async function handleFormModalSubmit(interaction) {
  if (interaction.customId !== 'uprank_req_form_modal') return false;

  const passport = interaction.fields.getTextInputValue('uprank_req_passport').trim();
  const currentRank = interaction.fields.getTextInputValue('uprank_req_current_rank').trim();
  const newRank = interaction.fields.getTextInputValue('uprank_req_new_rank').trim();

  const errors = [];
  if (!passport) {
    errors.push('• **Номер паспорта:** поле обязательно.');
  } else if (!isValidPassport(passport)) {
    errors.push('• **Номер паспорта:** допускаются только цифры.');
  }
  if (!currentRank) errors.push('• **Текущий ранг:** поле обязательно.');
  if (!newRank) errors.push('• **Новый ранг:** поле обязательно.');

  if (errors.length > 0) {
    await interaction.reply({
      content: `❌ **Ошибки в форме:**\n\n${errors.join('\n')}\n\nИсправьте поля и отправьте форму снова.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.reply({
    content: 'Отправьте **ровно 3 скриншота из игры** в этот канал одним сообщением в течение 60 секунд.',
    flags: MessageFlags.Ephemeral,
  });

  const channel = interaction.channel;
  pendingRequest.set(interaction.user.id, {
    passport,
    currentRank,
    newRank,
    userId: interaction.user.id,
    timestamp: Date.now(),
  });

  const collector = channel.createMessageCollector({
    filter: (m) => m.author.id === interaction.user.id,
    time: COLLECTOR_TIME_MS,
  });

  collector.on('collect', async (message) => {
    if (message.attachments.size !== 3) {
      const reply = await message.reply('Нужно прикрепить **ровно 3 скриншота**. Отправьте одно сообщение с тремя вложениями.').catch(() => null);
      if (reply) {
        setTimeout(() => { message.delete().catch(() => {}); reply.delete().catch(() => {}); }, 5000);
      }
      return;
    }

    const data = pendingRequest.get(interaction.user.id);
    if (!data) return;
    pendingRequest.delete(interaction.user.id);
    collector.stop();

    const attachments = [...message.attachments.values()].slice(0, 3);
    let files;
    try {
      files = await Promise.all(attachments.map((a, i) => downloadAttachment(a).then((r) => ({ ...r, name: `proof${i + 1}.png` }))));
    } catch (err) {
      console.error('UprankRequest: failed to download images', err);
      await channel.send({ content: 'Не удалось загрузить изображения. Попробуйте снова.' }).catch(() => {});
      return;
    }

    const applicantDisplayName = getDisplayName(interaction);
    const embed = buildReportEmbed(interaction.user, applicantDisplayName, data.passport, data.currentRank, data.newRank);
    const filePayload = files.map((f) => ({ attachment: f.attachment, name: f.name }));

    const sentMsg = await channel.send({
      files: filePayload,
      embeds: [embed],
      components: getActionButtons(),
    });

    pendingByMessage.set(sentMsg.id, {
      passport: data.passport,
      currentRank: data.currentRank,
      newRank: data.newRank,
      applicantUserId: interaction.user.id,
      applicantUser: interaction.user,
      applicantDisplayName,
      applicantMember: interaction.member,
    });

    await message.delete().catch(() => {});
  });

  collector.on('end', () => {
    pendingRequest.delete(interaction.user.id);
  });

  return true;
}

async function sendUprankAudit(interaction, data) {
  const channelId = getChannelId('uprank');
  if (!channelId) {
    await interaction.reply({
      content: 'Канал для кадрового аудита (uprank) не настроен.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await interaction.reply({
      content: 'Не удалось найти канал аудита.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const approverDisplayName = getDisplayName(interaction);
  const rankWord = data.newRank === '1' ? '1-й' : data.newRank === '2' ? '2-й' : data.newRank === '3' ? '3-й' : `${data.newRank}-й`;
  const employeeDisplay = `${data.applicantUser} | ${data.applicantDisplayName}`;
  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${data.applicantUser}`;
  const reasonText = `Запрос на повышение одобрен: ${interaction.message.url}`;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Кадровый аудит | Повышение`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${interaction.user} | ${approverDisplayName}`, inline: false },
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${data.passport}`, inline: false },
      { name: '**Действие**', value: `• Повышение на ${rankWord} ранг`, inline: false },
      { name: '**Причина**', value: `• ${reasonText}`, inline: false }
    )
    .setTimestamp();

  await channel.send({ content: topLine, embeds: [embed] });
}

async function handleApprove(interaction) {
  if (interaction.customId !== 'uprank_req_approve') return false;

  if (!hasRole(interaction.member, allowedApproveRoles())) {
    await interaction.reply({
      content: 'Одобрять запрос может только роль «Генерал-лейтенант».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const data = pendingByMessage.get(interaction.message.id);
  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const checkerLabel = truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`);

  // Показываем кнопки: Одобрено (disabled) + Проверил + "Отправить кадровый аудит"
  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('uprank_req_done_approve')
          .setLabel('Одобрено')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('uprank_req_checker')
          .setLabel(checkerLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('uprank_req_send_audit')
          .setLabel('Отправить кадровый аудит')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  return true;
}

async function handleSendAudit(interaction) {
  if (interaction.customId !== 'uprank_req_send_audit') return false;

  if (!hasRole(interaction.member, allowedApproveRoles())) {
    await interaction.reply({
      content: 'Отправлять кадровый аудит может только роль «Генерал-лейтенант».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const data = pendingByMessage.get(interaction.message.id);
  if (!data) {
    await interaction.reply({
      content: 'Данные запроса не найдены.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await sendUprankAudit(interaction, data);
  pendingByMessage.delete(interaction.message.id);

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const checkerLabel = truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`);

  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('uprank_req_done_approve')
          .setLabel('Одобрено')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('uprank_req_checker')
          .setLabel(checkerLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('uprank_req_audit_sent')
          .setLabel('Кадровый аудит отправлен')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
    ],
  });

  return true;
}

function buildDeclineModal(messageId) {
  const modal = new ModalBuilder()
    .setCustomId(`uprank_req_decline_modal_${messageId}`)
    .setTitle('Причина отказа');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('uprank_req_decline_reason')
        .setLabel('Причина отказа')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  return modal;
}

async function handleDeclineButton(interaction) {
  if (interaction.customId !== 'uprank_req_decline') return false;

  if (!hasRole(interaction.member, allowedApproveRoles())) {
    await interaction.reply({
      content: 'Отклонять запрос может только роль «Генерал-лейтенант».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildDeclineModal(interaction.message.id));
  return true;
}

async function handleDeclineModalSubmit(interaction) {
  if (!interaction.customId.startsWith('uprank_req_decline_modal_')) return false;

  const messageId = interaction.customId.replace('uprank_req_decline_modal_', '');
  const reason = interaction.fields.getTextInputValue('uprank_req_decline_reason').trim();

  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    await interaction.reply({
      content: 'Сообщение не найдено.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  pendingByMessage.delete(messageId);

  const embed = EmbedBuilder.from(message.embeds[0]);
  const reasonLabel = truncateLabel(`Причина: ${reason}`, BUTTON_LABEL_MAX);

  await message.edit({
    content: message.content,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('uprank_req_done_decline')
          .setLabel('Отклонено')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('uprank_req_reason')
          .setLabel(reasonLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('uprank_req_checker_d')
          .setLabel(truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
    ],
  });

  await interaction.reply({
    content: 'Запрос отклонён.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleUprankRequestInteraction(interaction) {
  if (await handleOpenForm(interaction)) return true;
  if (await handleFormModalSubmit(interaction)) return true;
  if (await handleApprove(interaction)) return true;
  if (await handleSendAudit(interaction)) return true;
  if (await handleDeclineButton(interaction)) return true;
  if (await handleDeclineModalSubmit(interaction)) return true;
  return false;
}

module.exports = {
  UPRANK_REQUEST_CHANNEL_ID,
  getSetupContent,
  handleUprankRequestInteraction,
};
