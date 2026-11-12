// Связь с сайтом лицензий: список модов и выдача ключа.
const URL_BASE = (process.env.LICENSE_URL || 'http://iseee.xsph.ru/license.php').replace(/\/$/, '');
const KEY = process.env.LICENSE_API_KEY || '';

async function call(name, body) {
  const res = await fetch(`${URL_BASE}?api=${name}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Key': KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`сайт ответил не JSON (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// кэш модов: Discord ждёт ответ на кнопку 3 с, а хостинг может отвечать дольше
let mods = [];
let modsAt = 0;
async function refreshMods() {
  try {
    mods = (await call('mods')).mods || [];
    modsAt = Date.now();
  } catch (e) {
    console.error('[сайт] список модов:', e.message);
  }
  return mods;
}
const cachedMods = () => mods;
const modsAge = () => Date.now() - modsAt;

// ref — номер заказа: повтор с тем же ref вернёт уже выданный ключ, а не новый
const issue = (order) => call('issue', order);

module.exports = { refreshMods, cachedMods, modsAge, issue, KEY, URL_BASE };
