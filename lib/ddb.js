'use strict';
/*
 * Talking to D&D Beyond.
 *
 * Reading: a public character is served as JSON by character-service.dndbeyond.com (no login needed).
 *
 * Writing (end of the night): there is no official API. The D&D Beyond character sheet itself sends small PUT
 * requests to the same service when you tick a slot or a use, signed with a short-lived token that it gets from
 * auth-service.dndbeyond.com in exchange for your login cookie (CobaltSession). We do exactly that:
 *
 *   PUT /character/v5/life/hp/damage-taken   { characterId, removedHitPoints, temporaryHitPoints }
 *   PUT /character/v5/spell/slots             { characterId, level1: used, level2: used, ... }
 *   PUT /character/v5/spell/pact-magic        { characterId, level1: used, ... }
 *   PUT /character/v5/action/limited-use      { characterId, id, entityTypeId, uses, dataOriginType }
 *   PUT /character/v5/character/inspiration   { characterId, inspiration }
 *
 * (Paths and bodies taken from D&D Beyond's character sheet code, October 2026.) It is unofficial and can break
 * whenever they change their site, so after writing we load the sheet again and check every value.
 */

const SERVICE = (process.env.DDB_SERVICE || 'https://character-service.dndbeyond.com').replace(/\/$/, '');
const AUTH_URL = process.env.DDB_AUTH_URL || 'https://auth-service.dndbeyond.com/v1/cobalt-token';
const UA = 'Mozilla/5.0 (dnd-character app)';

class DdbError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code || 'error';
  }
}

function parseCharacterId(input) {
  const m = String(input || '').match(/(?:characters\/|^\s*)(\d{4,12})(?:\b|$)/);
  return m ? m[1] : null;
}

async function request(url, opts, timeoutMs, what) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new DdbError(e && e.name === 'TimeoutError' ? `D&D Beyond did not answer in time (${what}).` : `Could not reach D&D Beyond from the server (${what}). Check its internet connection.`, 'network');
  }
}

/** The full character JSON of a public character. */
async function fetchCharacter(id, { timeoutMs = 15000, token = null } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await request(`${SERVICE}/character/v5/character/${id}?includeCustomItems=true`, { headers }, timeoutMs, 'loading the sheet');
  if (res.status === 404) throw new DdbError('D&D Beyond does not know that character. Check the link in Settings.', 'notfound');
  if (res.status === 401 || res.status === 403) throw new DdbError('D&D Beyond refused. Set the character to Public in its Character Settings > Privacy.', 'private');
  if (res.status === 429) throw new DdbError('D&D Beyond says we are asking too often. Try again in a minute.', 'rate');
  if (!res.ok) throw new DdbError(`D&D Beyond answered with an error (${res.status}).`, 'http');
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new DdbError('D&D Beyond sent something that is not a character.', 'bad');
  }
  if (json && json.success === false) throw new DdbError(`D&D Beyond: ${String(json.message || 'could not give that character').slice(0, 160)}`, 'bad');
  return json;
}

/** Cleans what people paste: the bare value, "CobaltSession=...", or a whole cookie header. */
function cleanCobalt(input) {
  let s = String(input || '').trim();
  const m = s.match(/CobaltSession=([^;\s]+)/);
  if (m) s = m[1];
  s = s.replace(/^["']|["']$/g, '');
  if (!/^[A-Za-z0-9._\-~+/=%]{20,4000}$/.test(s)) return null;
  return s;
}

let tokenCache = null; // { cobalt, token, until }

/** A short-lived token for writing, in exchange for the login cookie. */
async function getToken(cobalt, { timeoutMs = 15000 } = {}) {
  if (tokenCache && tokenCache.cobalt === cobalt && tokenCache.until > Date.now()) return tokenCache.token;
  const res = await request(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `CobaltSession=${cobalt}`, 'User-Agent': UA } }, timeoutMs, 'signing in');
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok || !data || !data.token) {
    throw new DdbError('D&D Beyond did not accept the login cookie. It may have expired: copy a fresh one (Settings > D&D Beyond).', 'auth');
  }
  const ttl = Math.max(30, Math.min(300, Number(data.ttl) || 120));
  tokenCache = { cobalt, token: data.token, until: Date.now() + (ttl - 15) * 1000 };
  return data.token;
}

function forgetToken() {
  tokenCache = null;
}

async function put(path, body, token, { timeoutMs = 15000 } = {}) {
  const res = await request(`${SERVICE}/character/v5/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
    body: JSON.stringify(body),
  }, timeoutMs, path);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (res.status === 401 || res.status === 403) {
    forgetToken();
    throw new DdbError('D&D Beyond refused the change: the login cookie is not valid for this character (is it your character?).', 'auth');
  }
  if (!res.ok || (data && data.success === false)) {
    return { ok: false, message: (data && data.message) || `error ${res.status}` };
  }
  return { ok: true };
}

/** The write requests that bring D&D Beyond in line with what the player has now. */
function planWrites(characterId, sheet, live, baseline) {
  const id = Number(characterId);
  const ops = [];
  if (live.removed !== baseline.removed || live.temp !== baseline.temp) {
    ops.push({ key: 'hp', label: 'Hit points', path: 'life/hp/damage-taken', body: { characterId: id, removedHitPoints: live.removed, temporaryHitPoints: live.temp } });
  }
  const slots = {};
  for (const s of sheet.slots) if ((live.slots[s.level] ?? 0) !== (baseline.slots[s.level] ?? 0)) slots[`level${s.level}`] = Math.min(s.max, live.slots[s.level] ?? 0);
  if (Object.keys(slots).length) ops.push({ key: 'slots', label: 'Spell slots', path: 'spell/slots', body: { characterId: id, ...slots } });
  const pact = {};
  for (const s of sheet.pact) if ((live.pact[s.level] ?? 0) !== (baseline.pact[s.level] ?? 0)) pact[`level${s.level}`] = live.pact[s.level] ?? 0;
  if (Object.keys(pact).length) ops.push({ key: 'pact', label: 'Pact slots', path: 'spell/pact-magic', body: { characterId: id, ...pact } });
  for (const u of sheet.uses) {
    const now = live.uses[u.key] ?? 0;
    if (now === (baseline.uses[u.key] ?? 0)) continue;
    const num = /^\d+$/.test(u.id) ? Number(u.id) : u.id;
    const ent = /^\d+$/.test(u.entityTypeId) ? Number(u.entityTypeId) : u.entityTypeId;
    ops.push({ key: u.key, label: u.name, path: 'action/limited-use', body: { characterId: id, id: num, entityTypeId: ent, uses: now, dataOriginType: u.dataOriginType } });
  }
  if (live.inspiration !== baseline.inspiration) ops.push({ key: 'inspiration', label: 'Heroic inspiration', path: 'character/inspiration', body: { characterId: id, inspiration: Boolean(live.inspiration) } });
  return ops;
}

/** Did D&D Beyond end up with the value we sent? Compares a freshly loaded sheet with live. */
function verify(op, fresh, live) {
  if (op.key === 'hp') return fresh.hp.removed === live.removed && fresh.hp.temp === live.temp;
  if (op.key === 'slots') return fresh.slots.every((s) => !(`level${s.level}` in op.body) || s.used === op.body[`level${s.level}`]);
  if (op.key === 'pact') return fresh.pact.every((s) => !(`level${s.level}` in op.body) || s.used === op.body[`level${s.level}`]);
  if (op.key === 'inspiration') return fresh.inspiration === Boolean(live.inspiration);
  const u = fresh.uses.find((x) => x.key === op.key);
  return Boolean(u) && u.used === (live.uses[op.key] ?? 0);
}

module.exports = { DdbError, parseCharacterId, fetchCharacter, cleanCobalt, getToken, forgetToken, put, planWrites, verify };
