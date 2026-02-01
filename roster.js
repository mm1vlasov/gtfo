const config = require('./config');
const { EmbedBuilder } = require('discord.js');

const EMBED_COLOR = 0x2b2d31;
const EMBED_FIELD_VALUE_MAX = 1024;

/**
 * Присваивает каждого участника одной категории — по высшей роли из списка (первое совпадение).
 * @param {Map<string, import('discord.js').GuildMember>} membersMap — id участника -> member
 * @param {string[]} roleIdsOrder — роли по убыванию приоритета
 * @returns {import('discord.js').GuildMember[][]} — массивы участников по категориям
 */
function assignMembersByRoles(membersMap, roleIdsOrder) {
  const byCategory = roleIdsOrder.map(() => []);
  const assigned = new Set();

  roleIdsOrder.forEach((roleIds, i) => {
    for (const [memberId, member] of membersMap) {
      if (assigned.has(memberId)) continue;
      const hasRole = roleIds.some((rid) => member.roles.cache.has(rid));
      if (hasRole) {
        byCategory[i].push(member);
        assigned.add(memberId);
      }
    }
  });

  return byCategory;
}

/**
 * Для отдела: порядок ролей [curator, head, deputyHead, instructor, staff].
 * Участник попадает в первую (высшую) категорию, в которой у него есть роль.
 * Участники с ролями из excludeFromDepartmentRoster (например, Генерал-лейтенант) в составы отделов не попадают.
 */
function getDepartmentMembersByCategory(guild, dept) {
  const excludeRoleIds = config.roster?.excludeFromDepartmentRoster || [];
  const roleOrder = [
    [dept.curator],
    [dept.head],
    [dept.deputyHead],
    [dept.instructor],
    [dept.staff],
  ].filter((arr) => arr[0]);
  const allRoleIds = roleOrder.flat();
  const membersMap = new Map();
  for (const [, member] of guild.members.cache) {
    if (excludeRoleIds.some((rid) => member.roles.cache.has(rid))) continue;
    const hasAny = allRoleIds.some((rid) => member.roles.cache.has(rid));
    if (hasAny) membersMap.set(member.id, member);
  }
  return assignMembersByRoles(membersMap, roleOrder);
}

/**
 * Хай стафф: категории подряд, участник попадает в первую категорию, где есть любая из ролей.
 */
function getHighStaffMembersByCategory(guild, categories) {
  const roleOrder = categories.map((c) => c.roleIds);
  const allRoleIds = roleOrder.flat();
  const membersMap = new Map();
  for (const [, member] of guild.members.cache) {
    const hasAny = allRoleIds.some((rid) => member.roles.cache.has(rid));
    if (hasAny) membersMap.set(member.id, member);
  }
  return assignMembersByRoles(membersMap, roleOrder);
}

function formatMemberLine(member, index) {
  const tag = member.user.toString();
  const nickname = member.displayName || member.user.username;
  const num = index != null ? `${index + 1}. ` : '';
  return `${num}${tag} | ${nickname}`;
}

function truncateFieldValue(text) {
  if (text.length <= EMBED_FIELD_VALUE_MAX) return text;
  return text.slice(0, EMBED_FIELD_VALUE_MAX - 3) + '...';
}

const DEPARTMENT_CATEGORY_TITLES = ['Curator', 'Head', 'Deputy Head', 'Instructor', 'Staff'];

function buildDepartmentEmbeds(dept, membersByCategory) {
  const embeds = [];
  for (let i = 0; i < DEPARTMENT_CATEGORY_TITLES.length; i++) {
    const title = `${DEPARTMENT_CATEGORY_TITLES[i]} ${dept.shortName}`;
    const members = membersByCategory[i] || [];
    const description = members.length
      ? truncateFieldValue(members.map((m, idx) => formatMemberLine(m, idx)).join('\n'))
      : '—';
    embeds.push(
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
    );
  }
  return embeds;
}

function buildHighStaffEmbeds(categories, membersByCategory) {
  const embeds = [];
  if (categories.length === 0) return embeds;

  const embed1 = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(categories[0].title)
    .setDescription(
      (membersByCategory[0] || []).length
        ? truncateFieldValue((membersByCategory[0] || []).map((m, idx) => formatMemberLine(m, idx)).join('\n'))
        : '—'
    )
    .setTimestamp();
  embeds.push(embed1);

  if (categories.length > 1) {
    const embed2 = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(categories[1].title)
      .setDescription(
        (membersByCategory[1] || []).length
          ? truncateFieldValue((membersByCategory[1] || []).map((m, idx) => formatMemberLine(m, idx)).join('\n'))
          : '—'
      )
      .setTimestamp();
    embeds.push(embed2);
  }

  for (let d = 0; d < 9 && 2 + d * 3 + 2 < categories.length; d++) {
    const i0 = 2 + d * 3;
    const cat0 = categories[i0];
    const deptName = cat0.title.split(/\s+/).pop() || '';
    const fields = [];
    for (let f = 0; f < 3 && i0 + f < categories.length; f++) {
      const cat = categories[i0 + f];
      const members = membersByCategory[i0 + f] || [];
      const value = members.length
        ? truncateFieldValue(members.map((m, idx) => formatMemberLine(m, idx)).join('\n'))
        : '—';
      fields.push({ name: `**${cat.title}**`, value, inline: false });
    }
    embeds.push(
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(deptName)
        .addFields(fields)
        .setTimestamp()
    );
  }
  return embeds;
}

async function findRosterMessage(channel, embedTitlePrefix, expectedEmbedCount) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return null;
  return messages.find((m) => {
    if (m.author.id !== channel.client.user.id || !m.embeds?.length) return false;
    if (expectedEmbedCount != null && m.embeds.length !== expectedEmbedCount) return false;
    return m.embeds[0]?.title?.startsWith(embedTitlePrefix);
  }) ?? null;
}

async function sendOrUpdateRoster(channel, embedOrEmbeds, embedTitlePrefix, expectedEmbedCount) {
  if (!channel) return;
  const embeds = Array.isArray(embedOrEmbeds) ? embedOrEmbeds : [embedOrEmbeds];
  const existing = await findRosterMessage(channel, embedTitlePrefix, expectedEmbedCount);
  try {
    if (existing) {
      await existing.edit({ embeds });
    } else {
      await channel.send({ embeds });
    }
  } catch (err) {
    console.error('Roster: не удалось отправить/обновить сообщение в канал', channel.id, err);
  }
}

async function updateDepartmentRosters(client) {
  const guildId = config.guildId;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  await guild.members.fetch().catch(() => {});

  const rosterCfg = config.roster;
  if (!rosterCfg?.departments?.length) return;

  const DEPT_EMBED_COUNT = 5;
  for (const dept of rosterCfg.departments) {
    const channel = await client.channels.fetch(dept.channelId).catch(() => null);
    if (!channel) continue;
    const membersByCategory = getDepartmentMembersByCategory(guild, dept);
    const embeds = buildDepartmentEmbeds(dept, membersByCategory);
    await sendOrUpdateRoster(channel, embeds, 'Curator ', DEPT_EMBED_COUNT);
  }
}

async function updateHighStaffRoster(client) {
  const guildId = config.guildId;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  await guild.members.fetch().catch(() => {});

  const highStaff = config.roster?.highStaff;
  if (!highStaff?.channelId || !highStaff?.categories?.length) return;

  const channel = await client.channels.fetch(highStaff.channelId).catch(() => null);
  if (!channel) return;

  const membersByCategory = getHighStaffMembersByCategory(guild, highStaff.categories);
  const allEmbeds = buildHighStaffEmbeds(highStaff.categories, membersByCategory);
  const maxEmbedsPerMessage = 10;
  const firstTitle = highStaff.categories[0]?.title ?? 'Генерал';
  if (allEmbeds.length <= maxEmbedsPerMessage) {
    await sendOrUpdateRoster(channel, allEmbeds, firstTitle, allEmbeds.length);
  } else {
    const batch1 = allEmbeds.slice(0, maxEmbedsPerMessage);
    const batch2 = allEmbeds.slice(maxEmbedsPerMessage);
    const secondTitle = highStaff.categories[2 + 8 * 3]?.title?.split(/\s+/).pop() ?? 'DIV';
    await sendOrUpdateRoster(channel, batch1, firstTitle, batch1.length);
    await sendOrUpdateRoster(channel, batch2, secondTitle, batch2.length);
  }
}

async function runRosterUpdate(client) {
  await updateHighStaffRoster(client);
  await updateDepartmentRosters(client);
}

function startRosterScheduler(client) {
  const intervalMinutes = config.roster?.updateIntervalMinutes ?? 30;
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  runRosterUpdate(client).then(() => {
    console.log('[Roster] Первое обновление составов выполнено.');
  }).catch((err) => {
    console.error('[Roster] Ошибка первого обновления:', err);
  });

  setInterval(() => {
    runRosterUpdate(client).catch((err) => {
      console.error('[Roster] Ошибка обновления составов:', err);
    });
  }, intervalMs);
  console.log(`[Roster] Обновление составов каждые ${intervalMinutes} мин.`);
}

module.exports = {
  runRosterUpdate,
  startRosterScheduler,
};
