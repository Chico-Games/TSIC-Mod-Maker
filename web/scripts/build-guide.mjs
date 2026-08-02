// Renders docs/guide/*.md into a single self-contained page at
// public/guide/index.html, which Vite copies into dist/ — so the guide ships
// on the same GitHub Pages site as the editor, at /guide/.
//
// Runs from `prebuild` and `predev`, so the published guide can never drift
// from the markdown in the repo. The output is generated and gitignored.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../docs/guide');
const OUT_DIR = resolve(HERE, '../public/guide');
const OUT = join(OUT_DIR, 'index.html');
const REPO = 'https://github.com/Chico-Games/TSIC-Mod-Maker';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline: pull code spans out first so their contents are never re-parsed,
// then escape, then links / bold / italic, then put the code spans back.
function inline(s) {
  // Code spans are parked behind a NUL sentinel, which cannot occur in the
  // source markdown, so the placeholder can never collide with real text.
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => {
    const local = /^\d\d-|^README\.md/.test(href);
    // Chapter files become in-page sections; the index file is the "index"
    // section, not a section literally called README.
    const stem = href.split('#')[0].replace(/\.md$/, '');
    const target = local ? `#${stem === 'README' ? 'index' : stem}` : href;
    const ext = local ? '' : ' target="_blank" rel="noopener"';
    return `<a href="${target}"${ext}>${t}</a>`;
  });
  // Bare <https://…> autolinks. The brackets are already escaped by esc().
  s = s.replace(
    /&lt;(https?:\/\/[^&\s]+)&gt;/g,
    (_, url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Images are written before links in the source, so undo the link rewrite
  // that already fired on the ![alt](src) form and emit a figure instead.
  s = s.replace(
    /!<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g,
    (_, src, alt) =>
      `<figure><img src="${src}" alt="${alt}" loading="lazy" /><figcaption>${alt}</figcaption></figure>`,
  );
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

function renderTable(rows) {
  // Split on unescaped pipes only. Cells in this guide carry things like
  // `Tile.MazeDirection.<Up\|UpDown\|All>`, where a bare split('|') would
  // shred the row into extra columns and leave stray backslashes behind.
  const cells = (r) =>
    r
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
  const tr = body
    .map((r) => `<tr>${head.map((_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Code highlighting. Runs on already-escaped text, in a single pass per
// pattern set so a match can't be re-tokenised by a later rule.
// ---------------------------------------------------------------------------

const JSON_TOKENS =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|([{}[\],:])/g;

function highlightJson(escaped) {
  return escaped.replace(JSON_TOKENS, (m, key, colon, str, lit, num, punct) => {
    if (key) return `<span class="t-key">${key}</span><span class="t-punct">${colon}</span>`;
    if (str) return `<span class="t-str">${str}</span>`;
    if (lit) return `<span class="t-lit">${lit}</span>`;
    if (num) return `<span class="t-num">${num}</span>`;
    if (punct) return `<span class="t-punct">${punct}</span>`;
    return m;
  });
}

/** Trees, paths and log lines: quoted strings, and the trailing annotation
 *  after an arrow, are the only things worth colouring. Box-drawing characters
 *  are left exactly as authored. */
function highlightPlain(escaped) {
  return escaped
    .split('\n')
    .map((line) => {
      const arrow = line.search(/[←↓]/);
      const head = arrow === -1 ? line : line.slice(0, arrow);
      const tail = arrow === -1 ? '' : line.slice(arrow);
      const lit = head
        .replace(/'([^']*)'/g, `<span class="t-str">'$1'</span>`)
        .replace(/(\b[\w.-]+\.(?:json|glb|obj|fbx|png|wav|ogg|zip))\b/g, '<span class="t-key">$1</span>');
      return lit + (tail ? `<span class="t-comment">${tail}</span>` : '');
    })
    .join('\n');
}

function renderCode(lang, raw) {
  const escaped = esc(raw);
  const body = lang === 'json' ? highlightJson(escaped) : highlightPlain(escaped);
  return `<pre class="scroll${lang ? ` lang-${lang}` : ''}"><code>${body}</code></pre>`;
}

// ---------------------------------------------------------------------------
// UI mockups.
//
// Fenced blocks tagged ui-header / ui-panes / ui-rail / ui-tiers / ui-legend
// render as the editor's own chrome, using the app's real tokens from
// src/styles.css. They stay plain readable text in a code fence on GitHub,
// which is what the markdown has to degrade to.
//
// The mockups keep the app's dark palette in both page themes on purpose: it
// is a picture of a dark application, not page furniture.
// ---------------------------------------------------------------------------

/** "*Active thing :: subtitle" -> { label, sub, active } */
function uiEntry(raw) {
  let s = raw.trim();
  const active = s.startsWith('*');
  if (active) s = s.slice(1).trim();
  const [label, sub] = s.split('::').map((p) => p.trim());
  return { label, sub: sub ?? '', active };
}

const uiSplit = (s) => s.split('|').map((p) => p.trim()).filter(Boolean);

/** Reads a  or  line. Both separators are in use
 *  across the blocks below, so accept either rather than failing silently. */
/** Reads a `key: value` or `key :: value` line. Both separators are in use
 *  across the blocks below, so accept either rather than failing silently
 *  into an empty mockup. */
function kv(lines, key) {
  const re = new RegExp(String.raw`^\s*${key}\s*::?\s*`);
  const line = lines.find((l) => re.test(l));
  return line ? line.replace(re, '').trim() : '';
}

function renderUiBlock(kind, bodyText) {
  const lines = bodyText.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());

  if (kind === 'ui-header') {
    const get = (k) => kv(lines, k);
    const activeTab = get('active');
    const tabs = uiSplit(get('tabs'))
      .map((t) => `<span class="ui-tab${t === activeTab ? ' on' : ''}">${esc(t)}</span>`)
      .join('');
    const info = get('info');
    const buttons = uiSplit(get('buttons'))
      .map((b) => `<span class="ui-btn">${esc(b)}</span>`)
      .join('');
    return `<div class="uiframe"><div class="ui-headerbar">
      <div class="ui-tabs">${tabs}</div>
      ${info ? `<span class="ui-info">${esc(info)}</span>` : ''}
      <span class="ui-grow"></span>
      <div class="ui-btns">${buttons}</div>
    </div></div>`;
  }

  if (kind === 'ui-panes') {
    const panes = uiSplit(lines.join(' | ')).map(uiEntry);
    const cells = panes
      .map(
        (p) => `<div class="ui-pane${p.active ? ' wide' : ''}">
          <div class="ui-pane-title">${esc(p.label)}</div>
          ${p.sub ? `<div class="ui-pane-sub">${esc(p.sub)}</div>` : ''}
        </div>`,
      )
      .join('');
    return `<div class="uiframe"><div class="ui-panes">${cells}</div></div>`;
  }

  if (kind === 'ui-rail') {
    const items = lines
      .map(uiEntry)
      .map(
        (it) => `<div class="ui-railitem${it.active ? ' on' : ''}">
          <span>${esc(it.label)}</span>${it.sub ? `<span class="ui-count">${esc(it.sub)}</span>` : ''}
        </div>`,
      )
      .join('');
    return `<div class="uiframe"><div class="ui-rail">${items}</div></div>`;
  }

  if (kind === 'ui-tiers') {
    const rows = lines
      .map((l) => {
        const [name, pills] = l.split('::');
        const chips = uiSplit(pills ?? '')
          .map((p) => {
            const on = p.startsWith('*');
            const t = on ? p.slice(1) : p;
            return `<span class="ui-pill${on ? ' on' : ''}">${esc(t)}</span>`;
          })
          .join('');
        return `<div class="ui-family">
          <span class="ui-family-name">${esc((name ?? '').trim())}</span>
          <span class="ui-plus">＋</span>
          <span class="ui-pills">${chips}</span>
        </div>`;
      })
      .join('');
    return `<div class="uiframe"><div class="ui-rail">${rows}</div></div>`;
  }

  if (kind === 'ui-fields') {
    const rows = lines
      .map((l) => {
        const [name, type, value] = l.split('::').map((p) => (p ?? '').trim());
        const dirty = name.startsWith('*');
        const label = dirty ? name.slice(1).trim() : name;
        let control;
        if (type === 'bool') {
          control = `<span class="ui-toggle${value === 'on' ? ' on' : ''}"><i></i></span>`;
        } else if (type === 'tag') {
          control = `<span class="ui-tagchip">${esc(value)}</span>`;
        } else if (type === 'ref') {
          control = `<span class="ui-slot">${esc(value)}<span class="ui-slotcaret">▾</span></span>`;
        } else if (type === 'enum') {
          control = `<span class="ui-select">${esc(value)}<span class="ui-slotcaret">▾</span></span>`;
        } else {
          control = `<span class="ui-input ui-${type}">${esc(value)}</span>`;
        }
        return `<div class="ui-field${dirty ? ' dirty' : ''}">
          <span class="ui-flabel">${esc(label)}</span>
          ${control}
        </div>`;
      })
      .join('');
    return `<div class="uiframe"><div class="ui-fields">${rows}</div></div>`;
  }

  if (kind === 'ui-issues') {
    const rows = lines
      .map((l) => {
        const [sev, cat, detail] = l.split('::').map((p) => (p ?? '').trim());
        return `<div class="ui-issue ${sev}">
          <span class="ui-sev"></span>
          <span class="ui-cat">${esc(cat)}</span>
          <span class="ui-detail">${esc(detail)}</span>
          <span class="ui-open">Open</span>
        </div>`;
      })
      .join('');
    return `<div class="uiframe"><div class="ui-issues">${rows}</div></div>`;
  }

  if (kind === 'ui-recipe') {
    const get = (k) => kv(lines, k);
    const slot = (s) => {
      const m = s.match(/^(.*?)\s*×\s*(\d+)$/);
      return `<span class="ui-ingredient">${esc(m ? m[1] : s)}${
        m ? `<span class="ui-qty">×${m[2]}</span>` : ''
      }</span>`;
    };
    const ins = uiSplit(get('in')).map(slot).join('');
    const outs = uiSplit(get('out')).map(slot).join('');
    return `<div class="uiframe"><div class="ui-recipe">
      <div class="ui-recipe-head">${esc(get('title'))}</div>
      <div class="ui-recipe-body">
        <div class="ui-recipe-side"><span class="ui-slotlabel">input</span>${ins}</div>
        <div class="ui-arrow">→</div>
        <div class="ui-recipe-side"><span class="ui-slotlabel">output</span>${outs}</div>
      </div>
      ${get('meta') ? `<div class="ui-recipe-meta">${esc(get('meta'))}</div>` : ''}
    </div></div>`;
  }

  if (kind === 'ui-legend') {
    const rows = lines
      .map((l) => {
        const m = l.match(/^(\S+)\s+(.*)$/);
        if (!m) return '';
        const [, colour, rest] = m;
        const [label, desc] = rest.split('::').map((p) => p.trim());
        const style = colour.startsWith('#')
          ? `background:${colour}`
          : `background:transparent;border:1px dashed ${colour.replace(/^outline-/, '')}`;
        return `<div class="ui-legrow">
          <span class="ui-swatch" style="${style}"></span>
          <span class="ui-legname">${esc(label)}</span>
          <span class="ui-legdesc">${esc(desc ?? '')}</span>
        </div>`;
      })
      .join('');
    return `<div class="uiframe"><div class="ui-legend">${rows}</div></div>`;
  }

  return '';
}

const UI_KINDS = new Set([
  'ui-header', 'ui-panes', 'ui-rail', 'ui-tiers', 'ui-legend',
  'ui-fields', 'ui-issues', 'ui-recipe',
]);

function md(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Prev/next nav lines — the chapter rail replaces them.
    if (/^←|^Next: \[/.test(line)) { i++; continue; }

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(
        UI_KINDS.has(lang) ? renderUiBlock(lang, buf.join('\n')) : renderCode(lang, buf.join('\n')),
      );
      continue;
    }

    if (/^\|/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\|/.test(lines[i])) buf.push(lines[i++]);
      out.push(buf.length > 2 ? renderTable(buf) : '');
      continue;
    }

    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      const first = buf.find((b) => b.trim()) || '';
      const kind = /gotcha|nasty|trap|never|do not|check this one/i.test(first) ? 'warn'
        : /honest|limitation|bug/i.test(first) ? 'note'
        : 'why';
      out.push(`<blockquote class="${kind}">${md(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      let txt = line.replace(/^#+\s/, '');
      if (level === 1) txt = txt.replace(/^\d+\.\s*/, ''); // the rail already shows the number
      const num = level > 1 && /^\d+\.\d/.test(txt) ? txt.match(/^[\d.]+/)[0] : null;
      if (num) txt = txt.slice(num.length).trim();
      // Match GitHub's heading-anchor rule so a link written against the
      // markdown on GitHub also resolves here: apostrophes are dropped, not
      // turned into separators ("doesn't" -> "doesnt", never "doesn-t").
      const id = txt
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const badge = num ? `<span class="secnum">${num}</span>` : '';
      out.push(`<h${level} id="${id}">${badge}<span>${inline(txt)}</span></h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr />'); i++; continue; }

    // A line that is only an image becomes a full-width figure, not a
    // paragraph — <figure> inside <p> is invalid and would inherit prose width.
    const shot = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (shot) {
      const [, alt, src] = shot;
      out.push(
        `<figure><img src="${src}" alt="${esc(alt)}" loading="lazy" />` +
          (alt ? `<figcaption>${inline(alt)}</figcaption>` : '') +
          `</figure>`,
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (/^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const li = items.map((t) => `<li>${inline(t)}</li>`).join('');
      out.push(ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|\||>|```|\s*[-*]\s|\s*\d+\.\s|-{3,})/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const files = readdirSync(SRC).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
if (files.length === 0) throw new Error(`no chapters found in ${SRC}`);
const index = readFileSync(join(SRC, 'README.md'), 'utf8');

const chapters = files.map((f) => {
  const raw = readFileSync(join(SRC, f), 'utf8');
  const title = raw.match(/^#\s+\d+\.\s*(.+)$/m)?.[1] ?? f;
  const html = md(raw);
  // Harvest the rendered h2s for the right-hand "on this page" list, so the
  // anchors are guaranteed to match the ones the body actually emitted.
  const sections = [...html.matchAll(/<h2 id="([^"]+)">(?:<span class="secnum">([^<]*)<\/span>)?<span>(.*?)<\/span><\/h2>/g)]
    .map((m) => ({ id: m[1], num: m[2] ?? '', text: m[3].replace(/<[^>]+>/g, '') }));
  return { id: f.replace(/\.md$/, ''), num: f.slice(0, 2).replace(/^0/, ''), title, html, sections };
});

// The quick start is chapter "0" — numbered separately so the rail and the
// "Chapter N of M" counter don't claim there are fifteen chapters.
const numbered = chapters.filter((c) => c.num !== '0').length;

const rail = [
  `<a class="rail-item" href="#index"><span class="rail-num">—</span><span>Index</span></a>`,
  ...chapters.map(
    (c) => `<a class="rail-item" href="#${c.id}"><span class="rail-num">${
      c.num === '0' ? '★' : c.num
    }</span><span>${esc(c.title)}</span></a>`,
  ),
].join('\n');

const body = [
  `<section class="chapter" id="index"><div class="eyebrow">The TSIC Modding Guide</div>${md(index)}</section>`,
  ...chapters.map(
    (c) => `<section class="chapter" id="${c.id}">
      <div class="eyebrow"><span class="chnum${c.num === '0' ? ' qs' : ''}">${
        c.num === '0' ? '★' : c.num
      }</span> ${c.num === '0' ? 'Start here' : `Chapter ${c.num} of ${numbered}`}</div>
      ${c.html}
    </section>`,
  ),
].join('\n');

const toc = chapters
  .map(
    (c) => `<ul data-chapter="${c.id}">${c.sections
      .map(
        (s) => `<li><a href="#${s.id}">${s.num ? `<span class="tocnum">${s.num}</span>` : ''}${s.text}</a></li>`,
      )
      .join('')}</ul>`,
  )
  .join('\n');

const words = chapters.reduce((n, c) => n + c.html.split(/\s+/).length, 0);

mkdirSync(OUT_DIR, { recursive: true });

// Screenshots live beside the markdown so `![](images/x.jpg)` resolves both on
// GitHub and on the published page. Copy them next to the generated HTML.
const IMG_SRC = resolve(SRC, 'images');
if (existsSync(IMG_SRC)) {
  const imgOut = join(OUT_DIR, 'images');
  mkdirSync(imgOut, { recursive: true });
  const shots = readdirSync(IMG_SRC).filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
  for (const f of shots) copyFileSync(join(IMG_SRC, f), join(imgOut, f));
  console.log(`[guide] ${shots.length} screenshots copied`);
}
writeFileSync(OUT, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The TSIC Modding Guide</title>
<meta name="description" content="A practical guide to authoring TSIC content with the Definition Editor — from your first edit to a published mod, including how to lay out the world." />
<style>
:root{
  --ground:#f7f8fa; --raise:#ffffff; --ink:#181c23; --ink-soft:#5b6472; --line:#dfe3ea;
  --accent:#2f62d8; --accent-soft:#e8eefc;
  --loot:#b8820c; --enemy:#c8443c; --bounds:#c26414;
  --code-bg:#eef1f6;
  --t-key:#1f5fbf; --t-str:#197d55; --t-num:#8a5a00; --t-lit:#8b3ea8;
  --t-punct:#7a8493; --t-comment:#6b7480;
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#14171c; --raise:#1a1e25; --ink:#e2e6ec; --ink-soft:#98a2b1; --line:#2a3038;
    --accent:#6d9bff; --accent-soft:#1d2738;
    --loot:#ffcc44; --enemy:#ff6b63; --bounds:#ff9933;
    --code-bg:#20252d;
    --t-key:#7fb0ff; --t-str:#4fd6a0; --t-num:#ffcc72; --t-lit:#d79bff;
    --t-punct:#7d8794; --t-comment:#7d8794;
  }
}
:root[data-theme="dark"]{
  --ground:#14171c; --raise:#1a1e25; --ink:#e2e6ec; --ink-soft:#98a2b1; --line:#2a3038;
  --accent:#6d9bff; --accent-soft:#1d2738;
  --loot:#ffcc44; --enemy:#ff6b63; --bounds:#ff9933;
  --code-bg:#20252d;
  --t-key:#7fb0ff; --t-str:#4fd6a0; --t-num:#ffcc72; --t-lit:#d79bff;
  --t-punct:#7d8794; --t-comment:#7d8794;
}
:root[data-theme="light"]{
  --ground:#f7f8fa; --raise:#ffffff; --ink:#181c23; --ink-soft:#5b6472; --line:#dfe3ea;
  --accent:#2f62d8; --accent-soft:#e8eefc;
  --loot:#b8820c; --enemy:#c8443c; --bounds:#c26414;
  --code-bg:#eef1f6;
  --t-key:#1f5fbf; --t-str:#197d55; --t-num:#8a5a00; --t-lit:#8b3ea8;
  --t-punct:#7a8493; --t-comment:#6b7480;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:16.5px; line-height:1.62;
}
.mono,code,pre,.rail-num,.eyebrow,.secnum,.chnum,th,.backlink{
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
.wrap{display:grid; grid-template-columns:280px minmax(0,1fr) 240px; align-items:start;}
.rail{
  position:sticky; top:0; height:100vh; overflow-y:auto; padding:26px 14px 40px 26px;
  border-right:1px solid var(--line); background:var(--raise);
}
/* Right-hand "on this page" — only the active chapter's sections are shown. */
.toc{
  position:sticky; top:0; height:100vh; overflow-y:auto;
  padding:30px 24px 40px 14px; font-size:12.5px;
}
.toc-label{
  font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-soft);
  margin-bottom:10px;
}
.toc ul{list-style:none; margin:0; padding:0; display:none;}
.toc ul.active{display:block;}
.toc li{margin:0 0 2px;}
.toc a{
  display:block; padding:4px 8px; border-radius:4px; text-decoration:none;
  color:var(--ink-soft); border-left:2px solid transparent; line-height:1.35;
}
.toc a:hover{color:var(--ink); background:var(--accent-soft);}
.toc .tocnum{color:var(--accent); font-size:11px; margin-right:6px;}
.rail h1{font-size:15px; line-height:1.3; margin:0 0 4px; letter-spacing:-.01em;}
.rail .sub{font-size:12px; color:var(--ink-soft); margin:0 0 14px;}
.backlink{
  display:inline-block; font-size:11.5px; letter-spacing:.04em; text-decoration:none;
  color:var(--accent); border:1px solid var(--line); border-radius:4px;
  padding:5px 9px; margin:0 0 18px;
}
.backlink:hover{background:var(--accent-soft);}
.rail-item{
  display:grid; grid-template-columns:26px 1fr; gap:8px; align-items:baseline;
  padding:6px 8px; border-radius:4px; text-decoration:none; color:var(--ink-soft);
  font-size:13.5px; line-height:1.35;
}
.rail-item:hover{background:var(--accent-soft); color:var(--ink);}
.rail-item.active{background:var(--accent-soft); color:var(--ink); font-weight:600;}
.rail-num{font-size:11px; color:var(--accent); font-variant-numeric:tabular-nums;}
.rail-foot{margin-top:20px; padding-top:14px; border-top:1px solid var(--line); font-size:12px;}
.rail-foot a{color:var(--ink-soft);}
main{padding:0 48px 140px; max-width:1180px; margin:0 auto;}
/* Content grid. Everything shares ONE left edge; prose stops at a readable
   measure and the wide, dense things in this guide — tables, code, UI mockups
   — keep going to the right. Centring the prose instead would give the page
   two different left margins, which reads as "some text is narrower". */
.chapter{
  display:grid; padding-top:60px;
  grid-template-columns:
    [text-start] minmax(0,76ch) [text-end]
    minmax(0,1fr) [full-end];
}
.chapter > *{grid-column:text;}
.chapter > .scroll,
.chapter > pre,
.chapter > figure,
.chapter > .uiframe{grid-column:text-start / full-end;}
figure{margin:0 0 24px;}
figure img{
  display:block; width:100%; height:auto; border-radius:6px;
  border:1px solid var(--line);
}
figcaption{
  margin-top:8px; font-size:12.5px; color:var(--ink-soft); line-height:1.5;
  max-width:76ch;
}
.chapter + .chapter{border-top:1px solid var(--line); margin-top:60px;}
.eyebrow{
  font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-soft);
  display:flex; align-items:center; gap:10px; margin-bottom:10px;
}
.chnum.qs{background:var(--loot); color:#1a1400;}
.chnum{
  display:inline-grid; place-items:center; width:26px; height:26px; border-radius:3px;
  background:var(--accent); color:#fff; font-size:12px; letter-spacing:0;
}
h1{font-size:clamp(28px,3.4vw,38px); line-height:1.12; letter-spacing:-.025em; margin:0 0 22px; text-wrap:balance;}
h2{font-size:22px; letter-spacing:-.015em; margin:44px 0 12px; text-wrap:balance; display:flex; gap:10px; align-items:baseline;}
h3{font-size:16.5px; margin:30px 0 8px; text-wrap:balance; display:flex; gap:9px; align-items:baseline;}
h4{font-size:14px; margin:22px 0 6px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.07em;}
.secnum{font-size:12px; color:var(--accent); font-variant-numeric:tabular-nums;}
p{margin:0 0 14px;}
ul,ol{margin:0 0 16px; padding-left:22px;}
li{margin:0 0 6px;}
li::marker{color:var(--ink-soft);}
a{color:var(--accent); text-decoration-thickness:1px; text-underline-offset:2px;}
hr{border:0; border-top:1px solid var(--line); margin:32px 0;}
code{background:var(--code-bg); padding:.1em .35em; border-radius:3px; font-size:.87em;}
pre{
  background:var(--code-bg); padding:14px 16px; border-radius:5px; margin:0 0 18px;
  border-left:2px solid var(--line); font-size:13px; line-height:1.55;
}
pre code{background:none; padding:0; font-size:inherit;}
.t-key{color:var(--t-key);}
.t-str{color:var(--t-str);}
.t-num{color:var(--t-num);}
.t-lit{color:var(--t-lit);}
.t-punct{color:var(--t-punct);}
.t-comment{color:var(--t-comment); font-style:italic;}
.scroll{overflow-x:auto; max-width:100%;}

/* ---- Editor mockups -------------------------------------------------------
   These use the app's own tokens (web/src/styles.css) and stay dark in both
   page themes — they are pictures of a dark application. */
.uiframe{
  --app-bg:#0e1116; --app-panel:#161b22; --app-panel-2:#1d242d; --app-border:#2a313c;
  --app-text:#d6deeb; --app-muted:#8a96a8; --app-accent:#5fb3ff; --app-warn:#f0b35e;
  background:var(--app-bg); border:1px solid var(--app-border); border-radius:7px;
  margin:0 0 22px; overflow:hidden; color:var(--app-text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:13px; line-height:1.4;
}
.ui-headerbar{
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:8px 12px; background:var(--app-panel); border-bottom:1px solid var(--app-border);
}
.ui-tabs{display:flex; gap:4px; flex-wrap:wrap;}
.ui-tab{
  padding:5px 11px; border-radius:6px; border:1px solid transparent;
  color:var(--app-muted); font-size:12.5px; white-space:nowrap;
}
.ui-tab.on{background:var(--app-panel-2); color:var(--app-text); border-color:var(--app-border);}
.ui-info{color:var(--app-muted); font-size:11.5px; white-space:nowrap;}
.ui-grow{flex:1;}
.ui-btns{display:flex; gap:6px; flex-wrap:wrap;}
.ui-btn{
  background:var(--app-panel-2); border:1px solid var(--app-border); color:var(--app-text);
  padding:5px 10px; border-radius:6px; font-size:12px; white-space:nowrap;
}
.ui-panes{display:flex; gap:1px; background:var(--app-border); min-height:120px;}
.ui-pane{
  flex:1; background:var(--app-panel); padding:12px 14px;
  display:flex; flex-direction:column; gap:5px;
}
.ui-pane.wide{flex:2.2; background:var(--app-bg);}
.ui-pane-title{font-size:12px; letter-spacing:.05em; text-transform:uppercase; color:var(--app-accent);}
.ui-pane-sub{font-size:12px; color:var(--app-muted);}
.ui-rail{padding:8px; display:flex; flex-direction:column; gap:2px; background:var(--app-panel);}
.ui-railitem{
  display:flex; justify-content:space-between; gap:10px; align-items:center;
  padding:6px 10px; border-radius:5px; color:var(--app-muted); font-size:12.5px;
  border-left:3px solid transparent;
}
.ui-railitem.on{background:var(--app-panel-2); color:var(--app-text); border-left-color:var(--app-accent);}
.ui-count{font-size:11px; color:var(--app-muted); font-variant-numeric:tabular-nums;}
.ui-family{
  display:flex; align-items:center; gap:9px; padding:7px 10px;
  border-left:3px solid var(--app-accent); background:var(--app-panel-2); border-radius:5px;
}
.ui-family-name{flex:1; font-size:12.5px;}
.ui-plus{color:var(--app-muted); font-size:12px;}
.ui-pills{display:flex; gap:4px;}
.ui-pill{
  padding:2px 8px; border-radius:9px; font-size:11px; border:1px solid var(--app-border);
  color:var(--app-muted); background:var(--app-bg);
}
.ui-pill.on{border-color:var(--app-accent); color:var(--app-accent);}
/* Typed property editor */
.ui-fields{padding:10px 12px; display:flex; flex-direction:column;}
.ui-field{
  display:grid; grid-template-columns:210px 1fr; gap:14px; align-items:center;
  padding:7px 8px; border-bottom:1px solid var(--app-border);
}
.ui-field:last-child{border-bottom:0;}
.ui-field.dirty{border-left:2px solid var(--app-warn); padding-left:6px;}
.ui-flabel{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:12px; color:var(--app-muted);
}
.ui-input{
  background:var(--app-bg); border:1px solid var(--app-border); border-radius:4px;
  padding:4px 9px; font-size:12.5px; min-width:0;
}
.ui-input.ui-number{max-width:110px; text-align:right; font-variant-numeric:tabular-nums;}
.ui-select,.ui-slot{
  display:inline-flex; align-items:center; gap:8px;
  background:var(--app-bg); border:1px solid var(--app-border); border-radius:4px;
  padding:4px 9px; font-size:12.5px;
}
.ui-slot{color:var(--app-accent); font-family:ui-monospace,Menlo,Consolas,monospace;}
.ui-slotcaret{color:var(--app-muted); font-size:10px;}
.ui-tagchip{
  background:rgba(95,179,255,.12); border:1px solid rgba(95,179,255,.35);
  color:var(--app-accent); border-radius:10px; padding:2px 9px; font-size:11.5px;
  font-family:ui-monospace,Menlo,Consolas,monospace; justify-self:start;
}
.ui-toggle{
  width:34px; height:19px; border-radius:10px; background:var(--app-panel-2);
  border:1px solid var(--app-border); position:relative; display:inline-block; justify-self:start;
}
.ui-toggle i{
  position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:50%;
  background:var(--app-muted);
}
.ui-toggle.on{background:rgba(54,198,155,.25); border-color:#36c69b;}
.ui-toggle.on i{left:auto; right:2px; background:#36c69b;}

/* Validation rows */
.ui-issues{padding:8px; display:flex; flex-direction:column; gap:2px;}
.ui-issue{
  display:grid; grid-template-columns:8px 132px 1fr auto; gap:11px; align-items:center;
  padding:7px 10px; border-radius:5px; background:var(--app-panel); font-size:12.5px;
}
.ui-sev{width:8px; height:8px; border-radius:50%; background:var(--app-muted);}
.ui-issue.error .ui-sev{background:#ef6c6c;}
.ui-issue.warning .ui-sev{background:#f0b35e;}
.ui-cat{
  font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:var(--app-muted);
}
.ui-detail{color:var(--app-text); font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px;}
.ui-open{color:var(--app-accent); font-size:11.5px;}

/* Recipe card */
.ui-recipe{padding:0;}
.ui-recipe-head{
  padding:9px 14px; background:var(--app-panel); border-bottom:1px solid var(--app-border);
  font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; color:var(--app-accent);
}
.ui-recipe-body{display:flex; align-items:center; gap:16px; padding:14px; flex-wrap:wrap;}
.ui-recipe-side{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.ui-slotlabel{
  font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--app-muted);
}
.ui-ingredient{
  display:inline-flex; align-items:center; gap:7px;
  background:var(--app-panel-2); border:1px solid var(--app-border); border-radius:5px;
  padding:5px 10px; font-size:12px; font-family:ui-monospace,Menlo,Consolas,monospace;
}
.ui-qty{color:var(--app-warn); font-variant-numeric:tabular-nums;}
.ui-arrow{color:var(--app-muted); font-size:17px;}
.ui-recipe-meta{
  padding:8px 14px; border-top:1px solid var(--app-border); color:var(--app-muted); font-size:11.5px;
}

.ui-legend{padding:10px 12px; display:flex; flex-direction:column; gap:8px;}
.ui-legrow{display:grid; grid-template-columns:20px 132px 1fr; gap:11px; align-items:baseline; font-size:12.5px;}
.ui-swatch{width:16px; height:16px; border-radius:3px; display:inline-block; transform:translateY(2px);}
.ui-legname{color:var(--app-text);}
.ui-legdesc{color:var(--app-muted);}
@media (max-width:700px){
  .ui-panes{flex-direction:column;}
  .ui-legrow{grid-template-columns:20px 1fr; }
  .ui-legdesc{grid-column:2;}
}
table{border-collapse:collapse; width:100%; font-size:14px; margin:0 0 20px; min-width:min(100%,420px);}
th{
  text-align:left; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  color:var(--ink-soft); font-weight:500; padding:0 16px 8px 0; border-bottom:1px solid var(--line);
  white-space:nowrap;
}
td{padding:10px 16px 10px 0; border-bottom:1px solid var(--line); vertical-align:top;}
tbody tr:hover td{background:var(--accent-soft);}
tr:last-child td{border-bottom:0;}
/* First column of a table is nearly always the thing being named — an id, a
   property, a key. Keep it from wrapping mid-token where there's room. */
td:first-child{padding-left:2px;}
th:first-child{padding-left:2px;}
blockquote{
  margin:0 0 20px; padding:14px 18px; border-left:3px solid var(--accent);
  background:var(--raise); border-radius:0 4px 4px 0;
}
blockquote.warn{border-left-color:var(--enemy);}
blockquote.note{border-left-color:var(--bounds);}
blockquote p:last-child,blockquote ul:last-child{margin-bottom:0;}
blockquote h3{margin-top:0;}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:3px;}
html{scroll-behavior:smooth;}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto;}}
@media (max-width:1340px){
  .wrap{grid-template-columns:280px minmax(0,1fr);}
  .toc{display:none;}
}
@media (max-width:900px){
  .wrap{grid-template-columns:1fr;}
  .rail{position:static; height:auto; border-right:0; border-bottom:1px solid var(--line);}
  main{padding:0 20px 80px;}
  .chapter{display:block;}
}
</style>
</head>
<body>
<div class="wrap">
  <nav class="rail">
    <h1>The TSIC Modding Guide</h1>
    <p class="sub">${numbered} chapters + quick start &middot; ~${(words / 1000).toFixed(0)}k words</p>
    <a class="backlink" href="../">&larr; Definition Editor</a>
    ${rail}
    <div class="rail-foot"><a href="${REPO}/tree/main/docs/guide" target="_blank" rel="noopener">Source on GitHub &nearr;</a></div>
  </nav>
  <main>${body}</main>
  <aside class="toc">
    <div class="toc-label">On this page</div>
    ${toc}
  </aside>
</div>
<script>
  const items = [...document.querySelectorAll('.rail-item')];
  const map = new Map(items.map((a) => [a.getAttribute('href').slice(1), a]));
  const tocLists = [...document.querySelectorAll('.toc ul')];
  const tocMap = new Map(tocLists.map((u) => [u.dataset.chapter, u]));

  function setActive(id) {
    items.forEach((a) => a.classList.remove('active'));
    map.get(id)?.classList.add('active');
    tocLists.forEach((u) => u.classList.remove('active'));
    tocMap.get(id)?.classList.add('active');
  }

  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) setActive(e.target.id);
    }
  }, { rootMargin: '-10% 0px -80% 0px' });
  document.querySelectorAll('.chapter').forEach((s) => obs.observe(s));
  setActive(location.hash.slice(1) || 'index');
</script>
</body>
</html>
`);

console.log(`[guide] ${chapters.length} chapters, ~${words} words -> public/guide/index.html`);
