// Faster drop-in for makefun-site 1.0.0, written from the vendor README and the
// reference behaviour. Single-pass Markdown renderer, index-scanned front matter,
// compiled templates with a per-case include cache, and per-case slug caches.
// Dependency-free ES module. run(input) returns makefun-site's exact output tree.
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/;
const escapeHtml = (t) => {
  if (!ESC_RE.test(t)) return t;
  return t.replace(/[&<>"']/g, (c) => ESCAPES[c]);
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLUG_MAX = 64;
const isWS = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f' || c === '\u00a0' || c === '\u1680' || (c >= '\u2000' && c <= '\u200a') || c === '\u2028' || c === '\u2029' || c === '\u202f' || c === '\u205f' || c === '\u3000' || c === '\ufeff';

function slugify(ctx, text) {
  const hit = ctx.slug.get(text);
  if (hit !== undefined) return hit;
  const plain = /[^\x00-\x7F]/.test(text) ? text.normalize('NFKD').replace(/\p{M}/gu, '') : text;
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  let s = out.slice(0, SLUG_MAX);
  while (s.endsWith('-')) s = s.slice(0, -1);
  if (s === '') s = 'untitled';
  ctx.slug.set(text, s);
  return s;
}
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}
function longDate(ctx, date) {
  const hit = ctx.long.get(date);
  if (hit !== undefined) return hit;
  const p = date.split('-');
  const s = `${Number(p[2])} ${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
  ctx.long.set(date, s);
  return s;
}
const WS_TABLE = new Uint8Array(65536);
for (const c of [9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279]) WS_TABLE[c] = 1;
for (let c = 8192; c <= 8202; c++) WS_TABLE[c] = 1;
function wordsOf(text) {
  let n = 0, inWord = false;
  for (let i = 0; i < text.length; i++) {
    const w = WS_TABLE[text.charCodeAt(i)] === 1;
    if (!w && !inWord) { n++; inWord = true; }
    else if (w) inWord = false;
  }
  return n;
}
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// ---- front matter (index-scanned, body never split into lines) ----
const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}
function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n; i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}
function valueOf(key, raw) {
  switch (key) {
    case 'title': case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0, mo = m ? Number(m[2]) : 0, d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}
function parseFrontMatter(text) {
  const nl0 = text.indexOf('\n');
  const first = nl0 === -1 ? text : text.slice(0, nl0);
  if (first !== '---') return { error: 'no front matter' };
  // Scan only the front-matter lines for the closing ---.
  let pos = nl0 === -1 ? text.length : nl0 + 1;
  let closeLine = -1, closeEnd = -1, lineNo = 1;
  while (pos <= text.length) {
    const e = text.indexOf('\n', pos);
    const line = e === -1 ? text.slice(pos) : text.slice(pos, e);
    lineNo++;
    if (line === '---') { closeLine = lineNo; closeEnd = e === -1 ? text.length : e + 1; break; }
    if (e === -1) break;
    pos = e + 1;
    if (pos > text.length) break;
  }
  if (closeLine === -1) return { error: 'the front matter is not closed' };
  const data = {};
  pos = nl0 === -1 ? text.length : nl0 + 1;
  for (let i = 1; i < closeLine - 1; i++) {
    const e = text.indexOf('\n', pos);
    const line = e === -1 ? text.slice(pos) : text.slice(pos, e);
    pos = e === -1 ? text.length + 1 : e + 1;
    let blank = true;
    for (let k = 0; k < line.length; k++) if (line[k] !== ' ' && line[k] !== '\t') { blank = false; break; }
    if (blank || line.startsWith('#')) continue;
    // LINE: ([a-z_]+):(?: (.*))?$
    let k = 0;
    while (k < line.length && ((line[k] >= 'a' && line[k] <= 'z') || line[k] === '_')) k++;
    if (k === 0 || k >= line.length || line[k] !== ':') return { error: `line ${i + 1} is not "key: value"` };
    const key = line.slice(0, k);
    let raw;
    if (k + 1 === line.length) raw = '';
    else if (line[k + 1] === ' ') raw = line.slice(k + 2);
    else return { error: `line ${i + 1} is not "key: value"` };
    raw = raw.replace(/[ \t]+$/, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd >= text.length ? '' : text.slice(closeEnd) };
}

// ---- Markdown: single-pass line cursor, no line array, plain-run inline ----
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return line.slice(a, b);
}
function isBlank(line) {
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
}
function fenceLang(line) {
  if (!line.startsWith('```')) return null;
  let i = 3;
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-') i++;
    else break;
  }
  for (let j = i; j < line.length; j++) if (line[j] !== ' ' && line[j] !== '\t') return null;
  return line.slice(3, i);
}
function fenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let j = 3; j < line.length; j++) if (line[j] !== ' ' && line[j] !== '\t') return false;
  return true;
}
function headingOf(line) {
  let i = 0;
  while (i < 6 && line[i] === '#') i++;
  if (i === 0) return null;
  if (i >= line.length || (line[i] !== ' ' && line[i] !== '\t')) return null;
  const text = trimLine(line.slice(i));
  if (text === '') return null;
  return { depth: i, text };
}
function isHR(line) {
  if (line !== '---' && line !== '***') {
    if (!line.startsWith('---') && !line.startsWith('***')) return false;
    const base = line.slice(0, 3);
    if (base !== '---' && base !== '***') return false;
    for (let j = 3; j < line.length; j++) if (line[j] !== ' ' && line[j] !== '\t') return false;
    return true;
  }
  return true;
}
function bulletRest(line) {
  if ((line[0] === '-' || line[0] === '*') && line[1] === ' ') return line.slice(2);
  return null;
}
function orderedParse(line) {
  let i = 0;
  while (i < 9 && line[i] >= '0' && line[i] <= '9') i++;
  if (i === 0 || line[i] !== '.' || line[i + 1] !== ' ') return null;
  return { n: Number(line.slice(0, i)), rest: line.slice(i + 2) };
}
function isContinued(line) {
  return line[0] === ' ' && line[1] === ' ' && line.length > 2 && !isWS(line[2]);
}
function endsParagraph(line) {
  if (line === '') return true;
  const c = line.charCodeAt(0);
  if (c === 32 || c === 9) return isBlank(line);
  if (c === 96) return fenceLang(line) !== null;
  if (c === 35) return headingOf(line) !== null;
  if (c === 45 || c === 42) return isHR(line);
  return false;
}
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}
const SPECIAL_RE = /[\\`*\[]/;
const SPECIAL_G = /[\\`*\[]/g;
const ANY_RE = /[\\`*\[]|[&<>"']/;
function nextSpecial(s, i) {
  SPECIAL_G.lastIndex = i;
  const m = SPECIAL_G.exec(s);
  const j = m === null ? -1 : m.index;
  SPECIAL_G.lastIndex = 0;
  return j;
}
function inline(ctx, s, env) {
  if (s.search(ANY_RE) === -1) return s;
  if (!SPECIAL_RE.test(s)) return escapeHtml(s);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const m = nextSpecial(s, i);
    if (m === -1) { out.push(escapeHtml(s.slice(i))); break; }
    if (m > i) out.push(escapeHtml(s.slice(i, m)));
    i = m;
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) { out.push(escapeHtml(s[i + 1])); i += 2; continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { out.push(`<code>${escapeHtml(s.slice(i + 1, j))}</code>`); i = j + 1; }
      else { out.push('`'); i++; }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) { out.push(`<strong>${inline(ctx, s.slice(i + 2, j), env)}</strong>`); i = j + 2; }
        else { out.push('**'); i += 2; }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) { out.push(`<em>${inline(ctx, s.slice(i + 1, j), env)}</em>`); i = j + 1; }
      else { out.push('*'); i++; }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const mm = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 ? '' : s.slice(k + 2, mm);
      if (target !== '' && !/\s/.test(target)) {
        out.push(`<a href="${escapeHtml(env.link(target))}">${inline(ctx, s.slice(i + 1, k), env)}</a>`);
        i = mm + 1; continue;
      }
      out.push('['); i++; continue;
    }
    // A backslash before a non-escapable char, or any other special the search
    // found but this branch did not consume: emit it escaped and move on.
    out.push(escapeHtml(c)); i++;
  }
  return out.join('');
}
function renderMarkdown(ctx, src, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let p = 0;
  const L = src.length;
  let lineEnd = -2;
  const curLine = () => {
    if (p > L) return null;
    if (lineEnd === -2) lineEnd = src.indexOf('\n', p);
    return lineEnd === -1 ? src.slice(p) : src.slice(p, lineEnd);
  };
  const advance = () => {
    if (lineEnd === -2) lineEnd = src.indexOf('\n', p);
    p = lineEnd === -1 ? L + 1 : lineEnd + 1;
    lineEnd = -2;
  };
  while (p <= L) {
    const line = curLine();
    if (line === null) break;
    if (isBlank(line)) { advance(); continue; }
    const lang = line[0] === '`' ? fenceLang(line) : null;
    if (lang !== null) {
      advance();
      let code = '';
      while (p <= L) {
        const l2 = curLine();
        if (l2 === null) break;
        if (fenceClose(l2)) { advance(); break; }
        code += `${escapeHtml(l2)}\n`;
        advance();
      }
      blocks.push(`<pre><code${lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`}>${code}</code></pre>`);
      continue;
    }
    const heading = line[0] === '#' ? headingOf(line) : null;
    if (heading !== null) {
      const id = uniqueSlug(slugify(ctx, heading.text), ids);
      const html = inline(ctx, heading.text, env);
      blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      advance(); continue;
    }
    if ((line[0] === '-' || line[0] === '*') && isHR(line)) { blocks.push('<hr>'); advance(); continue; }
    if (line[0] === '>') {
      const body = [];
      while (p <= L) {
        const l2 = curLine();
        if (l2 === null || l2[0] !== '>') break;
        let t = l2.slice(1);
        if (t[0] === ' ') t = t.slice(1);
        t = trimLine(t);
        if (t !== '') body.push(t);
        advance();
      }
      blocks.push(body.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(ctx, body.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    const bRest = bulletRest(line);
    const oParse = bRest === null ? orderedParse(line) : null;
    if (bRest !== null || oParse !== null) {
      const isOrdered = oParse !== null;
      const items = [];
      while (p <= L) {
        const l2 = curLine();
        if (l2 === null) break;
        if (isOrdered) {
          const m = orderedParse(l2);
          if (m !== null) { items.push([trimLine(m.rest)]); advance(); continue; }
        } else {
          const m = bulletRest(l2);
          if (m !== null) { items.push([trimLine(m)]); advance(); continue; }
        }
        if (items.length > 0 && isContinued(l2)) { items[items.length - 1].push(trimLine(l2)); advance(); continue; }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && oParse.n !== 1 ? `<ol start="${oParse.n}">` : `<${tag}>`;
      blocks.push(`${open}\n${items.map((it) => `<li>${inline(ctx, it.length === 1 ? it[0] : it.join('\n'), env)}</li>\n`).join('')}</${tag}>`);
      continue;
    }
    const first = trimLine(line);
    advance();
    let body = null;
    while (p <= L) {
      const l2 = curLine();
      if (l2 === null || endsParagraph(l2)) break;
      if (body === null) body = [first];
      body.push(trimLine(l2));
      advance();
    }
    const html = body === null ? inline(ctx, first, env) : inline(ctx, body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  return { html: blocks.length === 0 ? '' : `${blocks.join('\n')}\n`, toc, excerpt: excerpt ?? '' };
}

// ---- Templates: parsed once per case, rendered to arrays, includes cached ----
class TemplateError extends Error {}
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node); stack.push(node); body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node); stack.push(node); body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = []; body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}
// First-name dependencies of a template (names bound by its own fors excluded;
// an include's deps are that template's own deps). Used only for the include cache.
function depsOf(ctx, name) {
  const done = ctx.deps.get(name);
  if (done !== undefined) return done;
  if (ctx.depBusy.has(name)) return new Set();
  ctx.depBusy.add(name);
  const deps = new Set();
  const walk = (nodes, bound) => {
    for (const n of nodes) {
      if (n.kind === 'var' || n.kind === 'raw') { if (!bound.has(n.path[0])) deps.add(n.path[0]); }
      else if (n.kind === 'if') {
        if (!bound.has(n.path[0])) deps.add(n.path[0]);
        walk(n.then, bound); if (n.else !== null) walk(n.else, bound);
      } else if (n.kind === 'for') {
        if (!bound.has(n.path[0])) deps.add(n.path[0]);
        const b2 = new Set(bound); b2.add(n.name); b2.add('loop');
        walk(n.body, b2);
      } else if (n.kind === 'include') {
        const sub = depsOf(ctx, n.name);
        for (const d of sub) deps.add(d);
      }
    }
  };
  const nodes = ctx.templates.get(name);
  if (nodes !== undefined) walk(nodes, new Set());
  ctx.depBusy.delete(name);
  ctx.deps.set(name, deps);
  return deps;
}
function lookup(scope, path) {
  for (let s = scope.length - 1; s >= 0; s--) {
    const vars = scope[s];
    if (!Object.hasOwn(vars, path[0])) continue;
    let v = vars[path[0]];
    for (let k = 1; k < path.length; k++) {
      if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
      v = v[path[k]];
    }
    return v;
  }
  return undefined;
}
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}
function objId(ctx, v) {
  let id = ctx.ids.get(v);
  if (id === undefined) { id = ++ctx.idn; ctx.ids.set(v, id); }
  return id;
}
function renderNodes(ctx, nodes, scope, depth, out) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': out.push(n.text); break;
      case 'var': {
        const v = textOf(lookup(scope, n.path));
        if (v.length < 64) {
          const h = ctx.esc.get(v);
          if (h !== undefined) { out.push(h); break; }
          const e = escapeHtml(v);
          ctx.esc.set(v, e);
          out.push(e);
        } else out.push(escapeHtml(v));
        break;
      }
      case 'raw': out.push(textOf(lookup(scope, n.path))); break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(ctx, branch, scope, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const vars = {};
        scope.push(vars);
        for (let k = 0; k < xs.length; k++) {
          vars[n.name] = xs[k];
          vars.loop = { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length };
          renderNodes(ctx, n.body, scope, depth, out);
        }
        scope.pop();
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t === undefined || depth >= 8) break;
        const deps = depsOf(ctx, n.name);
        let key = `${n.name}|${depth}|`;
        for (const d of deps) {
          const v = lookup(scope, [d]);
          key += v === undefined ? 'u;' : v === null ? 'n;' : typeof v === 'object' ? `o${objId(ctx, v)};` : `${typeof v}:${String(v)};`;
        }
        const hit = ctx.inc.get(key);
        if (hit !== undefined) { out.push(hit); break; }
        const sub = [];
        renderNodes(ctx, t, scope, depth + 1, sub);
        const s = sub.join('');
        ctx.inc.set(key, s);
        out.push(s);
        break;
      }
    }
  }
}

// ---- Build pipeline (same order and messages as the reference) ----
const RESERVED = ['posts', 'tags', 'page'];
function build(ctx, input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try { templates.set(name, parseTemplate(name, input.templates[name])); }
    catch (err) { if (!(err instanceof TemplateError)) throw err; report.push(err.message); }
  }
  ctx.templates = templates;
  const b = {
    input, base: input.site.base_url.replace(/\/+$/, ''),
    sources: [], statics: [], bySource: new Map(),
    broken: new Set(), report, posts: [], tags: [], cards: new Map(), output: {},
  };
  // 1. sources, sorted by path; .md sources with \n ends, others static.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }
  // 2. front matter and the refusal checks, in order.
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) { b.report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data = fm.data; s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) { b.report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { b.report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { b.report.push(`draft ${s.path}`); continue; }
    kept.push(s);
  }
  b.sources = kept;
  // 3. permalinks.
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(ctx, s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
  // 4. Markdown, links resolved.
  const staticPaths = new Set(b.statics.map((f) => f.path));
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const rpKey = `${dir}\n${rel}`;
        let path = ctx.rp.get(rpKey);
        if (path === undefined) { path = rel === '' ? null : resolvePath(dir, rel); ctx.rp.set(rpKey, path); }
        if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
        b.broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(ctx, s.body, env);
    s.html = md.html; s.toc = md.toc; s.excerpt = md.excerpt;
  }
  // 5. collections.
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => { p.newer = k === 0 ? null : posts[k - 1]; p.older = k === posts.length - 1 ? null : posts[k + 1]; });
  // 6. tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    return (s.data.tags ?? []).filter((name) => !seen.has(slugify(ctx, name)) && seen.add(slugify(ctx, name)));
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(ctx, name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(ctx, name)) ?? { name, slug: slugify(ctx, name), url: '', posts: [] });
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  // 7. layouts.
  const linkOf = (s) => {
    if (s === null) return null;
    let l = ctx.lk.get(s);
    if (l === undefined) { l = { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(ctx, s.data.date) }; ctx.lk.set(s, l); }
    return l;
  };
  const cardOf = (s) => {
    let rm = ctx.rm.get(s);
    if (rm === undefined) { rm = Math.max(1, Math.ceil(wordsOf(s.body) / 200)); ctx.rm.set(s, rm); }
    return {
      title: s.data.title, url: s.url, date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(ctx, s.data.date),
      summary: s.data.summary ?? '', excerpt: s.excerpt, reading_minutes: rm,
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
  };
  const pageOf = (s) => ({
    ...(s.post ? b.cards.get(s) : cardOf(s)), slug: s.slug, content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null), older: linkOf(s.older ?? null), is_post: s.post,
  });
  b.cards = new Map(b.posts.map((p) => [p, cardOf(p)]));
  const site = { title: input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, input.site.recent).map((p) => b.cards.get(p));
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderNodes(ctx, nodes, [{ site, tags: allTags, recent, ...vars }], 0, out);
    return out.join('');
  };
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const tagObj = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) };
    const html = render('tag', { tag: tagObj });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
  // 8. report.
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pageCount = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output['build-report.txt'] = `${lines.join('\n')}\n`;
  return b.output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  const ctx = {
    slug: new Map(), long: new Map(), rm: new WeakMap(), rp: new Map(), lk: new WeakMap(), esc: new Map(),
    inc: new Map(), ids: new WeakMap(), idn: 0,
    templates: new Map(), deps: new Map(), depBusy: new Set(),
  };
  return build(ctx, input);
}
