const config = require('../config');
const { SlashCommandBuilder, SlashCommandStringOption, SlashCommandUserOption, MessageFlags } = require('discord.js');
const { isValidPassport, baseEmbed, sendToAuditChannel } = require('../utils.js');

const data = new SlashCommandBuilder()
  .setName('invite')
  .setDescription('Кадровый аудит: принятие в организацию')
  .addUserOption(
    new SlashCommandUserOption()
      .setName('кого')
      .setDescription('Кого принять (упоминание пользователя)')
      .setRequired(true)
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('номер_паспорта')
      .setDescription('Номер паспорта (StaticID), только цифры')
      .setRequired(true)
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('причина')
      .setDescription('Причина (если не указана — Набор/Собес)')
      .setRequired(false)
  );

async function run(interaction) {
  const employeeUser = interaction.options.getUser('кого');
  const passport = interaction.options.getString('номер_паспорта');
  const reasonRaw = interaction.options.getString('причина');
  const reason = (reasonRaw?.trim()) ? reasonRaw.trim() : 'Набор/Собес';

  if (!employeeUser) {
    await interaction.reply({
      content: 'Не удалось получить данные пользователя. Убедитесь, что выбранный пользователь доступен.',
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

  const employeeMember = interaction.options.getMember('кого');
  const inviteRoleIds = config.roles?.inviteRoles || [];
  if (employeeMember && inviteRoleIds.length > 0) {
    try {
      const rolesToAdd = inviteRoleIds
        .map((id) => employeeMember.guild.roles.cache.get(id))
        .filter(Boolean);
      if (rolesToAdd.length > 0) {
        await employeeMember.roles.add(rolesToAdd);
      }
    } catch (err) {
      console.error('Invite: failed to add roles', err);
      await interaction.reply({
        content: 'Не удалось выдать роли. Проверьте, что у бота есть право «Управление ролями» и его роль выше выбранных.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
  }

  const employeeDisplay = `${employeeUser} | ${employeeMember?.displayName ?? employeeUser.username}`;
  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${employeeUser}`;

  const embed = baseEmbed(interaction, 'Кадровый аудит | Принятие')
    .addFields(
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Действие**', value: '• Принятие в организацию на 1-й ранг', inline: false },
      { name: '**Причина**', value: `• ${reason}`, inline: false }
    );

  await sendToAuditChannel(interaction, 'invite', topLine, [embed]);
}

module.exports = { data, run };
