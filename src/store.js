// Хранилище в data/store.json: настройки сервера, счётчик и открытые заказы.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'store.json');
let data = { guilds: {} };

try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  // файла ещё нет — начнём с пустого
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

// { settings: {role, category, logs, panel, panelMessage} | null, counter, open: {channelId: order} }
function guild(id) {
  if (!data.guilds[id]) data.guilds[id] = { settings: null, counter: 0, open: {} };
  return data.guilds[id];
}

// общие отметки бота (например, какая версия профиля уже выставлена)
const meta = () => (data.meta ||= {});

module.exports = { guild, meta, save };
