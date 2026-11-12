// Самопроверка без Discord: node selftest.js — собирает панель, форму и кнопки и проверяет их валидаторами discord.js
const assert = require('assert');
process.env.LICENSE_API_KEY = 'x'.repeat(16);
const api = require('./src/api');
const bot = require('./index.js');

// подставляем список модов, как будто пришёл с сайта
const mods = [{ name: 'RoofRack', title: 'Roof Rack', price: '2500 ₽' }, { name: 'NoPrice', title: 'Без цены', price: '' }];
api.cachedMods = () => mods;

const panel = bot.buildPanel();
const pj = panel.embeds[0].toJSON();
assert(pj.fields[0].value.includes('**Roof Rack** — 2500 ₽'), 'панель показывает мод с ценой');
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
console.log('selftest OK');
process.exit(0);
