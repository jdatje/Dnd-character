'use strict';
/*
 * Reading journal pages with Gemini (Google AI Studio key; the free tier works).
 *
 * One call per scan: the photos plus what the app knows about the campaign (description, party, word list, what is
 * already in the campaign summary) go in; out comes JSON with a faithful copy of the pages as note HTML, the words it
 * is unsure about (also wrapped in <mark> in the HTML), and suggestions for the campaign summary in Dutch.
 */

const BASE = (process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const DEFAULT_MODEL = 'gemini-flash-latest';
const SECTIONS = ['quests', 'npcs', 'places', 'loot', 'effects', 'where'];

class AiError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code || 'error';
  }
}

async function call(key, path, body, timeoutMs) {
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new AiError(e && e.name === 'TimeoutError' ? 'Gemini took too long. Try again, or with fewer pages at once.' : 'Could not reach Gemini from the server. Check its internet connection.', 'network');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `error ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new AiError('Gemini did not accept the API key. Check it in Settings.', 'key');
    if (res.status === 401 || res.status === 403) throw new AiError('Gemini did not accept the API key. Check it in Settings.', 'key');
    if (res.status === 404) throw new AiError(`Gemini does not know the model in Settings (${msg.slice(0, 120)}).`, 'model');
    if (res.status === 429) throw new AiError('Gemini says: too many requests for the free tier right now. Wait a minute and try again.', 'rate');
    throw new AiError(`Gemini answered with an error: ${String(msg).slice(0, 200)}`, 'http');
  }
  return data;
}

/** Checks a key by listing models; returns the best Flash model name it finds (for when the default is gone). */
async function checkKey(key) {
  const data = await call(key, 'models?pageSize=200', null, 20000);
  const models = ((data && data.models) || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'));
  const names = models.map((m) => String(m.name).replace(/^models\//, ''));
  const flash = names.filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio|thinking|exp/.test(n));
  return { models: names, suggested: names.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : flash.sort().reverse()[0] || names[0] || DEFAULT_MODEL };
}

function textOf(data) {
  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const t = parts.map((p) => p.text || '').join('');
  if (!t) {
    const why = data && data.promptFeedback && data.promptFeedback.blockReason;
    throw new AiError(why ? `Gemini refused to read this (${why}).` : 'Gemini sent back an empty answer. Try again.', 'empty');
  }
  return t;
}

function parseJson(t) {
  const s = String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(s);
  } catch (e) {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch (e2) { /* fall through */ }
    }
    throw new AiError('Gemini sent something that is not readable data. Try again.', 'json');
  }
}

function campaignContext(c) {
  const lines = [];
  if (c.description) lines.push(`Campaign description: ${c.description}`);
  if (c.party.length) {
    lines.push('Player characters in the party (these are PCs, NEVER list them as NPCs):');
    for (const p of c.party) lines.push(`- ${p.name}${p.cls ? ` (${p.cls})` : ''}${p.player ? `, played by ${p.player}` : ''}`);
  }
  if (c.selfName) lines.push(`The note writer plays: ${c.selfName}.`);
  if (c.words.length) lines.push(`Known names, places and abbreviations in this campaign (spell them exactly like this): ${c.words.join(', ')}`);
  const known = [];
  for (const s of SECTIONS) if (s !== 'where') for (const it of c.summary[s] || []) known.push(`${s}: ${it.name}`);
  if (known.length) lines.push(`Already in the campaign summary: ${known.join('; ')}`);
  return lines.join('\n');
}

const SCAN_PROMPT = `You digitise handwritten session notes from a tabletop role-playing game (D&D) journal.
The photos are pages of one or more sessions, in order.

Return ONLY a JSON object with exactly these keys:
{
  "session": { "number": <number or null>, "date": <string as written on the page, e.g. "7 feb", or null> },
  "html": <string>,
  "unsure": [<string>, ...],
  "suggestions": [ { "section": "quests"|"npcs"|"places"|"loot"|"effects"|"where", "name": <string>, "text": <string>, "op": "add"|"update" }, ... ]
}

Rules for "html" (a FAITHFUL copy, the most important part):
- Copy exactly what is written: same words, same language (do NOT translate), same abbreviations, nothing added, nothing left out, no explanations.
- Keep the structure, not the exact position: one line or bullet per written line, indented follow-ups as nested <ul>.
- Keep arrows as characters: → for arrows, ↳ for a bent arrow at the start of a line, ↓ for downward arrows, = and + as written.
- A heading such as "Session 10" goes in <h3>; leave the date out of the html (it goes in "session").
- Anything drawn inside a box goes in <div class="box">…</div>. A small table goes in <table><tr><td>…</td></tr></table>.
- Only use these tags: h3, p, ul, li, b, i, br, div (with class="box" only), table, tr, td, mark.
- Wrap every word or name you are NOT sure you read correctly in <mark>…</mark>, with your best reading inside.
  Names are the usual suspects. Use the campaign context below to read names correctly; a name that matches the context exactly does not need a mark.

"unsure": the texts you wrapped in <mark>, in order.

"suggestions" (for the player's campaign summary, written in DUTCH even if the notes are in English; keep names exactly as written):
- quests: quests, missions and open threads (name = quest name, text = what it is about and its status).
- npcs: non-player characters met or mentioned (text = who they are and what happened). Player characters from the party list are NOT npcs.
- places: locations visited or mentioned.
- loot: items, money and rewards gained (text includes amounts).
- effects: lasting buffs, curses, boons and conditions on the party.
- where: exactly one item, name "Waar we gebleven zijn", text = where the session ended.
- Use op "update" (with the exact existing name) when something is already in the campaign summary and changed; otherwise "add".
- Only include what the notes actually say. Keep texts short (one or two sentences).`;

/** Reads journal pages. images: [{ mime, data (base64) }]. Returns { session, html, unsure, suggestions, model }. */
async function scanPages(key, model, images, context) {
  const parts = [{ text: `${SCAN_PROMPT}\n\nCampaign context:\n${campaignContext(context) || '(nothing yet)'}` }];
  for (const im of images) parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
  const data = await call(key, `models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  }, 150000);
  const out = parseJson(textOf(data));
  const sug = Array.isArray(out.suggestions) ? out.suggestions : [];
  return {
    session: {
      number: Number.isFinite(Number(out.session && out.session.number)) && out.session.number !== null ? Number(out.session.number) : null,
      date: out.session && out.session.date ? String(out.session.date).slice(0, 30) : null,
    },
    html: String(out.html || ''),
    unsure: (Array.isArray(out.unsure) ? out.unsure : []).map((x) => String(x).slice(0, 80)).slice(0, 100),
    suggestions: sug
      .filter((x) => x && SECTIONS.includes(x.section) && (x.name || x.section === 'where'))
      .map((x) => ({ section: x.section, name: String(x.name || 'Waar we gebleven zijn').slice(0, 80), text: String(x.text || '').slice(0, 600), op: x.op === 'update' ? 'update' : 'add' }))
      .slice(0, 60),
  };
}

/** A short recap of one session, in Dutch. */
async function recap(key, model, noteText, context) {
  const prompt = `Write a short recap (3 to 5 sentences, in DUTCH) of this D&D session from the player's notes below. Only use what the notes say; do not invent anything. Keep names exactly as written. Plain text, no headings.\n\nCampaign context:\n${campaignContext(context) || '(nothing)'}\n\nNotes:\n${noteText}`;
  const data = await call(key, `models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 },
  }, 60000);
  return textOf(data).trim().slice(0, 2000);
}

module.exports = { AiError, DEFAULT_MODEL, SECTIONS, checkKey, scanPages, recap, campaignContext };
