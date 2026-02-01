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

const PROMOTION_CHANNEL_ID = config.channels?.promotion;
const EMBED_COLOR = 0x2b2d31;
const SETUP_EMBED_COLOR = 0x3498db; // синяя полоска, как в канале увольнений
const BUTTON_LABEL_MAX = 80;

const pendingPromotion = new Map();

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
        .setTitle('Запрос на повышение')
        .setDescription('Чтобы подать запрос на повышение, вам нужно нажать кнопку ниже и заполнить анкету!'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('promotion_open_form')
          .setLabel('Подать запрос на повышение')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildFormModal() {
  const modal = new ModalBuilder()
    .setCustomId('promotion_form_modal')
    .setTitle('Запрос на повышение');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('promotion_passport')
        .setLabel('Номер паспорта (StaticID), только цифры')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('promotion_current_rank')
        .setLabel('Текущий ранг (цифра)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('promotion_new_rank')
        .setLabel('Новый ранг (цифра)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('promotion_link')
        .setLabel('Ссылка на одобренный отчет на повышение')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  return modal;
}

function buildRequestEmbed(applicantUser, applicantDisplayName, passport, currentRank, newRank, link) {
  const filledBy = `${applicantUser} | ${applicantDisplayName}`;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Запрос на повышение`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${filledBy}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Текущий ранг**', value: `• ${currentRank}`, inline: false },
      { name: '**Новый ранг**', value: `• ${newRank}`, inline: false },
      { name: '**Ссылка на одобренный отчет на повышение**', value: `• ${link}`, inline: false }
    )
    .setTimestamp();
}

function getActionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('promotion_approve').setLabel('Одобрить').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('promotion_decline').setLabel('Отклонить').setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function sendUprankFromApproval(interaction, applicantUser, applicantDisplayName, passport, newRank) {
  const channelId = getChannelId('uprank');
  if (!channelId) return;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const approverDisplayName = getDisplayName(interaction);
  const rankWord = newRank === '1' ? '1-й' : newRank === '2' ? '2-й' : newRank === '3' ? '3-й' : `${newRank}-й`;
  const employeeDisplay = `${applicantUser} | ${applicantDisplayName}`;
  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${applicantUser}`;
  const messageUrl = interaction.message.url;
  const reasonText = `Запрос на повышение одобрен ${messageUrl}`;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Кадровый аудит | Повышение`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${interaction.user} | ${approverDisplayName}`, inline: false },
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Действие**', value: `• Повышение на ${rankWord} ранг`, inline: false },
      { name: '**Причина**', value: `• ${reasonText}`, inline: false }
    )
    .setTimestamp();

  await channel.send({ content: topLine, embeds: [embed] });
}

function hasRole(member, roleIds) {
  if (!member?.roles?.cache) return false;
  const ids = Array.isArray(roleIds) ? roleIds : (roleIds ? [roleIds] : []);
  return ids.some((id) => member.roles.cache.has(id));
}

async function handleOpenForm(interaction) {
  if (interaction.customId !== 'promotion_open_form') return false;

  const allowedRoles = config.roles?.resignPromotionSubmit || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Подавать запрос на повышение может только роль SANG.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildFormModal());
  return true;
}

async function handleFormModalSubmit(interaction) {
  if (interaction.customId !== 'promotion_form_modal') return false;

  const passport = interaction.fields.getTextInputValue('promotion_passport').trim();
  const currentRank = interaction.fields.getTextInputValue('promotion_current_rank').trim();
  const newRank = interaction.fields.getTextInputValue('promotion_new_rank').trim();
  const link = interaction.fields.getTextInputValue('promotion_link').trim();

  if (!isValidPassport(passport)) {
    await interaction.reply({
      content: 'Номер паспорта (StaticID) должен содержать только цифры.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const applicantDisplayName = getDisplayName(interaction);
  const embed = buildRequestEmbed(
    interaction.user,
    applicantDisplayName,
    passport,
    currentRank,
    newRank,
    link
  );

  await interaction.reply({
    content: 'Запрос на повышение отправлен.',
    flags: MessageFlags.Ephemeral,
  });

  const channel = await interaction.client.channels.fetch(PROMOTION_CHANNEL_ID).catch(() => null);
  if (!channel) return true;

  const mentionRoleId = config.roles?.resignPromotionApprove?.[0];
  const msg = await channel.send({
    content: mentionRoleId ? `<@&${mentionRoleId}>` : null,
    embeds: [embed],
    components: getActionButtons(),
  });

  pendingPromotion.set(msg.id, {
    applicantUserId: interaction.user.id,
    applicantUser: interaction.user,
    applicantDisplayName,
    passport,
    newRank,
  });

  return true;
}

async function handleApprove(interaction) {
  if (interaction.customId !== 'promotion_approve') return false;

  const allowedRoles = config.roles?.resignPromotionApprove || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Одобрять запрос на повышение может только роль «Старший состав».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const data = pendingPromotion.get(interaction.message.id);
  if (!data) {
    await interaction.reply({
      content: 'Данные запроса не найдены.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await sendUprankFromApproval(
    interaction,
    data.applicantUser,
    data.applicantDisplayName,
    data.passport,
    data.newRank
  );

  pendingPromotion.delete(interaction.message.id);

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const checkerLabel = truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`);

  await interaction.update({
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('promotion_done_approve')
          .setLabel('Одобрено')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('promotion_checker')
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
    .setCustomId(`promotion_decline_modal_${messageId}`)
    .setTitle('Причина отказа');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('promotion_decline_reason')
        .setLabel('Причина отказа')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  return modal;
}

async function handleDeclineButton(interaction) {
  if (interaction.customId !== 'promotion_decline') return false;

  const allowedRoles = config.roles?.resignPromotionApprove || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Отклонять запрос на повышение может только роль «Старший состав».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildDeclineModal(interaction.message.id));
  return true;
}

async function handleDeclineModalSubmit(interaction) {
  if (!interaction.customId.startsWith('promotion_decline_modal_')) return false;

  const messageId = interaction.customId.replace('promotion_decline_modal_', '');
  const reason = interaction.fields.getTextInputValue('promotion_decline_reason').trim();

  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    await interaction.reply({
      content: 'Сообщение не найдено.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  pendingPromotion.delete(messageId);

  const embed = EmbedBuilder.from(message.embeds[0]);
  const reasonLabel = truncateLabel(`Причина: ${reason}`, BUTTON_LABEL_MAX);

  await message.edit({
    content: null,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('promotion_done_decline')
          .setLabel('Отклонено')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('promotion_reason')
          .setLabel(reasonLabel)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('promotion_checker_d')
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

async function handlePromotionInteraction(interaction) {
  if (await handleOpenForm(interaction)) return true;
  if (await handleFormModalSubmit(interaction)) return true;
  if (await handleApprove(interaction)) return true;
  if (await handleDeclineButton(interaction)) return true;
  if (await handleDeclineModalSubmit(interaction)) return true;
  return false;
}

module.exports = {
  PROMOTION_CHANNEL_ID,
  getSetupContent,
  handlePromotionInteraction,
};
