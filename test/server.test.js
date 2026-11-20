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
const GEMINI_KEY = 'AIzaTestKey_0123456789abcdefghij';
const gem = {
  calls: [],
  scanAnswer: {
    session: { number: 10, date: '7 feb' },
    html: '<h3>Session 10</h3><ul><li><mark>Marshall Dunhan</mark> voor info Hogger</li><li>Chalybes in z\'n ballen getrapt door Billy<ul><li>→ ketting teruggegeven → 20 gp</li></ul></li></ul><div class="box">arcane traps</div><script>alert(1)</script>',
    unsure: ['Marshall Dunhan'],
    suggestions: [
      { section: 'npcs', name: 'Marshal Dughan', text: 'Gaf informatie over Hogger.', op: 'add' },
      { section: 'loot', name: '20 gp', text: 'Voor de teruggegeven ketting.', op: 'add' },
      { section: 'where', name: 'Waar we gebleven zijn', text: 'Tweede verdieping van de toren, bij de spiegel.', op: 'add' },
      { section: 'bogus', name: 'x', text: 'y' },
    ],
  },
};

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
    if (req.url.startsWith('/gemini/')) {
      if (req.headers['x-goog-api-key'] !== GEMINI_KEY) return json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
      if (req.method === 'GET' && req.url.startsWith('/gemini/models?')) {
        return json(200, { models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-pro-latest', supportedGenerationMethods: ['generateContent'] }] });
      }
      const m = req.url.match(/^\/gemini\/models\/([^:]+):generateContent$/);
      if (!m) return json(404, { error: { message: 'not found' } });
      const b = JSON.parse(body);
      gem.calls.push({ model: decodeURIComponent(m[1]), body: b });
      const parts = b.contents[0].parts;
      if (parts.some((x) => x.inline_data)) return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(gem.scanAnswer) }] } }] });
      return json(200, { candidates: [{ content: { parts: [{ text: 'Het gezelschap sprak Marshal Dughan.' }] } }] });
    }
    if (req.url === '/auth' && req.method === 'POST') {
      if (req.headers.cookie === `CobaltSession=${COOKIE}`) return json(200, { token: ddb.token, ttl: 300 });
      return json(401, { message: 'no' });
    }
    if (req.method === 'GET' && req.url.startsWith('/character/v5/character/157221719')) return json(200, ddb.char);
    if (req.method === 'GET' && req.url.startsWith('/character/v5/character/24242424')) {
      const other = JSON.parse(JSON.stringify(fixture));
      other.data.id = 24242424;
      other.data.name = 'Brindle Oakhart';
      other.data.inventory = other.data.inventory.filter((i) => !/Quill/.test(i.definition.name));
      return json(200, other);
    }
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
  process.env.GEMINI_URL = `http://127.0.0.1:${sp}/gemini`;
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

  await act('settings/set', { homebrewWild: false }); // this test plays by the 2024 rules
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

test('more characters: add, switch, own trackers, remove', async () => {
  let r = await call('/api/load', { url: 'https://www.dndbeyond.com/characters/24242424/abc' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, true);
  let st = (await call('/api/state')).data;
  assert.equal(st.active, '24242424');
  assert.deepEqual(st.characters.map((c) => c.name), ['Volo Gerddam', 'Brindle Oakhart']);
  assert.deepEqual(st.custom, [], 'a new character has no trackers of its own yet');
  assert.deepEqual(st.settings.quotes, []);
  const sh = (await call('/api/sheet')).data;
  assert.equal(sh.sheet.name, 'Brindle Oakhart');
  assert.match(sh.sheetKey, /^24242424:/);

  // a change on Brindle does not touch Volo
  await act('hp/damage', { amount: 3 });
  const pin = sh.sheet.actions.find((a) => a.name === 'Shatter');
  await act('action/pin', { key: pin.key, show: true });
  st = (await call('/api/state')).data;
  assert.equal(st.actionPins[pin.key], true);
  await act('char/switch', { id: '157221719' });
  st = (await call('/api/state')).data;
  assert.equal(st.active, '157221719');
  assert.deepEqual(st.actionPins, {});
  assert.ok(st.custom.some((c) => c.id === 'spark'));
  assert.equal((await call('/api/sheet')).data.sheet.name, 'Volo Gerddam');

  // style is shared
  await act('settings/set', { theme: 'feywild' });
  await act('char/switch', { id: '24242424' });
  st = (await call('/api/state')).data;
  assert.equal(st.settings.theme, 'feywild');

  r = await act('char/remove', { id: '24242424' });
  assert.equal(r.status, 200);
  st = (await call('/api/state')).data;
  assert.equal(st.active, '157221719');
  assert.equal(st.characters.length, 1);
  const res = await fetch(`${base}/avatar?id=24242424`);
  assert.equal(res.status, 404);
});

test('journal scan: key, read pages, check words, campaign summary, recap, cleanup', async () => {
  const IMG = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg bytes for the test').toString('base64');
  let r = await call('/api/scan', { images: [IMG] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Gemini API key/);

  r = await call('/api/ai/key', { key: 'nope' });
  assert.equal(r.status, 400);
  r = await call('/api/ai/key', { key: 'AIzaWrongKey_0123456789abcdefghij' });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /did not accept the API key/);
  r = await call('/api/ai/key', { key: GEMINI_KEY });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.model, 'gemini-flash-latest');
  let st = (await call('/api/state')).data;
  assert.equal(st.ai.has, true);
  assert.ok(!JSON.stringify(st).includes(GEMINI_KEY), 'the key never goes to the phone');

  // party member: must reach the prompt as a PC
  await act('party/save', { name: 'Chalybes', cls: 'Rogue', player: 'Sam' });
  await act('campaign/set', { description: 'Inspired by World of Warcraft', words: ['Vallhyr', 'vallhyr', ' Dread Tower '] });
  st = (await call('/api/state')).data;
  assert.ok(st.campaign.words.includes('Vallhyr') && st.campaign.words.includes('Dread Tower'));
  assert.equal(st.campaign.words.filter((w) => w.toLowerCase() === 'vallhyr').length, 1, 'no doubles');

  r = await call('/api/scan', { images: [IMG, IMG] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const prompt = gem.calls.at(-1).body.contents[0].parts[0].text;
  assert.match(prompt, /Chalybes \(Rogue\), played by Sam/);
  assert.match(prompt, /NEVER list them as NPCs/);
  assert.match(prompt, /Inspired by World of Warcraft/);
  assert.equal(gem.calls.at(-1).body.contents[0].parts.filter((x) => x.inline_data).length, 2);
  const draft = r.data.draft;
  assert.equal(draft.title, 'Session 10 – 7 feb');
  assert.ok(!/script/.test(draft.html), 'cleaned');
  assert.match(draft.html, /<mark>Marshall Dunhan<\/mark>/);
  assert.match(draft.html, /<div class="box">/);
  assert.equal(draft.suggestions.length, 3, 'unknown sections dropped');
  assert.equal(draft.photos.length, 2);
  let res = await fetch(`${base}/api/photo?id=${draft.photos[0]}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');

  r = await call('/api/scan/save', { title: draft.title, html: draft.html });
  assert.equal(r.status, 200);
  const noteId = r.data.id;
  st = (await call('/api/state')).data;
  assert.equal(st.scanDraft, null);
  let note = st.notes.find((n) => n.id === noteId);
  assert.deepEqual(note.photos, draft.photos);
  assert.equal(note.suggest.length, 3);

  // check an unsure word: corrected and remembered
  r = await act('mark/resolve', { noteId, index: 0, text: 'Marshal Dughan' });
  assert.equal(r.status, 200);
  st = (await call('/api/state')).data;
  note = st.notes.find((n) => n.id === noteId);
  assert.ok(!/<mark>/.test(note.html));
  assert.match(note.html, /Marshal Dughan voor info Hogger/);
  assert.ok(st.campaign.words.includes('Marshal Dughan'));

  // accept two of the three suggestions, one edited
  r = await act('suggest/apply', { noteId, accept: [
    { section: 'npcs', name: 'Marshal Dughan', text: 'Marshal in Goldshire; gaf info over Hogger.' },
    { section: 'where', name: 'Waar we gebleven zijn', text: 'Bij de spiegel.' },
  ] });
  assert.deepEqual(r.data.result, { added: 1, updated: 1 });
  // the same NPC again later updates instead of doubling
  await act('summary/save', { section: 'npcs', name: 'Billy', text: '' });
  r = await act('suggest/apply', { noteId, accept: [{ section: 'npcs', name: 'marshal dughan', text: 'Nieuw.' }] });
  st = (await call('/api/state')).data;
  assert.equal(st.campaign.summary.npcs.length, 2);
  assert.equal(st.campaign.summary.npcs[0].text, 'Nieuw.');
  assert.equal(st.campaign.summary.where, 'Bij de spiegel.');
  assert.deepEqual(st.notes.find((n) => n.id === noteId).suggest, []);

  r = await call('/api/recap', { noteId });
  assert.equal(r.status, 200);
  st = (await call('/api/state')).data;
  assert.equal(st.notes.find((n) => n.id === noteId).recap, 'Het gezelschap sprak Marshal Dughan.');

  // a second scan thrown away removes its photos; deleting the note removes its photos
  r = await call('/api/scan', { images: [IMG] });
  const pid = r.data.draft.photos[0];
  assert.equal(r.data.draft.title, 'Session 10 – 7 feb');
  await call('/api/scan/discard', {});
  assert.equal((await fetch(`${base}/api/photo?id=${pid}`)).status, 404);
  await act('note/remove', { id: noteId });
  assert.equal((await fetch(`${base}/api/photo?id=${draft.photos[0]}`)).status, 404);

  r = await call('/api/scan', { images: ['data:text/html;base64,PHNjcmlwdD4='] });
  assert.equal(r.status, 400);
});
