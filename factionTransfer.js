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
const { getDisplayName, isValidPassport } = require('./utils.js');

const FACTION_TRANSFER_CHANNEL_ID = config.channels?.factionTransfer;
const EMBED_COLOR = 0x2b2d31;
const SETUP_EMBED_COLOR = 0x3498db;
const COLLECTOR_TIME_MS = 60_000;
const BUTTON_LABEL_MAX = 80;
const FOLDER = '📁';
const MIN_SCREENSHOTS = 1;
const MAX_SCREENSHOTS = 3;

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
        .setTitle('Переводы фракций')
        .setDescription('Чтобы подать заявку на перевод фракции, нажмите кнопку ниже, заполните форму и отправьте от 1 до 3 скриншотов.'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('faction_open_form')
          .setLabel('Подать заявку на перевод фракции')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildFormModal() {
  const modal = new ModalBuilder()
    .setCustomId('faction_form_modal')
    .setTitle('Заявление на перевод');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('faction_full_name')
        .setLabel('Имя и фамилия')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('faction_passport')
        .setLabel('Номер паспорта (StaticID), только цифры')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('faction_current')
        .setLabel('Текущая фракция')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('faction_target')
        .setLabel('Желаемая фракция')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    )
  );

  return modal;
}

function buildReportEmbed(applicantUser, applicantDisplayName, fullName, passport, currentFaction, targetFaction) {
  const filledBy = `${applicantUser} | ${applicantDisplayName}`;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Заявление на перевод`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${filledBy}`, inline: false },
      { name: '**Имя Фамилия**', value: `• ${fullName}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Текущая фракция**', value: `• ${currentFaction}`, inline: false },
      { name: '**Желаемая фракция**', value: `• ${targetFaction}`, inline: false }
    )
    .setTimestamp();
}

function getActionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('faction_approve')
        .setLabel('Одобрить')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('faction_decline')
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
  const ids = Array.isArray(roleIds) ? roleIds : (roleIds ? [roleIds] : []);
  return ids.some((id) => member.roles.cache.has(id));
}

const allowedApproveRoles = () => config.roles?.factionTransferApprove || [];

async function handleOpenForm(interaction) {
  if (interaction.customId !== 'faction_open_form') return false;

  const allowedRoles = config.roles?.factionTransferSubmit || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Подавать заявку на перевод фракции может только участник с соответствующей ролью.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildFormModal());
  return true;
}

async function handleFormModalSubmit(interaction) {
  if (interaction.customId !== 'faction_form_modal') return false;

  const fullName = interaction.fields.getTextInputValue('faction_full_name').trim();
  const passport = interaction.fields.getTextInputValue('faction_passport').trim();
  const currentFaction = interaction.fields.getTextInputValue('faction_current').trim();
  const targetFaction = interaction.fields.getTextInputValue('faction_target').trim();

  if (!fullName) {
    await interaction.reply({
      content: 'Заполните поле «Имя и фамилия».',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (!passport || !isValidPassport(passport)) {
    await interaction.reply({
      content: 'Номер паспорта (StaticID) должен содержать только цифры.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (!currentFaction || !targetFaction) {
    await interaction.reply({
      content: 'Заполните поля «Текущая фракция» и «Желаемая фракция».',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.reply({
    content: `Отправьте **от ${MIN_SCREENSHOTS} до ${MAX_SCREENSHOTS} скриншотов** в этот канал одним сообщением в течение 60 секунд.`,
    flags: MessageFlags.Ephemeral,
  });

  const channel = interaction.channel;
  pendingRequest.set(interaction.user.id, {
    fullName,
    passport,
    currentFaction,
    targetFaction,
    userId: interaction.user.id,
    timestamp: Date.now(),
  });

  const collector = channel.createMessageCollector({
    filter: (m) => m.author.id === interaction.user.id,
    time: COLLECTOR_TIME_MS,
  });

  collector.on('collect', async (message) => {
    const count = message.attachments.size;
    if (count < MIN_SCREENSHOTS || count > MAX_SCREENSHOTS) {
      const reply = await message.reply(`Нужно прикрепить **от ${MIN_SCREENSHOTS} до ${MAX_SCREENSHOTS} скриншотов**. Отправьте одно сообщение с нужным количеством вложений.`).catch(() => null);
      if (reply) {
        setTimeout(() => { message.delete().catch(() => {}); reply.delete().catch(() => {}); }, 5000);
      }
      return;
    }

    const data = pendingRequest.get(interaction.user.id);
    if (!data) return;
    pendingRequest.delete(interaction.user.id);
    collector.stop();

    const attachments = [...message.attachments.values()].slice(0, MAX_SCREENSHOTS);
    let files;
    try {
      files = await Promise.all(attachments.map((a, i) => downloadAttachment(a).then((r) => ({ ...r, name: `proof${i + 1}.png` }))));
    } catch (err) {
      console.error('FactionTransfer: failed to download images', err);
      await channel.send({ content: 'Не удалось загрузить изображения. Попробуйте снова.' }).catch(() => {});
      return;
    }

    const applicantDisplayName = getDisplayName(interaction);
    const embed = buildReportEmbed(interaction.user, applicantDisplayName, data.fullName, data.passport, data.currentFaction, data.targetFaction);
    const filePayload = files.map((f) => ({ attachment: f.attachment, name: f.name }));

    const mentionRoleId = config.roles?.factionTransferApprove?.[0];
    const sentMsg = await channel.send({
      content: mentionRoleId ? `<@&${mentionRoleId}>` : null,
      files: filePayload,
      embeds: [embed],
      components: getActionButtons(),
    });

    pendingByMessage.set(sentMsg.id, {
      fullName: data.fullName,
      passport: data.passport,
      currentFaction: data.currentFaction,
      targetFaction: data.targetFaction,
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

async function handleApprove(interaction) {
  if (interaction.customId !== 'faction_approve') return false;

  if (!hasRole(interaction.member, allowedApproveRoles())) {
    await interaction.reply({
      content: 'Одобрять заявку может только роль «Генерал».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const data = pendingByMessage.get(interaction.message.id);
  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const checkerLabel = truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`);

  pendingByMessage.delete(interaction.message.id);

  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('faction_done_approve')
          .setLabel('Одобрено')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('faction_checker')
          .setLabel(checkerLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
    ],
  });

  return true;
}

function buildDeclineModal(messageId) {
  const modal = new ModalBuilder()
    .setCustomId(`faction_decline_modal_${messageId}`)
    .setTitle('Причина отказа');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('faction_decline_reason')
        .setLabel('Причина отказа')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  return modal;
}

async function handleDeclineButton(interaction) {
  if (interaction.customId !== 'faction_decline') return false;

  if (!hasRole(interaction.member, allowedApproveRoles())) {
    await interaction.reply({
      content: 'Отклонять заявку может только роль «Генерал».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildDeclineModal(interaction.message.id));
  return true;
}

async function handleDeclineModalSubmit(interaction) {
  if (!interaction.customId.startsWith('faction_decline_modal_')) return false;

  const messageId = interaction.customId.replace('faction_decline_modal_', '');
  const reason = interaction.fields.getTextInputValue('faction_decline_reason').trim();

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
          .setCustomId('faction_done_decline')
          .setLabel('Отклонено')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('faction_reason')
          .setLabel(reasonLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('faction_checker_d')
          .setLabel(truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
    ],
  });

  await interaction.reply({
    content: 'Заявка отклонена.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleFactionTransferInteraction(interaction) {
  if (await handleOpenForm(interaction)) return true;
  if (await handleFormModalSubmit(interaction)) return true;
  if (await handleApprove(interaction)) return true;
  if (await handleDeclineButton(interaction)) return true;
  if (await handleDeclineModalSubmit(interaction)) return true;
  return false;
}

module.exports = {
  FACTION_TRANSFER_CHANNEL_ID,
  getSetupContent,
  handleFactionTransferInteraction,
};
