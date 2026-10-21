// Renders social preview images and app icons into public/ before every build:
//   public/og/home.png          1200×630, the landing page
//   public/og/wiki.png          1200×630, the wiki index
//   public/og/wiki/<slug>.png   1200×630, one per wiki page (title from its frontmatter)
//   public/icons/*.png          apple-touch-icon and manifest icons, from favicon.svg
// Generated files are gitignored; `npm run build` runs this first.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { DOTS, DOT_VIEW } from '../src/data/dots.ts';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const require = createRequire(import.meta.url);
const font = (pkg, file) => readFileSync(require.resolve(`${pkg}/files/${file}`));

const W = 1200, H = 630, PAD = 72;
const C = { bg: '#f2efe7', fg: '#121210', dim: 'rgba(18,18,16,0.6)', acc: '#d4ff3a', dot: 'rgba(18,18,16,0.2)' };

// "Ș"/"ț" live only in the latin-ext subset. Satori falls back per glyph across families,
// not within one, so each subset gets its own name and styles list both.
const fonts = [
  { name: 'Display', data: font('@fontsource/big-shoulders-display', 'big-shoulders-display-latin-900-normal.woff'), weight: 900 },
  { name: 'DisplayExt', data: font('@fontsource/big-shoulders-display', 'big-shoulders-display-latin-ext-900-normal.woff'), weight: 900 },
  { name: 'Mono', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff'), weight: 500 },
  { name: 'MonoExt', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-ext-500-normal.woff'), weight: 500 },
];
const DISPLAY = 'Display, DisplayExt', MONO = 'Mono, MonoExt';

// Minimal element helper, so no JSX/React is needed.
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', boxSizing: 'border-box', ...style }, children: children.flat() } });
const hl = (text) => h('span', { background: C.acc, padding: '0 0.06em', marginLeft: '-0.06em' }, text);

const logo = (size = 34) =>
  h('div', { fontFamily: DISPLAY, fontWeight: 900, fontSize: size, color: C.fg, letterSpacing: '0.02em' }, 'partidul', hl('.ai'));

/** Romania's dots as SVG circles, placed at (x, y) with the given width. Satori draws text; the map is injected after. */
function mapSvg(x, y, width, color = C.dot) {
  const s = width / DOT_VIEW.width, r = (DOT_VIEW.step * 0.27).toFixed(2);
  let circles = '';
  for (let i = 0; i < DOTS.length; i += 3) circles += `<circle cx="${DOTS[i].toFixed(1)}" cy="${DOTS[i + 1].toFixed(1)}" r="${r}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(4)})" fill="${color}">${circles}</g>`;
}

async function render(tree, map, out) {
  let svg = await satori(tree, { width: W, height: H, fonts });
  // Background first, then the map, then satori's text on top.
  svg = svg.replace(/^(<svg[^>]*>)/, `$1<rect width="${W}" height="${H}" fill="${C.bg}"/>${map}`);
  writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

// Landing page: the headline bottom-left, Romania top-right, like the site.
const home = h(
  'div',
  { width: W, height: H, padding: PAD, flexDirection: 'column', justifyContent: 'space-between' },
  logo(),
  h(
    'div',
    { flexDirection: 'column', fontFamily: DISPLAY, fontWeight: 900, fontSize: 104, lineHeight: 0.88, color: C.fg, textTransform: 'uppercase' },
    h('div', {}, 'Spune ce merge.'),
    h('div', {}, hl('Și ce nu.')),
  ),
);

// Wiki: label, title (wraps up to three lines), small map bottom-right.
// title: a string, or [text, hl(text)] parts. lineHeight 1.24 so the deep comma under Ș/Ț clears the next line.
const wikiCard = (title, label, text = [title].flat().map((t) => (typeof t === 'string' ? t : t.props.children.join(''))).join('')) =>
  h(
    'div',
    { width: W, height: H, padding: PAD, flexDirection: 'column', justifyContent: 'space-between' },
    h('div', { alignItems: 'baseline', gap: 24 }, logo(), h('div', { fontFamily: MONO, fontSize: 20, letterSpacing: '0.18em', color: C.dim, textTransform: 'uppercase' }, label)),
    h(
      'div',
      { maxWidth: 900, flexWrap: 'wrap', fontFamily: DISPLAY, fontWeight: 900, fontSize: text.length > 34 ? 84 : 104, lineHeight: 1.24, color: C.fg, textTransform: 'uppercase' },
      title,
    ),
  );

function frontmatter(file) {
  const m = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const get = (k) => m?.[1].match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1];
  return { title: get('title') };
}

mkdirSync(here('../public/og/wiki'), { recursive: true });
mkdirSync(here('../public/icons'), { recursive: true });

const mapW = 640;
await render(home, mapSvg(W - PAD - mapW + 24, PAD - 8, mapW), here('../public/og/home.png'));
await render(wikiCard(['România,\u00a0', hl('pe date.')], 'Wiki'), mapSvg(W - PAD - 300, PAD - 6, 300), here('../public/og/wiki.png'));

const wikiDir = here('../../wiki/');
const pages = readdirSync(wikiDir).filter((f) => /^[a-z].*\.md$/.test(f));
for (const f of pages) {
  const { title } = frontmatter(wikiDir + f);
  if (!title) continue;
  await render(wikiCard(title, 'Wiki'), mapSvg(W - PAD - 300, PAD - 6, 300), here(`../public/og/wiki/${f.replace(/\.md$/, '')}.png`));
}

// Icons from the favicon. The SVG has rounded corners; iOS rounds them itself, so fill the square there.
const favicon = readFileSync(here('../public/favicon.svg'), 'utf8');
const square = favicon.replace(/rx="[^"]*"/, 'rx="0"');
for (const [name, size, svg] of [['apple-touch-icon', 180, square], ['icon-192', 192, favicon], ['icon-512', 512, favicon]])
  writeFileSync(here(`../public/icons/${name}.png`), new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

console.log(`og: home, wiki, ${pages.length} wiki pages; icons: 3`);
