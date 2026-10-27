'use strict';
/*
 * What the app keeps between visits, and every change the phone can make.
 *
 *  baseline  what D&D Beyond had when the sheet was last loaded or synced
 *  live      what the player has now (spell slots, limited uses, HP, inspiration)
 *  custom    trackers that only exist in this app (homebrew, notebook stickies)
 *
 * The end-of-night list is the difference between live and baseline. Every change goes through apply(), which
 * checks its input and returns a short result for the phone.
 */
const crypto = require('crypto');
const html = require('./html');

const THEMES = ['arcane', 'parchment', 'feywild', 'ember', 'slate', 'contrast'];
const RESETS = ['short', 'long', 'none'];
const MAX_NOTES = 50;
const MAX_CUSTOM = 30;

class ActionError extends Error {}
const fail = (msg) => {
  throw new ActionError(msg);
};
const int = (v, lo, hi, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) fail(`${name} must be a whole number from ${lo} to ${hi}.`);
  return n;
};
const newId = () => crypto.randomBytes(6).toString('hex');
const clampStr = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function defaults() {
  return {
    v: 1,
    rev: 1,
    settings: {
      characterUrl: 'https://www.dndbeyond.com/characters/157221719',
      theme: 'arcane',
      size: 100,
      showQuote: true,
      handleSide: 'right',
      acOverride: null,
      quotes: [
        'The world is bigger and stranger than most dare admit. I intend to write all of it down.',
      ],
    },
    sheetRev: 0,
    baseline: null,
    live: null,
    custom: [
      { id: 'spark', name: 'Chronicler’s Spark', note: 'Quill of Living Chronicles · +1d4 to one damage roll of a damaging spell', max: 2, reset: 'long', used: 0, pb: true },
    ],
    notes: [],
    activeNote: null,
    surge: { check: null, table: null, log: [] },
    lastSync: null,
    loadedAt: null,
  };
}

/** Repairs anything odd in a stored state (older versions, hand edits). */
function normalize(s) {
  const d = defaults();
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) }, surge: { ...d.surge, ...(s.surge || {}) } };
  if (!THEMES.includes(out.settings.theme)) out.settings.theme = 'arcane';
  out.settings.size = Math.min(130, Math.max(80, Math.round(Number(out.settings.size) / 5) * 5 || 100));
  if (!Array.isArray(out.settings.quotes)) out.settings.quotes = d.settings.quotes;
  if (!Array.isArray(out.custom)) out.custom = d.custom;
  if (!Array.isArray(out.notes)) out.notes = [];
  if (!Array.isArray(out.surge.log)) out.surge.log = [];
  return out;
}

/** The counters D&D Beyond knows about, read from a sheet. */
function trackOf(sheet) {
  return {
    removed: sheet.hp.removed,
    temp: sheet.hp.temp,
    inspiration: sheet.inspiration,
    slots: Object.fromEntries(sheet.slots.map((s) => [s.level, s.used])),
    pact: Object.fromEntries(sheet.pact.map((s) => [s.level, s.used])),
    uses: Object.fromEntries(sheet.uses.map((u) => [u.key, u.used])),
    extra: {},
  };
}

/** A freshly loaded sheet replaces both baseline and live. Custom trackers and notes stay. */
function applyLoad(state, sheet) {
  state.baseline = trackOf(sheet);
  state.live = trackOf(sheet);
  state.loadedAt = Date.now();
  for (const c of state.custom) if (c.pb) c.max = sheet.pb;
}

/** After a successful sync: what D&D Beyond now has becomes the baseline. */
function applySynced(state, sheet) {
  state.baseline = trackOf(sheet);
}

const findUse = (sheet, re) => sheet.uses.find((u) => re.test(u.name));

/** The list for the end of the night. */
function diff(state, sheet) {
  if (!state.live || !state.baseline || !sheet) return [];
  const L = state.live;
  const B = state.baseline;
  const out = [];
  if (L.removed !== B.removed || L.temp !== B.temp) {
    out.push({ key: 'hp', label: 'Hit points', text: `${sheet.hp.max - L.removed} / ${sheet.hp.max}${L.temp ? ` (+${L.temp} temp)` : ''}, ${L.removed} damage taken`, sync: true });
  }
  const slotText = [];
  for (const s of sheet.slots) if ((L.slots[s.level] ?? 0) !== (B.slots[s.level] ?? 0)) slotText.push(`${ord(s.level)}: ${L.slots[s.level] ?? 0} of ${s.max} used`);
  if (slotText.length) out.push({ key: 'slots', label: 'Spell slots', text: slotText.join(' · '), sync: true });
  const pactText = [];
  for (const s of sheet.pact) if ((L.pact[s.level] ?? 0) !== (B.pact[s.level] ?? 0)) pactText.push(`${ord(s.level)}: ${L.pact[s.level] ?? 0} of ${s.max} used`);
  if (pactText.length) out.push({ key: 'pact', label: 'Pact slots', text: pactText.join(' · '), sync: true });
  for (const u of sheet.uses) {
    const a = L.uses[u.key] ?? 0;
    if (a !== (B.uses[u.key] ?? 0)) out.push({ key: u.key, label: u.name.replace(/^Font of Magic: /, ''), text: `${a} of ${u.max} used`, sync: true });
  }
  if (L.inspiration !== B.inspiration) out.push({ key: 'inspiration', label: 'Heroic inspiration', text: L.inspiration ? 'Have it' : 'Used', sync: true });
  return out;
}

const ord = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function rollDie(sides) {
  return crypto.randomInt(1, sides + 1);
}

function surgeRow(sheet, roll) {
  const row = (sheet.surgeTable || []).find((r) => roll >= r.from && roll <= r.to);
  return row ? row.html : '';
}

function addLog(state, entry) {
  state.surge.log.unshift({ ...entry, at: Date.now() });
  state.surge.log = state.surge.log.slice(0, 20);
}

/** Rolls on the surge table. Rolling on the table brings Tides of Chaos back. */
function rollTable(state, sheet) {
  const roll = rollDie(100);
  const text = surgeRow(sheet, roll);
  state.surge.table = { roll, html: text, at: Date.now() };
  const tides = findUse(sheet, /^Tides of Chaos$/);
  let tidesBack = false;
  if (tides && (state.live.uses[tides.key] ?? 0) > 0) {
    state.live.uses[tides.key] = 0;
    tidesBack = true;
  }
  addLog(state, { type: 'table', roll, html: text });
  return { roll, html: text, tidesBack };
}

function needLive(state) {
  if (!state.live) fail('Load your sheet from D&D Beyond first (Settings).');
}

function slotList(sheet, pact) {
  return pact ? sheet.pact : sheet.slots;
}

/**
 * Applies one change. Returns { result } for the phone. Throws ActionError with a message the player can read.
 */
function apply(state, sheet, type, p = {}) {
  const L = state.live;
  switch (type) {
    case 'hp/damage': {
      needLive(state);
      let n = int(p.amount, 0, 999, 'Damage');
      const fromTemp = Math.min(L.temp, n);
      L.temp -= fromTemp;
      n -= fromTemp;
      L.removed = Math.min(sheet.hp.max, L.removed + n);
      return { hp: sheet.hp.max - L.removed, down: L.removed >= sheet.hp.max };
    }
    case 'hp/heal': {
      needLive(state);
      const n = int(p.amount, 0, 999, 'Healing');
      L.removed = Math.max(0, L.removed - n);
      return { hp: sheet.hp.max - L.removed };
    }
    case 'hp/temp': {
      needLive(state);
      L.temp = int(p.amount, 0, 999, 'Temporary hit points');
      return {};
    }
    case 'inspiration/set': {
      needLive(state);
      L.inspiration = Boolean(p.on);
      return {};
    }
    case 'slot/set': {
      needLive(state);
      const list = slotList(sheet, p.pact);
      const s = list.find((x) => x.level === Number(p.level));
      if (!s) fail('There is no spell slot of that level.');
      const bag = p.pact ? L.pact : L.slots;
      const extra = p.pact ? 0 : (L.extra[s.level] || 0);
      const used = int(p.used, 0, s.max + extra, 'Used slots');
      bag[s.level] = used;
      return {};
    }
    case 'use/set': {
      needLive(state);
      const u = sheet.uses.find((x) => x.key === p.key);
      if (!u) fail('That counter is not on your sheet any more. Load the sheet again.');
      L.uses[u.key] = int(p.used, 0, u.max, u.name);
      return {};
    }
    case 'cast': {
      needLive(state);
      const sp = sheet.spells.find((x) => x.key === p.spellKey);
      if (!sp) fail('That spell is not on your sheet any more.');
      if (sp.level === 0) return { cantrip: true };
      let withSlot = false;
      if (p.level === 'free') {
        const u = sheet.uses.find((x) => x.key === sp.useKey);
        if (!u) fail('This spell has no free casting.');
        if ((L.uses[u.key] ?? 0) >= u.max) fail(`No free casting of ${sp.name} left.`);
        L.uses[u.key] = (L.uses[u.key] ?? 0) + 1;
      } else {
        const lvl = int(p.level, sp.level, 9, 'Slot level');
        const pact = Boolean(p.pact);
        const s = slotList(sheet, pact).find((x) => x.level === lvl);
        if (!s) fail(`You have no ${ord(lvl)}-level slots.`);
        const bag = pact ? L.pact : L.slots;
        const cap = s.max + (pact ? 0 : (L.extra[lvl] || 0));
        if ((bag[lvl] ?? 0) >= cap) fail(`No ${ord(lvl)}-level slots left.`);
        bag[lvl] = (bag[lvl] ?? 0) + 1;
        withSlot = true;
      }
      const out = { spell: sp.name };
      if (withSlot && sp.sorcerer && sheet.wildMagic) {
        const tides = findUse(sheet, /^Tides of Chaos$/);
        if (tides && (L.uses[tides.key] ?? 0) > 0) {
          out.autoSurge = rollTable(state, sheet); // Tides of Chaos spent: this spell surges for sure
        } else out.offerCheck = true;
      }
      return out;
    }
    case 'surge/check': {
      needLive(state);
      const die = (sheet.surgeRule && sheet.surgeRule.die) || 20;
      const on = (sheet.surgeRule && sheet.surgeRule.on) || 20;
      const roll = rollDie(die);
      const surge = roll === on;
      state.surge.check = { roll, surge, at: Date.now() };
      addLog(state, { type: 'check', roll, surge });
      const out = { roll, surge };
      if (surge) out.table = rollTable(state, sheet);
      return out;
    }
    case 'surge/table': {
      needLive(state);
      return rollTable(state, sheet);
    }
    case 'sp/from-slot': {
      // Font of Magic: spend a slot, gain sorcery points equal to its level
      needLive(state);
      const sp = findUse(sheet, /Sorcery Points/);
      if (!sp) fail('No sorcery points on this sheet.');
      const lvl = int(p.level, 1, 9, 'Slot level');
      const s = sheet.slots.find((x) => x.level === lvl);
      const cap = s ? s.max + (L.extra[lvl] || 0) : 0;
      if (!s || (L.slots[lvl] ?? 0) >= cap) fail(`No ${ord(lvl)}-level slot left to convert.`);
      if ((L.uses[sp.key] ?? 0) === 0) fail('Your sorcery points are already full.');
      L.slots[lvl] = (L.slots[lvl] ?? 0) + 1;
      L.uses[sp.key] = Math.max(0, (L.uses[sp.key] ?? 0) - lvl);
      return { gained: lvl };
    }
    case 'sp/to-slot': {
      // Font of Magic: spend points to create a slot (2024 costs), gone at the next long rest
      needLive(state);
      const sp = findUse(sheet, /Sorcery Points/);
      if (!sp) fail('No sorcery points on this sheet.');
      const cost = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };
      const lvl = int(p.level, 1, 5, 'Slot level');
      const left = sp.max - (L.uses[sp.key] ?? 0);
      if (left < cost[lvl]) fail(`A ${ord(lvl)}-level slot costs ${cost[lvl]} points; you have ${left}.`);
      L.uses[sp.key] = (L.uses[sp.key] ?? 0) + cost[lvl];
      if ((L.slots[lvl] ?? 0) > 0) L.slots[lvl] -= 1;
      else L.extra[lvl] = (L.extra[lvl] || 0) + 1;
      return { cost: cost[lvl] };
    }
    case 'rest/short': {
      needLive(state);
      for (const u of sheet.uses) if (u.reset === 'short') L.uses[u.key] = 0;
      for (const c of state.custom) if (c.reset === 'short') c.used = 0;
      for (const s of sheet.pact) L.pact[s.level] = 0;
      state.surge.check = null;
      return {};
    }
    case 'rest/long': {
      needLive(state);
      for (const u of sheet.uses) if (u.reset !== 'other') L.uses[u.key] = 0;
      for (const s of sheet.slots) L.slots[s.level] = 0;
      for (const s of sheet.pact) L.pact[s.level] = 0;
      L.extra = {};
      L.removed = 0;
      L.temp = 0;
      for (const c of state.custom) if (c.reset !== 'none') c.used = 0;
      state.surge.check = null;
      state.surge.table = null;
      return {};
    }
    case 'custom/add': {
      if (state.custom.length >= MAX_CUSTOM) fail('That is a lot of trackers. Remove one first.');
      const name = clampStr(p.name, 40);
      if (!name) fail('Give the tracker a name.');
      const c = { id: newId(), name, note: clampStr(p.note, 120), max: int(p.max, 1, 99, 'Number of uses'), reset: RESETS.includes(p.reset) ? p.reset : 'long', used: 0 };
      state.custom.push(c);
      return { id: c.id };
    }
    case 'custom/update': {
      const c = state.custom.find((x) => x.id === p.id);
      if (!c) fail('That tracker no longer exists.');
      if (p.name !== undefined) c.name = clampStr(p.name, 40) || c.name;
      if (p.note !== undefined) c.note = clampStr(p.note, 120);
      if (p.max !== undefined) {
        c.max = int(p.max, 1, 99, 'Number of uses');
        c.pb = false;
      }
      if (p.reset !== undefined && RESETS.includes(p.reset)) c.reset = p.reset;
      c.used = Math.min(c.used, c.max);
      return {};
    }
    case 'custom/remove': {
      const i = state.custom.findIndex((x) => x.id === p.id);
      if (i === -1) fail('That tracker no longer exists.');
      state.custom.splice(i, 1);
      return {};
    }
    case 'custom/set': {
      const c = state.custom.find((x) => x.id === p.id);
      if (!c) fail('That tracker no longer exists.');
      c.used = int(p.used, 0, c.max, c.name);
      return {};
    }
    case 'note/add': {
      if (state.notes.length >= MAX_NOTES) fail('You have 50 notes. Delete one first.');
      const n = { id: newId(), title: clampStr(p.title, 40) || nextTitle(state), html: html.note(p.html || ''), created: Date.now(), updated: Date.now() };
      state.notes.push(n);
      state.activeNote = n.id;
      return { id: n.id };
    }
    case 'note/update': {
      const n = state.notes.find((x) => x.id === p.id);
      if (!n) fail('That note was deleted (maybe on another device).');
      if (p.title !== undefined) n.title = clampStr(p.title, 40) || n.title;
      if (p.html !== undefined) n.html = html.note(p.html);
      n.updated = Date.now();
      return { updated: n.updated };
    }
    case 'note/remove': {
      const i = state.notes.findIndex((x) => x.id === p.id);
      if (i === -1) fail('That note no longer exists.');
      state.notes.splice(i, 1);
      if (state.activeNote === p.id) state.activeNote = state.notes[Math.max(0, i - 1)]?.id ?? null;
      return {};
    }
    case 'note/move': {
      const i = state.notes.findIndex((x) => x.id === p.id);
      if (i === -1) fail('That note no longer exists.');
      const j = Math.min(state.notes.length - 1, Math.max(0, i + (p.dir === 'left' ? -1 : 1)));
      const [n] = state.notes.splice(i, 1);
      state.notes.splice(j, 0, n);
      return {};
    }
    case 'note/active': {
      if (p.id !== null && !state.notes.some((x) => x.id === p.id)) fail('That note no longer exists.');
      state.activeNote = p.id;
      return {};
    }
    case 'settings/set': {
      const s = state.settings;
      if (p.theme !== undefined) {
        if (!THEMES.includes(p.theme)) fail('Unknown style.');
        s.theme = p.theme;
      }
      if (p.size !== undefined) s.size = Math.round(int(p.size, 80, 130, 'Size') / 5) * 5;
      if (p.showQuote !== undefined) s.showQuote = Boolean(p.showQuote);
      if (p.handleSide !== undefined) s.handleSide = p.handleSide === 'left' ? 'left' : 'right';
      if (p.acOverride !== undefined) s.acOverride = p.acOverride === null || p.acOverride === '' ? null : int(p.acOverride, 0, 40, 'AC');
      if (p.quotes !== undefined) {
        if (!Array.isArray(p.quotes)) fail('Quotes must be a list.');
        s.quotes = p.quotes.map((q) => clampStr(q, 200)).filter(Boolean).slice(0, 100);
      }
      if (p.characterUrl !== undefined) s.characterUrl = clampStr(p.characterUrl, 200);
      return {};
    }
    case 'sync/marked': {
      // the player ticked everything off in D&D Beyond by hand
      needLive(state);
      state.baseline = JSON.parse(JSON.stringify({ ...state.live, extra: {} }));
      state.lastSync = { at: Date.now(), by: 'hand' };
      return {};
    }
    default:
      fail(`Unknown change "${type}".`);
  }
  return {};
}

function nextTitle(state) {
  let n = state.notes.length + 1;
  while (state.notes.some((x) => x.title === `Note ${n}`)) n++;
  return `Note ${n}`;
}

module.exports = { defaults, normalize, trackOf, applyLoad, applySynced, diff, apply, ActionError, THEMES, rollDie };
