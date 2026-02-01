const config = require('../config');
const { SlashCommandBuilder, SlashCommandStringOption, SlashCommandUserOption, MessageFlags } = require('discord.js');
const { isValidPassport, baseEmbed, sendToAuditChannel } = require('../utils.js');

const data = new SlashCommandBuilder()
  .setName('uninvite')
  .setDescription('Кадровый аудит: увольнение из организации')
  .addUserOption(
    new SlashCommandUserOption()
      .setName('кого')
      .setDescription('Кого уволить (упоминание пользователя)')
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
      .setName('черный_список')
      .setDescription('Занесение в черный список?')
      .setRequired(true)
      .addChoices({ name: 'Да', value: 'да' }, { name: 'Нет', value: 'нет' })
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('причина')
      .setDescription('Причина увольнения')
      .setRequired(true)
  );

async function run(interaction) {
  const uninviteRoles = config.roles?.uninvite || [];
  if (uninviteRoles.length > 0) {
    const member = interaction.member;
    const hasRole = member?.roles?.cache?.some((r) => uninviteRoles.includes(r.id));
    if (!hasRole) {
      await interaction.reply({
        content: 'Команду /uninvite может использовать только Старший состав.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
  }

  const employeeUser = interaction.options.getUser('кого');
  const employeeMember = interaction.options.getMember('кого');
  const passport = interaction.options.getString('номер_паспорта');
  const blacklistValue = interaction.options.getString('черный_список');
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

  if (employeeMember) {
    try {
      await employeeMember.roles.set([]);
    } catch (err) {
      console.error('Uninvite: failed to remove roles', err);
      await interaction.reply({
        content: 'Не удалось снять роли. Проверьте, что у бота есть право «Управление ролями» и его роль выше ролей участника.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
  }

  const employeeDisplay = `${employeeUser} | ${employeeMember?.displayName ?? employeeUser.username}`;
  const blacklist = blacklistValue === 'да';
  const actionText = blacklist
    ? 'Увольнение из организации с занесением в черный список'
    : 'Увольнение из организации без занесения в черный список';

  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${employeeUser}`;

  const embed = baseEmbed(interaction, 'Кадровый аудит | Увольнение')
    .addFields(
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Действие**', value: `• ${actionText}`, inline: false },
      { name: '**Причина**', value: `• ${reason}`, inline: false }
    );

  await sendToAuditChannel(interaction, 'uninvite', topLine, [embed]);
}

module.exports = { data, run };
