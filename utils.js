const config = require('./config');
const { EmbedBuilder, MessageFlags } = require('discord.js');

const EMBED_COLOR = 0x2b2d31;
const FOLDER = '📁';

const DEPARTMENTS = [
  { name: 'MA | Millitary Academy', value: 'MA | Millitary Academy' },
  { name: 'MP | Millitary Police', value: 'MP | Millitary Police' },
  { name: 'Academy', value: 'Academy' },
  { name: 'DIV | Division', value: 'DIV | Division' },
  { name: 'MMS | Military Medical Service', value: 'MMS | Military Medical Service' },
  { name: 'SOG | Studies and Observations Group', value: 'SOG | Studies and Observations Group' },
  { name: 'CG | Coast Guard', value: 'CG | Coast Guard' },
  { name: 'AF | Air Force', value: 'AF | Air Force' },
  { name: 'SEAL | United States Navy SEAL', value: 'SEAL | United States Navy SEAL' },
  { name: 'DF | Delta Force', value: 'DF | Delta Force' },
];

function isValidPassport(value) {
  return /^\d+$/.test(String(value).trim());
}

function getDisplayName(interactionOrMember) {
  const member = interactionOrMember.member ?? interactionOrMember;
  const user = interactionOrMember.user ?? interactionOrMember;
  return member?.displayName ?? user?.username ?? 'Unknown';
}

function filledByText(interaction) {
  const u = interaction.user;
  const displayName = getDisplayName(interaction);
  return `${u} | ${displayName}`;
}

function baseEmbed(interaction, title) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${FOLDER} ${title}`)
    .addFields({
      name: "**Заполнил'а**",
      value: `• ${filledByText(interaction)}`,
      inline: false,
    })
    .setTimestamp();
}

async function sendToAuditChannel(interaction, channelKey, content, embeds) {
  const channelId = config.channels?.[channelKey];
  if (!channelId) {
    await interaction.reply({
      content: 'Канал для аудита не настроен.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await interaction.reply({
      content: 'Не удалось найти канал аудита.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await channel.send({ content, embeds });
  await interaction.reply({
    content: `Кадровый аудит отправлен в ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });
}

function getChannelId(key) {
  return config.channels?.[key] || null;
}

module.exports = {
  EMBED_COLOR,
  FOLDER,
  DEPARTMENTS,
  isValidPassport,
  getDisplayName,
  filledByText,
  baseEmbed,
  sendToAuditChannel,
  getChannelId,
};
