'use strict';
/*
 * The whole app against a stand-in for D&D Beyond: load the sheet, play, send the changes back, check what arrived.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/character.json'), 'utf8'));
const COOKIE = 'good-cookie-value-1234567890abcdef';

// stand-in D&D Beyond: serves the character, hands out tokens, applies PUTs like the real sheet does
const ddb = { char: JSON.parse(JSON.stringify(fixture)), puts: [], token: 'tok-123', refuse: new Set() };
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/auth' && req.method === 'POST') {
      if (req.headers.cookie === `CobaltSession=${COOKIE}`) return json(200, { token: ddb.token, ttl: 300 });
      return json(401, { message: 'no' });
    }
    if (req.method === 'GET' && req.url.startsWith('/character/v5/character/157221719')) return json(200, ddb.char);
    if (req.method === 'GET') return json(404, { success: false });
    if (req.method === 'PUT') {
      if (req.headers.authorization !== `Bearer ${ddb.token}`) return json(401, { success: false, message: 'auth' });
      const p = req.url.replace('/character/v5/', '');
      const b = JSON.parse(body);
      ddb.puts.push({ path: p, body: b });
      if (ddb.refuse.has(p)) return json(400, { success: false, message: 'nope' });
      const c = ddb.char.data;
      if (p === 'life/hp/damage-taken') {
        c.removedHitPoints = b.removedHitPoints;
        c.temporaryHitPoints = b.temporaryHitPoints;
      } else if (p === 'spell/slots') {
        for (const s of c.spellSlots) if (`level${s.level}` in b) s.used = b[`level${s.level}`];
      } else if (p === 'action/limited-use') {
        const all = [...Object.values(c.actions).flat(), ...Object.values(c.spells).flat()];
        const hit = all.find((x) => x && String(x.id) === String(b.id) && String(x.entityTypeId) === String(b.entityTypeId));
        if (!hit) return json(404, { success: false, message: 'unknown' });
        hit.limitedUse.numberUsed = b.uses;
      } else if (p === 'character/inspiration') c.inspiration = b.inspiration;
      return json(200, { success: true });
    }
    return json(405, {});
  });
});

let base;
let app;
test.before(async () => {
  await new Promise((r) => stub.listen(0, r));
  const sp = stub.address().port;
  process.env.DDB_SERVICE = `http://127.0.0.1:${sp}`;
  process.env.DDB_AUTH_URL = `http://127.0.0.1:${sp}/auth`;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-test-'));
  const { handle } = require('../server');
  app = http.createServer(handle);
  await new Promise((r) => app.listen(0, r));
  base = `http://127.0.0.1:${app.address().port}`;
});
test.after(() => {
  app.close();
  stub.close();
});

async function call(p, body) {
  const res = await fetch(base + p, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
const act = (type, p = {}) => call('/api/act', { type, ...p });

test('serves the app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<nav id="tabs"/);
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.match(h.v, /^[0-9a-f]{10}$/, 'the app version is reported for automatic reloads');
  const nope = await fetch(`${base}/../server.js`);
  assert.notEqual((await nope.text()).includes('require('), true);
});

test('full night: load, play, send back, verified', async () => {
  let r = await call('/api/load', { url: 'https://www.dndbeyond.com/characters/157221719' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call('/api/sheet');
  const sheet = r.data.sheet;
  assert.equal(sheet.name, 'Volo Gerddam');

  const tides = sheet.uses.find((u) => u.name === 'Tides of Chaos').key;
  const misty = sheet.spells.find((s) => s.name === 'Misty Step');
  const shatter = sheet.spells.find((s) => s.name === 'Shatter');
  assert.equal((await act('hp/heal', { amount: 10 })).status, 200);
  await act('use/set', { key: tides, used: 1 });
  await act('cast', { spellKey: misty.key, level: 'free' });
  const cast = await act('cast', { spellKey: shatter.key, level: 2 });
  assert.ok(cast.data.result.autoSurge, 'Tides was spent, so Shatter surges');
  await act('inspiration/set', { on: true });

  r = await call('/api/state');
  const labels = r.data.pending.map((p) => p.key);
  assert.ok(labels.includes('hp') && labels.includes('slots') && labels.includes(misty.useKey) && labels.includes('inspiration'));
  assert.ok(!labels.includes(tides), 'Tides came back with the surge, so it matches D&D Beyond again');

  // loading now would lose changes: the server asks first
  r = await call('/api/load', {});
  assert.equal(r.status, 409);
  assert.ok(r.data.pending.length >= 4);

  // no cookie yet
  r = await call('/api/sync', {});
  assert.equal(r.status, 502);
  assert.match(r.data.error, /cookie/);

  // a wrong cookie is refused, the right one accepted (pasted as a whole cookie header)
  r = await call('/api/ddb/cookie', { cobalt: 'wrong-cookie-value-000000000000' });
  assert.equal(r.status, 400);
  r = await call('/api/ddb/cookie', { cobalt: `foo=1; CobaltSession=${COOKIE}; bar=2` });
  assert.equal(r.status, 200);
  assert.equal(r.data.checked, true);
  r = await call('/api/state');
  assert.equal(r.data.auth.has, true);
  assert.ok(!JSON.stringify(r.data).includes(COOKIE), 'the cookie never goes back to the phone');

  r = await call('/api/sync', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.allOk, true, JSON.stringify(r.data.results));
  const paths = ddb.puts.map((x) => x.path).sort();
  assert.deepEqual(paths, ['action/limited-use', 'character/inspiration', 'life/hp/damage-taken', 'spell/slots']);
  const hpPut = ddb.puts.find((x) => x.path === 'life/hp/damage-taken').body;
  assert.deepEqual(hpPut, { characterId: 157221719, removedHitPoints: 12, temporaryHitPoints: 0 });
  assert.deepEqual(ddb.puts.find((x) => x.path === 'spell/slots').body, { characterId: 157221719, level2: 2 });
  const use = ddb.puts.find((x) => x.path === 'action/limited-use').body;
  assert.equal(use.uses, 1);
  assert.equal(use.dataOriginType, 'feat');

  r = await call('/api/state');
  assert.deepEqual(r.data.pending, [], 'after sending, D&D Beyond and the app agree');
  assert.equal(r.data.lastSync.by, 'app');
});

test('a refused change is reported and stays on the list', async () => {
  ddb.puts = [];
  ddb.refuse.add('spell/slots');
  const st = (await call('/api/state')).data;
  const used = st.live.slots[1];
  await act('slot/set', { level: 1, used: used + 1 });
  const r = await call('/api/sync', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.allOk, false);
  const res = r.data.results.find((x) => x.key === 'slots');
  assert.equal(res.ok, false);
  assert.match(res.message, /nope|old value/);
  const after = (await call('/api/state')).data;
  assert.deepEqual(after.pending.map((p) => p.key), ['slots']);
  ddb.refuse.clear();
});

test('bad requests get plain messages', async () => {
  let r = await act('slot/set', { level: 7, used: 1 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no spell slot/);
  r = await act('nonsense');
  assert.equal(r.status, 400);
  r = await call('/api/nothing', {});
  assert.equal(r.status, 404);
});
