// Тексты и настройки бота Isee MODS. Меняйте здесь.
module.exports = {
  BRAND: {
    name: 'Isee MODS',
    color: 0xd8d8d8,           // серебро, как на сайте
    site: 'http://iseee.xsph.ru/',
    cabinet: 'http://iseee.xsph.ru/license.php?me',
    // картинки лежат в папке art/ репозитория (он публичный) — Discord берёт их по ссылке
    banner: 'https://raw.githubusercontent.com/arkasaparavozov13-cpu/iseemods-bot/main/art/panel_banner.png',
    logo: 'https://raw.githubusercontent.com/arkasaparavozov13-cpu/iseemods-bot/main/art/icon.png',
  },
  // профиль бота: аватар art/icon.png, баннер art/profile_banner.png и «Обо мне».
  // Поменяли что-то — увеличьте version, бот выставит заново при запуске.
  PROFILE: {
    version: 1,
    about: [
      '◈ Магазин модов Isee MODS для DayZ-серверов',
      '',
      '🛒 Заказ — кнопка «Купить мод» в #создать-заказ',
      '🔑 Ключ лицензии — сразу после оплаты',
      '🌐 iseee.xsph.ru',
    ].join('\n'),
  },
  // способы оплаты в форме заказа
  PAYMENT: ['Карта РФ', 'СБП', 'Криптовалюта', 'Другое — обсудим в тикете'],
  // сколько серверов на один ключ и срок лицензии (0 = бессрочно) при выдаче через бота
  LICENSE: { maxServers: 1, days: 0 },
  PANEL_TEXT: [
    '**Моды для DayZ-серверов от Isee MODS.**',
    '',
    '◇ Нажмите **«Купить мод»** — выберите мод, укажите проект, Steam ID и способ оплаты',
    '◇ Откроется приватный тикет — администратор пришлёт реквизиты',
    '◇ После оплаты бот пришлёт **ключ лицензии** и ссылку на кабинет, где лежит ваша сборка',
    '',
    '-# Один открытый заказ на человека. Вопросы без покупки — в #техподдержка.',
  ].join('\n'),
};
