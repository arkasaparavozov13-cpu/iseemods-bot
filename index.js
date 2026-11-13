// Бот Isee MODS: заказы модов через тикеты и выдача ключей лицензий с сайта.
// Запуск: node index.js. Переменные (или файл .env): DISCORD_BOT_TOKEN, LICENSE_API_KEY, LICENSE_URL (необязательно)
const fs = require('fs');
const path = require('path');

function readEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
readEnvFile();

const {
  ActionRowBuilder, ActivityType, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, Events,
  GatewayIntentBits, LabelBuilder, MessageFlags, ModalBuilder, OverwriteType, PermissionFlagsBits: P, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { generateFromMessages, ExportReturnType } = require('discord-html-transcripts');
const { BRAND, PAYMENT, LICENSE, PANEL_TEXT, SUPPORT_TEXT, DEV_TEXT, RULES, PROFILE } = require('./src/config');
const store = require('./src/store');
const api = require('./src/api');

const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.TOKEN;
if (require.main === module) {
  if (!TOKEN) { console.error('[ОШИБКА] Нет DISCORD_BOT_TOKEN (переменная или файл .env)'); process.exit(1); }
  if (api.KEY.length < 16) console.error('[ОШИБКА] Нет LICENSE_API_KEY — выдача ключей работать не будет');
}

// ---------- сеть до Discord (как у бота YamalskiZ: IPv4, кэш DNS, тёплое соединение) ----------
const dns = require('dns');
const { Agent } = require(require.resolve('undici', { paths: [path.dirname(require.resolve('@discordjs/rest'))] }));
dns.setDefaultResultOrder('ipv4first');
const dnsCache = new Map();
function cachedLookup(host, options, callback) {
  const hit = dnsCache.get(host);
  if (hit) callback(null, options?.all ? [{ address: hit.address, family: hit.family }] : hit.address, hit.family);
  if (hit && Date.now() - hit.at < 10 * 60_000) return;
  dns.lookup(host, { family: 4 }, (err, address, family) => {
    if (!err) dnsCache.set(host, { address, family, at: Date.now() });
    if (!hit) err ? callback(err) : callback(null, options?.all ? [{ address, family }] : address, family);
  });
}
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  rest: { agent: new Agent({ keepAliveTimeout: 120_000, keepAliveMaxTimeout: 120_000, connect: { lookup: cachedLookup, timeout: 5000 } }) },
});

// ---------- помощники ----------
const pad = (n) => String(n).padStart(4, '0');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ts = (ms, f = 'f') => `<t:${Math.floor(ms / 1000)}:${f}>`;
const OK = 0x9fd8a8, BAD = 0xe2867f;
const notice = (text, color = BRAND.color) => new EmbedBuilder().setColor(color).setDescription(text);
const isStaff = (member, s) => member.permissions.has(P.Administrator) || (s && member.roles.cache.has(s.role));
const steamOk = (s) => /^7656\d{13}$/.test(s);

async function replyError(interaction, text) {
  const payload = { embeds: [notice(`⛔ ${text}`, BAD)], flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

function installText(modName) {
  return [
    `**1.** Откройте [кабинет покупателя](${BRAND.cabinet}), войдите по ключу и скачайте сборку.`,
    '**2.** Распакуйте архив в папку сервера, добавьте мод в `-mod=` / `-serverMod=`, ключ из `Keys` положите в `keys` сервера.',
    `**3.** Запустите сервер один раз — появится \`profiles\\Licenses\\${modName}.txt\`.`,
    '**4.** Впишите туда ключ и перезапустите сервер. В логе должно быть `ЛИЦЕНЗИЯ: OK`.',
    '',
    '-# Ключ привязывается к первому серверу, который запустит мод. Переезд — «Сбросить привязку» в кабинете (раз в 7 дней).',
    '-# Сборка персональная: не передавайте её и ключ другим.',
  ].join('\n');
}

// ---------- команды ----------
const COMMANDS = [
  new SlashCommandBuilder().setName('setup')
    .setDescription('Настроить заказы: категория для тикетов, канал логов и панель с кнопкой «Купить мод»')
    .setDefaultMemberPermissions(P.Administrator)
    .addRoleOption((o) => o.setName('role').setDescription('Роль, которая видит заказы и выдаёт ключи').setRequired(true))
    .addChannelOption((o) => o.setName('panel').setDescription('Канал для панели (например #создать-заказ)').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName('panel')
    .setDescription('Отправить панель заказа в этот канал')
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('support')
    .setDescription('Отправить панель техподдержки в этот канал (после /setup)')
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('devpanel')
    .setDescription('Отправить панель «Заказать разработку» в этот канал (после /setup)')
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('rules')
    .setDescription('Отправить правила сервера в этот канал')
    .setDefaultMemberPermissions(P.Administrator),
].map((c) => c.toJSON());

function buildRules() {
  const head = new EmbedBuilder().setColor(BRAND.color).setImage(BRAND.banner)
    .setAuthor({ name: `${BRAND.name} · Правила сервера`, iconURL: BRAND.logo });
  const parts = RULES.map((r) => new EmbedBuilder().setColor(BRAND.color).setTitle(r.title).setDescription(r.text));
  parts[parts.length - 1].setFooter({ text: BRAND.name, iconURL: BRAND.logo }).setTimestamp();
  return { embeds: [head, ...parts].slice(0, 10) };
}

// ---------- тикеты без оплаты: техподдержка и заказ разработки ----------
// Поле формы: { id, label, desc?, select?: [...] | style: 'short'|'long', required, min?, max }
const TICKETS = {
  support: {
    id: 's', command: 'support', emoji: '🛟', channel: 'поддержка', word: 'Обращение', heading: 'Техподдержка',
    panelTitle: 'Нужна помощь?', text: SUPPORT_TEXT, button: 'Создать обращение', modalTitle: 'Обращение в поддержку',
    greet: 'Администратор скоро ответит здесь.\nПриложите скриншоты или лог сервера (`script_*.log`, `*.RPT`), если есть.',
    fields: [
      { id: 'topic', label: 'Тема', select: ['Мод не работает / ошибка', 'Лицензия и ключ', 'Оплата и заказ', 'Перенос на другой сервер', 'Другое'] },
      { id: 'about', label: 'Мод / проект', desc: 'Необязательно', style: 'short', required: false, max: 100 },
      { id: 'text', label: 'Опишите проблему', desc: 'Что случилось, что пробовали; ключ лицензии сюда не пишите', style: 'long', required: true, min: 10, max: 1500 },
    ],
  },
  dev: {
    id: 'd', command: 'devpanel', emoji: '🛠️', channel: 'разработка', word: 'Заявка', heading: 'Разработка на заказ',
    panelTitle: 'Заказать разработку', text: DEV_TEXT, button: 'Оставить заявку', modalTitle: 'Заявка на разработку',
    greet: 'Заявка принята — обсудим детали, сроки и цену здесь.\nПримеры, референсы и скриншоты можно прикрепить прямо в этот канал.',
    fields: [
      { id: 'topic', label: 'Что нужно', select: ['Новый мод', 'Доработка существующего мода', 'Постройки / карта', 'Скрипты и механики сервера', 'Другое'] },
      { id: 'about', label: 'Проект / сервер', desc: 'Необязательно', style: 'short', required: false, max: 100 },
      { id: 'budget', label: 'Бюджет и сроки', desc: 'Необязательно, например: до 5000 ₽, за 2 недели', style: 'short', required: false, max: 100 },
      { id: 'text', label: 'Опишите задачу', desc: 'Что должно получиться, как должно работать', style: 'long', required: true, min: 20, max: 1500 },
    ],
  },
};
const ticketKind = (customId) => Object.entries(TICKETS).find(([, t]) => customId === `${t.id}:new` || customId === `${t.id}:form`)?.[0];

function buildTicketPanel(kind) {
  const t = TICKETS[kind];
  return {
    embeds: [new EmbedBuilder()
      .setColor(BRAND.color)
      .setAuthor({ name: `${BRAND.name} · ${t.heading}`, iconURL: BRAND.logo })
      .setTitle(`${t.emoji}  ${t.panelTitle}`)
      .setDescription(t.text)
      .setThumbnail(BRAND.logo)
      .setFooter({ text: `${BRAND.name} · отвечаем в тикете`, iconURL: BRAND.logo })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${t.id}:new`).setLabel(t.button).setEmoji(t.emoji).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Витрина').setURL(BRAND.site))],
  };
}

function buildTicketModal(kind) {
  const t = TICKETS[kind];
  return new ModalBuilder().setCustomId(`${t.id}:form`).setTitle(`${t.emoji} ${t.modalTitle}`)
    .addLabelComponents(t.fields.map((f) => {
      const label = new LabelBuilder().setLabel(f.label);
      if (f.desc) label.setDescription(f.desc);
      if (f.select) return label.setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId(f.id).setPlaceholder('Выберите')
        .addOptions(f.select.map((o) => ({ label: o, value: o }))));
      const input = new TextInputBuilder().setCustomId(f.id).setStyle(f.style === 'long' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(f.required).setMaxLength(f.max);
      if (f.min) input.setMinLength(f.min);
      return label.setTextInputComponent(input);
    }));
}

async function onTicketNew(interaction, kind) {
  const g = store.guild(interaction.guild.id);
  if (!g.settings) return replyError(interaction, 'Тикеты ещё не настроены. Администратору: `/setup`.');
  const existing = findOpen(g, interaction.user.id, kind);
  if (existing) return replyError(interaction, `У вас уже есть открытый тикет: <#${existing[0]}>`);
  await interaction.showModal(buildTicketModal(kind));
}

async function onTicketForm(interaction, kind) {
  const t = TICKETS[kind];
  const guild = interaction.guild;
  const g = store.guild(guild.id);
  const s = g.settings;
  const user = interaction.user;
  if (!s) return replyError(interaction, 'Тикеты не настроены.');
  const values = Object.fromEntries(t.fields.map((f) => [f.id, f.select
    ? interaction.fields.getStringSelectValues(f.id)[0]
    : (interaction.fields.getTextInputValue(f.id) || '').trim()]));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (findOpen(g, user.id, kind)) return replyError(interaction, 'У вас уже есть открытый тикет.');
  if (opening.has(user.id)) return replyError(interaction, 'Тикет уже создаётся, подождите.');
  opening.add(user.id);
  try {
    g.counters ||= {};
    if (kind === 'support' && g.supportCounter) { g.counters.support = g.supportCounter; delete g.supportCounter; } // старый счётчик
    g.counters[kind] = (g.counters[kind] || 0) + 1;
    const number = g.counters[kind];
    store.save();
    const channel = await guild.channels.create({
      name: `${t.emoji}・${t.channel}-${pad(number)}`,
      type: ChannelType.GuildText,
      parent: guild.channels.cache.has(s.category) ? s.category : null,
      topic: `${t.word} #${pad(number)} · ${user.username} (${user.id}) · ${values.topic}`,
      permissionOverwrites: ticketPerms(guild, s, user.id),
    });
    g.open[channel.id] = { kind, number, user: user.id, username: user.username, openedAt: Date.now(), title: values.topic, about: values.about };
    store.save();
    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setAuthor({ name: `${t.word} #${pad(number)}`, iconURL: user.displayAvatarURL() })
      .setTitle(`${t.emoji} ${values.topic}`)
      .setDescription(`Привет, ${user}! ${t.greet}\n\n**Описание:**\n${cut(values.text, 1500)}`)
      .addFields({ name: 'Discord', value: `${user} · \`${user.id}\``, inline: true })
      .setFooter({ text: `${BRAND.name} · закрыть тикет — кнопка ниже` })
      .setTimestamp();
    for (const f of t.fields) {
      if (f.id === 'topic' || f.id === 'text' || !values[f.id]) continue;
      embed.addFields({ name: f.label, value: cut(values[f.id], 1024), inline: true });
    }
    await channel.send({
      content: `${user} · <@&${s.role}>`, embeds: [embed],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('o:close').setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Danger))],
      allowedMentions: { users: [user.id], roles: [s.role] },
    });
    await interaction.editReply({
      embeds: [notice(`✅ **${t.word} #${pad(number)} создан${t.word.endsWith('а') ? 'а' : 'о'}:** ${channel}`, OK)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Перейти').setURL(channel.url))],
    });
    await log(guild, new EmbedBuilder().setColor(BRAND.color).setTitle(`${t.emoji} ${t.word} #${pad(number)} — ${values.topic}`)
      .addFields({ name: 'Пользователь', value: `${user}`, inline: true }, { name: 'Канал', value: `${channel}`, inline: true })
      .setTimestamp());
  } finally {
    opening.delete(user.id);
  }
}

// ---------- панель ----------
function buildPanel() {
  const mods = api.cachedMods();
  // 1: баннер, 2: как купить + список (карточки модов — только в #каталог-модов)
  const banner = new EmbedBuilder().setColor(BRAND.color).setImage(BRAND.banner);
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: `${BRAND.name} · Магазин`, iconURL: BRAND.logo })
    .setTitle('◈  Купить мод')
    .setDescription(PANEL_TEXT)
    .setThumbnail(BRAND.logo)
    .setFooter({ text: `${BRAND.name} · оплата и выдача ключа — в тикете`, iconURL: BRAND.logo });
  if (mods.length) embed.addFields({ name: 'В продаже', value: cut(mods.map((m) => `◇ **${m.title}**${m.price ? ` — ${m.price}` : ''}`).join('\n'), 1024) });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('o:new').setLabel('Купить мод').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Витрина').setURL(BRAND.site),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Кабинет').setURL(BRAND.cabinet));
  return { embeds: [banner, embed], components: [row] };
}

// Аватар, баннер и «Обо мне» — один раз на версию PROFILE (Discord ограничивает частую смену аватара)
async function applyProfile() {
  const meta = store.meta();
  if (meta.profile === PROFILE.version) return;
  const uri = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'art', f)).toString('base64');
  try {
    await client.rest.patch('/users/@me', { body: { avatar: uri('icon.png'), banner: uri('profile_banner.png') } });
    await client.rest.patch('/applications/@me', { body: { description: PROFILE.about } });
    meta.profile = PROFILE.version;
    store.save();
    console.log('[профиль] аватар, баннер и описание обновлены');
  } catch (e) {
    console.error('[профиль]', e.message); // не критично: попробуем при следующем запуске
  }
}

function buildModal(mods) {
  const modSelect = new StringSelectMenuBuilder().setCustomId('mod').setPlaceholder('Выберите мод')
    .addOptions(mods.slice(0, 25).map((m) => ({ label: cut(m.title, 100), value: m.name, description: m.price ? cut(m.price, 100) : undefined })));
  const paySelect = new StringSelectMenuBuilder().setCustomId('pay').setPlaceholder('Как будете платить')
    .addOptions(PAYMENT.map((p) => ({ label: cut(p, 100), value: cut(p, 100) })));
  return new ModalBuilder().setCustomId('o:form').setTitle('🛒 Заказ мода')
    .addLabelComponents(
      new LabelBuilder().setLabel('Мод').setStringSelectMenuComponent(modSelect),
      new LabelBuilder().setLabel('Проект / сервер').setDescription('Название вашего DayZ-проекта')
        .setTextInputComponent(new TextInputBuilder().setCustomId('project').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      new LabelBuilder().setLabel('Steam ID (SteamID64)').setDescription('17 цифр, начинается с 7656 — владелец сервера')
        .setTextInputComponent(new TextInputBuilder().setCustomId('steam').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(17).setPlaceholder('76561198000000000')),
      new LabelBuilder().setLabel('Способ оплаты').setStringSelectMenuComponent(paySelect));
}

// ---------- настройка ----------
async function setup(interaction) {
  const guild = interaction.guild;
  const role = interaction.options.getRole('role', true);
  const panel = interaction.options.getChannel('panel', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const hidden = [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    { id: role.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
    { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory] },
  ];
  const cat = await guild.channels.create({ name: '🛒 Заказы', type: ChannelType.GuildCategory, permissionOverwrites: hidden });
  const logs = await guild.channels.create({ name: '📜・заказы-лог', type: ChannelType.GuildText, parent: cat.id, permissionOverwrites: hidden, topic: 'Заказы: открытие, выдача ключей, закрытие и история' });
  await api.refreshMods();
  const msg = await panel.send(buildPanel());
  const g = store.guild(guild.id);
  g.settings = { role: role.id, category: cat.id, logs: logs.id, panel: panel.id, panelMessage: msg.id };
  store.save();
  await interaction.editReply({ embeds: [notice(`✅ **Заказы настроены**\n\n▸ Панель: ${panel}\n▸ Логи: ${logs}\n▸ Категория: **${cat.name}**\n▸ Роль: ${role}\n▸ Модов с сайта: **${api.cachedMods().length}**`, OK)] });
}

async function updatePanels() {
  for (const guild of client.guilds.cache.values()) {
    const s = store.guild(guild.id).settings;
    if (!s?.panelMessage) continue;
    const ch = await guild.channels.fetch(s.panel).catch(() => null);
    const msg = ch && await ch.messages.fetch(s.panelMessage).catch(() => null);
    if (msg) await msg.edit(buildPanel()).catch((e) => console.error('[панель]', e.message));
  }
}

// ---------- открытие заказа ----------
const opening = new Set();
// заказ и обращение в поддержку считаются раздельно: по одному открытому каждого вида
const findOpen = (g, userId, kind = 'order') => Object.entries(g.open).find(([, o]) => o.user === userId && (o.kind || 'order') === kind);
const ticketPerms = (guild, s, userId) => {
  const staffPerms = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.ManageMessages];
  return [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    { id: userId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
    { id: s.role, allow: staffPerms },
    { id: client.user.id, allow: [...staffPerms, P.ManageChannels] },
  ];
};

async function onNew(interaction) {
  const g = store.guild(interaction.guild.id);
  if (!g.settings) return replyError(interaction, 'Заказы ещё не настроены. Администратору: `/setup`.');
  const existing = findOpen(g, interaction.user.id);
  if (existing) return replyError(interaction, `У вас уже есть открытый заказ: <#${existing[0]}>`);
  const mods = api.cachedMods();
  if (!mods.length) {
    api.refreshMods();
    return replyError(interaction, 'Каталог сейчас недоступен. Попробуйте через минуту.');
  }
  await interaction.showModal(buildModal(mods));
}

function orderButtons(paidDone = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('o:paid').setLabel(paidDone ? 'Ключ выдан' : 'Оплачено — выдать ключ').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(paidDone),
    new ButtonBuilder().setCustomId('o:close').setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Danger));
}

async function onForm(interaction) {
  const guild = interaction.guild;
  const g = store.guild(guild.id);
  const s = g.settings;
  const user = interaction.user;
  if (!s) return replyError(interaction, 'Заказы не настроены.');
  const modName = interaction.fields.getStringSelectValues('mod')[0];
  const pay = interaction.fields.getStringSelectValues('pay')[0];
  const project = interaction.fields.getTextInputValue('project').trim();
  const steam = interaction.fields.getTextInputValue('steam').trim();
  if (!steamOk(steam)) return replyError(interaction, 'Steam ID — 17 цифр, начинается с 7656. Узнать: steamid.io. Нажмите «Купить мод» ещё раз.');
  const mod = api.cachedMods().find((m) => m.name === modName);
  if (!mod) return replyError(interaction, 'Этот мод больше не продаётся. Нажмите «Купить мод» ещё раз.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (findOpen(g, user.id)) return replyError(interaction, 'У вас уже есть открытый заказ.');
  if (opening.has(user.id)) return replyError(interaction, 'Заказ уже создаётся, подождите.');
  opening.add(user.id);
  try {
    g.counter += 1;
    const number = g.counter;
    store.save();
    const channel = await guild.channels.create({
      name: `🛒・заказ-${pad(number)}`,
      type: ChannelType.GuildText,
      parent: guild.channels.cache.has(s.category) ? s.category : null,
      topic: `Заказ #${pad(number)} · ${user.username} (${user.id}) · ${mod.title}`,
      permissionOverwrites: ticketPerms(guild, s, user.id),
    });
    g.open[channel.id] = { number, user: user.id, username: user.username, openedAt: Date.now(), mod: mod.name, title: mod.title, price: mod.price, project, steam, pay };
    store.save();

    await channel.send({
      content: `${user} · <@&${s.role}>`,
      embeds: [new EmbedBuilder()
        .setColor(BRAND.color)
        .setAuthor({ name: `Заказ #${pad(number)}`, iconURL: user.displayAvatarURL() })
        .setTitle(`◈ ${mod.title}`)
        .setDescription([
          `Привет, ${user}! Заказ принят.`,
          '',
          '**1.** Администратор пришлёт сюда реквизиты для оплаты.',
          '**2.** Оплатите и отправьте сюда скриншот чека.',
          '**3.** После проверки бот пришлёт ключ лицензии и инструкцию.',
        ].join('\n'))
        .addFields(
          { name: 'Цена', value: mod.price || 'уточнит администратор', inline: true },
          { name: 'Оплата', value: pay, inline: true },
          { name: 'Проект', value: cut(project, 1024), inline: true },
          { name: 'Steam ID', value: `[\`${steam}\`](https://steamcommunity.com/profiles/${steam})`, inline: true },
          { name: 'Discord', value: `${user} · \`${user.id}\``, inline: true },
        )
        .setFooter({ text: `${BRAND.name} · «Оплачено» нажимает администратор` })
        .setTimestamp()],
      components: [orderButtons()],
      allowedMentions: { users: [user.id], roles: [s.role] },
    });
    await interaction.editReply({
      embeds: [notice(`✅ **Заказ #${pad(number)} создан:** ${channel}`, OK)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Перейти в заказ').setURL(channel.url))],
    });
    await log(guild, new EmbedBuilder().setColor(BRAND.color).setTitle(`📥 Заказ #${pad(number)} — ${mod.title}`)
      .addFields({ name: 'Покупатель', value: `${user}`, inline: true }, { name: 'Проект', value: cut(project, 256), inline: true }, { name: 'Канал', value: `${channel}`, inline: true })
      .setTimestamp());
  } finally {
    opening.delete(user.id);
  }
}

async function log(guild, embed, files = []) {
  const s = store.guild(guild.id).settings;
  const ch = s && await guild.channels.fetch(s.logs).catch(() => null);
  if (ch) await ch.send({ embeds: [embed], files }).catch((e) => console.error('[лог]', e.message));
}

// ---------- выдача ключа ----------
const issuing = new Set();

async function onPaid(interaction) {
  const g = store.guild(interaction.guild.id);
  const order = g.open[interaction.channelId];
  if (!order || TICKETS[order.kind]) return replyError(interaction, 'Этот заказ уже закрыт.');
  if (!isStaff(interaction.member, g.settings)) return replyError(interaction, 'Подтвердить оплату может только администрация.');
  if (order.issued) return replyError(interaction, `Ключ уже выдан ${ts(order.issued.at, 'R')}.`);
  if (issuing.has(interaction.channelId)) return replyError(interaction, 'Ключ уже выдаётся.');
  issuing.add(interaction.channelId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const r = await api.issue({
      mod: order.mod, buyer: order.username, steam: order.steam, project: order.project,
      note: `Discord ${order.user} · заказ #${pad(order.number)} · ${order.pay}`,
      max: LICENSE.maxServers, days: LICENSE.days, ref: `${interaction.guild.id}-${order.number}`,
    });
    order.issued = { key: r.key, build: r.build, at: Date.now(), by: interaction.user.id };
    store.save();

    const keyEmbed = () => new EmbedBuilder()
      .setColor(OK)
      .setTitle(`🔑 Лицензия: ${r.title}`)
      .setDescription(`**Ключ:** \`${r.key}\`\n${r.expires ? `**Действует до:** ${ts(r.expires * 1000, 'D')}` : '**Срок:** бессрочно'}\n\n${installText(r.mod)}`)
      .setFooter({ text: `${BRAND.name} · спасибо за покупку!` })
      .setTimestamp();
    const cabinetRow = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Кабинет покупателя').setURL(BRAND.cabinet));

    await interaction.channel.send({ content: `<@${order.user}>`, embeds: [keyEmbed()], components: [cabinetRow()], allowedMentions: { users: [order.user] } });
    const buyer = await client.users.fetch(order.user).catch(() => null);
    const dm = await buyer?.send({ embeds: [keyEmbed()], components: [cabinetRow()] }).then(() => true).catch(() => false);
    await interaction.message.edit({ components: [orderButtons(true)] }).catch(() => {});

    await interaction.editReply({
      embeds: [notice([
        `✅ Ключ выдан${dm ? ' и отправлен в ЛС' : ' (ЛС у покупателя закрыты — ключ только в тикете)'}.`,
        '',
        `**Сборка покупателя:** \`${r.build}\``,
        `1. \`.\\build.ps1 -Build ${r.build}\` в папке мода`,
        '2. Запакуйте папку из `Покупатели\\' + r.build + '` в zip',
        '3. Админка сайта → Лицензии → этот покупатель → «Сборка» → загрузить zip',
        '',
        'Пока сборка не загружена, в кабинете покупатель увидит «Сборка пока не загружена».',
      ].join('\n'), OK)],
    });
    await log(interaction.guild, new EmbedBuilder().setColor(OK).setTitle(`🔑 Ключ выдан — заказ #${pad(order.number)}`)
      .addFields(
        { name: 'Мод', value: r.title, inline: true }, { name: 'Покупатель', value: `<@${order.user}>`, inline: true },
        { name: 'Выдал', value: `${interaction.user}`, inline: true }, { name: 'Сборка', value: `\`${r.build}\``, inline: true })
      .setTimestamp());
  } catch (e) {
    console.error('[выдача]', e);
    await replyError(interaction, `Сайт не выдал ключ: ${e.message}. Можно нажать ещё раз — второй ключ не создастся.`);
  } finally {
    issuing.delete(interaction.channelId);
  }
}

// ---------- закрытие ----------
const closing = new Set();

async function onCloseButton(interaction) {
  const g = store.guild(interaction.guild.id);
  const order = g.open[interaction.channelId];
  if (!order) return replyError(interaction, 'Этот тикет уже закрыт.');
  const sup = Boolean(TICKETS[order.kind]);
  if (!isStaff(interaction.member, g.settings) && order.user !== interaction.user.id) return replyError(interaction, 'Закрыть тикет может только автор или администрация.');
  await interaction.showModal(new ModalBuilder().setCustomId('o:closeform').setTitle(sup ? '🔒 Закрыть тикет' : '🔒 Закрыть заказ').addLabelComponents(
    new LabelBuilder().setLabel('Причина (необязательно)').setTextInputComponent(new TextInputBuilder()
      .setCustomId('reason').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setPlaceholder(sup ? 'Например: вопрос решён' : 'Например: ключ выдан'))));
}

async function fetchAll(channel) {
  const all = [];
  let before;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    all.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return all.reverse();
}

async function closeOrder(interaction) {
  const g = store.guild(interaction.guild.id);
  const order = g.open[interaction.channelId];
  const channel = interaction.channel;
  if (!order) return replyError(interaction, 'Этот тикет уже закрыт.');
  if (closing.has(channel.id)) return replyError(interaction, 'Тикет уже закрывается.');
  closing.add(channel.id);
  const sup = Boolean(TICKETS[order.kind]);
  const word = TICKETS[order.kind]?.word || 'Заказ';
  const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'не указана';
  const name = `#${pad(order.number)}`;
  await interaction.reply({ embeds: [notice(`🔒 **${word} закрывается.** Закрыл: ${interaction.user}\nПричина: ${reason}\n\nСохраняю историю, канал удалится через 10 секунд…`, BAD)] });
  try {
    await channel.permissionOverwrites.edit(order.user, { SendMessages: false }, { type: OverwriteType.Member }).catch(() => {});
    const messages = await fetchAll(channel);
    const html = await generateFromMessages(messages, channel, { returnType: ExportReturnType.Buffer, poweredBy: false, footerText: `${word} ${name} · сообщений: {number}`, favicon: 'guild' });
    const fields = [{ name: sup ? 'Автор' : 'Покупатель', value: `<@${order.user}>`, inline: true }, { name: 'Закрыл', value: `${interaction.user}`, inline: true }];
    if (!sup) fields.push({ name: 'Ключ', value: order.issued ? `выдан \`${order.issued.build}\`` : 'не выдан', inline: true });
    fields.push({ name: 'Открыт', value: ts(order.openedAt), inline: true }, { name: 'Причина', value: cut(reason, 1024) });
    await log(interaction.guild, new EmbedBuilder().setColor(0x7d8c99).setTitle(`📕 ${word} ${name} закрыт${{ Обращение: 'о', Заявка: 'а' }[word] || ''} — ${order.title}`)
      .addFields(fields)
      .setFooter({ text: 'История переписки во вложении' }).setTimestamp(),
    [new AttachmentBuilder(html, { name: `${order.kind || 'order'}-${pad(order.number)}.html` })]);
  } catch (e) {
    console.error('[закрытие]', e);
  }
  delete g.open[channel.id];
  store.save();
  setTimeout(() => { closing.delete(channel.id); channel.delete(`${word} ${name} закрыт`).catch(() => {}); }, 10_000);
}

// ---------- события ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.inGuild()) return;
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') return await setup(interaction);
      if (interaction.commandName === 'panel') {
        await api.refreshMods();
        const msg = await interaction.channel.send(buildPanel());
        const g = store.guild(interaction.guild.id);
        if (g.settings) { g.settings.panel = interaction.channelId; g.settings.panelMessage = msg.id; store.save(); }
        return interaction.reply({ embeds: [notice('✅ Панель отправлена', OK)], flags: MessageFlags.Ephemeral });
      }
      if (interaction.commandName === 'rules') {
        await interaction.channel.send(buildRules());
        return interaction.reply({ embeds: [notice('✅ Правила отправлены', OK)], flags: MessageFlags.Ephemeral });
      }
      const panelKind = Object.keys(TICKETS).find((k) => TICKETS[k].command === interaction.commandName);
      if (panelKind) {
        if (!store.guild(interaction.guild.id).settings) return replyError(interaction, 'Сначала выполните `/setup` — тикеты используют ту же роль, категорию и лог.');
        await interaction.channel.send(buildTicketPanel(panelKind));
        return interaction.reply({ embeds: [notice('✅ Панель отправлена', OK)], flags: MessageFlags.Ephemeral });
      }
    }
    const kind = ticketKind(interaction.customId);
    if (kind && interaction.isButton()) return await onTicketNew(interaction, kind);
    if (kind && interaction.isModalSubmit()) return await onTicketForm(interaction, kind);
    if (interaction.isButton()) {
      if (interaction.customId === 'o:new') return await onNew(interaction);
      if (interaction.customId === 'o:paid') return await onPaid(interaction);
      if (interaction.customId === 'o:close') return await onCloseButton(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'o:form') return await onForm(interaction);
      if (interaction.customId === 'o:closeform') return await closeOrder(interaction);
    }
  } catch (e) {
    console.error('[взаимодействие]', e);
    replyError(interaction, 'Что-то пошло не так. Попробуйте ещё раз.');
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`[бот] ${client.user.tag} онлайн, серверов: ${client.guilds.cache.size}`);
  client.user.setActivity('заказы модов', { type: ActivityType.Watching });
  await applyProfile();
  for (const guild of client.guilds.cache.values()) await guild.commands.set(COMMANDS).catch((e) => console.error('[команды]', guild.name, e.message));
  await api.refreshMods();
  console.log(`[сайт] модов на витрине: ${api.cachedMods().length}`);
  await updatePanels();
  // список модов и панель — раз в 5 минут; соединение с Discord держим тёплым
  setInterval(async () => { const before = JSON.stringify(api.cachedMods()); await api.refreshMods(); if (JSON.stringify(api.cachedMods()) !== before) updatePanels(); }, 5 * 60_000);
  setInterval(() => client.rest.get('/gateway', { auth: false }).catch(() => {}), 20_000);
});
client.on(Events.GuildCreate, (guild) => guild.commands.set(COMMANDS).catch(() => {}));

if (require.main === module) {
  (function login() {
    client.login(TOKEN).catch((e) => { console.error('[вход]', e.code || e.message, '— повтор через 30 с'); setTimeout(login, 30000); });
  })();
}

module.exports = { buildPanel, buildModal, buildRules, buildTicketPanel, buildTicketModal, ticketKind, orderButtons, installText, COMMANDS };
