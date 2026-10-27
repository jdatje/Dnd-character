'use strict';
/*
 * Turns D&D Beyond's character JSON into what the phone shows.
 *
 * The JSON holds the pieces, not the numbers on the sheet: ability scores come as a base value plus a list of
 * modifiers from race, background, feats and items; saves and skills are proficiencies; spell slots come from the
 * class table. We add them up the way the sheet does for ordinary characters. Unusual cases (rare items, odd
 * homebrew) may come out slightly off, so AC and initiative can be corrected in Settings.
 */
const { rich, plain, decode } = require('./html');

const ABILITIES = [
  { id: 1, key: 'STR', name: 'Strength', slug: 'strength' },
  { id: 2, key: 'DEX', name: 'Dexterity', slug: 'dexterity' },
  { id: 3, key: 'CON', name: 'Constitution', slug: 'constitution' },
  { id: 4, key: 'INT', name: 'Intelligence', slug: 'intelligence' },
  { id: 5, key: 'WIS', name: 'Wisdom', slug: 'wisdom' },
  { id: 6, key: 'CHA', name: 'Charisma', slug: 'charisma' },
];
const SKILLS = [
  ['Acrobatics', 2], ['Animal Handling', 5], ['Arcana', 4], ['Athletics', 1], ['Deception', 6], ['History', 4],
  ['Insight', 5], ['Intimidation', 6], ['Investigation', 4], ['Medicine', 5], ['Nature', 4], ['Perception', 5],
  ['Performance', 6], ['Persuasion', 6], ['Religion', 4], ['Sleight of Hand', 2], ['Stealth', 2], ['Survival', 5],
];
const ACTIVATION = { 1: 'Action', 2: 'No action', 3: 'Bonus action', 4: 'Reaction', 5: 'Special', 6: 'Minute', 7: 'Hour', 8: 'Special' };
const RESET = { 1: 'short', 2: 'long', 3: 'long', 4: 'other' };
const ORIGIN = { class: 'class-feature', race: 'race', feat: 'feat', item: 'item', background: 'background' };
const SPELL_ORIGIN = { class: 'class', race: 'race', feat: 'feat', item: 'item', background: 'background' };
// standard multiclass spell slot table (caster level -> slots for levels 1..9)
const MULTI = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const modOf = (score) => Math.floor((score - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const arr = (v) => (Array.isArray(v) ? v : []);

class SheetError extends Error {}

function unwrap(json) {
  const d = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json;
  if (!d || typeof d !== 'object' || typeof d.name !== 'string' || !Array.isArray(d.stats) || !Array.isArray(d.classes)) {
    throw new SheetError('That does not look like a D&D Beyond character.');
  }
  return d;
}

/** Every modifier that currently applies, with the group it came from. Items only count while equipped/attuned. */
function activeModifiers(d) {
  const out = [];
  const groups = d.modifiers && typeof d.modifiers === 'object' ? d.modifiers : {};
  for (const [group, list] of Object.entries(groups)) {
    for (const m of arr(list)) {
      if (!m || typeof m !== 'object') continue;
      if (group === 'item' && !itemActive(d, m)) continue;
      out.push({ ...m, group });
    }
  }
  return out;
}

function itemActive(d, m) {
  const it = arr(d.inventory).find((x) => x && x.definition && x.definition.id === m.componentId);
  if (!it) return false;
  if (it.definition.canEquip && !it.equipped) return false;
  if ((it.definition.canAttune || m.requiresAttunement) && !it.isAttuned) return false;
  return true;
}

function abilityScores(d, mods) {
  const at = (list, id) => arr(list).find((s) => s && s.id === id);
  return ABILITIES.map((a) => {
    const over = at(d.overrideStats, a.id);
    const overVal = over && over.value != null ? num(over.value) : null;
    let score = overVal != null ? overVal : num(at(d.stats, a.id) && at(d.stats, a.id).value) + num(at(d.bonusStats, a.id) && at(d.bonusStats, a.id).value);
    let setTo = 0;
    for (const m of mods) {
      if (m.subType !== `${a.slug}-score`) continue;
      const v = num(m.value != null ? m.value : m.fixedValue);
      if (m.type === 'bonus' && overVal == null) score += v;
      else if (m.type === 'set') setTo = Math.max(setTo, v);
    }
    score = Math.max(score, setTo);
    return { ...a, score, mod: modOf(score) };
  });
}

/** Value of a bonus modifier; "value: null, bonusTypes: [1]" means "your proficiency bonus". */
function bonusValue(m, pb, abil) {
  if (m.value != null || m.fixedValue != null) {
    let v = num(m.value != null ? m.value : m.fixedValue);
    if (m.statId && abil) v += abil.find((a) => a.id === m.statId)?.mod ?? 0;
    return v;
  }
  if (arr(m.bonusTypes).includes(1)) return pb;
  if (arr(m.bonusTypes).includes(2)) return Math.floor(pb / 2);
  if (m.statId && abil) return abil.find((a) => a.id === m.statId)?.mod ?? 0;
  return 0;
}

function hitPoints(d, abil, level, mods) {
  const con = abil.find((a) => a.key === 'CON').mod;
  const perLevel = mods.filter((m) => m.type === 'bonus' && m.subType === 'hit-points-per-level').reduce((n, m) => n + num(m.value != null ? m.value : m.fixedValue), 0);
  const max = d.overrideHitPoints != null
    ? Math.max(1, Math.round(num(d.overrideHitPoints)))
    : Math.max(1, Math.round(num(d.baseHitPoints) + num(d.bonusHitPoints) + con * level + perLevel * level));
  return {
    max,
    removed: Math.min(max, Math.max(0, num(d.removedHitPoints))),
    temp: Math.max(0, num(d.temporaryHitPoints)),
  };
}

function armorClass(d, abil, mods) {
  const dex = abil.find((a) => a.key === 'DEX').mod;
  const worn = arr(d.inventory).filter((i) => i && i.equipped && i.definition && i.definition.armorClass != null && i.definition.armorTypeId);
  const body = worn.find((i) => i.definition.armorTypeId !== 4);
  const shields = worn.filter((i) => i.definition.armorTypeId === 4);
  let ac;
  if (body) {
    const t = body.definition.armorTypeId;
    ac = num(body.definition.armorClass) + (t === 1 ? dex : t === 2 ? Math.min(dex, 2) : 0);
    for (const m of mods) if (m.type === 'bonus' && m.subType === 'armored-armor-class') ac += bonusValue(m, 0, abil);
  } else {
    ac = 10 + dex;
    let setBase = 0;
    for (const m of mods) {
      if (m.subType !== 'unarmored-armor-class') continue;
      if (m.type === 'set') setBase = Math.max(setBase, num(m.value));
      if (m.type === 'bonus') ac += bonusValue(m, 0, abil);
    }
    ac += setBase;
  }
  for (const s of shields) ac += num(s.definition.armorClass);
  for (const m of mods) if (m.type === 'bonus' && m.subType === 'armor-class') ac += num(m.value != null ? m.value : m.fixedValue);
  return ac;
}

function proficiencySet(mods) {
  const prof = new Set();
  const exp = new Set();
  const half = new Set();
  for (const m of mods) {
    if (m.type === 'proficiency') prof.add(m.subType);
    if (m.type === 'expertise') exp.add(m.subType);
    if (m.type === 'half-proficiency' || m.type === 'half-proficiency-round-up') half.add(m.subType);
  }
  return { prof, exp, half };
}

function saves(abil, pb, ps, mods) {
  const all = mods.filter((m) => m.type === 'bonus' && m.subType === 'saving-throws').reduce((n, m) => n + bonusValue(m, pb, abil), 0);
  return abil.map((a) => {
    const prof = ps.prof.has(`${a.slug}-saving-throws`);
    const own = mods.filter((m) => m.type === 'bonus' && m.subType === `${a.slug}-saving-throws`).reduce((n, m) => n + bonusValue(m, pb, abil), 0);
    const v = a.mod + (prof ? pb : 0) + all + own;
    return { key: a.key, name: a.name, mod: v, text: signed(v), prof };
  });
}

function skills(abil, pb, ps, mods) {
  const checks = mods.filter((m) => m.type === 'bonus' && m.subType === 'ability-checks').reduce((n, m) => n + bonusValue(m, pb, abil), 0);
  return SKILLS.map(([name, abId]) => {
    const s = slug(name);
    const a = abil.find((x) => x.id === abId);
    const exp = ps.exp.has(s);
    const prof = exp || ps.prof.has(s);
    const half = !prof && (ps.half.has(s) || ps.half.has('ability-checks'));
    const own = mods.filter((m) => m.type === 'bonus' && m.subType === s).reduce((n, m) => n + bonusValue(m, pb, abil), 0);
    const v = a.mod + (exp ? 2 * pb : prof ? pb : half ? Math.floor(pb / 2) : 0) + checks + own;
    return { name, ab: a.key, mod: v, text: signed(v), prof, exp };
  });
}

function speeds(d, mods) {
  const base = (d.race && d.race.weightSpeeds && d.race.weightSpeeds.normal) || {};
  const out = { walk: num(base.walk), fly: num(base.fly), swim: num(base.swim), climb: num(base.climb), burrow: num(base.burrow) };
  for (const m of mods) {
    if (m.type === 'bonus' && (m.subType === 'speed' || m.subType === 'speed-walking' || m.subType === 'unarmored-movement')) out.walk += num(m.value != null ? m.value : m.fixedValue);
    if (m.type === 'set' && /^speed-(flying|swimming|climbing|burrowing)$/.test(m.subType)) {
      const k = { flying: 'fly', swimming: 'swim', climbing: 'climb', burrowing: 'burrow' }[m.subType.slice(6)];
      out[k] = Math.max(out[k], m.value == null ? out.walk : num(m.value));
    }
  }
  for (const c of arr(d.customSpeeds)) if (c && c.distance) out[{ 1: 'walk', 2: 'burrow', 3: 'climb', 4: 'fly', 5: 'swim' }[c.movementId] || 'walk'] = num(c.distance);
  return out;
}

function senses(d, mods) {
  const out = [];
  for (const m of mods) {
    if (m.type === 'set-base' && /vision|sight|tremorsense/.test(m.subType)) out.push(`${m.friendlySubtypeName || m.subType} ${num(m.value)} ft`);
  }
  for (const c of arr(d.customSenses)) if (c && c.distance) out.push(`${['', 'Blindsight', 'Darkvision', 'Tremorsense', 'Truesight'][c.senseId] || 'Sense'} ${num(c.distance)} ft`);
  return [...new Set(out)];
}

function defenses(d, mods) {
  const pick = (type) => [...new Set(mods.filter((m) => m.type === type).map((m) => m.friendlySubtypeName || m.subType))];
  const out = { resistances: pick('resistance'), immunities: pick('immunity'), vulnerabilities: pick('vulnerability') };
  for (const c of arr(d.customDefenseAdjustments)) {
    if (!c) continue;
    const k = c.type === 1 ? 'resistances' : c.type === 2 ? 'immunities' : 'vulnerabilities';
    out[k].push(c.name || `Custom ${c.adjustmentId}`);
  }
  return out;
}

function proficiencies(d, mods) {
  const p = mods.filter((m) => m.type === 'proficiency');
  const isSkill = (s) => SKILLS.some(([n]) => slug(n) === s);
  const out = { armor: [], weapons: [], tools: [], languages: [], other: [] };
  for (const m of p) {
    const name = m.friendlySubtypeName || m.subType;
    if (/saving-throws$/.test(m.subType) || isSkill(m.subType) || m.subType === 'initiative') continue;
    if (/armor|shields/.test(m.subType)) out.armor.push(name);
    else if (/weapons?$|^(club|dagger|greatclub|handaxe|javelin|light-hammer|mace|quarterstaff|sickle|spear|crossbow|dart|shortbow|sling|longsword|rapier|shortsword|scimitar|hand-crossbow)/.test(m.subType)) out.weapons.push(name);
    else if (/tools?|kit|supplies|instrument|set$|gaming/.test(m.subType)) out.tools.push(name);
    else out.other.push(name);
  }
  out.languages = mods.filter((m) => m.type === 'language').map((m) => m.friendlySubtypeName || m.subType);
  for (const c of arr(d.customProficiencies)) if (c && c.name) out.other.push(c.name);
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort();
  return out;
}

function maxUses(lu, pb, abil, classLevel) {
  if (!lu) return 0;
  let max = num(lu.maxUses);
  if (Array.isArray(lu.levelScales) && lu.levelScales.length) {
    const s = lu.levelScales.filter((x) => num(x.level) <= classLevel).sort((a, b) => num(b.level) - num(a.level))[0];
    if (s) max = num(s.uses ?? s.value ?? max);
  }
  if (lu.statModifierUsesId) max += abil.find((a) => a.id === lu.statModifierUsesId)?.mod ?? 0;
  if (lu.useProficiencyBonus) max = lu.proficiencyBonusOperator === 2 ? max * pb : max + pb;
  return Math.max(lu.statModifierUsesId ? 1 : 0, max);
}

function castTime(act) {
  if (!act || !act.activationType) return '';
  const t = act.activationType;
  if (t === 6 || t === 7) return `${num(act.activationTime) || 1} ${t === 6 ? 'minute' : 'hour'}${num(act.activationTime) > 1 ? 's' : ''}`;
  return ACTIVATION[t] || '';
}

function rangeText(r) {
  if (!r) return '';
  let t = r.origin === 'Ranged' ? `${num(r.rangeValue)} ft` : r.origin || '';
  if (r.origin === 'Self' && r.rangeValue) t = `Self (${num(r.rangeValue)} ft)`;
  if (r.aoeType) t += `${t ? ' · ' : ''}${num(r.aoeValue)} ft ${String(r.aoeType).toLowerCase()}`;
  return t;
}

function spellDamage(def, charLevel, slotLevel) {
  const dmg = arr(def.modifiers).find((m) => m.type === 'damage' && m.die);
  if (!dmg) {
    if (def.healingDice && def.healingDice.length) return { text: `${def.healingDice[0].diceString} healing`, kind: 'heal' };
    return null;
  }
  let count = num(dmg.die.diceCount);
  const value = num(dmg.die.diceValue);
  let fixed = num(dmg.die.fixedValue);
  const defs = arr(dmg.atHigherLevels && dmg.atHigherLevels.higherLevelDefinitions);
  if (def.level === 0 && def.scaleType === 'characterlevel') {
    const hit = defs.filter((h) => num(h.level) <= charLevel).sort((a, b) => num(b.level) - num(a.level))[0];
    if (hit && hit.dice) count = num(hit.dice.diceCount) || count;
  } else if (def.level > 0 && slotLevel > def.level && defs.length) {
    const step = defs[0].dice;
    if (step && num(step.diceValue) === value) count += num(step.diceCount) * (slotLevel - def.level);
  }
  const dice = count ? `${count}d${value}${fixed ? `+${fixed}` : ''}` : String(fixed || dmg.die.diceString || '');
  return { text: `${dice} ${dmg.friendlySubtypeName ? dmg.friendlySubtypeName.toLowerCase() : dmg.subType}`.trim(), kind: 'damage' };
}

function parseSurgeTable(html) {
  const rows = [];
  const tables = String(html || '').match(/<table[\s\S]*?<\/table>/gi) || [];
  const t = tables.find((x) => /1d100/i.test(x)) || tables[0];
  if (!t) return rows;
  for (const tr of t.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = tr.match(/<td[\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 2) continue;
    const range = decode(cells[0].replace(/<[^>]+>/g, '')).trim();
    const m = range.match(/^(\d{1,3})(?:\s*[–—-]\s*(\d{1,3}))?$/);
    if (!m) continue;
    let from = Number(m[1]);
    let to = m[2] ? Number(m[2]) : from;
    if (from === 0) from = 100;
    if (to === 0) to = 100;
    rows.push({ from, to, html: rich(cells.slice(1).join('').replace(/<\/?td[^>]*>/gi, '')) });
  }
  return rows;
}

function buildSheet(json, { fetchedAt = Date.now() } = {}) {
  const d = unwrap(json);
  const mods = activeModifiers(d);
  const level = d.classes.reduce((n, c) => n + num(c.level), 0) || 1;
  const pb = Math.ceil(level / 4) + 1;
  const abil = abilityScores(d, mods);
  const A = Object.fromEntries(abil.map((a) => [a.key, a]));
  const ps = proficiencySet(mods);
  const hp = hitPoints(d, abil, level, mods);
  const sk = skills(abil, pb, ps, mods);
  const passive = (n) => 10 + sk.find((s) => s.name === n).mod;
  const initBonus = mods.filter((m) => m.type === 'bonus' && m.subType === 'initiative').reduce((n, m) => n + bonusValue(m, pb, abil), 0);
  const initiative = A.DEX.mod + initBonus + (ps.prof.has('initiative') ? pb : 0);
  const classes = d.classes.map((c) => ({
    name: (c.definition && c.definition.name) || 'Class',
    level: num(c.level),
    subclass: (c.subclassDefinition && c.subclassDefinition.name) || '',
  }));
  const classLevelOf = (name) => classes.find((c) => c.name === name)?.level ?? level;

  // spellcasting
  const casters = d.classes.filter((c) => c.definition && c.definition.spellCastingAbilityId);
  const caster = casters[0] || null;
  let spellcasting = null;
  if (caster) {
    const ab = abil.find((a) => a.id === caster.definition.spellCastingAbilityId);
    const dcBonus = mods.filter((m) => m.type === 'bonus' && m.subType === 'spell-save-dc').reduce((n, m) => n + bonusValue(m, pb, abil), 0);
    const atkBonus = mods.filter((m) => m.type === 'bonus' && m.subType === 'spell-attacks').reduce((n, m) => n + bonusValue(m, pb, abil), 0);
    spellcasting = { ability: ab.key, dc: 8 + pb + ab.mod + dcBonus, attack: pb + ab.mod + atkBonus };
  }
  const usedSlots = Object.fromEntries(arr(d.spellSlots).map((s) => [num(s.level), num(s.used)]));
  let slotMax = [];
  const nonPact = casters.filter((c) => c.definition.name !== 'Warlock');
  if (nonPact.length === 1) slotMax = arr(nonPact[0].definition.spellRules && nonPact[0].definition.spellRules.levelSpellSlots)[num(nonPact[0].level)] || [];
  else if (nonPact.length > 1) {
    let cl = 0;
    for (const c of nonPact) {
      const r = c.definition.spellRules || {};
      const div = num(r.multiClassSpellSlotDivisor) || 1;
      cl += r.multiClassSpellSlotRounding === 2 ? Math.ceil(num(c.level) / div) : Math.floor(num(c.level) / div);
    }
    slotMax = MULTI[Math.min(20, cl)] || [];
  }
  const slots = [];
  slotMax.forEach((max, i) => {
    if (num(max) > 0) slots.push({ level: i + 1, max: num(max), used: Math.min(num(max), usedSlots[i + 1] || 0) });
  });
  const pact = [];
  const warlock = casters.find((c) => c.definition.name === 'Warlock');
  if (warlock) {
    const row = arr(warlock.definition.spellRules && warlock.definition.spellRules.levelSpellSlots)[num(warlock.level)] || [];
    const usedPact = Object.fromEntries(arr(d.pactMagic).map((s) => [num(s.level), num(s.used)]));
    row.forEach((max, i) => num(max) > 0 && pact.push({ level: i + 1, max: num(max), used: Math.min(num(max), usedPact[i + 1] || 0) }));
  }

  // limited uses: class/race/feat/item actions and spells with a counter
  const uses = [];
  for (const [group, list] of Object.entries(d.actions || {})) {
    for (const a of arr(list)) {
      if (!a || !a.limitedUse) continue;
      const cls = d.classes.find((c) => arr(c.classFeatures).some((f) => f.definition && f.definition.id === a.componentId));
      const max = maxUses(a.limitedUse, pb, abil, cls ? num(cls.level) : level);
      if (max <= 0) continue;
      uses.push({
        key: `act:${a.id}`, kind: 'action', name: a.name, id: String(a.id), entityTypeId: String(a.entityTypeId),
        dataOriginType: ORIGIN[group] || group, componentId: a.componentId, max, used: Math.min(max, num(a.limitedUse.numberUsed)),
        reset: RESET[a.limitedUse.resetType] || 'other', activation: castTime(a.activation), group,
      });
    }
  }

  const spells = [];
  const charLevel = level;
  const pushSpell = (s, source, group, className) => {
    const def = s && s.definition;
    if (!def) return;
    const lvl = num(def.level);
    let hit = '';
    if (def.attackType && spellcasting) hit = signed(spellcasting.attack);
    else if (def.saveDcAbilityId && spellcasting) hit = `DC ${spellcasting.dc} ${ABILITIES.find((a) => a.id === def.saveDcAbilityId)?.key || ''}`.trim();
    const dmg = spellDamage(def, charLevel, lvl);
    let use = null;
    if (s.limitedUse && num(s.limitedUse.maxUses) > 0) {
      const max = maxUses(s.limitedUse, pb, abil, level);
      use = { key: `spell:${s.id}`, kind: 'spell', name: def.name, id: String(s.id), entityTypeId: String(s.entityTypeId), dataOriginType: SPELL_ORIGIN[group] || group, max, used: Math.min(max, num(s.limitedUse.numberUsed)), reset: RESET[s.limitedUse.resetType] || 'long', activation: castTime(def.activation), group: source };
      if (!uses.some((u) => u.key === use.key)) uses.push(use);
    }
    const key = `${def.id}:${source}`;
    if (spells.some((x) => x.key === key)) return;
    spells.push({
      key, id: def.id, name: def.name, level: lvl, school: def.school || '', source, className: className || '',
      castTime: castTime(def.activation), activationType: def.activation ? num(def.activation.activationType) : 0,
      range: rangeText(s.range || def.range), duration: def.duration ? (def.duration.durationType === 'Concentration' ? `Concentration, ${num(def.duration.durationInterval)} ${String(def.duration.durationUnit || '').toLowerCase()}` : def.duration.durationType === 'Time' ? `${num(def.duration.durationInterval)} ${String(def.duration.durationUnit || '').toLowerCase()}` : def.duration.durationType) : '',
      concentration: Boolean(def.concentration), ritual: Boolean(def.ritual),
      hit, damage: dmg ? dmg.text : '', higher: Boolean(arr(def.modifiers).find((m) => m.type === 'damage' && m.atHigherLevels && arr(m.atHigherLevels.higherLevelDefinitions).length)),
      usesSlot: lvl > 0,
      useKey: use ? use.key : null,
      sorcerer: className === 'Sorcerer',
      prepared: Boolean(s.prepared || s.alwaysPrepared || s.countsAsKnownSpell !== false),
      html: rich(def.description),
      components: arr(def.components).map((c) => ({ 1: 'V', 2: 'S', 3: 'M' }[c])).join(', '),
    });
  };
  for (const cs of arr(d.classSpells)) {
    const cls = d.classes.find((c) => c.id === cs.characterClassId) || d.classes[0];
    for (const s of arr(cs.spells)) pushSpell(s, 'class', 'class', cls && cls.definition ? cls.definition.name : '');
  }
  for (const [group, list] of Object.entries(d.spells || {})) for (const s of arr(list)) pushSpell(s, group, group, '');
  spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  // features
  const features = [];
  const seen = new Set();
  const skipNames = /^(\d+: )?Ability Score Improvement$|Subclass$|^Core .* Traits$|^Epic Boon$|^(Creature Type|Size|Speed|Ability Score Increases|Languages)$/;
  for (const c of d.classes) {
    for (const f of arr(c.classFeatures)) {
      const def = f.definition;
      if (!def || num(def.requiredLevel) > num(c.level) || seen.has(def.name) || skipNames.test(def.name)) continue;
      seen.add(def.name);
      features.push({ name: def.name, source: (c.subclassDefinition && def.classId === c.subclassDefinition.id) ? c.subclassDefinition.name : c.definition.name, level: num(def.requiredLevel), html: rich(def.description), snippet: plain(def.snippet || def.description, 220), componentId: def.id });
    }
  }
  for (const o of arr(d.options && d.options.class)) {
    const def = o.definition;
    if (def && !seen.has(def.name)) {
      seen.add(def.name);
      features.push({ name: def.name, source: 'Option', level: 0, html: rich(def.description), snippet: plain(def.snippet || def.description, 220) });
    }
  }
  for (const t of arr(d.race && d.race.racialTraits)) {
    const def = t.definition;
    if (!def || seen.has(def.name) || skipNames.test(def.name) || def.hideInSheet) continue;
    seen.add(def.name);
    features.push({ name: def.name, source: (d.race && d.race.fullName) || 'Species', level: 0, html: rich(def.description), snippet: plain(def.snippet || def.description, 220), componentId: def.id });
  }
  for (const f of arr(d.feats)) {
    const def = f.definition;
    if (!def || seen.has(def.name)) continue;
    seen.add(def.name);
    features.push({ name: def.name, source: 'Feat', level: 0, html: rich(def.description), snippet: plain(def.snippet || def.description, 220), componentId: def.id });
  }
  // attuned or homebrew magic items: their powers are features too
  for (const it of arr(d.inventory)) {
    const def = it && it.definition;
    if (!def || !(it.isAttuned || (def.magic && it.equipped) || (def.isHomebrew && def.magic))) continue;
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    features.push({ name: def.name, source: def.isHomebrew ? 'Item (homebrew)' : 'Item', level: 0, html: rich(def.description), snippet: plain(def.snippet || def.description, 220) });
  }
  for (const u of uses) {
    const f = features.find((x) => x.componentId && x.componentId === u.componentId) || features.find((x) => u.name === x.name || u.name.startsWith(`${x.name}:`));
    if (f) (f.useKeys = f.useKeys || []).push(u.key);
  }

  // actions: weapons, attack cantrips, spells and features by when you use them
  const actions = [];
  const wp = (it) => {
    const def = it.definition;
    const finesse = arr(def.properties).some((p) => p.name === 'Finesse');
    const ranged = def.attackType === 2;
    const ab = finesse ? (A.DEX.mod > A.STR.mod ? A.DEX : A.STR) : ranged ? A.DEX : A.STR;
    const cat = def.categoryId === 2 ? 'martial-weapons' : 'simple-weapons';
    const prof = ps.prof.has(cat) || ps.prof.has(slug(def.type || def.name));
    const magic = arr(def.grantedModifiers).filter((m) => m.type === 'bonus' && m.subType === 'magic').reduce((n, m) => n + num(m.value), 0);
    const dice = def.damage ? def.damage.diceString : '1';
    const dmgMod = ab.mod + magic;
    const rng = def.range && def.longRange && def.longRange !== def.range ? `${def.range}/${def.longRange} ft` : `${def.range || 5} ft`;
    const thrown = arr(def.properties).some((p) => p.name === 'Thrown');
    return {
      key: `item:${slug(def.name)}`, shown: true,
      group: 'Attacks', name: def.name, meta: ranged ? `Ranged · ${rng}` : thrown ? `Melee 5 ft · thrown ${rng}` : 'Melee · 5 ft',
      hit: signed(ab.mod + (prof ? pb : 0) + magic), damage: `${dice}${dmgMod ? (dmgMod > 0 ? `+${dmgMod}` : `−${Math.abs(dmgMod)}`) : ''} ${String(def.damageType || '').toLowerCase()}`.trim(),
      html: rich(def.description),
    };
  };
  const weaponNames = new Set();
  for (const it of arr(d.inventory)) {
    if (it && it.equipped && it.definition && it.definition.filterType === 'Weapon' && !weaponNames.has(it.definition.name)) {
      weaponNames.add(it.definition.name);
      actions.push(wp(it));
    }
  }
  if (!d.preferences || d.preferences.showUnarmedStrike !== false) {
    const v = 1 + A.STR.mod;
    actions.push({ key: 'unarmed', shown: true, group: 'Attacks', name: 'Unarmed Strike', meta: 'Melee · 5 ft', hit: signed(A.STR.mod + pb), damage: `${Math.max(1, v)} bludgeoning`, html: '<p>A punch, kick, head-butt or similar forceful blow.</p>' });
  }
  // every spell you can cast in a turn is an action; "shown" is only the default, the player can change it per action
  for (const s of spells) {
    const t = s.activationType;
    if (t !== 1 && t !== 3 && t !== 4) continue;
    const g = t === 3 ? 'Bonus actions' : t === 4 ? 'Reactions' : s.level === 0 ? 'Attacks' : 'Spells';
    const shown = g === 'Bonus actions' || g === 'Reactions' || (g === 'Attacks' && Boolean(s.damage));
    actions.push({ key: `spell:${s.key}`, shown, group: g === 'Attacks' && !s.damage ? 'Spells' : g, name: s.name, meta: `${s.level === 0 ? 'Cantrip' : `${['', '1st', '2nd', '3rd'][s.level] || `${s.level}th`} level`}${s.range ? ` · ${s.range}` : ''}`, hit: s.hit, damage: s.damage, spellKey: s.key, useKey: s.useKey, html: s.html });
  }
  for (const [group, list] of Object.entries(d.actions || {})) {
    for (const a of arr(list)) {
      if (!a || !a.name) continue;
      const t = a.activation ? num(a.activation.activationType) : 0;
      const g = t === 1 ? 'Actions' : t === 3 ? 'Bonus actions' : t === 4 ? 'Reactions' : 'Other';
      const use = uses.find((u) => u.key === `act:${a.id}`);
      if (/Table$/.test(a.name)) continue;
      actions.push({ key: `act:${group}:${a.id}`, shown: g === 'Bonus actions' || g === 'Reactions', group: g, name: a.name, meta: [castTime(a.activation), use ? `${use.max} per ${use.reset} rest` : ''].filter(Boolean).join(' · '), hit: '', damage: '', useKey: use ? use.key : null, html: rich(a.description || a.snippet), source: group });
    }
  }

  // inventory
  const inventory = arr(d.inventory).map((it) => {
    const def = it.definition || {};
    return {
      id: it.id, name: def.name || 'Item', qty: num(it.quantity) || 1, equipped: Boolean(it.equipped), attuned: Boolean(it.isAttuned),
      magic: Boolean(def.magic), rarity: def.rarity || '', type: def.type || def.filterType || '', homebrew: Boolean(def.isHomebrew),
      weight: num(def.weight), html: rich(def.description), charges: it.limitedUse ? { max: num(it.limitedUse.maxUses), used: num(it.limitedUse.numberUsed) } : null,
    };
  }).sort((a, b) => Number(b.attuned) - Number(a.attuned) || Number(b.equipped) - Number(a.equipped) || Number(b.magic) - Number(a.magic) || a.name.localeCompare(b.name));
  const cur = d.currencies || {};

  // wild magic
  let surgeTable = [];
  let wildMagic = false;
  for (const c of d.classes) {
    for (const f of arr(c.classFeatures)) {
      if (f.definition && /Wild Magic Surge/.test(f.definition.name) && num(f.definition.requiredLevel) <= num(c.level)) {
        wildMagic = true;
        const t = parseSurgeTable(f.definition.description);
        if (t.length) surgeTable = t;
      }
    }
  }
  const surgeRule = (() => {
    const f = d.classes.flatMap((c) => arr(c.classFeatures)).find((x) => x.definition && x.definition.name === 'Wild Magic Surge');
    const t = f ? plain(f.definition.description, 2000) : '';
    if (/roll a 20/i.test(t) || /If you roll a 20/i.test(t)) return { die: 20, on: 20 };
    return { die: 20, on: 1 };
  })();

  const bg = d.background || {};
  const bgDef = bg.definition || bg.customBackground || {};
  const notes = d.notes || {};
  const traits = d.traits || {};
  const story = [
    ['Backstory', notes.backstory], ['Personality', traits.personalityTraits], ['Ideals', traits.ideals], ['Bonds', traits.bonds], ['Flaws', traits.flaws],
    ['Appearance', traits.appearance], ['Allies', notes.allies], ['Enemies', notes.enemies], ['Organizations', notes.organizations], ['Other notes', notes.otherNotes],
  ].filter(([, v]) => v && String(v).trim()).map(([title, v]) => ({ title, html: rich(String(v).replace(/\r?\n/g, '<br>')) }));

  return {
    id: d.id, name: d.name, fetchedAt, modifiedAt: d.dateModified || null,
    avatarUrl: [d.decorations && d.decorations.avatarUrl, d.avatarUrl].map((u) => String(u || '')).find((u) => /^https:\/\/\S+$/.test(u)) || '',
    level, pb, classes, race: (d.race && d.race.fullName) || '',
    classLine: `${(d.race && d.race.fullName) || ''} ${classes.map((c) => `${c.name} ${c.level}`).join(' / ')}`.trim(),
    abilities: abil.map(({ key, name, score, mod }) => ({ key, name, score, mod, text: signed(mod) })),
    saves: saves(abil, pb, ps, mods), skills: sk,
    passives: { perception: passive('Perception'), insight: passive('Insight'), investigation: passive('Investigation') },
    initiative, initiativeText: signed(initiative), ac: armorClass(d, abil, mods),
    speed: speeds(d, mods), senses: senses(d, mods), defenses: defenses(d, mods), proficiencies: proficiencies(d, mods),
    hp, inspiration: Boolean(d.inspiration), conditions: arr(d.conditions).map((c) => c.id),
    spellcasting, slots, pact, spells, uses, features, actions, inventory,
    currency: { pp: num(cur.pp), gp: num(cur.gp), ep: num(cur.ep), sp: num(cur.sp), cp: num(cur.cp) },
    wildMagic, surgeTable, surgeRule,
    background: { name: bgDef.name || '', html: rich(bgDef.description || bgDef.shortDescription || '') },
    story,
  };
}

module.exports = { buildSheet, parseSurgeTable, SheetError, signed };
