// Link preview for a result (/r/{id}.png, 1200×630): the headline and score on the left, the
// person's radar on the right. Same look as scripts/build-og.mjs, drawn in the Worker: satori
// lays out the text, the radar is plain SVG, resvg turns it into a PNG. Both need WebAssembly,
// imported as modules: Workers can't compile WebAssembly at runtime. That's also why this is
// satori 0.12 ("satori-wasm"): 0.62, used by the build script, compiles its text shaper on the fly.
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
import satori, { init as initSatori } from 'satori-wasm/wasm';
import initYoga from 'yoga-wasm-web';
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm?module';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm?module';
import displayLatin from '@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff?inline';
import displayExt from '@fontsource/big-shoulders-display/files/big-shoulders-display-latin-ext-900-normal.woff?inline';
import sansLatin from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-500-normal.woff?inline';
import sansExt from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-ext-500-normal.woff?inline';
import monoLatin from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff?inline';
import monoExt from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-500-normal.woff?inline';

export type PreviewAxis = { label: string; value: number | null }; // value null: locked

const W = 1200, H = 630, PAD = 64;
const C = { bg: '#f2efe7', fg: '#121210', dim: 'rgba(18,18,16,0.6)', faint: 'rgba(18,18,16,0.32)', line: 'rgba(18,18,16,0.14)', acc: '#d4ff3a' };

// Fonts arrive as data: URLs (?inline); satori wants bytes. "Ș"/"ț" live only in the latin-ext
// subsets, and satori falls back per glyph across families, so each subset has its own name.
const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
type Fonts = { name: string; data: ArrayBuffer; weight: 500 | 900 }[];
let ready: Promise<Fonts> | undefined;
const setup = () =>
  (ready ??= Promise.all([
    initYoga(yogaWasm).then(initSatori),
    // Already set up (the dev server reloads this module, not resvg's) is fine.
    initResvg(resvgWasm).catch((e: Error) => { if (!/Already initialized/.test(e.message)) throw e; }),
  ]).then(() => [
    { name: 'Display', data: bytes(displayLatin), weight: 900 },
    { name: 'DisplayExt', data: bytes(displayExt), weight: 900 },
    { name: 'Sans', data: bytes(sansLatin), weight: 500 },
    { name: 'SansExt', data: bytes(sansExt), weight: 500 },
    { name: 'Mono', data: bytes(monoLatin), weight: 500 },
    { name: 'MonoExt', data: bytes(monoExt), weight: 500 },
  ] as Fonts));
const DISPLAY = 'Display, DisplayExt', SANS = 'Sans, SansExt', MONO = 'Mono, MonoExt';

// Minimal element helper, so no JSX is needed.
type Node = { type: string; props: { style: Record<string, unknown>; children: (Node | string)[] } };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string | (Node | string)[])[]): Node => ({
  type,
  props: { style: { display: 'flex', boxSizing: 'border-box', ...style }, children: children.flat() },
});
const hl = (text: string) => h('span', { background: C.acc, padding: '0 0.06em' }, text);

export async function renderPreview({ score, axes }: { score: number | null; axes: PreviewAxis[] }) {
  const fonts = await setup();

  // Radar, right side: the same scale as the page (0 a little off the center).
  const CX = 905, CY = 322, R = 168, ZERO = 0.12, N = axes.length;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / N;
  const pt = (i: number, v: number, raw = false) => {
    const r = raw ? (R * v) / 100 : R * (ZERO + ((1 - ZERO) * v) / 100);
    return [CX + Math.cos(ang(i)) * r, CY + Math.sin(ang(i)) * r];
  };
  const f = (n: number) => n.toFixed(1);
  let svg = '';
  const open = axes.map((_, i) => i).filter((i) => axes[i].value !== null);
  // As on the page: the shape first, with no outline, and the grid over it.
  if (open.length >= 3) svg += `<polygon points="${open.map((i) => pt(i, axes[i].value!).map(f).join(',')).join(' ')}" fill="${C.acc}"/>`;
  for (const v of [25, 50, 75, 100]) svg += `<polygon points="${axes.map((_, i) => pt(i, v).map(f).join(',')).join(' ')}" fill="none" stroke="${C.line}" stroke-width="2"/>`;
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 100);
    svg += `<line x1="${CX}" y1="${CY}" x2="${f(x)}" y2="${f(y)}" stroke="${C.line}" stroke-width="2"${a.value === null ? ' stroke-dasharray="3 7"' : ''}/>`;
  });
  if (open.length === 2) {
    const [a, b] = open.map((i) => pt(i, axes[i].value!).map(f));
    svg += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.fg}" stroke-width="3.5"/>`;
  }
  for (const i of open) {
    const [x, y] = pt(i, axes[i].value!);
    svg += `<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="${C.acc}" stroke="${C.fg}" stroke-width="2.5"/>`;
  }

  // Area names around the wheel (satori text, placed absolutely).
  const labels = axes.map(({ label, value }, i) => {
    const [x, y] = pt(i, 118, true);
    const side = Math.abs(x - CX) < 10 ? 'mid' : x > CX ? 'right' : 'left';
    const box = 150;
    return h(
      'div',
      {
        position: 'absolute', top: y - 22, height: 44, width: box, alignItems: 'center',
        fontFamily: SANS, fontWeight: 500, fontSize: 17, lineHeight: 1.1, color: value === null ? C.faint : C.fg,
        ...(side === 'mid' ? { left: x - box / 2, justifyContent: 'center', textAlign: 'center' }
          : side === 'right' ? { left: x, justifyContent: 'flex-start' }
          : { left: x - box, justifyContent: 'flex-end', textAlign: 'right' }),
      },
      label,
    );
  });

  // Headline, in the sharer's voice: "Cum văd eu / lucrurile: / 36/100".
  const lines = ['Cum văd eu'];
  const size = 92;
  const headline = h(
    'div',
    { flexDirection: 'column', fontFamily: DISPLAY, fontWeight: 900, fontSize: size, lineHeight: 0.92, color: C.fg, textTransform: 'uppercase' },
    ...lines.map((l) => h('div', {}, l)),
    h('div', {}, score === null ? 'lucrurile' : 'lucrurile:'),
    ...(score === null ? [] : [h('div', { alignItems: 'baseline', marginTop: Math.round(size * 0.12) }, hl(String(score)), h('span', { fontSize: Math.round(size * 0.48), color: C.dim, marginLeft: 8 }, '/100'))]),
  );

  const tree = h(
    'div',
    { width: W, height: H, padding: PAD, position: 'relative' },
    h(
      'div',
      { flexDirection: 'column', justifyContent: 'space-between', width: 540, height: H - 2 * PAD },
      h('div', { fontFamily: DISPLAY, fontWeight: 900, fontSize: 34, color: C.fg, letterSpacing: '0.02em' }, 'partidul', hl('.ai')),
      headline,
      h('div', { fontFamily: MONO, fontSize: 20, letterSpacing: '0.14em', color: C.dim, textTransform: 'uppercase' }, 'Tu cum le vezi?'),
    ),
    ...labels,
  );
  let out = await satori(tree as never, { width: W, height: H, fonts });
  out = out.replace(/^(<svg[^>]*>)/, `$1<rect width="${W}" height="${H}" fill="${C.bg}"/>${svg}`);
  return new Resvg(out, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
