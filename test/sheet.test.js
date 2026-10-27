'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSheet, parseSurgeTable } = require('../lib/sheet');
const fixture = require('./fixtures/character.json');

const s = buildSheet(fixture);

test('basics match the D&D Beyond screen', () => {
  assert.equal(s.name, 'Volo Gerddam');
  assert.equal(s.classLine, 'Human Sorcerer 4');
  assert.equal(s.ac, 9);
  assert.equal(s.initiativeText, '+1');
  assert.equal(s.pb, 2);
  assert.deepEqual(s.hp, { max: 26, removed: 22, temp: 0 });
});

test('ability scores include race, background and feat bonuses', () => {
  const by = Object.fromEntries(s.abilities.map((a) => [a.key, [a.score, a.text]]));
  assert.deepEqual(by, { STR: [10, '+0'], DEX: [8, '−1'], CON: [14, '+2'], INT: [13, '+1'], WIS: [10, '+0'], CHA: [19, '+4'] });
});

test('saves and skills use proficiency', () => {
  const sv = Object.fromEntries(s.saves.map((x) => [x.key, x.text]));
  assert.equal(sv.CON, '+4');
  assert.equal(sv.CHA, '+6');
  assert.equal(sv.DEX, '−1');
  const sk = Object.fromEntries(s.skills.map((x) => [x.name, x.text]));
  assert.equal(sk.Deception, '+6');
  assert.equal(sk.Investigation, '+3');
  assert.equal(sk.Stealth, '−1');
  assert.equal(s.skills.length, 18);
  assert.deepEqual(s.passives, { perception: 10, insight: 10, investigation: 13 });
});

test('spellcasting and slots', () => {
  assert.deepEqual(s.spellcasting, { ability: 'CHA', dc: 14, attack: 6 });
  assert.deepEqual(s.slots, [{ level: 1, max: 4, used: 1 }, { level: 2, max: 3, used: 1 }]);
  const fb = s.spells.find((x) => x.name === 'Fire Bolt');
  assert.equal(fb.hit, '+6');
  assert.equal(fb.damage, '1d10 fire');
  assert.equal(fb.sorcerer, true);
  const misty = s.spells.find((x) => x.name === 'Misty Step');
  assert.ok(misty.useKey, 'Fey Touched free cast is linked');
  assert.equal(misty.sorcerer, false);
});

test('limited uses carry what the write-back needs', () => {
  const names = s.uses.map((u) => u.name);
  assert.deepEqual(names, ['Innate Sorcery', 'Font of Magic: Sorcery Points', 'Tides of Chaos', 'Misty Step', 'Detect Magic']);
  const sp = s.uses.find((u) => /Sorcery Points/.test(u.name));
  assert.equal(sp.max, 4);
  assert.equal(sp.dataOriginType, 'class-feature');
  assert.match(sp.id, /^\d+$/);
  assert.match(sp.entityTypeId, /^\d+$/);
  assert.equal(s.uses.find((u) => u.name === 'Misty Step').dataOriginType, 'feat');
});

test('features, homebrew item and actions', () => {
  const f = s.features.map((x) => x.name);
  for (const n of ['Wild Magic Surge', 'Tides of Chaos', 'Innate Sorcery', 'Font of Magic', 'Fey Touched', 'Alert', 'Dark Bargain', 'Quill of Living Chronicles']) assert.ok(f.includes(n), n);
  assert.ok(!f.includes('Arcane Apotheosis'), 'level 20 feature is not shown at level 4');
  assert.ok(s.features.find((x) => x.name === 'Tides of Chaos').useKeys.length);
  const dagger = s.actions.find((a) => a.name === 'Dagger');
  assert.equal(dagger.hit, '+2');
  assert.equal(dagger.damage, '1d4 piercing');
  assert.ok(!s.actions.some((a) => a.name === 'Friends'), 'utility cantrips are not attacks');
  assert.ok(!s.actions.some((a) => a.name === 'Shatter' || a.name === 'Ice Knife'), 'leveled action spells stay in the Spells tab');
  assert.ok(s.actions.some((a) => a.name === 'Misty Step' && a.group === 'Bonus actions'), 'bonus action spells still listed');
  assert.ok(s.actions.some((a) => a.name === 'Fire Bolt' && a.group === 'Attacks'));
});

test('wild magic surge table and 2024 rule', () => {
  assert.equal(s.wildMagic, true);
  assert.equal(s.surgeTable.length, 25);
  assert.deepEqual([s.surgeTable[0].from, s.surgeTable[0].to], [1, 4]);
  assert.deepEqual([s.surgeTable.at(-1).from, s.surgeTable.at(-1).to], [97, 100]);
  assert.deepEqual(s.surgeRule, { die: 20, on: 20 });
  assert.ok(!/<script/i.test(s.surgeTable.map((r) => r.html).join('')));
});

test('surge table parser handles 00 and single numbers', () => {
  const rows = parseSurgeTable('<table><tr><th>d100</th></tr><tr><td>01-02</td><td>A</td></tr><tr><td>03</td><td><b>B</b></td></tr><tr><td>99-00</td><td>C</td></tr></table>');
  assert.deepEqual(rows.map((r) => [r.from, r.to]), [[1, 2], [3, 3], [99, 100]]);
});
