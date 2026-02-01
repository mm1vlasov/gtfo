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

const RESIGN_CHANNEL_ID = config.channels?.resign;
const EMBED_COLOR = 0x3498db;
const COLLECTOR_TIME_MS = 60_000;
const BUTTON_LABEL_MAX = 80;
const FOLDER = '📁';

const pendingResign = new Map();
const pendingResignByMessage = new Map();

function isValidPassport(value) {
  return /^\d+$/.test(String(value).trim());
}

function truncateLabel(text, max = BUTTON_LABEL_MAX) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function getDisplayName(interaction) {
  return interaction.member?.displayName ?? interaction.user.username;
}

function checkerLabelDisplay(interaction) {
  return `Проверил'а: ${getDisplayName(interaction)}`;
}

function getSetupContent() {
  return {
    content: null,
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Заявление на увольнение')
        .setDescription('Чтобы подать заявление на увольнение, вам нужно нажать кнопку ниже и заполнить анкету!'),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('resign_open_form')
          .setLabel('Подать заявление на увольнение')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildFormModal() {
  const modal = new ModalBuilder()
    .setCustomId('resign_form_modal')
    .setTitle('Рапорт на увольнение');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('resign_passport')
        .setLabel('Номер паспорта (StaticID), только цифры')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('resign_department')
        .setLabel('Отдел')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('resign_reason')
        .setLabel('Причина увольнения')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    )
  );

  return modal;
}

function buildReportEmbed(interaction, passport, department, reason) {
  const filledBy = `${interaction.user} | ${getDisplayName(interaction)}`;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Заявление на увольнение')
    .addFields(
      { name: "**Заполнил'а**", value: `• ${filledBy}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Отдел**', value: `• ${department}`, inline: false },
      { name: '**Причина увольнения**', value: `• ${reason}`, inline: false }
    )
    .setTimestamp();
}

function getActionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('resign_approve')
        .setLabel('Одобрить')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('resign_approve_blacklist')
        .setLabel('Одобрить с занесением в ЧС')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('resign_decline')
        .setLabel('Отклонить')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function checkerLabel(interaction) {
  return truncateLabel(checkerLabelDisplay(interaction));
}

async function downloadAttachment(attachment) {
  const res = await fetch(attachment.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = attachment.name && /\.(png|jpe?g|gif|webp)$/i.test(attachment.name) ? attachment.name : 'photo.png';
  return { attachment: buf, name };
}

function hasRole(member, roleIds) {
  if (!member?.roles?.cache) return false;
  const ids = Array.isArray(roleIds) ? roleIds : (roleIds ? [roleIds] : []);
  return ids.some((id) => member.roles.cache.has(id));
}

async function handleOpenForm(interaction) {
  if (interaction.customId !== 'resign_open_form') return false;
  const allowedRoles = config.roles?.resignPromotionSubmit || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Подавать рапорт на увольнение может только роль SANG.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
  await interaction.showModal(buildFormModal());
  return true;
}

async function handleFormModalSubmit(interaction) {
  if (interaction.customId !== 'resign_form_modal') return false;

  const passport = interaction.fields.getTextInputValue('resign_passport').trim();
  const department = interaction.fields.getTextInputValue('resign_department').trim();
  const reason = interaction.fields.getTextInputValue('resign_reason').trim();

  const errors = [];
  if (!passport) {
    errors.push('• **Номер паспорта (StaticID):** поле обязательно.');
  } else if (!isValidPassport(passport)) {
    errors.push('• **Номер паспорта (StaticID):** допускаются только цифры.');
  }
  if (!department) {
    errors.push('• **Отдел:** поле обязательно.');
  }
  if (!reason) {
    errors.push('• **Причина увольнения:** поле обязательно.');
  }

  if (errors.length > 0) {
    await interaction.reply({
      content: `❌ **Ошибки в форме:**\n\n${errors.join('\n')}\n\nИсправьте поля и отправьте форму снова.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.reply({
    content: 'Отправьте **ровно 2 фотографии** в этот канал одним сообщением в течение 60 секунд.',
    flags: MessageFlags.Ephemeral,
  });

  const channel = interaction.channel;
  pendingResign.set(interaction.user.id, {
    passport,
    department,
    reason,
    userId: interaction.user.id,
    timestamp: Date.now(),
  });

  const collector = channel.createMessageCollector({
    filter: (m) => m.author.id === interaction.user.id,
    time: COLLECTOR_TIME_MS,
  });

  collector.on('collect', async (message) => {
    if (message.attachments.size !== 2) {
      const reply = await message.reply('Нужно прикрепить **ровно 2 фотографии**. Отправьте одно сообщение с двумя вложениями.').catch(() => null);
      if (reply) {
        setTimeout(() => { message.delete().catch(() => {}); reply.delete().catch(() => {}); }, 5000);
      }
      return;
    }

    const data = pendingResign.get(interaction.user.id);
    if (!data) return;
    pendingResign.delete(interaction.user.id);
    collector.stop();

    const attachments = [...message.attachments.values()].slice(0, 2);
    let files;
    try {
      files = await Promise.all(attachments.map((a) => downloadAttachment(a)));
    } catch (err) {
      console.error('Resign: failed to download images', err);
      await channel.send({ content: 'Не удалось загрузить изображения. Попробуйте снова.', ephemeral: false }).catch(() => {});
      return;
    }

    const file1Name = 'photo1.png';
    const file2Name = 'photo2.png';
    const embed = buildReportEmbed(interaction, data.passport, data.department, data.reason);
    const sentMsg = await channel.send({
      content: config.roles?.resignPromotionApprove?.[0] ? `<@&${config.roles.resignPromotionApprove[0]}>` : null,
      files: [
        { attachment: files[0].attachment, name: file1Name },
        { attachment: files[1].attachment, name: file2Name },
      ],
      embeds: [embed],
      components: getActionButtons(),
    });

    pendingResignByMessage.set(sentMsg.id, {
      passport: data.passport,
      department: data.department,
      reason: data.reason,
      applicantUserId: interaction.user.id,
      applicantUser: interaction.user,
      applicantDisplayName: getDisplayName(interaction),
      applicantMember: interaction.member,
    });

    await message.delete().catch(() => {});
  });

  collector.on('end', () => {
    pendingResign.delete(interaction.user.id);
  });

  return true;
}

async function sendUninviteFromResign(interaction, data, blacklist, messageUrl) {
  const channelId = config.channels?.uninvite;
  if (!channelId) return;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const filledBy = `${interaction.user} | ${getDisplayName(interaction)}`;
  const employeeText = data.applicantUser
    ? `${data.applicantUser} | ${data.applicantDisplayName ?? data.applicantUser.username}`
    : `${data.department} | ${data.passport}`;
  const actionText = blacklist
    ? 'Увольнение из организации с занесением в черный список'
    : 'Увольнение из организации без занесения в черный список';
  const reasonText = messageUrl || data.reason;

  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${data.applicantUser ?? data.department}`;
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`${FOLDER} Кадровый аудит | Увольнение`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${filledBy}`, inline: false },
      { name: '**Сотрудник**', value: `• ${employeeText}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${data.passport}`, inline: false },
      { name: '**Действие**', value: `• ${actionText}`, inline: false },
      { name: '**Причина**', value: `• ${reasonText}`, inline: false }
    )
    .setTimestamp();

  await channel.send({ content: topLine, embeds: [embed] });
}

function statusRowApproved(interaction) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('resign_done_approve')
      .setLabel('Одобрено')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('resign_checker')
      .setLabel(checkerLabel(interaction))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );
}

function statusRowApprovedBlacklist(interaction) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('resign_done_blacklist')
      .setLabel('Одобрено с ЧС')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('resign_checker_bl')
      .setLabel(checkerLabel(interaction))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );
}

function statusRowDeclined(interaction, reason) {
  const reasonLabel = truncateLabel(`Причина: ${reason}`, BUTTON_LABEL_MAX);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('resign_done_decline')
      .setLabel('Отклонено')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('resign_reason')
      .setLabel(reasonLabel)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('resign_checker_d')
      .setLabel(checkerLabel(interaction))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );
}

async function handleApprove(interaction) {
  if (interaction.customId !== 'resign_approve') return false;

  const allowedRoles = config.roles?.resignPromotionApprove || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Одобрять рапорт на увольнение может только роль «Старший состав».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const data = pendingResignByMessage.get(interaction.message.id);
  if (data) {
    // Снимаем роли с человека, который ПОДАЛ рапорт
    const applicantUserId = data.applicantUserId || data.applicantUser?.id;
    try {
      let applicantMember = data.applicantMember;
      if (!applicantMember && applicantUserId) {
        applicantMember =
          interaction.guild.members.cache.get(applicantUserId) ||
          (await interaction.guild.members.fetch(applicantUserId).catch(() => null));
      }
      if (applicantMember) {
        await applicantMember.roles.set([]);
      }
    } catch (err) {
      console.error('Resign approve: failed to remove roles from applicant', err);
    }

    await sendUninviteFromResign(interaction, data, false, interaction.message.url);
    pendingResignByMessage.delete(interaction.message.id);
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);

  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: [statusRowApproved(interaction)],
  });

  return true;
}

async function handleApproveBlacklist(interaction) {
  if (interaction.customId !== 'resign_approve_blacklist') return false;

  const allowedRoles = config.roles?.resignPromotionApprove || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Одобрять рапорт на увольнение может только роль «Старший состав».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const data = pendingResignByMessage.get(interaction.message.id);
  if (data) {
    // Снимаем роли с человека, который ПОДАЛ рапорт
    const applicantUserId = data.applicantUserId || data.applicantUser?.id;
    try {
      let applicantMember = data.applicantMember;
      if (!applicantMember && applicantUserId) {
        applicantMember =
          interaction.guild.members.cache.get(applicantUserId) ||
          (await interaction.guild.members.fetch(applicantUserId).catch(() => null));
      }
      if (applicantMember) {
        await applicantMember.roles.set([]);
      }
    } catch (err) {
      console.error('Resign approve blacklist: failed to remove roles from applicant', err);
    }

    await sendUninviteFromResign(interaction, data, true, interaction.message.url);
    pendingResignByMessage.delete(interaction.message.id);
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);

  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: [statusRowApprovedBlacklist(interaction)],
  });

  return true;
}

function buildDeclineModal(messageId) {
  const modal = new ModalBuilder()
    .setCustomId(`resign_decline_modal_${messageId}`)
    .setTitle('Причина отказа');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('resign_decline_reason')
        .setLabel('Причина отказа')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );

  return modal;
}

async function handleDeclineButton(interaction) {
  if (interaction.customId !== 'resign_decline') return false;

  const allowedRoles = config.roles?.resignPromotionApprove || [];
  if (!hasRole(interaction.member, allowedRoles)) {
    await interaction.reply({
      content: 'Отклонять рапорт на увольнение может только роль «Старший состав».',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildDeclineModal(interaction.message.id));
  return true;
}

async function handleDeclineModalSubmit(interaction) {
  if (!interaction.customId.startsWith('resign_decline_modal_')) return false;

  const messageId = interaction.customId.replace('resign_decline_modal_', '');
  const reason = interaction.fields.getTextInputValue('resign_decline_reason').trim();

  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    await interaction.reply({
      content: 'Сообщение не найдено.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const embed = EmbedBuilder.from(message.embeds[0]);

  await message.edit({
    content: null,
    embeds: [embed],
    components: [statusRowDeclined(interaction, reason)],
  });

  await interaction.reply({
    content: 'Заявление отклонено.',
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handleResignInteraction(interaction) {
  if (await handleOpenForm(interaction)) return true;
  if (await handleFormModalSubmit(interaction)) return true;
  if (await handleApprove(interaction)) return true;
  if (await handleApproveBlacklist(interaction)) return true;
  if (await handleDeclineButton(interaction)) return true;
  if (await handleDeclineModalSubmit(interaction)) return true;
  return false;
}

module.exports = {
  RESIGN_CHANNEL_ID,
  getSetupContent,
  handleResignInteraction,
};
