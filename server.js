'use strict';
/*
 * Character app server. No dependencies: Node 24 only.
 *
 *   PORT       (default 3200)
 *   DATA_DIR   (default ./data)
 *       state.json            every character's trackers, notes and settings (see lib/state.js)
 *       chars/<id>.json       the last sheet D&D Beyond gave for that character
 *       chars/<id>.img(.json) its portrait
 *       ddb-auth.json         the D&D Beyond login cookie (for sending changes back)
 */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { buildSheet, SheetError } = require('./lib/sheet');
const S = require('./lib/state');
const ddb = require('./lib/ddb');

const PORT = Number(process.env.PORT) || 3200;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'public');
const CHARS = path.join(DATA_DIR, 'chars');
const FILES = { state: path.join(DATA_DIR, 'state.json'), auth: path.join(DATA_DIR, 'ddb-auth.json') };
const rawFile = (id) => path.join(CHARS, `${id}.json`);
const imgFile = (id) => path.join(CHARS, `${id}.img`);
fs.mkdirSync(CHARS, { recursive: true });

// version of the phone app: changes whenever an update changes its files, so open phones know to reload
const VERSION = (() => {
  const h = require('crypto').createHash('sha1');
  for (const f of ['index.html', 'app.js', 'app.css', 'sw.js']) {
    try {
      h.update(fs.readFileSync(path.join(PUBLIC, f)));
    } catch (e) { /* missing file: still a version */ }
  }
  return h.digest('hex').slice(0, 10);
})();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
async function writeJson(file, data, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data), mode ? { mode } : undefined);
  await fsp.rename(tmp, file);
}

const stored = readJson(FILES.state, null);
if (stored && stored.v !== 2) {
  // first start after the multi-character update: keep a copy of the old data, just in case
  try {
    fs.copyFileSync(FILES.state, path.join(DATA_DIR, 'state-v1-backup.json'));
  } catch (e) { /* best effort */ }
}
let state = S.normalize(stored);

// version 1 kept one character in character.json and avatar.img: move them next to the others
(() => {
  const id = state.active;
  const old = path.join(DATA_DIR, 'character.json');
  if (!id || !fs.existsSync(old) || fs.existsSync(rawFile(id))) return;
  fs.renameSync(old, rawFile(id));
  for (const ext of ['', '.json']) {
    const a = path.join(DATA_DIR, `avatar.img${ext}`);
    if (fs.existsSync(a)) fs.renameSync(a, `${imgFile(id)}${ext}`);
  }
  fs.writeFileSync(FILES.state, JSON.stringify(state));
  console.log(`Moved the stored character ${id} to the new layout.`);
})();

const sheets = new Map(); // id -> sheet, read from chars/<id>.json when first needed
function sheetOf(id) {
  if (!id) return null;
  if (sheets.has(id)) return sheets.get(id);
  const raw = readJson(rawFile(id), null);
  let sh = null;
  if (raw) {
    try {
      sh = buildSheet(raw, { fetchedAt: (state.chars[id] && state.chars[id].loadedAt) || Date.now() });
    } catch (e) {
      console.error(`Stored sheet of ${id} could not be read:`, e.message);
    }
  }
  sheets.set(id, sh);
  return sh;
}
const cur = () => (state.active ? state.chars[state.active] : null);
const curSheet = () => sheetOf(state.active);
for (const id of state.order) {
  const c = state.chars[id];
  const sh = sheetOf(id);
  if (sh && !c.live) S.applyLoad(c, sh);
  if (sh && !c.name) {
    c.name = sh.name;
    c.classLine = sh.classLine;
  }
}
let auth = readJson(FILES.auth, null);

// one change at a time, so a slow D&D Beyond call never interleaves with taps on the phone
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const sheetKey = () => (state.active ? `${state.active}:${cur().sheetRev}:${VERSION}` : '');
const clients = new Set();
function event() {
  return `event: rev\ndata: ${JSON.stringify({ rev: state.rev, sheetKey: sheetKey(), v: VERSION })}\n\n`;
}
async function save() {
  state.rev += 1;
  await writeJson(FILES.state, state);
  const msg = event();
  for (const res of clients) res.write(msg);
}

function view() {
  const c = cur();
  const sh = curSheet();
  const base = {
    v: VERSION,
    rev: state.rev,
    sheetKey: sheetKey(),
    active: state.active,
    characters: state.order.map((id) => ({ id, name: state.chars[id].name || `Character ${id}`, classLine: state.chars[id].classLine || '' })),
    hasSheet: Boolean(sh),
    auth: { has: Boolean(auth && auth.cobalt), savedAt: auth ? auth.savedAt : null },
  };
  if (!c) return { ...base, settings: { ...state.look, characterUrl: '', quotes: [], acOverride: null }, live: null, baseline: null, custom: [], notes: [], activeNote: null, surge: { log: [] }, actionPins: {}, lastSync: null, loadedAt: null, pending: [] };
  return {
    ...base,
    settings: { ...state.look, ...c.settings },
    live: c.live,
    baseline: c.baseline,
    custom: c.custom,
    notes: c.notes,
    activeNote: c.activeNote,
    surge: c.surge,
    actionPins: c.actionPins,
    lastSync: c.lastSync,
    loadedAt: c.loadedAt,
    pending: S.diff(c, sh),
  };
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
const ok = (res, data) => send(res, 200, { ok: true, ...data });
const err = (res, status, message, extra = {}) => send(res, status, { ok: false, error: message, ...extra });

function readBody(req, limit = 1_500_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

async function downloadAvatar(id, url) {
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(type)) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return;
    await fsp.writeFile(imgFile(id), buf);
    await writeJson(`${imgFile(id)}.json`, { type, url, at: Date.now() });
  } catch (e) {
    /* the portrait is a nice-to-have */
  }
}

/**
 * Loads a character from D&D Beyond: a new one is added to the list, a known one is refreshed. Either way it becomes
 * the active character. Asks first (409) when that character has changes that are not on D&D Beyond yet.
 */
async function loadCharacter(url, force) {
  const id = ddb.parseCharacterId(url);
  if (!id) throw new ddb.DdbError('That is not a D&D Beyond character link (it looks like dndbeyond.com/characters/123456).', 'nolink');
  const known = state.chars[id];
  const c = known || S.newChar(id, String(url).trim());
  if (known) {
    const pending = S.diff(c, sheetOf(id));
    if (pending.length && !force) return { needConfirm: true, pending, name: c.name };
  } else if (state.order.length >= 20) {
    throw new ddb.DdbError('That is a lot of characters. Remove one first (Settings).', 'full');
  }
  const json = await ddb.fetchCharacter(id);
  const sh = buildSheet(json, { fetchedAt: Date.now() });
  await writeJson(rawFile(id), json);
  sheets.set(id, sh);
  c.sheetRev += 1;
  c.name = sh.name;
  c.classLine = sh.classLine;
  S.applyLoad(c, sh);
  if (!known) {
    S.starterFor(c, sh);
    state.chars[id] = c;
    state.order.push(id);
  }
  state.active = id;
  await save();
  downloadAvatar(id, sh.avatarUrl).then(() => save()).catch(() => {});
  return { loaded: true, name: sh.name, added: !known };
}

async function syncToDdb() {
  const c = cur();
  const sh = curSheet();
  if (!c || !sh || !c.live) throw new ddb.DdbError('Load your sheet first.', 'nosheet');
  if (!auth || !auth.cobalt) throw new ddb.DdbError('Add your D&D Beyond login cookie in Settings first.', 'nocookie');
  const id = c.id;
  const ops = ddb.planWrites(id, sh, c.live, c.baseline);
  if (!ops.length) return { results: [], allOk: true, nothing: true };
  const token = await ddb.getToken(auth.cobalt);
  const results = [];
  for (const op of ops) {
    try {
      const r = await ddb.put(op.path, op.body, token);
      results.push({ key: op.key, label: op.label, ok: r.ok, message: r.ok ? '' : `D&D Beyond said: ${r.message}` });
    } catch (e) {
      if (e.code === 'auth') throw e;
      results.push({ key: op.key, label: op.label, ok: false, message: e.message });
    }
  }
  // check what actually landed
  const json = await ddb.fetchCharacter(id, { token });
  const fresh = buildSheet(json, { fetchedAt: Date.now() });
  for (const r of results) {
    const op = ops.find((o) => o.key === r.key);
    const landed = ddb.verify(op, fresh, c.live);
    if (r.ok && !landed) {
      r.ok = false;
      r.message = 'Sent, but D&D Beyond still shows the old value.';
    }
    if (!r.ok && landed) {
      r.ok = true;
      r.message = '';
    }
  }
  await writeJson(rawFile(id), json);
  sheets.set(id, fresh);
  c.sheetRev += 1;
  S.applySynced(c, fresh);
  c.lastSync = { at: Date.now(), by: 'app', results };
  await save();
  return { results, allOk: results.every((r) => r.ok) };
}

/** Changes that are not about one character's trackers: the look, and the list of characters. */
async function rootAct(type, p) {
  if (type === 'char/switch') {
    if (!state.chars[p.id]) throw new S.ActionError('That character is not in the app any more.');
    state.active = p.id;
    return {};
  }
  if (type === 'char/remove') {
    if (!state.chars[p.id]) throw new S.ActionError('That character is not in the app any more.');
    delete state.chars[p.id];
    state.order = state.order.filter((x) => x !== p.id);
    sheets.delete(p.id);
    for (const f of [rawFile(p.id), imgFile(p.id), `${imgFile(p.id)}.json`]) await fsp.rm(f, { force: true });
    if (state.active === p.id) state.active = state.order[0] || null;
    return {};
  }
  if (type === 'char/move') {
    const i = state.order.indexOf(p.id);
    if (i === -1) throw new S.ActionError('That character is not in the app any more.');
    const j = Math.min(state.order.length - 1, Math.max(0, i + (p.dir === 'up' ? -1 : 1)));
    state.order.splice(i, 1);
    state.order.splice(j, 0, p.id);
    return {};
  }
  return null;
}

const LOOK_KEYS = ['theme', 'size', 'showQuote'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const buf = await fsp.readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' ? 'public, max-age=86400' : 'no-cache',
      ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    res.end(buf);
  } catch (e) {
    send(res, 404, 'Not found');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return ok(res, { v: VERSION, rev: state.rev, hasSheet: Boolean(curSheet()) });
    if (p === '/api/state' && req.method === 'GET') return ok(res, view());
    if (p === '/api/sheet' && req.method === 'GET') {
      const sh = curSheet();
      if (!sh) return err(res, 404, 'No sheet loaded yet.');
      const c = cur();
      const s = c.settings.acOverride != null ? { ...sh, ac: c.settings.acOverride, acOverridden: true } : sh;
      return ok(res, { sheetKey: sheetKey(), sheet: s });
    }
    if (p === '/avatar' && req.method === 'GET') {
      const id = /^\d{4,12}$/.test(url.searchParams.get('id') || '') ? url.searchParams.get('id') : state.active;
      try {
        const meta = readJson(`${imgFile(id)}.json`, { type: 'image/jpeg' });
        const buf = await fsp.readFile(imgFile(id));
        res.writeHead(200, { 'Content-Type': meta.type, 'Cache-Control': 'no-cache' });
        return res.end(buf);
      } catch (e) {
        return send(res, 404, 'No portrait');
      }
    }
    if (p === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(event());
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return undefined;
    }
    if (req.method === 'POST' && p.startsWith('/api/')) {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        return err(res, 400, e.message === 'too big' ? 'That is too much text at once.' : 'The app sent something garbled.');
      }
      if (p === '/api/act') {
        return await locked(async () => {
          try {
            const type = String(body.type || '');
            const before = JSON.stringify(state);
            let result = await rootAct(type, body);
            if (result === null) {
              if (type === 'settings/set' && LOOK_KEYS.some((k) => body[k] !== undefined)) S.applyLook(state, body);
              const c = cur();
              const charPart = type === 'settings/set' ? (body.quotes !== undefined || body.acOverride !== undefined) : true;
              if (charPart) {
                if (!c) throw new S.ActionError('Load a character first.');
                result = S.apply(c, curSheet(), type, body);
              } else result = {};
            }
            if (JSON.stringify(state) !== before) await save();
            return ok(res, { result, rev: state.rev });
          } catch (e) {
            if (e instanceof S.ActionError) return err(res, 400, e.message);
            throw e;
          }
        });
      }
      if (p === '/api/load') {
        return await locked(async () => {
          const c = cur();
          const target = body.url !== undefined && String(body.url).trim() ? String(body.url) : c ? c.settings.characterUrl : '';
          const r = await loadCharacter(target, Boolean(body.force));
          if (r.needConfirm) return err(res, 409, 'You have changes that are not on D&D Beyond yet.', { pending: r.pending, name: r.name });
          return ok(res, r);
        });
      }
      if (p === '/api/sync') return await locked(async () => ok(res, await syncToDdb()));
      if (p === '/api/ddb/cookie') {
        return await locked(async () => {
          if (body.remove) {
            auth = null;
            await fsp.rm(FILES.auth, { force: true });
            ddb.forgetToken();
            await save();
            return ok(res, { removed: true });
          }
          const cobalt = ddb.cleanCobalt(body.cobalt);
          if (!cobalt) return err(res, 400, 'That does not look like a CobaltSession cookie. Copy only its Value.');
          let checked = true;
          try {
            ddb.forgetToken();
            await ddb.getToken(cobalt);
          } catch (e) {
            if (e.code !== 'network') return err(res, 400, e.message);
            checked = false;
          }
          auth = { cobalt, savedAt: Date.now() };
          await writeJson(FILES.auth, auth, 0o600);
          await save();
          return ok(res, { checked });
        });
      }
    }
    if (p.startsWith('/api/')) return err(res, 404, 'Unknown request.');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, p);
  } catch (e) {
    if (e instanceof ddb.DdbError || e instanceof SheetError) return err(res, 502, e.message, { code: e.code });
    console.error(e);
    return err(res, 500, 'Something went wrong on the server. The log has the details.');
  }
}

if (require.main === module) {
  http.createServer(handle).listen(PORT, () => console.log(`Character app on http://localhost:${PORT} (data in ${DATA_DIR})`));
}

module.exports = { handle };
