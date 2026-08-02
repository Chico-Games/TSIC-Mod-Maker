// Renders docs/guide/*.md into a single self-contained page at
// public/guide/index.html, which Vite copies into dist/ — so the guide ships
// on the same GitHub Pages site as the editor, at /guide/.
//
// Runs from `prebuild` and `predev`, so the published guide can never drift
// from the markdown in the repo. The output is generated and gitignored.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
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
    const target = local ? `#${href.split('#')[0].replace(/\.md$/, '')}` : href;
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
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

function renderTable(rows) {
  const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
  const tr = body
    .map((r) => `<tr>${head.map((_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function md(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Prev/next nav lines — the chapter rail replaces them.
    if (/^←|^Next: \[/.test(line)) { i++; continue; }

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="scroll"><code>${esc(buf.join('\n'))}</code></pre>`);
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
      const id = txt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const badge = num ? `<span class="secnum">${num}</span>` : '';
      out.push(`<h${level} id="${id}">${badge}<span>${inline(txt)}</span></h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr />'); i++; continue; }

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
  return { id: f.replace(/\.md$/, ''), num: f.slice(0, 2).replace(/^0/, ''), title, html: md(raw) };
});

const rail = [
  `<a class="rail-item" href="#index"><span class="rail-num">—</span><span>Index</span></a>`,
  ...chapters.map(
    (c) => `<a class="rail-item" href="#${c.id}"><span class="rail-num">${c.num}</span><span>${esc(c.title)}</span></a>`,
  ),
].join('\n');

const body = [
  `<section class="chapter" id="index"><div class="eyebrow">The TSIC Modding Guide</div>${md(index)}</section>`,
  ...chapters.map(
    (c) => `<section class="chapter" id="${c.id}">
      <div class="eyebrow"><span class="chnum">${c.num}</span> Chapter ${c.num} of ${chapters.length}</div>
      ${c.html}
    </section>`,
  ),
].join('\n');

const words = chapters.reduce((n, c) => n + c.html.split(/\s+/).length, 0);

mkdirSync(OUT_DIR, { recursive: true });
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
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#14171c; --raise:#1a1e25; --ink:#e2e6ec; --ink-soft:#98a2b1; --line:#2a3038;
    --accent:#6d9bff; --accent-soft:#1d2738;
    --loot:#ffcc44; --enemy:#ff6b63; --bounds:#ff9933;
    --code-bg:#20252d;
  }
}
:root[data-theme="dark"]{
  --ground:#14171c; --raise:#1a1e25; --ink:#e2e6ec; --ink-soft:#98a2b1; --line:#2a3038;
  --accent:#6d9bff; --accent-soft:#1d2738;
  --loot:#ffcc44; --enemy:#ff6b63; --bounds:#ff9933;
  --code-bg:#20252d;
}
:root[data-theme="light"]{
  --ground:#f7f8fa; --raise:#ffffff; --ink:#181c23; --ink-soft:#5b6472; --line:#dfe3ea;
  --accent:#2f62d8; --accent-soft:#e8eefc;
  --loot:#b8820c; --enemy:#c8443c; --bounds:#c26414;
  --code-bg:#eef1f6;
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
.wrap{display:grid; grid-template-columns:270px minmax(0,1fr); align-items:start;}
.rail{
  position:sticky; top:0; height:100vh; overflow-y:auto; padding:26px 14px 40px 22px;
  border-right:1px solid var(--line); background:var(--raise);
}
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
main{padding:0 40px 120px;}
.chapter{max-width:70ch; margin:0 auto; padding-top:56px;}
.chapter + .chapter{border-top:1px solid var(--line); margin-top:56px;}
.eyebrow{
  font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-soft);
  display:flex; align-items:center; gap:10px; margin-bottom:10px;
}
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
.scroll{overflow-x:auto; max-width:100%;}
table{border-collapse:collapse; width:100%; font-size:14px; margin:0 0 18px; min-width:min(100%,420px);}
th{
  text-align:left; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  color:var(--ink-soft); font-weight:500; padding:0 12px 7px 0; border-bottom:1px solid var(--line);
  white-space:nowrap;
}
td{padding:9px 12px 9px 0; border-bottom:1px solid var(--line); vertical-align:top;}
tr:last-child td{border-bottom:0;}
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
@media (max-width:860px){
  .wrap{grid-template-columns:1fr;}
  .rail{position:static; height:auto; border-right:0; border-bottom:1px solid var(--line);}
  main{padding:0 20px 80px;}
}
</style>
</head>
<body>
<div class="wrap">
  <nav class="rail">
    <h1>The TSIC Modding Guide</h1>
    <p class="sub">${chapters.length} chapters &middot; ~${(words / 1000).toFixed(0)}k words</p>
    <a class="backlink" href="../">&larr; Definition Editor</a>
    ${rail}
    <div class="rail-foot"><a href="${REPO}/tree/main/docs/guide" target="_blank" rel="noopener">Source on GitHub &nearr;</a></div>
  </nav>
  <main>${body}</main>
</div>
<script>
  const items = [...document.querySelectorAll('.rail-item')];
  const map = new Map(items.map((a) => [a.getAttribute('href').slice(1), a]));
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      items.forEach((a) => a.classList.remove('active'));
      map.get(e.target.id)?.classList.add('active');
    }
  }, { rootMargin: '-10% 0px -80% 0px' });
  document.querySelectorAll('.chapter').forEach((s) => obs.observe(s));
</script>
</body>
</html>
`);

console.log(`[guide] ${chapters.length} chapters, ~${words} words -> public/guide/index.html`);
