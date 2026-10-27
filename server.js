'use strict';
/*
 * Character app server. No dependencies: Node 24 only.
 *
 *   PORT       (default 3200)
 *   DATA_DIR   (default ./data) state.json, character.json (last sheet from D&D Beyond), ddb-auth.json (login cookie)
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
const FILES = {
  state: path.join(DATA_DIR, 'state.json'),
  raw: path.join(DATA_DIR, 'character.json'),
  auth: path.join(DATA_DIR, 'ddb-auth.json'),
  avatar: path.join(DATA_DIR, 'avatar.img'),
};
fs.mkdirSync(DATA_DIR, { recursive: true });

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

let state = S.normalize(readJson(FILES.state, null));
let sheet = null;
const raw = readJson(FILES.raw, null);
if (raw) {
  try {
    sheet = buildSheet(raw, { fetchedAt: state.loadedAt || Date.now() });
    if (!state.live) S.applyLoad(state, sheet);
  } catch (e) {
    console.error('Stored sheet could not be read:', e.message);
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

const clients = new Set();
async function save() {
  state.rev += 1;
  await writeJson(FILES.state, state);
  const msg = `event: rev\ndata: ${JSON.stringify({ rev: state.rev, sheetRev: state.sheetRev, v: VERSION })}\n\n`;
  for (const res of clients) res.write(msg);
}

function view() {
  return {
    v: VERSION,
    rev: state.rev,
    sheetRev: state.sheetRev,
    hasSheet: Boolean(sheet),
    settings: state.settings,
    live: state.live,
    baseline: state.baseline,
    custom: state.custom,
    notes: state.notes,
    activeNote: state.activeNote,
    surge: state.surge,
    lastSync: state.lastSync,
    loadedAt: state.loadedAt,
    pending: S.diff(state, sheet),
    auth: { has: Boolean(auth && auth.cobalt), savedAt: auth ? auth.savedAt : null },
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

async function downloadAvatar(url) {
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(type)) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return;
    await fsp.writeFile(FILES.avatar, buf);
    await writeJson(`${FILES.avatar}.json`, { type, url, at: Date.now() });
  } catch (e) {
    /* the portrait is a nice-to-have */
  }
}

async function loadSheet(force) {
  const id = ddb.parseCharacterId(state.settings.characterUrl);
  if (!id) throw new ddb.DdbError('Put your D&D Beyond character link in Settings first.', 'nolink');
  const pending = S.diff(state, sheet);
  if (pending.length && !force) return { needConfirm: true, pending };
  const json = await ddb.fetchCharacter(id);
  const next = buildSheet(json, { fetchedAt: Date.now() });
  await writeJson(FILES.raw, json);
  sheet = next;
  state.sheetRev += 1;
  S.applyLoad(state, sheet);
  await save();
  downloadAvatar(sheet.avatarUrl).then(() => save()).catch(() => {});
  return { loaded: true, name: sheet.name };
}

async function syncToDdb() {
  if (!sheet || !state.live) throw new ddb.DdbError('Load your sheet first.', 'nosheet');
  if (!auth || !auth.cobalt) throw new ddb.DdbError('Add your D&D Beyond login cookie in Settings first.', 'nocookie');
  const id = ddb.parseCharacterId(state.settings.characterUrl) || String(sheet.id);
  const ops = ddb.planWrites(id, sheet, state.live, state.baseline);
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
    const landed = ddb.verify(op, fresh, state.live);
    if (r.ok && !landed) {
      r.ok = false;
      r.message = 'Sent, but D&D Beyond still shows the old value.';
    }
    if (!r.ok && landed) {
      r.ok = true;
      r.message = '';
    }
  }
  await writeJson(FILES.raw, json);
  sheet = fresh;
  state.sheetRev += 1;
  S.applySynced(state, sheet);
  state.lastSync = { at: Date.now(), by: 'app', results };
  await save();
  return { results, allOk: results.every((r) => r.ok) };
}

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
    if (p === '/api/health') return ok(res, { v: VERSION, rev: state.rev, hasSheet: Boolean(sheet) });
    if (p === '/api/state' && req.method === 'GET') return ok(res, view());
    if (p === '/api/sheet' && req.method === 'GET') {
      if (!sheet) return err(res, 404, 'No sheet loaded yet.');
      const s = state.settings.acOverride != null ? { ...sheet, ac: state.settings.acOverride, acOverridden: true } : sheet;
      return ok(res, { sheetRev: state.sheetRev, sheet: s });
    }
    if (p === '/avatar' && req.method === 'GET') {
      try {
        const meta = readJson(`${FILES.avatar}.json`, { type: 'image/jpeg' });
        const buf = await fsp.readFile(FILES.avatar);
        res.writeHead(200, { 'Content-Type': meta.type, 'Cache-Control': 'no-cache' });
        return res.end(buf);
      } catch (e) {
        return send(res, 404, 'No portrait');
      }
    }
    if (p === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: rev\ndata: ${JSON.stringify({ rev: state.rev, sheetRev: state.sheetRev, v: VERSION })}\n\n`);
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
            const before = JSON.stringify([state.live, state.custom, state.notes, state.settings, state.surge, state.activeNote, state.baseline]);
            const result = S.apply(state, sheet, String(body.type || ''), body);
            const after = JSON.stringify([state.live, state.custom, state.notes, state.settings, state.surge, state.activeNote, state.baseline]);
            if (after !== before) await save();
            return ok(res, { result, rev: state.rev });
          } catch (e) {
            if (e instanceof S.ActionError) return err(res, 400, e.message);
            throw e;
          }
        });
      }
      if (p === '/api/load') {
        return await locked(async () => {
          if (body.url !== undefined) {
            S.apply(state, sheet, 'settings/set', { characterUrl: body.url });
            await save();
          }
          const r = await loadSheet(Boolean(body.force));
          if (r.needConfirm) return err(res, 409, 'You have changes that are not on D&D Beyond yet.', { pending: r.pending });
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
