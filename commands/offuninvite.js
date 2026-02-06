const config = require('../config');
const { SlashCommandBuilder, SlashCommandStringOption, MessageFlags, EmbedBuilder } = require('discord.js');
const { isValidPassport, baseEmbed, sendToAuditChannel } = require('../utils.js');

const data = new SlashCommandBuilder()
    .setName('offuninvite')
    .setDescription('Кадровый аудит: увольнение (без Discord пользователя)')
    .addStringOption(
        new SlashCommandStringOption()
            .setName('никнейм')
            .setDescription('Никнейм сотрудника (Имя Фамилия)')
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
    // Проверка прав (те же роли, что и uninvite)
    const uninviteRoles = config.roles?.uninvite || [];
    if (uninviteRoles.length > 0) {
        const member = interaction.member;
        const hasRole = member?.roles?.cache?.some((r) => uninviteRoles.includes(r.id));
        if (!hasRole) {
            await interaction.reply({
                content: 'Команду /offuninvite может использовать только Старший состав.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => { });
            return;
        }
    }

    const nickname = interaction.options.getString('никнейм');
    const passport = interaction.options.getString('номер_паспорта');
    const blacklistValue = interaction.options.getString('черный_список');
    const reason = interaction.options.getString('причина');

    if (!isValidPassport(passport)) {
        await interaction.reply({
            content: 'Номер паспорта (StaticID) должен содержать только цифры.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const blacklist = blacklistValue === 'да';
    const actionText = blacklist
        ? 'Увольнение из организации с занесением в черный список'
        : 'Увольнение из организации без занесения в черный список';

    const authorDisplay = `${interaction.user} | ${interaction.member?.displayName ?? interaction.user.username}`;

    const embed = baseEmbed(interaction, 'Кадровый аудит | Увольнение (Offuninvite)')
        .addFields(
            { name: '**Сотрудник**', value: `• ${nickname}`, inline: false },
            { name: '**Номер паспорта (StaticID)**', value: `• ${passport}`, inline: false },
            { name: '**Действие**', value: `• ${actionText}`, inline: false },
            { name: '**Причина**', value: `• ${reason}`, inline: false },
            { name: '**Примечания**', value: `• Уволен через /offuninvite (Сотрудник отсутствует в Discord)`, inline: false }
        );

    const topLine = `${interaction.user} заполнил'а кадровый аудит на ${nickname} (${passport})`;

    // Отправляем в канал uninvite (кадровый аудит)
    await sendToAuditChannel(interaction, 'uninvite', topLine, [embed]);

    await interaction.editReply({ content: 'Аудит отправлен (без кика/ЛС, только запись).' });
}

module.exports = { data, run };
