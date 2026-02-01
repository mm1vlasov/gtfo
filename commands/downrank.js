const { SlashCommandBuilder, SlashCommandStringOption, SlashCommandIntegerOption, SlashCommandUserOption, MessageFlags } = require('discord.js');
const { isValidPassport, baseEmbed, sendToAuditChannel } = require('../utils.js');

const data = new SlashCommandBuilder()
  .setName('downrank')
  .setDescription('Кадровый аудит: понижение по рангу')
  .addUserOption(
    new SlashCommandUserOption()
      .setName('кого')
      .setDescription('Кого понизили (упоминание пользователя)')
      .setRequired(true)
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('номер_паспорта')
      .setDescription('Номер паспорта (StaticID), только цифры')
      .setRequired(true)
  )
  .addIntegerOption(
    new SlashCommandIntegerOption()
      .setName('ранг')
      .setDescription('На какой ранг понижен (цифра)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(99)
  )
  .addStringOption(
    new SlashCommandStringOption()
      .setName('причина')
      .setDescription('Причина понижения')
      .setRequired(true)
  );

async function run(interaction) {
  const employeeUser = interaction.options.getUser('кого');
  const employeeMember = interaction.options.getMember('кого');
  const passport = interaction.options.getString('номер_паспорта');
  const rank = interaction.options.getInteger('ранг');
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

  const employeeDisplay = `${employeeUser} | ${employeeMember?.displayName ?? employeeUser.username}`;
  const rankWord = rank === 1 ? '1-й' : rank === 2 ? '2-й' : rank === 3 ? '3-й' : `${rank}-й`;
  const actionText = `Понижение на ${rankWord} ранг`;

  const topLine = `${interaction.user} заполнил'а кадровый аудит на ${employeeUser}`;

  const embed = baseEmbed(interaction, 'Кадровый аудит | Понижение')
    .addFields(
      { name: '**Сотрудник**', value: `• ${employeeDisplay}`, inline: false },
      { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
      { name: '**Действие**', value: `• ${actionText}`, inline: false },
      { name: '**Причина**', value: `• ${reason}`, inline: false }
    );

  await sendToAuditChannel(interaction, 'uprank', topLine, [embed]);
}

module.exports = { data, run };
