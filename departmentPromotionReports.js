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
const { getDisplayName, getChannelId, FOLDER } = require('./utils.js');

const EMBED_COLOR = 0x2b2d31;
const SETUP_EMBED_COLOR = 0x3498db;
const BUTTON_LABEL_MAX = 80;

const MAX_SCREENSHOTS = Number(config.departmentPromotionReports?.maxScreenshots ?? 10);
const COLLECTOR_TIME_MS = Number(config.departmentPromotionReports?.collectorTimeMs ?? 120_000);

const pendingByMessage = new Map(); // messageId -> data

function truncateLabel(text, max = BUTTON_LABEL_MAX) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function hasRole(member, roleIds) {
  if (!member?.roles?.cache) return false;
  const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
  return ids.some((id) => member.roles.cache.has(id));
}

function getDeptKeyByChannelId(channelId) {
  const map = config.departmentPromotionReports?.channels || {};
  return Object.entries(map).find(([, id]) => id === channelId)?.[0] || null;
}

function getRosterDept(shortName) {
  const deps = config.roster?.departments || [];
  return deps.find((d) => String(d.shortName).toUpperCase() === String(shortName).toUpperCase()) || null;
}

function getApproveRoleIdsForDept(deptKey) {
  // По требованию: MCE использует роли MA (куратор/хед/деп/инструктор).
  // Для Academy тоже используем MA, т.к. отдельные роли руководства Academy не переданы.
  const effective = deptKey === 'MCE' || deptKey === 'Academy' ? 'MA' : deptKey;
  const d = getRosterDept(effective);
  if (!d) return [];
  return [d.curator, d.head, d.deputyHead, d.instructor].filter(Boolean);
}

function getSubmitRoleIdsForDept(deptKey) {
  // Требование: подавать можно только в своём отделе (по роли отдела).
  // Academy: только роль Academy.
  // MCE: подавать могут люди с ролью отдела MA.
  if (deptKey === 'Academy') {
    // В конфиге Academy уже используется в inviteRoles (SANG + Academy).
    const academyRoleId = config.roles?.inviteRoles?.[1];
    return academyRoleId ? [academyRoleId] : [];
  }

  const effective = deptKey === 'MCE' ? 'MA' : deptKey;
  const d = getRosterDept(effective);
  return d?.staff ? [d.staff] : [];
}

function roleMentions(roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
  const cleaned = ids.filter(Boolean);
  if (cleaned.length === 0) return '—';
  return cleaned.map((id) => `<@&${id}>`).join(', ');
}

function parseDiscordMessageLink(url) {
  // Пример: https://discord.com/channels/<guildId>/<channelId>/<messageId>
  const m = String(url || '').trim().match(
    /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/i
  );
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

function validateProofLink(link) {
  const gratitudeChannelId = config.channels?.gratitude;
  if (!gratitudeChannelId) {
    return { ok: false, error: 'Не настроен канал благодарностей: укажите `channels.gratitude` в config.json.' };
  }
  const parsed = parseDiscordMessageLink(link);
  if (!parsed) {
    return { ok: false, error: 'Ссылка на доказательства должна быть ссылкой на сообщение Discord (формат `discord.com/channels/...`).' };
  }
  if (String(parsed.guildId) !== String(config.guildId)) {
    return { ok: false, error: 'Ссылка должна вести на сообщение **вашего** сервера.' };
  }
  if (String(parsed.channelId) !== String(gratitudeChannelId)) {
    return { ok: false, error: 'Ссылка должна вести **только** на канал благодарностей.' };
  }
  return { ok: true };
}

function getSetupContent(deptKey) {
  return {
    content: null,
    embeds: [
      new EmbedBuilder()
        .setColor(SETUP_EMBED_COLOR)
        .setTitle(`Отчет на повышение (${deptKey})`)
        .setDescription(
          `Чтобы создать отчет на повышение для отдела **${deptKey}**, нажмите кнопку ниже, заполните форму и затем отправьте **${MAX_SCREENSHOTS} скриншотов** в этот чат.`
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('dept_promo_open_form')
          .setLabel('Подать запрос на повышение')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildFormModal(deptKey) {
  const modal = new ModalBuilder().setCustomId(`dept_promo_form_modal_${deptKey}`).setTitle(`Отчет на повышение (${deptKey})`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dept_promo_from_rank')
        .setLabel('С какого ранга')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dept_promo_to_rank')
        .setLabel('На какой ранг')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dept_promo_proof_link')
        // В Discord лимит label = 45 символов
        .setLabel('Доказательства (ссылка из благодарностей)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
    )
  );
  return modal;
}

function buildReportEmbed(deptKey, applicantUser, applicantDisplayName, fromRank, toRank, proofLink) {
  const filledBy = `${applicantUser} | ${applicantDisplayName}`;
  const proofValue = proofLink ? `• ${proofLink}` : '• —';
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Отчет на повышение | ${deptKey}`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${filledBy}`, inline: false },
      { name: '**С какого ранга**', value: `• ${fromRank}`, inline: false },
      { name: '**На какой ранг**', value: `• ${toRank}`, inline: false },
      { name: '**Доказательства**', value: `${proofValue}\n• ${MAX_SCREENSHOTS} скриншотов (вложения ниже)`, inline: false }
    )
    .setTimestamp();
}

function getActionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dept_promo_approve').setLabel('Одобрить').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('dept_promo_decline').setLabel('Отклонить').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('dept_promo_send_audit').setLabel('Отправить кадровый аудит').setStyle(ButtonStyle.Primary)
    ),
  ];
}

async function downloadAttachment(attachment) {
  const res = await fetch(attachment.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = attachment.name && /\.(png|jpe?g|gif|webp)$/i.test(attachment.name) ? attachment.name : 'proof.png';
  return { attachment: buf, name };
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
  const employeeDisplay = `${data.applicantUser} | ${data.applicantDisplayName}`;
  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${data.applicantUser}`;
  const reasonText = `Одобрение повышения. Ссылка на отчёт: ${interaction.message.url}`;
  const proofValue = data.proofLink ? `• ${data.proofLink}` : '• —';

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} Кадровый аудит | Повышение`)
    .addFields(
      { name: "**Заполнил'а**", value: `• ${interaction.user} | ${approverDisplayName}`, inline: false },
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Отдел**', value: `• ${data.deptKey}`, inline: false },
      { name: '**С какого ранга**', value: `• ${data.fromRank}`, inline: false },
      { name: '**На какой ранг**', value: `• ${data.toRank}`, inline: false },
      { name: '**Доказательства**', value: proofValue, inline: false },
      { name: '**Причина**', value: `• ${reasonText}`, inline: false }
    )
    .setTimestamp();

  await channel.send({ content: topLine, embeds: [embed] });
  await interaction.reply({ content: `Кадровый аудит отправлен в ${channel}.`, flags: MessageFlags.Ephemeral }).catch(() => {});
}

async function handleOpenForm(interaction) {
  if (interaction.customId !== 'dept_promo_open_form') return false;

  const deptKey = getDeptKeyByChannelId(interaction.channelId);
  if (!deptKey) {
    await interaction.reply({ content: 'Этот канал не настроен для отчетов на повышение.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const submitRoleIds = getSubmitRoleIdsForDept(deptKey);
  if (submitRoleIds.length === 0) {
    await interaction.reply({
      content: 'Не настроена роль отдела для подачи отчёта (проверьте roles.inviteRoles для Academy и roster.departments[].staff).',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
  if (!hasRole(interaction.member, submitRoleIds)) {
    await interaction.reply({
      content: `Подавать отчет на повышение в этом канале могут только участники с ролью отдела: ${roleMentions(submitRoleIds)}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildFormModal(deptKey));
  return true;
}

async function handleFormModalSubmit(interaction) {
  if (!interaction.customId.startsWith('dept_promo_form_modal_')) return false;

  const deptKey = interaction.customId.replace('dept_promo_form_modal_', '');
  const channelId = config.departmentPromotionReports?.channels?.[deptKey];
  if (!channelId || interaction.channelId !== channelId) {
    await interaction.reply({ content: 'Ошибка: канал не совпадает с настройками отдела.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const fromRank = interaction.fields.getTextInputValue('dept_promo_from_rank').trim();
  const toRank = interaction.fields.getTextInputValue('dept_promo_to_rank').trim();
  const proofLink = interaction.fields.getTextInputValue('dept_promo_proof_link')?.trim?.() ?? '';

  const errors = [];
  if (!fromRank) errors.push('• **С какого ранга:** поле обязательно.');
  if (!toRank) errors.push('• **На какой ранг:** поле обязательно.');

  if (errors.length > 0) {
    await interaction.reply({
      content: `❌ **Ошибки в форме:**\n\n${errors.join('\n')}\n\nИсправьте поля и отправьте форму снова.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  if (proofLink) {
    const proofValidation = validateProofLink(proofLink);
    if (!proofValidation.ok) {
      await interaction.reply({ content: `❌ ${proofValidation.error}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
  }

  await interaction.reply({
    content: `Отправьте **${MAX_SCREENSHOTS} скриншотов** в этот чат (можно несколькими сообщениями) в течение ${Math.round(
      COLLECTOR_TIME_MS / 1000
    )} секунд.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});

  const channel = interaction.channel;
  const collected = [];

  const collector = channel.createMessageCollector({
    filter: (m) => m.author.id === interaction.user.id,
    time: COLLECTOR_TIME_MS,
  });

  collector.on('collect', async (message) => {
    if (!message.attachments?.size) return;
    for (const a of message.attachments.values()) {
      if (collected.length >= MAX_SCREENSHOTS) break;
      collected.push(a);
    }
    if (collected.length >= MAX_SCREENSHOTS) {
      collector.stop('done');
    }
  });

  collector.on('end', async (_collectedMsgs, reason) => {
    if (reason !== 'done') {
      await channel
        .send({ content: `${interaction.user}, не удалось собрать ${MAX_SCREENSHOTS} скриншотов за отведённое время. Попробуйте снова.` })
        .catch(() => {});
      return;
    }

    let files;
    try {
      files = await Promise.all(collected.map((a, i) => downloadAttachment(a).then((r) => ({ ...r, name: `proof${i + 1}.png` }))));
    } catch (err) {
      console.error('DeptPromotionReports: failed to download images', err);
      await channel.send({ content: 'Не удалось загрузить изображения. Попробуйте снова.' }).catch(() => {});
      return;
    }

    const approveRoleIds = getApproveRoleIdsForDept(deptKey);
    const applicantDisplayName = getDisplayName(interaction);
    const embed = buildReportEmbed(deptKey, interaction.user, applicantDisplayName, fromRank, toRank, proofLink);
    const filePayload = files.map((f) => ({ attachment: f.attachment, name: f.name }));

    const sentMsg = await channel
      .send({
        content: approveRoleIds.length ? roleMentions(approveRoleIds) : null,
        files: filePayload,
        embeds: [embed],
        components: getActionButtons(),
      })
      .catch(() => null);

    if (!sentMsg) return;

    pendingByMessage.set(sentMsg.id, {
      deptKey,
      approveRoleIds,
      fromRank,
      toRank,
      proofLink,
      applicantUserId: interaction.user.id,
      applicantUser: interaction.user,
      applicantDisplayName,
    });
  });

  return true;
}

async function handleApprove(interaction) {
  if (interaction.customId !== 'dept_promo_approve') return false;

  const data = pendingByMessage.get(interaction.message.id);
  if (!data) {
    await interaction.reply({ content: 'Данные отчёта не найдены.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (!hasRole(interaction.member, data.approveRoleIds)) {
    await interaction.reply({
      content: 'Одобрять отчет могут только: Ген.майор / Полковник / Подполковник / Инструктор отдела.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const checkerLabel = truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`);

  await interaction.update({
    content: interaction.message.content,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dept_promo_done_approve').setLabel('Одобрено').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('dept_promo_checker').setLabel(checkerLabel).setStyle(ButtonStyle.Secondary).setDisabled(true)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dept_promo_send_audit').setLabel('Отправить кадровый аудит').setStyle(ButtonStyle.Primary)
      ),
    ],
  });

  return true;
}

async function handleSendAudit(interaction) {
  if (interaction.customId !== 'dept_promo_send_audit') return false;

  const data = pendingByMessage.get(interaction.message.id);
  if (!data) {
    await interaction.reply({ content: 'Данные отчёта не найдены.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (!hasRole(interaction.member, data.approveRoleIds)) {
    await interaction.reply({
      content: 'Отправлять кадровый аудит могут только: Ген.майор / Полковник / Подполковник / Инструктор отдела.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await sendUprankAudit(interaction, data);
  pendingByMessage.delete(interaction.message.id);

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const checkerLabel = truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`);

  await interaction
    .update({
      content: interaction.message.content,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('dept_promo_done_approve').setLabel('Одобрено').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId('dept_promo_checker').setLabel(checkerLabel).setStyle(ButtonStyle.Secondary).setDisabled(true)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('dept_promo_audit_sent').setLabel('Кадровый аудит отправлен').setStyle(ButtonStyle.Secondary).setDisabled(true)
        ),
      ],
    })
    .catch(() => {});

  return true;
}

function buildDeclineModal(messageId) {
  const modal = new ModalBuilder().setCustomId(`dept_promo_decline_modal_${messageId}`).setTitle('Причина отказа');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dept_promo_decline_reason')
        .setLabel('Причина отказа')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );
  return modal;
}

async function handleDeclineButton(interaction) {
  if (interaction.customId !== 'dept_promo_decline') return false;

  const data = pendingByMessage.get(interaction.message.id);
  if (!data) {
    await interaction.reply({ content: 'Данные отчёта не найдены.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (!hasRole(interaction.member, data.approveRoleIds)) {
    await interaction.reply({
      content: 'Отклонять отчет могут только: Ген.майор / Полковник / Подполковник / Инструктор отдела.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await interaction.showModal(buildDeclineModal(interaction.message.id));
  return true;
}

async function handleDeclineModalSubmit(interaction) {
  if (!interaction.customId.startsWith('dept_promo_decline_modal_')) return false;

  const messageId = interaction.customId.replace('dept_promo_decline_modal_', '');
  const reason = interaction.fields.getTextInputValue('dept_promo_decline_reason').trim();

  const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    await interaction.reply({ content: 'Сообщение не найдено.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  pendingByMessage.delete(messageId);

  const embed = EmbedBuilder.from(message.embeds[0]);
  const reasonLabel = truncateLabel(`Причина: ${reason}`, BUTTON_LABEL_MAX);

  await message
    .edit({
      content: message.content,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('dept_promo_done_decline').setLabel('Отклонено').setStyle(ButtonStyle.Danger).setDisabled(true),
          new ButtonBuilder().setCustomId('dept_promo_reason').setLabel(reasonLabel).setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder()
            .setCustomId('dept_promo_checker_d')
            .setLabel(truncateLabel(`Проверил'а: ${getDisplayName(interaction)}`))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        ),
      ],
    })
    .catch(() => {});

  await interaction.reply({ content: 'Отчет отклонён.', flags: MessageFlags.Ephemeral }).catch(() => {});
  return true;
}

function getSetupTargets() {
  const map = config.departmentPromotionReports?.channels || {};
  return Object.entries(map)
    .filter(([, id]) => id)
    .map(([deptKey, channelId]) => ({
      deptKey,
      channelId,
      embedTitle: `Отчет на повышение (${deptKey})`,
      logName: `Отчет на повышение (${deptKey})`,
    }));
}

async function handleDepartmentPromotionReportsInteraction(interaction) {
  if (await handleOpenForm(interaction)) return true;
  if (await handleFormModalSubmit(interaction)) return true;
  if (await handleApprove(interaction)) return true;
  if (await handleSendAudit(interaction)) return true;
  if (await handleDeclineButton(interaction)) return true;
  if (await handleDeclineModalSubmit(interaction)) return true;
  return false;
}

module.exports = {
  getSetupTargets,
  getSetupContent,
  handleDepartmentPromotionReportsInteraction,
};

