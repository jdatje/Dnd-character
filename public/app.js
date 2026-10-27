'use strict';
/*
 * Character app (phone). Plain JavaScript, no build step.
 * Data: /api/state (trackers, notes, settings), /api/sheet (the character from D&D Beyond), /events (live updates
 * from other devices). Every change goes to POST /api/act; the server checks it and tells all devices.
 */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const ord = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const LS = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`dc.${k}`);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`dc.${k}`, JSON.stringify(v));
      } catch (e) { /* private mode */ }
    },
  };

  const ICON = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/></svg>',
    tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l4 4M4 20l9-9M15 3l6 6-3 3-6-6z"/></svg>',
    scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h11a2 2 0 0 1 0 4H7z"/><path d="M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10V8"/><path d="M10 12h5M10 16h4"/></svg>',
  };

  const THEMES = [
    { id: 'arcane', name: 'Arcane night', bg: '#16131D', surface: '#211C2B', line: '#3A3349', text: '#F1EDF7', accent: '#F07FB0', hp: '#F5B547', sp: '#B79CFF', header: '#1D1926' },
    { id: 'parchment', name: 'Parchment', bg: '#F3EBDD', surface: '#FBF6EC', line: '#D6C7AC', text: '#2A2118', accent: '#9C2F4E', hp: '#9A5A06', sp: '#5B3FA0', header: '#EADFCB' },
    { id: 'feywild', name: 'Feywild', bg: '#0F1A16', surface: '#192C25', line: '#2F4A3F', text: '#E8F3EE', accent: '#7FE0B0', hp: '#F2C14E', sp: '#C3A6FF', header: '#14231D' },
    { id: 'ember', name: 'Ember', bg: '#1A1210', surface: '#2B1D19', line: '#4A322B', text: '#F7EDE8', accent: '#FF8A4C', hp: '#F5C04A', sp: '#E0A3FF', header: '#231815' },
    { id: 'slate', name: 'Beyond slate', bg: '#10161E', surface: '#222E3A', line: '#3A4A5A', text: '#F0F4F8', accent: '#FF6B6B', hp: '#5BB0FF', sp: '#9FD3FF', header: '#1B2631' },
    { id: 'contrast', name: 'High contrast', bg: '#000000', surface: '#111111', line: '#666666', text: '#FFFFFF', accent: '#FFD400', hp: '#FFD400', sp: '#7FDBFF', header: '#0A0A0A' },
  ];

  let S = LS.get('state', null);
  let SHEET = LS.get('sheet', null);
  let sheetRev = SHEET ? LS.get('sheetRev', -1) : -1;
  let offline = false;
  const UI = { tab: LS.get('tab', 'actions'), other: LS.get('other', null), q: LS.get('q', 0), otherOpen: false, end: null };
  if (!['actions', 'spells', 'checks', 'features', 'other'].includes(UI.tab)) UI.tab = 'actions';

  /* ---------- talking to the server ---------- */
  async function api(path, body, method) {
    let res;
    try {
      res = await fetch(path, body === undefined && !method ? undefined : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch (e) {
      setOffline(true);
      const err = new Error('No connection to the app server. Is Tailscale on?');
      err.offline = true;
      throw err;
    }
    setOffline(false);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok || !data || data.ok === false) {
      const err = new Error((data && data.error) || `The server answered ${res.status}.`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function setOffline(on) {
    if (offline === on) return;
    offline = on;
    $('#offline').classList.toggle('hidden', !on);
  }

  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const st = await api('/api/state');
        S = st;
        LS.set('state', S);
        if (S.hasSheet && S.sheetRev !== sheetRev) {
          const sh = await api('/api/sheet');
          SHEET = sh.sheet;
          sheetRev = sh.sheetRev;
          LS.set('sheet', SHEET);
          LS.set('sheetRev', sheetRev);
        }
        if (!S.hasSheet) SHEET = null;
        render();
      } catch (e) {
        if (!e.offline) toast(e.message, 'error');
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function act(type, params = {}, { quiet = false } = {}) {
    try {
      const r = await api('/api/act', { type, ...params });
      if (!quiet) await refresh();
      return r.result;
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    }
  }

  function listen() {
    if (!window.EventSource) return setInterval(refresh, 15000);
    const es = new EventSource('/events');
    es.addEventListener('rev', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!S || d.rev !== S.rev || d.sheetRev !== sheetRev) refresh();
      } catch (err) { /* ignore */ }
    });
    es.onerror = () => setOffline(true);
    es.onopen = () => setOffline(false);
    return null;
  }

  /* ---------- small helpers ---------- */
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `show${kind === 'error' ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.className = '';
    }, kind === 'error' ? 4500 : 2200);
  }

  const L = () => (S && S.live) || { removed: 0, temp: 0, inspiration: false, slots: {}, pact: {}, uses: {}, extra: {} };
  const useOf = (key) => SHEET && SHEET.uses.find((u) => u.key === key);
  const usedOf = (key) => L().uses[key] ?? 0;
  const findUse = (re) => SHEET && SHEET.uses.find((u) => re.test(u.name));

  function pips(kind, key, max, used, { box = false, sm = false, extra = 0 } = {}) {
    const total = max + extra;
    if (total > 12) {
      return `<span class="chip" style="color:var(--sp)">${total - used} / ${total}</span>`;
    }
    let h = '';
    for (let i = 0; i < total; i++) {
      const isUsed = i >= total - used;
      h += `<button type="button" class="pip${box ? ' box' : ''}${sm ? ' sm' : ''}${isUsed ? ' used' : ''}${i >= max ? ' extra' : ''}" data-a="pip" data-kind="${kind}" data-key="${esc(key)}" data-used="${isUsed ? 1 : 0}" aria-label="${isUsed ? 'Used' : 'Available'}${i >= max ? ' (created)' : ''}, tap to ${isUsed ? 'get back' : 'use'}"></button>`;
    }
    return `<div class="pips">${h}</div>`;
  }

  async function tapPip(el) {
    const { kind, key } = el.dataset;
    const freeing = el.dataset.used === '1';
    const step = freeing ? -1 : 1;
    if (kind === 'use') {
      const u = useOf(key);
      if (!u) return;
      await act('use/set', { key, used: Math.min(u.max, Math.max(0, usedOf(key) + step)) });
    } else if (kind === 'slot' || kind === 'pact') {
      const lvl = Number(key);
      const bag = kind === 'pact' ? L().pact : L().slots;
      await act('slot/set', { level: lvl, pact: kind === 'pact', used: Math.max(0, (bag[lvl] ?? 0) + step) });
    } else if (kind === 'custom') {
      const c = S.custom.find((x) => x.id === key);
      if (!c) return;
      await act('custom/set', { id: key, used: Math.min(c.max, Math.max(0, c.used + step)) });
    }
  }

  /* ---------- look ---------- */
  function applyLook() {
    const st = (S && S.settings) || {};
    const theme = THEMES.find((t) => t.id === st.theme) || THEMES[0];
    document.documentElement.dataset.theme = theme.id;
    document.documentElement.style.fontSize = `${(16 * (st.size || 100)) / 100}px`;
    $('meta[name="theme-color"]').setAttribute('content', theme.header);
    const side = st.handleSide === 'left' ? 'left' : 'right';
    $('#app').dataset.side = side;
    $('#drawer').classList.toggle('left', side === 'left');
  }

  /* ---------- header ---------- */
  function renderHeader() {
    const h = $('#hdr');
    if (!SHEET) {
      h.innerHTML = `<div class="hdr-top"><div class="portrait" aria-hidden="true">?</div><div class="hdr-name">Character</div>
        <button type="button" class="icon-btn" data-a="settings" aria-label="Settings">${ICON.gear}</button></div>`;
      return;
    }
    const live = L();
    const max = SHEET.hp.max;
    const hp = Math.max(0, max - live.removed);
    const pct = Math.round((hp / max) * 100);
    const st = S.settings;
    const quotes = st.quotes && st.quotes.length ? st.quotes : [];
    const q = quotes.length ? quotes[UI.q % quotes.length] : '';
    h.innerHTML = `
      <div class="hdr-top">
        <img class="portrait" src="/avatar?v=${sheetRev}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'portrait',textContent:'${esc(SHEET.name[0] || '?')}'}))">
        <div class="hdr-name">${esc(SHEET.name)}</div>
        <button type="button" class="icon-btn${live.inspiration ? ' on' : ''}" data-a="insp" aria-pressed="${live.inspiration}" aria-label="Heroic inspiration">${ICON.star}</button>
        <button type="button" class="icon-btn" data-a="go-notes" aria-label="Notes">${ICON.notes}</button>
        <button type="button" class="icon-btn" data-a="settings" aria-label="Settings">${ICON.gear}</button>
      </div>
      <div class="stats">
        <button type="button" class="stat hp${hp === 0 ? ' down' : ''}" data-a="hp" aria-label="Hit points ${hp} of ${max}${live.temp ? `, ${live.temp} temporary` : ''}. Tap to change.">
          <span class="lbl">HP</span><span class="val">${hp}</span><span class="of">/ ${max}</span>
          ${live.temp ? `<span class="temp">+${live.temp} temp</span>` : ''}
          <span class="bar"><i style="width:${pct}%"></i></span>
        </button>
        <div class="stat"><span class="lbl">AC</span><span class="val">${SHEET.ac}</span></div>
        <div class="stat"><span class="lbl">INIT</span><span class="val">${esc(SHEET.initiativeText)}</span></div>
      </div>
      ${st.showQuote && q ? `<div class="quote"><p>“${esc(q)}”</p>${quotes.length > 1 ? `<button type="button" class="icon-btn plain" data-a="quote" aria-label="Another line">${ICON.shuffle}</button>` : ''}</div>` : ''}`;
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    $$('#tabs button').forEach((b) => {
      if (b.dataset.tab === UI.tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function noSheet() {
    const url = (S && S.settings && S.settings.characterUrl) || '';
    return `<div class="pane"><div class="card" style="padding:1rem;display:flex;flex-direction:column;gap:.8rem">
      <h2 class="serif" style="font-size:1.5rem">Load your character</h2>
      <p class="hint" style="margin:0">Paste the link of your D&amp;D Beyond character (it must be set to Public).</p>
      <div class="field"><label for="first-url">Character link</label><input id="first-url" class="input" type="url" value="${esc(url)}" placeholder="https://www.dndbeyond.com/characters/..."></div>
      <button type="button" class="btn primary" data-a="first-load">Load from D&amp;D Beyond</button>
    </div></div>`;
  }

  function sec(title, side, body) {
    return `<section class="sec"><div class="sec-h"><h2>${esc(title)}</h2>${side ? `<span class="side">${side}</span>` : ''}</div>${body}</section>`;
  }

  function renderActions() {
    const order = ['Attacks', 'Actions', 'Spells', 'Bonus actions', 'Reactions', 'Other'];
    const groups = {};
    SHEET.actions.forEach((a, i) => (groups[a.group] = groups[a.group] || []).push({ ...a, i }));
    let h = '';
    for (const g of order) {
      const list = groups[g];
      if (!list) continue;
      const collapsed = g === 'Other' && !UI.otherOpen;
      const rows = collapsed ? '' : list.map((a) => {
        const u = a.useKey && useOf(a.useKey);
        return `<div class="row">
          <button type="button" class="main" style="all:unset;flex:1;min-width:0;cursor:pointer" data-a="detail" data-kind="action" data-i="${a.i}">
            <div class="name">${esc(a.name)}</div><div class="meta">${esc(a.meta)}</div>
          </button>
          ${a.hit ? `<span class="chip">${esc(a.hit)}</span>` : ''}
          ${a.damage ? `<span class="dmg">${esc(a.damage)}</span>` : ''}
          ${u ? pips('use', u.key, u.max, usedOf(u.key), { box: true, sm: true }) : ''}
        </div>`;
      }).join('');
      const head = g === 'Other'
        ? `<div class="sec-h"><h2>Other</h2><button type="button" class="btn small" data-a="toggle-other">${collapsed ? `Show ${list.length}` : 'Hide'}</button></div>`
        : `<div class="sec-h"><h2>${esc(g)}</h2></div>`;
      h += `<section class="sec">${head}${rows}</section>`;
    }
    return `<div class="pane">${h || '<p class="empty">No actions on this sheet.</p>'}</div>`;
  }

  function spellMeta(s) {
    return [s.castTime, s.range, s.hit, s.damage, s.concentration ? 'Conc.' : '', s.ritual ? 'Ritual' : '', s.useKey ? `${useOf(s.useKey) ? useOf(s.useKey).max - usedOf(s.useKey) : 0} free` : ''].filter(Boolean).join(' · ');
  }

  function renderSpells() {
    const sc = SHEET.spellcasting;
    let h = sc ? `<div class="btns" style="flex-wrap:nowrap"><span class="chip" style="color:var(--text)">Save DC <b>${sc.dc}</b></span><span class="chip" style="color:var(--text)">Attack <b>${sc.attack >= 0 ? '+' : '−'}${Math.abs(sc.attack)}</b></span><span class="chip" style="color:var(--muted)">${esc(sc.ability)}</span></div>` : '';
    const levels = [...new Set(SHEET.spells.map((s) => s.level))].sort((a, b) => a - b);
    for (const lv of levels) {
      const slot = SHEET.slots.find((x) => x.level === lv);
      const used = L().slots[lv] ?? 0;
      const extra = L().extra[lv] || 0;
      const side = lv === 0 ? 'at will' : slot ? `${slot.max + extra - used} / ${slot.max + extra} slots` : 'no slots';
      const pipRow = slot ? `<div style="margin-top:-.2rem">${pips('slot', lv, slot.max, used, { sm: true, extra })}</div>` : '';
      const rows = SHEET.spells.filter((s) => s.level === lv).map((s) => {
        const i = SHEET.spells.indexOf(s);
        return `<div class="row">
          <button type="button" style="all:unset;flex:1;min-width:0;cursor:pointer" data-a="detail" data-kind="spell" data-i="${i}">
            <div class="name">${esc(s.name)}</div><div class="meta">${esc(spellMeta(s))}</div>
          </button>
          ${s.level > 0 ? `<button type="button" class="cast" data-a="cast" data-i="${i}">Cast</button>` : ''}
        </div>`;
      }).join('');
      h += sec(lv === 0 ? 'Cantrips' : `${ord(lv)} level`, side, pipRow + rows);
    }
    return `<div class="pane">${h || '<p class="empty">No spells on this sheet.</p>'}</div>`;
  }

  function renderChecks() {
    const ab = SHEET.abilities.map((a) => `<div class="abil"><span class="k">${a.key}</span><span class="m">${esc(a.text)}</span><span class="s">${a.score}</span></div>`).join('');
    const sv = SHEET.saves.map((s) => `<div class="save"><span class="dot${s.prof ? ' on' : ''}" aria-label="${s.prof ? 'proficient' : ''}"></span><span class="k">${s.key}</span><span class="v">${esc(s.text)}</span></div>`).join('');
    const sk = SHEET.skills.map((s) => `<div class="li"><span class="dot${s.exp ? ' exp' : s.prof ? ' on' : ''}"></span><span class="n">${esc(s.name)}</span><span class="a">${s.ab}</span><span class="v">${esc(s.text)}</span></div>`).join('');
    const p = SHEET.passives;
    const senses = SHEET.senses.length ? SHEET.senses.map((x) => `<div class="li"><span class="n">${esc(x)}</span></div>`).join('') : '';
    return `<div class="pane">
      ${sec('Abilities', '', `<div class="grid6">${ab}</div>`)}
      ${sec('Saving throws', '', `<div class="grid3">${sv}</div>`)}
      ${sec('Skills', '', `<div class="list">${sk}</div>`)}
      ${sec('Senses', '', `<div class="list">
        <div class="li"><span class="n">Passive Perception</span><span class="v">${p.perception}</span></div>
        <div class="li"><span class="n">Passive Insight</span><span class="v">${p.insight}</span></div>
        <div class="li"><span class="n">Passive Investigation</span><span class="v">${p.investigation}</span></div>${senses}</div>`)}
    </div>`;
  }

  function renderFeatures() {
    const cards = SHEET.features.map((f, i) => {
      const us = (f.useKeys || []).map(useOf).filter(Boolean);
      return `<div class="feat">
        <button type="button" style="all:unset;cursor:pointer;display:flex;flex-direction:column;gap:.3rem" data-a="detail" data-kind="feature" data-i="${i}">
          <span class="top"><span class="name">${esc(f.name)}</span><span class="tag">${esc(f.source)}</span></span>
          <span class="snip">${esc(f.snippet)}</span>
        </button>
        ${us.map((u) => `<div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap"><span class="lab">${esc(u.name.replace(/^Font of Magic: /, ''))} · per ${u.reset} rest</span>${pips('use', u.key, u.max, usedOf(u.key), { box: true, sm: true })}</div>`).join('')}
      </div>`;
    }).join('');
    return `<div class="pane">${cards || '<p class="empty">No features on this sheet.</p>'}</div>`;
  }

  const OTHER = [
    { id: 'notes', name: 'Notes', sub: 'Your own notes', icon: ICON.notes },
    { id: 'inventory', name: 'Inventory', sub: 'Items and money', icon: ICON.bag },
    { id: 'defenses', name: 'Speed & Defences', sub: 'Movement, resistances', icon: ICON.shield },
    { id: 'profs', name: 'Proficiencies', sub: 'Armor, weapons, tools, languages', icon: ICON.tools },
    { id: 'story', name: 'Background & story', sub: 'From your sheet', icon: ICON.scroll },
  ];

  function renderOther() {
    if (!UI.other) {
      return `<div class="pane"><div class="tiles">${OTHER.map((o) => `<button type="button" class="tile" data-a="other" data-id="${o.id}">${o.icon}<span><b>${esc(o.name)}</b><br><span>${esc(o.sub)}</span></span></button>`).join('')}</div></div>`;
    }
    const o = OTHER.find((x) => x.id === UI.other) || OTHER[0];
    const head = `<div class="subhead"><button type="button" class="icon-btn plain" data-a="other-menu" aria-label="Back to Other">${ICON.back}</button><h2>${esc(o.name)}</h2></div>`;
    let body = '';
    if (o.id === 'notes') body = renderNotes();
    if (o.id === 'inventory') body = renderInventory();
    if (o.id === 'defenses') body = renderDefenses();
    if (o.id === 'profs') body = renderProfs();
    if (o.id === 'story') body = renderStory();
    return `<div class="pane">${head}${body}</div>`;
  }

  function renderInventory() {
    const c = SHEET.currency;
    const coins = ['pp', 'gp', 'ep', 'sp', 'cp'].filter((k) => c[k]).map((k) => `<span class="chip" style="color:var(--text)">${c[k]} <span class="muted">${k}</span></span>`).join('') || '<span class="muted">No coins</span>';
    const items = SHEET.inventory.map((it, i) => `<button type="button" class="row" data-a="detail" data-kind="item" data-i="${i}">
      <span class="main"><span class="name" style="display:block">${esc(it.name)}${it.qty > 1 ? ` <span class="muted">×${it.qty}</span>` : ''}</span>
      <span class="meta" style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.25rem">${it.attuned ? '<span class="tag acc">Attuned</span>' : ''}${it.equipped ? '<span class="tag">Equipped</span>' : ''}${it.magic ? `<span class="tag">${esc(it.rarity || 'Magic')}</span>` : ''}${it.homebrew ? '<span class="tag">Homebrew</span>' : ''}${it.charges ? `<span class="tag">${it.charges.max - it.charges.used}/${it.charges.max} charges</span>` : ''}</span></span>
    </button>`).join('');
    return `${sec('Money', '', `<div class="btns">${coins}</div>`)}${sec('Items', `${SHEET.inventory.length}`, items || '<p class="empty">Nothing carried.</p>')}`;
  }

  function renderDefenses() {
    const sp = SHEET.speed;
    const speeds = [['Walking', sp.walk], ['Flying', sp.fly], ['Swimming', sp.swim], ['Climbing', sp.climb], ['Burrowing', sp.burrow]].filter(([, v]) => v).map(([n, v]) => `<div class="li"><span class="n">${n}</span><span class="v" style="width:auto">${v} ft</span></div>`).join('');
    const d = SHEET.defenses;
    const list = (arr) => (arr.length ? arr.map((x) => `<div class="li"><span class="n">${esc(x)}</span></div>`).join('') : '<div class="li"><span class="n muted">None</span></div>');
    return `${sec('Speed', '', `<div class="list">${speeds}</div>`)}
      ${SHEET.senses.length ? sec('Senses', '', `<div class="list">${list(SHEET.senses)}</div>`) : ''}
      ${sec('Resistances', '', `<div class="list">${list(d.resistances)}</div>`)}
      ${sec('Immunities', '', `<div class="list">${list(d.immunities)}</div>`)}
      ${sec('Vulnerabilities', '', `<div class="list">${list(d.vulnerabilities)}</div>`)}
      ${sec('Armor class', '', `<div class="list"><div class="li"><span class="n">AC</span><span class="v">${SHEET.ac}</span></div></div>${SHEET.acOverridden ? '<p class="hint">Set by hand in Settings.</p>' : ''}`)}`;
  }

  function renderProfs() {
    const p = SHEET.proficiencies;
    const part = (t, arr) => (arr.length ? sec(t, '', `<div class="list">${arr.map((x) => `<div class="li"><span class="n">${esc(x)}</span></div>`).join('')}</div>`) : '');
    return `${sec('Proficiency bonus', '', `<div class="list"><div class="li"><span class="n">Proficiency bonus</span><span class="v">+${SHEET.pb}</span></div></div>`)}
      ${part('Armor', p.armor)}${part('Weapons', p.weapons)}${part('Tools', p.tools)}${part('Languages', p.languages)}${part('Other', p.other)}`;
  }

  function renderStory() {
    const bg = SHEET.background;
    let h = bg && bg.name ? sec('Background', '', `<div class="card" style="padding:.8rem"><b>${esc(bg.name)}</b><div class="rich" style="margin-top:.4rem">${bg.html}</div></div>`) : '';
    for (const s of SHEET.story) h += sec(s.title, '', `<div class="card rich" style="padding:.8rem">${s.html}</div>`);
    return h || '<p class="empty">No background or story on the sheet yet.</p>';
  }

  /* ---------- notes ---------- */
  const NOTE = { timer: null, saving: false, dirty: false, last: '', id: null, status: '' };

  function renderNotes() {
    const notes = S.notes || [];
    if (!notes.length) {
      return `<div class="empty"><p>No notes yet.</p><button type="button" class="btn primary" data-a="note-new">New note</button></div>`;
    }
    const active = notes.find((n) => n.id === S.activeNote) || notes[0];
    NOTE.id = active.id;
    NOTE.last = active.html;
    const chips = notes.map((n) => `<button type="button" class="nchip" data-a="note-pick" data-id="${n.id}" aria-pressed="${n.id === active.id}">${esc(n.title)}</button>`).join('');
    return `<div class="notes">
      <div class="note-chips" role="tablist" aria-label="Your notes">${chips}<button type="button" class="nchip add" data-a="note-new" aria-label="New note">+</button></div>
      <div class="note-tools">
        <button type="button" class="btn" data-a="note-fmt" data-f="bold" aria-label="Bold"><b>B</b></button>
        <button type="button" class="btn" data-a="note-fmt" data-f="head" aria-label="Heading">H</button>
        <button type="button" class="btn" data-a="note-fmt" data-f="list" aria-label="Bullet list">•</button>
        <button type="button" class="btn" data-a="note-fmt" data-f="chk" aria-label="Checklist">☐</button>
        <span class="status" id="note-status">${NOTE.status || 'Saved'}</span>
        <button type="button" class="icon-btn plain" data-a="note-menu" aria-label="Rename, move or delete this note">${ICON.more}</button>
      </div>
      <div class="note-ed" id="note-ed" contenteditable="true" spellcheck="true" data-ph="Write anything: names, clues, loot… (- list, [] checkbox, # heading)" aria-label="${esc(active.title)}">${active.html}</div>
    </div>`;
  }

  function setNoteStatus(t) {
    NOTE.status = t;
    const el = $('#note-status');
    if (el) el.textContent = t;
  }

  function scheduleNoteSave() {
    NOTE.dirty = true;
    setNoteStatus('Editing…');
    clearTimeout(NOTE.timer);
    NOTE.timer = setTimeout(saveNote, 700);
  }

  async function saveNote() {
    clearTimeout(NOTE.timer);
    const ed = $('#note-ed');
    if (!ed || !NOTE.id) return;
    const html = ed.innerHTML;
    if (NOTE.saving) {
      NOTE.dirty = true;
      return;
    }
    if (html === NOTE.last) {
      NOTE.dirty = false;
      setNoteStatus('Saved');
      return;
    }
    NOTE.saving = true;
    NOTE.dirty = false;
    setNoteStatus('Saving…');
    try {
      await act('note/update', { id: NOTE.id, html }, { quiet: true });
      NOTE.last = html;
      const n = S.notes.find((x) => x.id === NOTE.id);
      if (n) n.html = html;
      setNoteStatus('Saved');
    } catch (e) {
      setNoteStatus('Not saved');
    }
    NOTE.saving = false;
    if (NOTE.dirty) saveNote();
  }

  function noteBlock(ed, node) {
    let n = node && node.nodeType === 3 ? node.parentNode : node;
    while (n && n !== ed) {
      if (/^(P|DIV|H3|LI)$/.test(n.nodeName)) return n;
      n = n.parentNode;
    }
    return ed;
  }
  function noteListOf(ed) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    while (n && n !== ed) {
      if (n.nodeName === 'UL' || n.nodeName === 'OL') return n;
      n = n.parentNode;
    }
    return null;
  }
  function noteMakeList(ed, chk) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let block = noteBlock(ed, sel.getRangeAt(0).startContainer);
    if (block === ed || block.nodeName === 'LI') {
      document.execCommand('formatBlock', false, 'div');
      block = noteBlock(ed, sel.getRangeAt(0).startContainer);
      if (block === ed) return;
    }
    const ul = document.createElement('ul');
    if (chk) ul.className = 'chk';
    const li = document.createElement('li');
    while (block.firstChild) li.appendChild(block.firstChild);
    if (!li.firstChild) li.appendChild(document.createElement('br'));
    ul.appendChild(li);
    block.replaceWith(ul);
    const r = document.createRange();
    r.selectNodeContents(li);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function noteFormat(kind) {
    const ed = $('#note-ed');
    if (!ed) return;
    ed.focus();
    try {
      document.execCommand('styleWithCSS', false, false);
    } catch (e) { /* older browsers */ }
    if (kind === 'bold') document.execCommand('bold');
    if (kind === 'head') {
      const cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      document.execCommand('formatBlock', false, cur === 'h3' ? 'div' : 'h3');
    }
    if (kind === 'list' || kind === 'chk') {
      const ul = noteListOf(ed);
      const isChk = ul && ul.classList.contains('chk');
      if (ul && ul.nodeName === 'UL' && (kind === 'chk') !== isChk) {
        ul.classList.toggle('chk', kind === 'chk');
        if (kind === 'list') $$('li', ul).forEach((li) => li.removeAttribute('data-done'));
      } else if (ul) document.execCommand('insertUnorderedList');
      else noteMakeList(ed, kind === 'chk');
    }
    scheduleNoteSave();
  }
  /** Quick typing at the start of a line: "- " list, "[] " checklist, "# " heading. Works with phone keyboards too. */
  function noteShortcut(ed) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    const block = noteBlock(ed, r.startContainer);
    if (block.nodeName === 'LI' || block.nodeName === 'H3') return false;
    const pre = document.createRange();
    if (block === ed) {
      let start = r.startContainer;
      if (start === ed) return false;
      while (start.parentNode !== ed) start = start.parentNode;
      let prev = start.previousSibling;
      while (prev && prev.nodeName !== 'BR' && !/^(P|DIV|H3|UL|OL)$/.test(prev.nodeName)) prev = prev.previousSibling;
      if (prev) pre.setStartAfter(prev);
      else pre.setStart(ed, 0);
    } else pre.setStart(block, 0);
    pre.setEnd(r.startContainer, r.startOffset);
    const typed = pre.toString().replace(/ /g, ' ');
    const kind = typed === '- ' || typed === '* ' ? 'list' : typed === '[] ' || typed === '[ ] ' ? 'chk' : typed === '# ' ? 'head' : '';
    if (!kind) return false;
    sel.removeAllRanges();
    sel.addRange(pre);
    document.execCommand('delete');
    noteFormat(kind);
    return true;
  }
  function setupNoteEditor() {
    const ed = $('#note-ed');
    if (!ed || ed.dataset.ready) return;
    ed.dataset.ready = '1';
    ed.addEventListener('input', (e) => {
      if (e.inputType === 'insertText' && e.data && e.data.endsWith(' ') && noteShortcut(ed)) return;
      if (e.inputType === 'insertParagraph') {
        const sel = window.getSelection();
        const li = sel.rangeCount && noteBlock(ed, sel.getRangeAt(0).startContainer);
        if (li && li.nodeName === 'LI' && !li.textContent.trim()) li.removeAttribute('data-done');
      }
      scheduleNoteSave();
    });
    ed.addEventListener('blur', () => {
      if (NOTE.dirty) saveNote();
    });
    ed.addEventListener('pointerdown', (e) => {
      const li = e.target.closest && e.target.closest('ul.chk > li');
      if (!li || !ed.contains(li)) return;
      const box = li.getBoundingClientRect();
      if (e.clientX > box.left + 4 || e.clientX < box.left - 32) return;
      e.preventDefault();
      if (li.hasAttribute('data-done')) li.removeAttribute('data-done');
      else li.setAttribute('data-done', '1');
      scheduleNoteSave();
    });
    ed.addEventListener('paste', (e) => {
      const t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, t);
    });
  }

  function editingNote() {
    const ed = $('#note-ed');
    return ed && document.activeElement === ed;
  }

  /* ---------- trackers drawer ---------- */
  function renderDrawer() {
    const d = $('#drawer');
    if (!SHEET) {
      d.innerHTML = `<div class="dh"><h2>Trackers</h2><button type="button" class="icon-btn plain" data-a="drawer-close" aria-label="Close">${ICON.close}</button></div><div class="db"><p class="empty">Load your sheet first (Settings).</p></div>`;
      return;
    }
    const live = L();
    let h = '';
    const slotRows = (list, kind) => list.map((s) => {
      const used = (kind === 'pact' ? live.pact : live.slots)[s.level] ?? 0;
      const extra = kind === 'pact' ? 0 : (live.extra[s.level] || 0);
      return `<div class="slotrow"><span class="lv">${ord(s.level)}</span>${pips(kind, s.level, s.max, used, { extra })}<span class="left">${s.max + extra - used} / ${s.max + extra}</span></div>`;
    }).join('');
    if (SHEET.slots.length) h += `<section class="tbox"><div class="sec-h"><h2>Spell slots</h2><span class="hint">tap to use</span></div>${slotRows(SHEET.slots, 'slot')}</section>`;
    if (SHEET.pact.length) h += `<section class="tbox"><div class="sec-h"><h2>Pact slots</h2></div>${slotRows(SHEET.pact, 'pact')}</section>`;

    const sp = findUse(/Sorcery Points/);
    if (sp) {
      const left = sp.max - usedOf(sp.key);
      h += `<section class="tbox"><div class="sec-h"><h2>Sorcery points</h2></div>
        <div class="counter">
          <button type="button" class="icon-btn" data-a="sp" data-d="1" aria-label="Spend a point">−</button>
          <div class="big"><b>${left}</b><span> / ${sp.max}</span></div>
          <button type="button" class="icon-btn" data-a="sp" data-d="-1" aria-label="Get a point back">+</button>
        </div>
        <div class="btns"><button type="button" class="btn sp" data-a="sp-from-slot">Slot → points</button><button type="button" class="btn sp" data-a="sp-to-slot">Points → slot</button></div>
      </section>`;
    }

    const tides = findUse(/^Tides of Chaos$/);
    if (SHEET.wildMagic) {
      const ready = tides && usedOf(tides.key) === 0;
      const last = S.surge && S.surge.log && S.surge.log[0];
      let res = '';
      if (last && last.type === 'table') res = `<div class="result"><span class="roll">${last.roll}</span><div class="rich">${last.html || 'No row for this number in your surge table.'}</div></div>`;
      else if (last && last.type === 'check') res = `<div class="result"><span class="roll">${last.roll}</span><div>d20 surge check: ${last.surge ? '<b>Surge!</b>' : 'no surge.'}</div></div>`;
      h += `<section class="tbox"><div class="sec-h"><h2>Wild magic</h2></div>
        ${tides ? `<button type="button" class="tides" data-a="tides"><b style="font-size:.9rem">Tides of Chaos</b><span class="pill${ready ? '' : ' off'}">${ready ? 'READY' : 'USED'}</span></button>` : ''}
        ${tides && !ready ? '<p class="hint" style="margin:0">Spent: your next Sorcerer spell with a slot surges for sure (and brings it back).</p>' : ''}
        <div class="btns"><button type="button" class="btn outline" data-a="surge-check">Surge check d${(SHEET.surgeRule && SHEET.surgeRule.die) || 20}</button><button type="button" class="btn primary" data-a="surge-table">Surge table d100</button></div>
        ${res}
      </section>`;
    }

    const others = SHEET.uses.filter((u) => u !== sp && u !== tides);
    if (others.length) {
      h += `<section class="tbox" style="gap:0"><div class="sec-h" style="margin-bottom:.3rem"><h2>Per rest</h2></div>${others.map((u) => `<div class="urow"><div class="t"><b>${esc(u.name)}</b><span>${u.kind === 'spell' ? 'Free cast' : esc(u.activation || 'Use')} · per ${u.reset} rest</span></div>${pips('use', u.key, u.max, usedOf(u.key), { box: true })}</div>`).join('')}</section>`;
    }

    h += `<section class="tbox" style="gap:0"><div class="sec-h" style="margin-bottom:.3rem"><h2>Your trackers</h2><span class="hint">only in this app</span></div>
      ${(S.custom || []).map((c) => `<div class="urow"><div class="t"><b>${esc(c.name)}</b><span>${esc(c.note || '')}${c.note ? ' · ' : ''}${c.reset === 'none' ? 'no reset' : `per ${c.reset} rest`}</span></div>${pips('custom', c.id, c.max, c.used, { box: true })}<button type="button" class="icon-btn plain edit" data-a="custom-edit" data-id="${c.id}" aria-label="Edit ${esc(c.name)}">${ICON.edit}</button></div>`).join('')}
      <button type="button" class="btn" style="margin-top:.5rem" data-a="custom-new">+ Add tracker</button>
    </section>`;

    const pending = (S.pending || []).length;
    d.innerHTML = `<div class="dh"><h2>Trackers</h2><button type="button" class="icon-btn plain" data-a="drawer-close" aria-label="Close trackers">${ICON.close}</button></div>
      <div class="db">${h}</div>
      <div class="df">
        <button type="button" class="btn" data-a="rest-short">Short rest</button>
        <button type="button" class="btn" data-a="rest-long">Long rest</button>
        <button type="button" class="btn gold" data-a="end-night">End night${pending ? ` (${pending})` : ''}</button>
      </div>`;
  }

  function renderHandle() {
    const dots = $('#handle .dots');
    if (!SHEET) {
      dots.innerHTML = '';
      return;
    }
    const live = L();
    const anySlot = SHEET.slots.some((s) => s.max + (live.extra[s.level] || 0) - (live.slots[s.level] ?? 0) > 0);
    const sp = findUse(/Sorcery Points/);
    const tides = findUse(/^Tides of Chaos$/);
    const marks = [anySlot];
    if (sp) marks.push(sp.max - usedOf(sp.key) > 0);
    if (tides) marks.push(usedOf(tides.key) === 0);
    dots.innerHTML = marks.map((m) => `<i class="${m ? '' : 'used'}"></i>`).join('');
  }

  /* ---------- layers: drawer, bottom sheet, full page (the phone's Back button closes the top one) ---------- */
  const layers = [];
  function pushLayer(name) {
    layers.push(name);
    history.pushState({ layer: name }, '');
  }
  function closeTop() {
    if (layers.length) history.back();
  }
  window.addEventListener('popstate', () => {
    const top = layers.pop();
    if (top === 'drawer') hideDrawer();
    else if (top === 'sheet') hideSheet();
    else if (top === 'page') hidePage();
  });

  function openDrawer() {
    if ($('#drawer').classList.contains('open')) return;
    renderDrawer();
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawer-scrim').classList.add('open');
    $('#handle').setAttribute('aria-expanded', 'true');
    pushLayer('drawer');
  }
  function hideDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#drawer-scrim').classList.remove('open');
    $('#handle').setAttribute('aria-expanded', 'false');
  }

  let sheetOnClose = null;
  function openSheet(title, sub, body, { onClose = null } = {}) {
    const el = $('#sheet');
    el.innerHTML = `<div class="sh"><h2>${esc(title)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</h2><button type="button" class="icon-btn plain" data-a="sheet-close" aria-label="Close">${ICON.close}</button></div><div class="sb">${body}</div>`;
    sheetOnClose = onClose;
    if (!el.classList.contains('open')) {
      el.classList.add('open');
      el.setAttribute('aria-hidden', 'false');
      $('#sheet-scrim').classList.add('open');
      pushLayer('sheet');
    }
  }
  function sheetBody(html) {
    const b = $('#sheet .sb');
    if (b) b.innerHTML = html;
  }
  function hideSheet() {
    const el = $('#sheet');
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    $('#sheet-scrim').classList.remove('open');
    const f = sheetOnClose;
    sheetOnClose = null;
    if (f) f();
  }
  const sheetIsOpen = () => $('#sheet').classList.contains('open');

  let pageName = null;
  function openPage(name) {
    pageName = name;
    renderPage();
    pushLayer('page');
  }
  function hidePage() {
    pageName = null;
    UI.end = null;
    $('#page-host').innerHTML = '';
  }
  function renderPage() {
    if (!pageName) return;
    const host = $('#page-host');
    if (pageName === 'settings') {
      const active = document.activeElement && host.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.nodeName);
      if (active && host.innerHTML) return; // don't wipe what the player is typing
      host.innerHTML = renderSettings();
    }
    if (pageName === 'end') host.innerHTML = renderEnd();
  }

  /* ---------- dialogs ---------- */
  function showDetail(kind, i) {
    if (kind === 'spell') {
      const s = SHEET.spells[i];
      const facts = [s.castTime, s.range, s.duration, s.components, s.hit, s.damage].filter(Boolean).join(' · ');
      openSheet(s.name, `${s.level === 0 ? 'Cantrip' : `${ord(s.level)} level`} ${s.school}${s.ritual ? ' · ritual' : ''}`, `
        <p class="hint" style="margin:0">${esc(facts)}</p>
        ${s.level > 0 ? `<div class="btns"><button type="button" class="btn primary" data-a="cast" data-i="${i}">Cast ${esc(s.name)}</button></div>` : ''}
        <div class="rich">${s.html}</div>`);
      return;
    }
    if (kind === 'action') {
      const a = SHEET.actions[i];
      if (a.spellKey) {
        const si = SHEET.spells.findIndex((s) => s.key === a.spellKey);
        if (si >= 0) return showDetail('spell', si);
      }
      const u = a.useKey && useOf(a.useKey);
      openSheet(a.name, a.meta, `${a.hit || a.damage ? `<p class="hint" style="margin:0">${esc([a.hit && `Hit ${a.hit}`, a.damage].filter(Boolean).join(' · '))}</p>` : ''}
        ${u ? `<div style="display:flex;gap:.6rem;align-items:center"><span class="lab">Uses</span>${pips('use', u.key, u.max, usedOf(u.key), { box: true })}</div>` : ''}
        <div class="rich">${a.html || '<p class="muted">No description.</p>'}</div>`);
      return;
    }
    if (kind === 'feature') {
      const f = SHEET.features[i];
      const us = (f.useKeys || []).map(useOf).filter(Boolean);
      openSheet(f.name, `${f.source}${f.level ? ` · level ${f.level}` : ''}`, `${us.map((u) => `<div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"><span class="lab">${esc(u.name)}</span>${pips('use', u.key, u.max, usedOf(u.key), { box: true })}</div>`).join('')}<div class="rich">${f.html || '<p class="muted">No description.</p>'}</div>`);
      return;
    }
    if (kind === 'item') {
      const it = SHEET.inventory[i];
      openSheet(it.name, [it.type, it.rarity, it.qty > 1 ? `×${it.qty}` : '', it.weight ? `${it.weight} lb` : ''].filter(Boolean).join(' · '), `<div class="rich">${it.html || '<p class="muted">No description.</p>'}</div>`);
    }
  }

  function castDialog(i) {
    const s = SHEET.spells[i];
    const live = L();
    let opts = '';
    for (const sl of SHEET.slots.filter((x) => x.level >= s.level)) {
      const extra = live.extra[sl.level] || 0;
      const left = sl.max + extra - (live.slots[sl.level] ?? 0);
      opts += `<button type="button" class="opt" data-a="cast-go" data-i="${i}" data-level="${sl.level}" ${left > 0 ? '' : 'disabled'}>${ord(sl.level)}-level slot<span>${left} of ${sl.max + extra} left</span></button>`;
    }
    for (const sl of SHEET.pact.filter((x) => x.level >= s.level)) {
      const left = sl.max - (live.pact[sl.level] ?? 0);
      opts += `<button type="button" class="opt" data-a="cast-go" data-i="${i}" data-level="${sl.level}" data-pact="1" ${left > 0 ? '' : 'disabled'}>Pact slot (${ord(sl.level)})<span>${left} of ${sl.max} left</span></button>`;
    }
    const u = s.useKey && useOf(s.useKey);
    if (u) {
      const left = u.max - usedOf(u.key);
      opts = `<button type="button" class="opt" data-a="cast-go" data-i="${i}" data-level="free" ${left > 0 ? '' : 'disabled'}>Free cast (no slot)<span>${left} of ${u.max} left</span></button>${opts}`;
    }
    openSheet(`Cast ${s.name}`, s.higher ? 'Higher slots make it stronger' : '', opts || '<p class="empty">No slots for this spell.</p>');
  }

  async function doCast(i, level, pact) {
    const s = SHEET.spells[i];
    let r;
    try {
      r = await act('cast', { spellKey: s.key, level: level === 'free' ? 'free' : Number(level), pact });
    } catch (e) {
      return;
    }
    if (r.autoSurge) {
      openSheet('Wild Magic Surge!', `${s.name}: Tides of Chaos was spent, so this spell surges`, surgeHtml(r.autoSurge));
      return;
    }
    if (r.offerCheck) {
      openSheet('Surge check?', `You cast ${s.name} with a spell slot`, `
        <p class="hint" style="margin:0">Wild Magic Surge: roll a d${SHEET.surgeRule.die}. On a ${SHEET.surgeRule.on} you roll on the surge table.</p>
        <div class="btns"><button type="button" class="btn primary" data-a="surge-check">Roll d${SHEET.surgeRule.die}</button><button type="button" class="btn" data-a="sheet-close">Not now</button></div>`);
      return;
    }
    if (sheetIsOpen()) closeTop();
    toast(`${s.name} cast${level === 'free' ? ' (free)' : level ? ` with a ${ord(Number(level))}-level slot` : ''}`);
  }

  function surgeHtml(t) {
    return `<div class="result"><span class="roll">${t.roll}</span><div class="rich">${t.html || 'No row for this number in your surge table.'}</div></div>${t.tidesBack ? '<p class="hint" style="margin:0">Tides of Chaos is ready again.</p>' : ''}<button type="button" class="btn" data-a="sheet-close">OK</button>`;
  }

  async function surgeCheck() {
    let r;
    try {
      r = await act('surge/check');
    } catch (e) {
      return;
    }
    const body = r.surge
      ? `<div class="result"><span class="roll">${r.roll}</span><div><b>Surge!</b> Rolling on the table…</div></div>${surgeHtml(r.table)}`
      : `<div class="result"><span class="roll">${r.roll}</span><div>No surge this time.</div></div><button type="button" class="btn" data-a="sheet-close">OK</button>`;
    if (sheetIsOpen()) {
      $('#sheet .sh h2').firstChild.textContent = r.surge ? 'Wild Magic Surge!' : 'Surge check';
      sheetBody(body);
    } else openSheet(r.surge ? 'Wild Magic Surge!' : 'Surge check', `d${SHEET.surgeRule.die}`, body);
  }

  async function surgeTable() {
    let r;
    try {
      r = await act('surge/table');
    } catch (e) {
      return;
    }
    openSheet('Wild Magic Surge', 'd100 on your surge table', surgeHtml(r));
  }

  /* hit points */
  const HP = { amount: '' };
  function hpDialog() {
    HP.amount = '';
    const live = L();
    openSheet('Hit points', `${Math.max(0, SHEET.hp.max - live.removed)} of ${SHEET.hp.max}${live.temp ? `, +${live.temp} temporary` : ''}`, hpBody());
  }
  function hpBody() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    return `<div class="amount" aria-live="polite">${HP.amount || '0'}</div>
      <div class="numpad">${keys.map((k) => `<button type="button" data-a="hp-key" data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k === 'C' ? 'Clear' : k}">${k}</button>`).join('')}</div>
      <div class="btns"><button type="button" class="btn danger" data-a="hp-go" data-t="damage">Damage</button><button type="button" class="btn" style="border-color:var(--good);color:var(--good);background:transparent" data-a="hp-go" data-t="heal">Heal</button><button type="button" class="btn sp" data-a="hp-go" data-t="temp">Set temp</button></div>`;
  }

  function slotPickDialog(kind) {
    const live = L();
    const sp = findUse(/Sorcery Points/);
    if (!sp) return;
    let opts = '';
    if (kind === 'from') {
      for (const s of SHEET.slots) {
        const left = s.max + (live.extra[s.level] || 0) - (live.slots[s.level] ?? 0);
        opts += `<button type="button" class="opt" data-a="sp-go" data-t="from" data-level="${s.level}" ${left > 0 ? '' : 'disabled'}>${ord(s.level)}-level slot → ${s.level} point${s.level > 1 ? 's' : ''}<span>${left} left</span></button>`;
      }
      openSheet('Slot → sorcery points', 'Spend a slot, gain points equal to its level', opts);
    } else {
      const cost = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };
      const left = sp.max - usedOf(sp.key);
      for (let lv = 1; lv <= 5; lv++) {
        if (!SHEET.slots.some((s) => s.level === lv)) continue;
        opts += `<button type="button" class="opt" data-a="sp-go" data-t="to" data-level="${lv}" ${left >= cost[lv] ? '' : 'disabled'}>${ord(lv)}-level slot<span>${cost[lv]} points</span></button>`;
      }
      openSheet('Sorcery points → slot', `You have ${left} points. The slot is gone after a long rest.`, opts || '<p class="empty">No slot levels to create.</p>');
    }
  }

  function customDialog(id) {
    const c = id ? S.custom.find((x) => x.id === id) : { name: '', note: '', max: 1, reset: 'long' };
    if (!c) return;
    const seg = ['short', 'long', 'none'].map((r) => `<button type="button" data-a="seg" data-v="${r}" aria-pressed="${c.reset === r}">${r === 'none' ? 'Never' : r === 'short' ? 'Short rest' : 'Long rest'}</button>`).join('');
    openSheet(id ? 'Edit tracker' : 'New tracker', 'Only in this app, not on D&D Beyond', `
      <div class="field"><label for="ct-name">Name</label><input id="ct-name" class="input" maxlength="40" value="${esc(c.name)}" placeholder="For example Luck points"></div>
      <div class="field"><label for="ct-note">Note (optional)</label><input id="ct-note" class="input" maxlength="120" value="${esc(c.note)}" placeholder="What it does"></div>
      <div class="field"><label for="ct-max">Number of uses</label><input id="ct-max" class="input" type="number" inputmode="numeric" min="1" max="99" value="${c.max}"></div>
      <div class="field"><span class="lab">Comes back after</span><div class="seg" id="ct-reset">${seg}</div></div>
      <div class="btns"><button type="button" class="btn primary" data-a="custom-save" data-id="${id || ''}">Save</button>${id ? `<button type="button" class="btn danger" data-a="custom-del" data-id="${id}">Delete</button>` : ''}</div>`);
  }

  function noteMenu() {
    const n = S.notes.find((x) => x.id === NOTE.id);
    if (!n) return;
    const i = S.notes.indexOf(n);
    openSheet('Note', n.title, `
      <div class="field"><label for="nt-title">Name</label><input id="nt-title" class="input" maxlength="40" value="${esc(n.title)}"></div>
      <button type="button" class="btn primary" data-a="note-rename">Save name</button>
      <div class="btns"><button type="button" class="btn" data-a="note-move" data-d="left" ${i === 0 ? 'disabled' : ''}>Move left</button><button type="button" class="btn" data-a="note-move" data-d="right" ${i === S.notes.length - 1 ? 'disabled' : ''}>Move right</button></div>
      <button type="button" class="btn danger" data-a="note-del">Delete this note</button>`);
  }

  /* ---------- settings page ---------- */
  function renderSettings() {
    const st = S.settings;
    const themes = THEMES.map((t) => `<button type="button" class="theme" data-a="theme" data-id="${t.id}" aria-pressed="${st.theme === t.id}" style="--t-bg:${t.bg};--t-surface:${t.surface};--t-line:${t.line};--t-text:${t.text};--t-accent:${t.accent}">
      <span class="sw"><b></b><i></i></span><span class="bars"><i style="width:2rem;background:${t.hp}"></i><i style="width:1.3rem;background:${t.sp}"></i></span><span class="nm">${esc(t.name)}</span></button>`).join('');
    const wake = LS.get('wake', true);
    const loaded = S.loadedAt ? new Date(S.loadedAt).toLocaleString() : 'never';
    const authBlock = S.auth.has
      ? `<p class="hint" style="margin:0">Login cookie saved ${new Date(S.auth.savedAt).toLocaleDateString()}. End night can send your changes to D&amp;D Beyond.</p>
         <div class="btns"><button type="button" class="btn" data-a="cookie-replace">Replace</button><button type="button" class="btn danger" data-a="cookie-remove">Remove</button></div>`
      : '';
    return `<div class="page" role="dialog" aria-label="Settings">
      <div class="ph"><button type="button" class="icon-btn plain" data-a="page-close" aria-label="Back">${ICON.back}</button><h1>Settings</h1></div>
      <div class="pb">
        ${sec('Style', '', `<div class="themes">${themes}</div>`)}
        <section class="sec"><div class="sec-h"><h2><label for="size">Size</label></h2><span class="side" style="color:var(--accent);font-weight:700" id="size-val">${st.size}%</span></div>
          <input id="size" type="range" min="80" max="130" step="5" value="${st.size}">
          <p class="hint" style="margin:0">Makes everything in the app bigger or smaller, on all your devices.</p></section>
        <section class="card" style="padding:0 .9rem">
          <div class="setrow"><span class="t">In-character line<small>Shown under your name</small></span><button type="button" class="switch" role="switch" aria-checked="${st.showQuote}" data-a="toggle-quote" aria-label="Show in-character line"><i></i></button></div>
          <div class="setrow"><span class="t">Keep screen on<small>While the app is open (this device)</small></span><button type="button" class="switch" role="switch" aria-checked="${wake}" data-a="toggle-wake" aria-label="Keep screen on"><i></i></button></div>
          <div class="setrow"><span class="t">Trackers handle</span><div class="seg" style="width:10rem"><button type="button" data-a="side" data-v="left" aria-pressed="${st.handleSide === 'left'}">Left</button><button type="button" data-a="side" data-v="right" aria-pressed="${st.handleSide !== 'left'}">Right</button></div></div>
        </section>
        <section class="sec"><div class="sec-h"><h2><label for="quotes">In-character lines</label></h2><span class="side">one per line</span></div>
          <textarea id="quotes" class="input" rows="5">${esc((st.quotes || []).join('\n'))}</textarea>
          <button type="button" class="btn" data-a="save-quotes">Save lines</button></section>
        <section class="sec"><div class="sec-h"><h2>D&amp;D Beyond</h2></div>
          <div class="card" style="padding:.9rem;display:flex;flex-direction:column;gap:.7rem">
            <div class="field"><label for="ddb-url">Character link</label><input id="ddb-url" class="input" type="url" value="${esc(st.characterUrl)}"></div>
            <button type="button" class="btn outline" data-a="load">Load sheet from D&amp;D Beyond</button>
            <p class="hint" style="margin:0">Last loaded: ${esc(loaded)}. Load at the start of the night, or after you change your character on D&amp;D Beyond.</p>
            <hr style="border:none;border-top:1px solid var(--line);margin:.2rem 0;width:100%">
            <b style="font-size:.92rem">Send changes back (login cookie)</b>
            ${authBlock}
            <div id="cookie-form" class="${S.auth.has ? 'hidden' : ''}" style="display:flex;flex-direction:column;gap:.6rem">
              <div class="field"><label for="cobalt">CobaltSession cookie</label><input id="cobalt" class="input" type="password" autocomplete="off" placeholder="Paste the Value here"></div>
              <button type="button" class="btn primary" data-a="cookie-save">Save cookie</button>
              <details class="hint"><summary>How to get it (on a PC)</summary><ol>
                <li>Open dndbeyond.com in Chrome and sign in.</li>
                <li>Press F12, open the <b>Application</b> tab, then <b>Cookies</b> &gt; https://www.dndbeyond.com.</li>
                <li>Click <code>CobaltSession</code> and copy its <b>Value</b>.</li>
                <li>Open this app on the PC (or send the value to your phone) and paste it here.</li>
              </ol>It is stored only on your own server and only used to send your trackers to your own character. It works like a login: don't share it. If D&amp;D Beyond logs you out, copy a fresh one.</details>
            </div>
          </div></section>
        ${sec('Armor class', '', `<div class="card" style="padding:.9rem;display:flex;flex-direction:column;gap:.6rem"><p class="hint" style="margin:0">The app works AC out from your sheet (${SHEET ? (SHEET.acOverridden ? 'set by hand' : SHEET.ac) : '–'}). If it is wrong, set it here; leave empty to use the sheet.</p><div class="btns" style="flex-wrap:nowrap"><input id="ac" class="input" type="number" inputmode="numeric" min="0" max="40" value="${st.acOverride ?? ''}" aria-label="Armor class by hand"><button type="button" class="btn" data-a="save-ac">Save</button></div></div>`)}
        <p class="hint" style="text-align:center">Install: in Chrome, menu ⋮ &gt; Add to Home screen.</p>
      </div></div>`;
  }

  /* ---------- end of the night ---------- */
  function renderEnd() {
    const pending = S.pending || [];
    const custom = (S.custom || []).filter((c) => c.used > 0);
    const since = S.loadedAt || 0;
    const surges = ((S.surge && S.surge.log) || []).filter((x) => x.type === 'table' && x.at >= since).length;
    const res = UI.end;
    let body = '';
    if (res && res.results) {
      body += sec('Sent to D&D Beyond', '', `<div class="list">${res.results.map((r) => `<div class="li"><span class="${r.ok ? 'res-ok' : 'res-bad'}" aria-hidden="true">${r.ok ? '✓' : '✗'}</span><span class="n">${esc(r.label)}${r.message ? `<br><span class="hint">${esc(r.message)}</span>` : ''}</span></div>`).join('')}</div>`);
    }
    body += pending.length
      ? sec('Changes since you loaded your sheet', '', `<div class="card" style="padding:0 .9rem">${pending.map((p) => `<label class="check"><input type="checkbox"><span class="t"><b>${esc(p.label)}</b><span>${esc(p.text)}</span></span></label>`).join('')}</div>`)
      : `<div class="card" style="padding:1rem"><p style="margin:0">D&amp;D Beyond is up to date. Nothing to send.</p></div>`;
    if (custom.length || surges) {
      body += sec('Only in this app', '', `<div class="card" style="padding:.8rem;font-size:.9rem;display:flex;flex-direction:column;gap:.3rem">${custom.map((c) => `<span>${esc(c.name)}: ${c.used} of ${c.max} used</span>`).join('')}${surges ? `<span>Surges tonight: ${surges}</span>` : ''}<span class="hint">These stay in the app; D&amp;D Beyond has no counter for them.</span></div>`);
    }
    const canSend = S.auth.has && pending.length;
    return `<div class="page" role="dialog" aria-label="End of the night">
      <div class="ph"><button type="button" class="icon-btn plain" data-a="page-close" aria-label="Back">${ICON.back}</button><h1>End of the night</h1></div>
      <div class="pb"><p class="hint" style="margin:0">Send your changes to D&amp;D Beyond, or tick them off as you mark them there yourself.</p>${body}</div>
      <div class="pf">
        ${pending.length ? `<button type="button" class="btn gold" data-a="sync" ${canSend ? '' : 'disabled'}>Send to D&amp;D Beyond</button>` : ''}
        ${pending.length && !S.auth.has ? '<p class="hint" style="margin:0;text-align:center">To send, add your login cookie in <button type="button" class="btn small" data-a="settings">Settings</button></p>' : ''}
        ${pending.length ? '<button type="button" class="btn" data-a="marked">I marked them myself</button>' : '<button type="button" class="btn" data-a="page-close">Close</button>'}
      </div></div>`;
  }

  /* ---------- main render ---------- */
  function render() {
    applyLook();
    renderHeader();
    renderTabs();
    renderHandle();
    const main = $('#main');
    if (!(UI.tab === 'other' && UI.other === 'notes' && editingNote())) {
      const y = main.scrollTop;
      const same = main.dataset.view === `${UI.tab}:${UI.other || ''}`;
      if (!SHEET) main.innerHTML = noSheet();
      else if (UI.tab === 'actions') main.innerHTML = renderActions();
      else if (UI.tab === 'spells') main.innerHTML = renderSpells();
      else if (UI.tab === 'checks') main.innerHTML = renderChecks();
      else if (UI.tab === 'features') main.innerHTML = renderFeatures();
      else main.innerHTML = renderOther();
      main.dataset.view = `${UI.tab}:${UI.other || ''}`;
      if (same) main.scrollTop = y;
      setupNoteEditor();
    }
    if ($('#drawer').classList.contains('open')) renderDrawer();
    renderPage();
    $('#handle').classList.toggle('hidden', !SHEET);
  }

  function setTab(tab) {
    if (tab === 'other' && UI.tab === 'other' && UI.other) UI.other = null; // tap Other again: back to the menu
    UI.tab = tab;
    LS.set('tab', tab);
    LS.set('other', UI.other);
    $('#main').scrollTop = 0;
    render();
  }

  /* ---------- taps ---------- */
  document.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('#tabs button');
    if (tabBtn) return setTab(tabBtn.dataset.tab);
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const a = el.dataset.a;
    const d = el.dataset;
    switch (a) {
      case 'pip': return tapPip(el);
      case 'insp': return act('inspiration/set', { on: !L().inspiration });
      case 'quote':
        UI.q += 1;
        LS.set('q', UI.q);
        return renderHeader();
      case 'go-notes':
        UI.tab = 'other';
        UI.other = 'notes';
        LS.set('tab', UI.tab);
        LS.set('other', UI.other);
        return render();
      case 'settings':
        if (pageName === 'end') closeTop();
        return setTimeout(() => openPage('settings'), pageName ? 50 : 0);
      case 'page-close': return closeTop();
      case 'drawer-close': return closeTop();
      case 'sheet-close': return closeTop();
      case 'toggle-other':
        UI.otherOpen = !UI.otherOpen;
        return render();
      case 'detail': return showDetail(d.kind, Number(d.i));
      case 'cast': return castDialog(Number(d.i));
      case 'cast-go': return doCast(Number(d.i), d.level, d.pact === '1');
      case 'surge-check': return surgeCheck();
      case 'surge-table': return surgeTable();
      case 'tides': {
        const t = findUse(/^Tides of Chaos$/);
        if (t) await act('use/set', { key: t.key, used: usedOf(t.key) ? 0 : 1 });
        return undefined;
      }
      case 'sp': {
        const sp = findUse(/Sorcery Points/);
        if (sp) await act('use/set', { key: sp.key, used: Math.min(sp.max, Math.max(0, usedOf(sp.key) + Number(d.d))) });
        return undefined;
      }
      case 'sp-from-slot': return slotPickDialog('from');
      case 'sp-to-slot': return slotPickDialog('to');
      case 'sp-go':
        try {
          const r = await act(d.t === 'from' ? 'sp/from-slot' : 'sp/to-slot', { level: Number(d.level) });
          closeTop();
          toast(d.t === 'from' ? `+${r.gained} sorcery point${r.gained > 1 ? 's' : ''}` : `${ord(Number(d.level))}-level slot created (${r.cost} points)`);
        } catch (err) { /* toast shown */ }
        return undefined;
      case 'hp': return hpDialog();
      case 'hp-key': {
        const k = d.k;
        if (k === 'C') HP.amount = '';
        else if (k === '⌫') HP.amount = HP.amount.slice(0, -1);
        else if (HP.amount.length < 3) HP.amount = (HP.amount + k).replace(/^0+(?=\d)/, '');
        $('#sheet .amount').textContent = HP.amount || '0';
        return undefined;
      }
      case 'hp-go': {
        const n = Number(HP.amount || 0);
        if (d.t !== 'temp' && !n) return toast('Type an amount first.');
        try {
          const r = await act(d.t === 'damage' ? 'hp/damage' : d.t === 'heal' ? 'hp/heal' : 'hp/temp', { amount: n });
          closeTop();
          if (r && r.down) toast('Down to 0 hit points!', 'error');
        } catch (err) { /* toast shown */ }
        return undefined;
      }
      case 'rest-short':
        await act('rest/short');
        return toast('Short rest taken');
      case 'rest-long':
        return openSheet('Long rest', 'Restores all spell slots, uses and hit points', '<button type="button" class="btn primary" data-a="rest-long-go">Take a long rest</button><button type="button" class="btn" data-a="sheet-close">Cancel</button>');
      case 'rest-long-go':
        try {
          await act('rest/long');
          closeTop();
          toast('Long rest taken');
        } catch (err) { /* toast shown */ }
        return undefined;
      case 'end-night':
        UI.end = null;
        return openPage('end');
      case 'sync': {
        el.disabled = true;
        el.textContent = 'Sending…';
        try {
          const r = await api('/api/sync', {});
          UI.end = r;
          await refresh();
          toast(r.allOk ? 'D&D Beyond is up to date' : 'Some changes did not make it', r.allOk ? '' : 'error');
        } catch (err) {
          toast(err.message, 'error');
          renderPage();
        }
        return undefined;
      }
      case 'marked':
        await act('sync/marked');
        toast('Marked as done');
        return closeTop();
      case 'custom-new': return customDialog(null);
      case 'custom-edit': return customDialog(d.id);
      case 'seg':
        $$('[data-a="seg"]', el.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
        return undefined;
      case 'custom-save': {
        const reset = ($('#ct-reset [aria-pressed="true"]') || {}).dataset?.v || 'long';
        const p = { name: $('#ct-name').value, note: $('#ct-note').value, max: Number($('#ct-max').value), reset };
        try {
          if (d.id) await act('custom/update', { id: d.id, ...p });
          else await act('custom/add', p);
          closeTop();
        } catch (err) { /* toast shown */ }
        return undefined;
      }
      case 'custom-del':
        try {
          await act('custom/remove', { id: d.id });
          closeTop();
        } catch (err) { /* toast shown */ }
        return undefined;
      case 'other':
        UI.other = d.id;
        LS.set('other', UI.other);
        $('#main').scrollTop = 0;
        return render();
      case 'other-menu':
        UI.other = null;
        LS.set('other', null);
        return render();
      case 'note-new': {
        if (NOTE.dirty) await saveNote();
        await act('note/add', {});
        setTimeout(() => {
          const ed = $('#note-ed');
          if (ed) ed.focus();
        }, 50);
        return undefined;
      }
      case 'note-pick':
        if (NOTE.dirty) await saveNote();
        return act('note/active', { id: d.id });
      case 'note-fmt': return noteFormat(d.f);
      case 'note-menu': return noteMenu();
      case 'note-rename':
        try {
          await act('note/update', { id: NOTE.id, title: $('#nt-title').value });
          closeTop();
        } catch (err) { /* toast shown */ }
        return undefined;
      case 'note-move':
        await act('note/move', { id: NOTE.id, dir: d.d });
        return closeTop();
      case 'note-del':
        return openSheet('Delete note?', (S.notes.find((x) => x.id === NOTE.id) || {}).title || '', '<button type="button" class="btn danger" data-a="note-del-go">Delete</button><button type="button" class="btn" data-a="sheet-close">Cancel</button>');
      case 'note-del-go':
        try {
          await act('note/remove', { id: NOTE.id });
          closeTop();
        } catch (err) { /* toast shown */ }
        return undefined;
      case 'theme':
        return act('settings/set', { theme: d.id });
      case 'toggle-quote':
        return act('settings/set', { showQuote: !S.settings.showQuote });
      case 'toggle-wake':
        LS.set('wake', !LS.get('wake', true));
        wakeLock();
        return renderPage();
      case 'side':
        return act('settings/set', { handleSide: d.v });
      case 'save-quotes':
        await act('settings/set', { quotes: $('#quotes').value.split('\n') });
        return toast('Lines saved');
      case 'save-ac':
        await act('settings/set', { acOverride: $('#ac').value === '' ? null : Number($('#ac').value) });
        return toast('Saved');
      case 'first-load':
      case 'load': {
        const url = $(a === 'first-load' ? '#first-url' : '#ddb-url').value.trim();
        return loadSheet(url, false, el);
      }
      case 'load-force':
        closeTop();
        return loadSheet(d.url, true, null);
      case 'cookie-save': {
        const v = $('#cobalt').value.trim();
        if (!v) return toast('Paste the cookie value first.');
        el.disabled = true;
        try {
          const r = await api('/api/ddb/cookie', { cobalt: v });
          await refresh();
          host().innerHTML = renderSettings();
          toast(r.checked ? 'Cookie saved and checked' : 'Cookie saved (could not check it right now)');
        } catch (err) {
          toast(err.message, 'error');
          el.disabled = false;
        }
        return undefined;
      }
      case 'cookie-replace':
        $('#cookie-form').classList.remove('hidden');
        return $('#cobalt').focus();
      case 'cookie-remove':
        await api('/api/ddb/cookie', { remove: true });
        await refresh();
        host().innerHTML = renderSettings();
        return toast('Cookie removed');
      default:
        return undefined;
    }
  });
  const host = () => $('#page-host');

  async function loadSheet(url, force, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading…';
    }
    try {
      const r = await api('/api/load', { url, force });
      await refresh();
      if (pageName === 'settings') host().innerHTML = renderSettings();
      toast(`${r.name} loaded`);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.pending) {
        openSheet('Load the sheet anyway?', 'You have changes that are not on D&D Beyond yet', `
          <div class="card" style="padding:.4rem .9rem">${e.data.pending.map((p) => `<div class="li"><span class="n"><b>${esc(p.label)}</b><br><span class="hint">${esc(p.text)}</span></span></div>`).join('')}</div>
          <p class="hint" style="margin:0">Loading replaces them with what D&amp;D Beyond has. Use End night first to send them.</p>
          <button type="button" class="btn danger" data-a="load-force" data-url="${esc(url)}">Load and lose these changes</button>
          <button type="button" class="btn" data-a="sheet-close">Cancel</button>`);
      } else toast(e.message, 'error');
    }
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.textContent = 'Load sheet from D&D Beyond';
    }
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'size') {
      const v = Number(e.target.value);
      $('#size-val').textContent = `${v}%`;
      document.documentElement.style.fontSize = `${(16 * v) / 100}px`;
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'size') act('settings/set', { size: Number(e.target.value) });
  });

  $('#drawer-scrim').addEventListener('click', closeTop);
  $('#sheet-scrim').addEventListener('click', closeTop);

  /* the handle: tap, or drag it in */
  (() => {
    const h = $('#handle');
    let start = null;
    h.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointerup', () => {
      start = null;
      openDrawer();
    });
    h.addEventListener('pointercancel', () => {
      start = null;
    });
    h.addEventListener('pointermove', (e) => {
      if (!start) return;
      const left = $('#app').dataset.side === 'left';
      const dx = left ? e.clientX - start.x : start.x - e.clientX;
      if (dx > 24) {
        start = null;
        openDrawer();
      }
    });
    // swipe the drawer back out
    const dr = $('#drawer');
    let s2 = null;
    dr.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, textarea')) return;
      s2 = { x: e.clientX, y: e.clientY };
    });
    dr.addEventListener('pointerup', (e) => {
      if (!s2) return;
      const left = dr.classList.contains('left');
      const dx = left ? s2.x - e.clientX : e.clientX - s2.x;
      const dy = Math.abs(e.clientY - s2.y);
      s2 = null;
      if (dx > 70 && dx > dy * 1.5) closeTop();
    });
  })();

  /* keep the screen on at the table */
  let lock = null;
  async function wakeLock() {
    try {
      if (!LS.get('wake', true)) {
        if (lock) await lock.release();
        lock = null;
        return;
      }
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !lock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => {
          lock = null;
        });
      }
    } catch (e) { /* not allowed right now */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      wakeLock();
      refresh();
    } else if (NOTE.dirty) saveNote();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (S) render();
  refresh();
  listen();
  wakeLock();
})();
