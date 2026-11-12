// Самопроверка без Discord: node selftest.js — собирает панель, форму и кнопки и проверяет их валидаторами discord.js
const assert = require('assert');
process.env.LICENSE_API_KEY = 'x'.repeat(16);
const api = require('./src/api');
const bot = require('./index.js');

// подставляем список модов, как будто пришёл с сайта
const mods = [{ name: 'RoofRack', title: 'Roof Rack', price: '2500 ₽', descr: 'Багажник', img: 'http://x/license.php?img=r.webp' }, { name: 'NoPrice', title: 'Без цены', price: '' }];
api.cachedMods = () => mods;

const panel = bot.buildPanel();
const pe = panel.embeds.map((e) => e.toJSON());
assert(pe[0].image.url.endsWith('panel_banner.png'), 'первым идёт баннер');
assert(pe[1].fields[0].value.includes('**Roof Rack** — 2500 ₽'), 'панель показывает мод с ценой');
assert.strictEqual(pe.length, 4, 'баннер + описание + 2 карточки');
assert.strictEqual(pe[2].thumbnail.url, mods[0].img, 'карточка с обложкой');
assert(!pe[3].thumbnail && !pe[3].fields, 'карточка без цены и обложки — без пустых полей');
api.cachedMods = () => Array.from({ length: 20 }, (_, i) => ({ name: `M${i}`, title: `Мод ${i}`, price: '' }));
assert(bot.buildPanel().embeds.length <= 10, 'не больше 10 embed в сообщении');
api.cachedMods = () => mods;
assert.strictEqual(panel.components[0].toJSON().components[0].custom_id, 'o:new');

const modal = bot.buildModal(mods).toJSON();
assert.strictEqual(modal.custom_id, 'o:form');
assert.strictEqual(modal.components.length, 4, 'в форме 4 поля');
const sel = modal.components[0].component;
assert.deepStrictEqual(sel.options.map((o) => o.value), ['RoofRack', 'NoPrice']);
assert.strictEqual(sel.options[1].description, undefined, 'у мода без цены нет пустого описания');

const many = Array.from({ length: 40 }, (_, i) => ({ name: `M${i}`, title: `Мод ${i}`, price: '' }));
assert.strictEqual(bot.buildModal(many).toJSON().components[0].component.options.length, 25, 'не больше 25 модов в списке');

assert(bot.orderButtons(true).toJSON().components[0].disabled, 'после выдачи кнопка неактивна');
assert(bot.installText('RoofRack').includes('Licenses\\RoofRack.txt'));
assert(bot.installText('RoofRack').length < 4000, 'инструкция влезает в embed');
assert(bot.COMMANDS.find((c) => c.name === 'setup'));
assert(bot.COMMANDS.find((c) => c.name === 'support'));
const sp = bot.buildSupportPanel();
assert.strictEqual(sp.components[0].toJSON().components[0].custom_id, 's:new');
assert(sp.embeds[0].toJSON().description.length < 4096);
const sm = bot.buildSupportModal().toJSON();
assert.strictEqual(sm.custom_id, 's:form');
assert.strictEqual(sm.components.length, 3, 'тема, мод/проект, описание');
console.log('selftest OK');
process.exit(0);
