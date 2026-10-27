'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSheet } = require('../lib/sheet');
const S = require('../lib/state');
const html = require('../lib/html');
const fixture = require('./fixtures/character.json');

const sheet = buildSheet(fixture);
const key = (re) => sheet.uses.find((u) => re.test(u.name)).key;
function fresh() {
  const st = S.normalize(null);
  S.applyLoad(st, sheet);
  return st;
}

test('loading takes the counters from D&D Beyond', () => {
  const st = fresh();
  assert.equal(st.live.removed, 22);
  assert.deepEqual(st.live.slots, { 1: 1, 2: 1 });
  assert.deepEqual(S.diff(st, sheet), []);
  assert.equal(st.custom.find((c) => c.id === 'spark').max, 2, 'Chronicler’s Spark follows the proficiency bonus');
});

test('damage eats temp HP first; healing stops at max', () => {
  const st = fresh();
  S.apply(st, sheet, 'hp/heal', { amount: 30 });
  assert.equal(st.live.removed, 0);
  S.apply(st, sheet, 'hp/temp', { amount: 5 });
  S.apply(st, sheet, 'hp/damage', { amount: 8 });
  assert.equal(st.live.temp, 0);
  assert.equal(st.live.removed, 3);
  const r = S.apply(st, sheet, 'hp/damage', { amount: 99 });
  assert.equal(st.live.removed, 26);
  assert.equal(r.down, true);
  assert.throws(() => S.apply(st, sheet, 'hp/damage', { amount: -1 }), S.ActionError);
});

test('casting a Sorcerer spell with a slot offers a surge check', () => {
  const st = fresh();
  const shatter = sheet.spells.find((s) => s.name === 'Shatter');
  const r = S.apply(st, sheet, 'cast', { spellKey: shatter.key, level: 2 });
  assert.equal(st.live.slots[2], 2);
  assert.equal(r.offerCheck, true);
  assert.throws(() => S.apply(st, sheet, 'cast', { spellKey: shatter.key, level: 1 }), /whole number from 2/);
  S.apply(st, sheet, 'cast', { spellKey: shatter.key, level: 2 });
  assert.throws(() => S.apply(st, sheet, 'cast', { spellKey: shatter.key, level: 2 }), /No 2nd-level slots left/);
});

test('free cast uses the feat counter, no surge', () => {
  const st = fresh();
  const misty = sheet.spells.find((s) => s.name === 'Misty Step');
  const r = S.apply(st, sheet, 'cast', { spellKey: misty.key, level: 'free' });
  assert.equal(st.live.uses[misty.useKey], 1);
  assert.equal(r.offerCheck, undefined);
  assert.throws(() => S.apply(st, sheet, 'cast', { spellKey: misty.key, level: 'free' }), /No free casting/);
});

test('with Tides of Chaos spent the next slot spell surges for sure and Tides comes back', () => {
  const st = fresh();
  const tides = key(/^Tides of Chaos$/);
  S.apply(st, sheet, 'use/set', { key: tides, used: 1 });
  const ice = sheet.spells.find((s) => s.name === 'Ice Knife');
  const r = S.apply(st, sheet, 'cast', { spellKey: ice.key, level: 1 });
  assert.ok(r.autoSurge);
  assert.ok(r.autoSurge.roll >= 1 && r.autoSurge.roll <= 100);
  assert.ok(r.autoSurge.html.length > 10, 'shows the matching row of the table');
  assert.equal(r.autoSurge.tidesBack, true);
  assert.equal(st.live.uses[tides], 0);
  assert.equal(st.surge.log[0].type, 'table');
});

test('surge check rolls a d20', () => {
  const st = fresh();
  for (let i = 0; i < 30; i++) {
    const r = S.apply(st, sheet, 'surge/check', {});
    assert.ok(r.roll >= 1 && r.roll <= 20);
    assert.equal(r.surge, r.roll === 20);
    if (r.surge) assert.ok(r.table);
  }
  assert.ok(st.surge.log.length <= 20);
});

test('Font of Magic both ways', () => {
  const st = fresh();
  const sp = key(/Sorcery Points/);
  assert.throws(() => S.apply(st, sheet, 'sp/from-slot', { level: 1 }), /already full/);
  S.apply(st, sheet, 'use/set', { key: sp, used: 3 });
  S.apply(st, sheet, 'sp/from-slot', { level: 2 });
  assert.equal(st.live.uses[sp], 1);
  assert.equal(st.live.slots[2], 2);
  // creating a 1st-level slot costs 2: frees a used one first
  S.apply(st, sheet, 'sp/to-slot', { level: 1 });
  assert.equal(st.live.uses[sp], 3);
  assert.equal(st.live.slots[1], 0);
  S.apply(st, sheet, 'use/set', { key: sp, used: 0 });
  S.apply(st, sheet, 'sp/to-slot', { level: 1 });
  assert.equal(st.live.extra[1], 1, 'with no used slot it becomes an extra slot');
  assert.throws(() => S.apply(st, sheet, 'sp/to-slot', { level: 2 }), /costs 3 points; you have 2/);
});

test('rests', () => {
  const st = fresh();
  st.custom[0].used = 2;
  S.apply(st, sheet, 'use/set', { key: key(/Innate/), used: 2 });
  S.apply(st, sheet, 'rest/short', {});
  assert.equal(st.live.uses[key(/Innate/)], 2, 'long-rest feature stays used after a short rest');
  S.apply(st, sheet, 'rest/long', {});
  assert.equal(st.live.uses[key(/Innate/)], 0);
  assert.deepEqual(st.live.slots, { 1: 0, 2: 0 });
  assert.equal(st.live.removed, 0);
  assert.equal(st.custom[0].used, 0);
});

test('end-of-night list and marking it done by hand', () => {
  const st = fresh();
  S.apply(st, sheet, 'slot/set', { level: 1, used: 3 });
  S.apply(st, sheet, 'use/set', { key: key(/Tides/), used: 1 });
  S.apply(st, sheet, 'inspiration/set', { on: true });
  S.apply(st, sheet, 'hp/heal', { amount: 5 });
  const d = S.diff(st, sheet);
  assert.deepEqual(d.map((x) => x.key).sort(), ['hp', 'inspiration', key(/Tides/), 'slots'].sort());
  assert.match(d.find((x) => x.key === 'slots').text, /1st: 3 of 4 used/);
  S.apply(st, sheet, 'sync/marked', {});
  assert.deepEqual(S.diff(st, sheet), []);
});

test('custom trackers', () => {
  const st = fresh();
  const { id } = S.apply(st, sheet, 'custom/add', { name: 'Luck', max: 3, reset: 'short', note: 'test' });
  S.apply(st, sheet, 'custom/set', { id, used: 2 });
  S.apply(st, sheet, 'custom/update', { id, max: 1 });
  assert.equal(st.custom.find((c) => c.id === id).used, 1);
  assert.throws(() => S.apply(st, sheet, 'custom/add', { name: '', max: 1 }), /name/);
  S.apply(st, sheet, 'custom/remove', { id });
  assert.ok(!st.custom.some((c) => c.id === id));
});

test('notes: add, switch, clean HTML, delete', () => {
  const st = fresh();
  const a = S.apply(st, sheet, 'note/add', {});
  const b = S.apply(st, sheet, 'note/add', { title: 'NPCs' });
  assert.equal(st.notes[0].title, 'Note 1');
  assert.equal(st.activeNote, b.id);
  S.apply(st, sheet, 'note/update', { id: a.id, html: '<b>Guz</b><script>alert(1)</script><img src=x onerror=alert(1)><ul class="chk"><li data-done="1">done</li></ul>' });
  assert.equal(st.notes[0].html, '<b>Guz</b><ul class="chk"><li data-done="1">done</li></ul>');
  S.apply(st, sheet, 'note/active', { id: a.id });
  S.apply(st, sheet, 'note/move', { id: a.id, dir: 'right' });
  assert.equal(st.notes[1].id, a.id);
  S.apply(st, sheet, 'note/remove', { id: a.id });
  assert.equal(st.activeNote, b.id);
});

test('settings are checked', () => {
  const st = fresh();
  S.apply(st, sheet, 'settings/set', { theme: 'ember', size: 112, quotes: ['a', '', ' b '] });
  assert.equal(st.settings.theme, 'ember');
  assert.equal(st.settings.size, 110);
  assert.deepEqual(st.settings.quotes, ['a', 'b']);
  assert.throws(() => S.apply(st, sheet, 'settings/set', { theme: 'pink' }), /style/);
  assert.throws(() => S.apply(st, sheet, 'settings/set', { size: 300 }), /Size/);
});

test('descriptions from D&D Beyond are made safe', () => {
  const out = html.rich('<p style="color:red" onclick="x()">Use [action]Attack[/action] <a href="javascript:x">link</a></p><iframe src=x></iframe><table><tr><td>1</td></tr></table>');
  assert.equal(out, '<p>Use Attack link</p><table><tr><td>1</td></tr></table>');
});
