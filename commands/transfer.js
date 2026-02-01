const config = require('../config');
const { SlashCommandBuilder, SlashCommandStringOption, SlashCommandUserOption, SlashCommandRoleOption, MessageFlags } = require('discord.js');
const { isValidPassport, baseEmbed, sendToAuditChannel } = require('../utils.js');

const data = new SlashCommandBuilder()
  .setName('transfer')
  .setDescription('Кадровый аудит: перевод в отдел')
  .addUserOption(
    new SlashCommandUserOption()
      .setName('кого')
      .setDescription('Кого перевели (упоминание пользователя)')
      .setRequired(true)
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('номер_паспорта')
      .setDescription('Номер паспорта (StaticID), только цифры')
      .setRequired(true)
  )
  .addRoleOption(
    new SlashCommandRoleOption()
      .setName('из_отдела')
      .setDescription('Из какого отдела (роль)')
      .setRequired(true)
  )
  .addRoleOption(
    new SlashCommandRoleOption()
      .setName('в_отдел')
      .setDescription('В какой отдел (роль)')
      .setRequired(true)
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('причина')
      .setDescription('Причина перевода')
      .setRequired(true)
  );

async function run(interaction) {
  const employeeUser = interaction.options.getUser('кого');
  const employeeMember = interaction.options.getMember('кого');
  const passport = interaction.options.getString('номер_паспорта');
  const fromRole = interaction.options.getRole('из_отдела');
  const toRole = interaction.options.getRole('в_отдел');
  const reason = interaction.options.getString('причина');

  if (!employeeUser) {
    await interaction.reply({
      content: 'Не удалось получить данные пользователя.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!isValidPassport(passport)) {
    await interaction.reply({
      content: 'Номер паспорта (StaticID) должен содержать только цифры.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const allowedDepartmentIds = config.roles?.departments || [];
  if (allowedDepartmentIds.length > 0) {
    const fromId = fromRole.id;
    const toId = toRole.id;
    if (!allowedDepartmentIds.includes(fromId) || !allowedDepartmentIds.includes(toId)) {
      await interaction.reply({
        content: 'Роли «из отдела» и «в отдел» должны быть из списка отделов в конфиге бота (УКМБ, Academy, DIV, MMS, SOG, CG, AF, SEAL, DF, MP, MA).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (employeeMember) {
    try {
      await employeeMember.roles.remove(fromRole);
      await employeeMember.roles.add(toRole);
    } catch (err) {
      console.error('Transfer: failed to update roles', err);
      await interaction.reply({
        content: 'Не удалось изменить роли. Проверьте, что у бота есть право «Управление ролями» и его роль выше выбранных.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
  }

  const employeeDisplay = `${employeeUser} | ${employeeMember?.displayName ?? employeeUser.username}`;
  const actionText = `Перевод из ${fromRole} в ${toRole}`;
  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${employeeUser}`;

  const embed = baseEmbed(interaction, 'Кадровый аудит | Перевод в отдел')
    .addFields(
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Действие**', value: `• ${actionText}`, inline: false },
      { name: '**Причина**', value: `• ${reason}`, inline: false }
    );

  await sendToAuditChannel(interaction, 'transfer', topLine, [embed]);
}

module.exports = { data, run };
