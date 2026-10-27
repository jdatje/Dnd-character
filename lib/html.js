'use strict';
/*
 * Small HTML helpers. D&D Beyond descriptions arrive as HTML with their own markup ([action]Attack[/action],
 * inline styles, tables). rich() keeps only safe formatting so the phone can show it; the notes the player writes
 * go through note() which keeps even less (plus the checklist attributes).
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const escText = (t) => t.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'head', 'title', 'caption', 'button', 'form']);

const RICH = {
  b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', p: 'p', div: 'p', br: 'br', ul: 'ul', ol: 'ol', li: 'li',
  h1: 'h4', h2: 'h4', h3: 'h4', h4: 'h4', h5: 'h4', h6: 'h4',
  table: 'table', thead: 'thead', tbody: 'tbody', tr: 'tr', td: 'td', th: 'th', blockquote: 'blockquote', hr: 'hr',
};
const NOTE = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', h1: 'h3', h2: 'h3', h3: 'h3', h4: 'h3', p: 'p', div: 'div', br: 'br', ul: 'ul', ol: 'ol', li: 'li' };
const VOID = new Set(['br', 'hr']);

function sanitize(html, keep, { attrs = () => '', max = 200_000 } = {}) {
  const src = String(html ?? '').slice(0, max).replace(/<!--[\s\S]*?(-->|$)/g, '');
  const out = [];
  const open = [];
  let skip = null;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const between = src.slice(last, m.index);
    last = re.lastIndex;
    if (!skip && between) out.push(escText(between));
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (skip) {
      if (closing && name === skip) skip = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(m[3])) skip = name;
      continue;
    }
    const tag = keep[name];
    if (!tag) continue;
    if (VOID.has(tag)) {
      if (!closing) out.push(`<${tag}>`);
      continue;
    }
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    out.push(`<${tag}${attrs(tag, m[3])}>`);
    open.push(tag);
  }
  if (!skip) out.push(escText(src.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** D&D Beyond's own tags like [action]Attack[/action] or [spell]Shield[/spell] become plain words. */
function ddbTags(s) {
  return String(s ?? '')
    .replace(/\[([a-z]+)\]([^[\]]*?)(?:;[^[\]]*)?\[\/\1\]/gi, '$2')
    .replace(/\{\{[^}]*\}\}/g, (all) => (/proficiency/.test(all) ? 'your proficiency bonus' : ''));
}

/** Safe, readable HTML for a description from D&D Beyond. */
function rich(html) {
  return sanitize(ddbTags(html), RICH)
    .replace(/(<p>\s*<\/p>)+/g, '')
    .replace(/^\s+|\s+$/g, '');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', times: '×', minus: '−' };
function decode(t) {
  return String(t ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

/** Plain one-line text, for snippets. */
function plain(html, max = 400) {
  const t = decode(ddbTags(String(html ?? '')).replace(/<(br|\/p|\/li|\/tr|\/h\d)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A note the player writes: formatting, lists and checklists only. */
function note(html) {
  return sanitize(html, NOTE, {
    max: 200_000,
    attrs: (tag, a) => {
      if (tag === 'ul' && /\bclass\s*=\s*["']?[^"'>]*\bchk\b/i.test(a)) return ' class="chk"';
      if (tag === 'li' && /\bdata-done\s*=\s*["']?1/i.test(a)) return ' data-done="1"';
      return '';
    },
  }).slice(0, 100_000);
}

module.exports = { esc, rich, plain, note, decode, ddbTags };
