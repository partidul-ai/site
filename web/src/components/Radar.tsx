import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { countyByCode } from '../data/counties';
import { OUTLINES } from '../data/outlines';
import { QUIZ_KEY, WHERE_KEY } from '../lib/quiz-storage';


// Radar chart. Values are 0–100 (50 = neutral); null leaves a point out. Hovering (or tapping)
// an area highlights it and shows that area's numbers for every series. Locked areas (no
// questions there yet) keep their place on the wheel with a padlock and no values; the shapes
// join the open areas only. Colors are theme tokens.
export type RadarAxis = { id?: string; label: string; open?: boolean; answered?: number; you: number | null; cohort: number | null; ro: number | null };
type Props = { axes: RadarAxis[]; names: { you: string; cohort: string | null; ro: string }; county?: string };

const C = 300, R = 200; // center and radius, in viewBox units

/** Measures text in the page's sans font at the given size; a character estimate before it loads. */
function useTextWidth(px: number, fontsReady: boolean) {
  const ctx = useMemo(() => (typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')), []);
  return useMemo(() => {
    if (!ctx || !fontsReady) return (s: string) => s.length * px * 0.56;
    // Bold, as a hovered label is: the room it needs never changes.
    ctx.font = `650 ${px}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'sans-serif'}`;
    return (s: string) => ctx.measureText(s).width;
  }, [ctx, px, fontsReady]);
}

// Labels with a long word, broken by hand on phones so one word doesn't shrink the wheel.
const PHONE_LINES: Record<string, string[]> = {
  'Infrastructură și mediu': ['Infra-', 'structură', 'și mediu'],
  'Localitatea ta': ['Locali-', 'tatea ta'],
};

/** Split a label into lines of at most ~14 characters, on word boundaries. */
function wrap(label: string, max = 14, phone = false) {
  if (phone && PHONE_LINES[label]) return PHONE_LINES[label];
  const lines: string[] = [];
  for (const word of label.split(' ')) {
    const last = lines.at(-1);
    if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

export default function Radar({ axes, names, county }: Props) {
  const [active, setActive] = useState<number | null>(null);
  // Which series is highlighted (filled, on top). Picked from the legend; yours by default.
  const [focus, setFocus] = useState<'you' | 'cohort' | 'ro'>('you');
  // On your own result (marked on <html> by the page) your series is "Tu".
  const [mine, setMine] = useState(false);
  useEffect(() => setMine('mine' in document.documentElement.dataset), []);
  const box = useRef<HTMLDivElement>(null);
  // The open tooltip, and how far it's shifted sideways to stay on screen.
  const tipRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState(0);
  // Unlocking an area: its hover box has a button that starts a round of its questions.
  const [starting, setStarting] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const startRound = async (unlock: number) => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch('/api/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: axes[unlock].id }),
      });
      const step = (await res.json()) as { done?: boolean; error?: string };
      if (!res.ok) throw new Error(step.error ?? 'Ceva n-a mers.');
      if (step.done) return location.reload();
      sessionStorage.setItem(QUIZ_KEY, JSON.stringify(step));
      sessionStorage.setItem(WHERE_KEY, JSON.stringify({ t: axes[unlock].label }));
      location.href = '/quiz';
    } catch (e) {
      setUnlockError((e as Error).message);
      setStarting(false);
    }
  };
  // Back from /quiz, the browser may restore this page as it was left: button still disabled.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setStarting(false);
    addEventListener('pageshow', onShow);
    return () => removeEventListener('pageshow', onShow);
  }, []);
  // On touch, a tap outside the chart closes the tooltip (the mouse closes it by leaving).
  useEffect(() => {
    if (active === null) return;
    const onDown = (e: PointerEvent) => e.pointerType !== 'mouse' && !box.current?.contains(e.target as Node) && setActive(null);
    addEventListener('pointerdown', onDown);
    return () => removeEventListener('pointerdown', onDown);
  }, [active]);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  // Label widths are measured in the page's font once it has loaded (estimated until then).
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => void document.fonts?.ready.then(() => setFontsReady(true)), []);

  // Layout, worked out in screen pixels and then scaled into the viewBox. Labels keep a readable
  // size (11px on phones, 13px on desktop) and the wheel takes all the width they leave: its
  // radius is the largest at which every side label still fits, measured label by label. When
  // padlocks sit on the rim, labels move out far enough to clear them.
  const narrow = width < 500;
  const maxChars = narrow ? 12 : 14;
  const px = narrow ? 11 : 13;
  const lineHpx = px * 1.1;
  const lockHalf = narrow ? 12 : 14; // padlock square, half its side in px
  const N = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / N;
  const isOpen = (i: number) => axes[i].open !== false;
  const hasLocks = mine && axes.some((_, i) => !isOpen(i));
  // Where a label hangs off its point: beside it on the sides, above at the top, below at the bottom.
  const side = (i: number) => Math.abs(Math.sin(angle(i))) < 0.2;
  const above = (i: number) => !side(i) && Math.sin(angle(i)) < 0;
  const middle = (i: number) => Math.abs(Math.cos(angle(i))) < 0.05;
  // Rim to label, px, along the spoke. Behind a padlock: the least that keeps the label's box clear
  // of the padlock's square, sideways or vertically, whichever is shorter for that direction.
  const gap = (i: number) => {
    if (isOpen(i) || !mine) return px * 0.8; // no padlock on this spoke
    const clear = lockHalf + 4, c = Math.abs(Math.cos(angle(i))), s = Math.abs(Math.sin(angle(i)));
    const sideways = middle(i) ? Infinity : clear / c;
    const vertical = side(i) ? Infinity : (clear + lineHpx / 2) / s;
    return Math.min(sideways, vertical);
  };
  const labels = axes.map((a) => wrap(a.label, maxChars, narrow));
  const measure = useTextWidth(px, fontsReady);
  const widths = labels.map((lines) => Math.max(...lines.map(measure)));
  const rPx = Math.max(
    40,
    Math.min(
      width / 2 - lockHalf - 2,
      ...axes.map((_, i) => (middle(i) ? Infinity : (width / 2 - widths[i] - 2) / Math.abs(Math.cos(angle(i))) - gap(i))),
    ),
  );
  // Vertical room: the rim, the padlocks, and every label's lines.
  let top = -rPx - (hasLocks ? lockHalf : 0), bottom = -top;
  axes.forEach((_, i) => {
    const y = Math.sin(angle(i)) * (rPx + gap(i)), h = labels[i].length * lineHpx;
    top = Math.min(top, side(i) ? y - h / 2 : above(i) ? y - h + lineHpx / 2 : y - lineHpx / 2);
    bottom = Math.max(bottom, side(i) ? y + h / 2 : above(i) ? y + lineHpx / 2 : y + h - lineHpx / 2);
  });
  const unit = R / rPx; // viewBox units per screen pixel
  const VIEW = { x: C - (width / 2) * unit, y: C + (top - 4) * unit, w: width * unit, h: (bottom - top + 8) * unit };
  const font = px * unit;
  const lineH = lineHpx * unit;
  const labelAt = (i: number) => 100 + (gap(i) / rPx) * 100; // label distance, in % of the radius
  // Values 0–100: 0 sits a little off the center (12% of the radius), so low scores still make
  // a shape instead of collapsing to a point; the grid rings use the same scale. Beyond 100
  // (labels, padlocks) distances stay as they are.
  const ZERO = 0.12;
  const pt = (i: number, v: number) => {
    const r = v <= 100 ? R * (ZERO + ((1 - ZERO) * v) / 100) : (R * v) / 100;
    return [C + Math.cos(angle(i)) * r, C + Math.sin(angle(i)) * r] as const;
  };
  const ring = (v: number) => axes.map((_, i) => pt(i, v).join(',')).join(' ');
  const openIdx = axes.map((_, i) => i).filter(isOpen);
  const poly = (vals: number[]) => openIdx.map((i) => pt(i, vals[i]).join(',')).join(' ');

  const series = [
    { key: 'you' as const, name: mine ? 'Tu' : names.you, base: 'var(--fg)', dash: undefined },
    // Comparisons are for your own result; someone opening a shared link sees just that person's shape.
    ...(mine && names.cohort ? [{ key: 'cohort' as const, name: names.cohort, base: 'var(--dim)', dash: '7 6' }] : []),
    ...(mine ? [{ key: 'ro' as const, name: names.ro, base: 'var(--faint)', dash: undefined }] : []),
  ].map((s) => ({
    ...s,
    focused: s.key === focus,
    stroke: s.key === focus ? 'var(--acc-fg)' : s.base,
    fill: s.key === focus ? 'color-mix(in oklab, var(--acc) 45%, transparent)' : 'none',
  }));
  // The shape's values, eased from the previous series to the picked one (a missing value sits
  // at the center, without a dot). Kept in a ref too, so a switch mid-animation starts from where it is.
  const target = axes.map((a, i) => (isOpen(i) ? a[focus] : null));
  const [shape, setShape] = useState(() => target.map((v) => v ?? 0));
  const shapeRef = useRef(shape);
  const targetKey = target.join(',');
  useEffect(() => {
    const from = shapeRef.current, to = target.map((v) => v ?? 0);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now(), ms = reduce ? 0 : 450;
    let raf = 0;
    const tick = (now: number) => {
      const x = ms ? Math.min(1, (now - t0) / ms) : 1;
      const e = x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; // ease-in-out: it moves in place
      const next = to.map((v, i) => (from[i] ?? 0) + (v - (from[i] ?? 0)) * e);
      shapeRef.current = next;
      setShape(next);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Hit area for axis i: the wedge halfway to each neighbour, out to the labels.
  const wedge = (i: number) => {
    const a0 = angle(i) - Math.PI / N, a1 = angle(i) + Math.PI / N, r = R * 1.45;
    return `${C},${C} ${C + Math.cos(a0) * r},${C + Math.sin(a0) * r} ${C + Math.cos(angle(i)) * r},${C + Math.sin(angle(i)) * r} ${C + Math.cos(a1) * r},${C + Math.sin(a1) * r}`;
  };
  // Tooltip takes the place of the hovered label: same spot, same alignment (left-aligned for
  // labels on the right, right-aligned on the left, centered top and bottom). Top labels grow
  // upward, bottom ones downward. On narrow screens it's centered on the label, kept in the box.
  const tip = (i: number): React.CSSProperties => {
    const [x, y] = pt(i, labelAt(i));
    const left = ((x - VIEW.x) / VIEW.w) * 100, top = ((y - VIEW.y) / VIEW.h) * 100;
    const ty = side(i) ? '-50%' : above(i) ? 'calc(-100% + 0.75rem)' : '-0.75rem';
    if (narrow) return { width: '11rem', left: `clamp(0px, calc(${left}% - 5.5rem), calc(100% - 11rem))`, top: `${top}%`, transform: `translateY(${ty})` };
    const tx = middle(i) ? '-50%' : x > C ? '-0.875rem' : 'calc(-100% + 0.875rem)';
    return { left: `${left}%`, top: `${top}%`, transform: `translate(${tx}, ${ty})` };
  };

  // A tooltip next to a label near the page's edge (labels on the right on large screens) would
  // stick out and make the page scroll sideways: shift it back in, keeping a small margin.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return setNudge(0);
    const r = el.getBoundingClientRect(), margin = 8;
    const left = r.left - nudge, right = r.right - nudge; // where it sits unshifted
    const w = document.documentElement.clientWidth; // without the scrollbar
    const next = right > w - margin ? w - margin - right : left < margin ? margin - left : 0;
    if (Math.round(next) !== Math.round(nudge)) setNudge(next);
  }, [active, narrow, nudge]);

  const GRID = 0.1; // the grid lines' opacity, the same for every ring and spoke
  // Strokes and dots are sized in screen pixels, whatever the chart's drawn size.
  const k = (px: number) => px * unit;

  // The tooltip closes when the pointer leaves, for the mouse only: a lifted finger also "leaves",
  // before its click, which would remove the tooltip's button from under the tap.
  return (
    <div ref={box} className="w-full" onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}>
      {/* The tooltip is positioned in % of this box, so it holds only the chart (not the legend). */}
      <div className="relative">
      <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} className="block w-full select-none" role="img" aria-label={`Grafic: ${series.map((s) => s.name).join(', ')}`}>
        {/* One shape: the series picked in the legend. Switching morphs it to the new values. Drawn
            under the grid, with no outline: the rings and spokes show through it. */}
        {openIdx.length >= 3 ? (
          <polygon points={poly(shape)} fill="var(--acc)" />
        ) : (
          openIdx.length === 2 && <line x1={pt(openIdx[0], shape[openIdx[0]])[0]} y1={pt(openIdx[0], shape[openIdx[0]])[1]} x2={pt(openIdx[1], shape[openIdx[1]])[0]} y2={pt(openIdx[1], shape[openIdx[1]])[1]} stroke="var(--shape-line)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
        {/* Grid: quarter rings, then the spokes (dashed to locked areas). White lines
            in "difference" blend: light on the dark theme, dark on paper and on the lime shape, so
            they look equally faint on all three. */}
        <g style={{ mixBlendMode: 'difference' }}>
        {[25, 50, 75, 100].map((v) => (
          <polygon key={v} points={ring(v)} fill="none" stroke="#fff" strokeOpacity={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {axes.map((_, i) => {
          const [x, y] = pt(i, 100);
          return (
            <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#fff" strokeOpacity={active === i ? 0.5 : GRID} strokeDasharray={isOpen(i) ? undefined : '2 4'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          );
        })}
        </g>
        {/* Locked areas, on your own result only: a plus button on the rim that opens the
            area's questions. Drawn after the hit areas (below), so it takes the click. */}

        {openIdx.map(
          (i) =>
            target[i] !== null && (
              <circle key={i} cx={pt(i, shape[i])[0]} cy={pt(i, shape[i])[1]} r={k(active === i ? 5 : 3.5)} fill="var(--acc)" stroke="var(--vertex-ring)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ),
        )}

        {axes.map((a, i) => {
          const [x, y] = pt(i, labelAt(i));
          const anchor = middle(i) ? 'middle' : x > C ? 'start' : 'end';
          const lines = labels[i];
          const dy = side(i) ? -((lines.length - 1) * lineH) / 2 : above(i) ? -(lines.length - 1) * lineH : 0;
          return (
            <text key={i} x={x} y={y + dy} textAnchor={anchor} fontSize={font} fontWeight={active === i ? 650 : 500} fill={!isOpen(i) ? 'var(--faint)' : active === null || active === i ? 'var(--fg)' : 'var(--dim)'} opacity={active === i ? 0 : 1} fontFamily="var(--font-sans)" className="transition-[fill] duration-150">
              {lines.map((l, j) => (
                <tspan key={j} x={x} dy={j ? lineH : 0} dominantBaseline="middle">{l}</tspan>
              ))}
            </text>
          );
        })}
        {/* Hover boxes only on your own result; a shared link shows just the shape. */}
        {axes.map((_, i) => i).filter(() => mine).map((i) => (
          <polygon
            key={i}
            points={wedge(i)}
            fill="transparent"
            className="cursor-pointer"
            onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
            onClick={() => setActive((a) => (a === i ? null : i))}
          />
        ))}
        {axes.map((a, i) => {
          if (isOpen(i) || !mine) return null;
          const [x, y] = pt(i, 100), u = k(lockHalf / 14); // drawn at 28 units, shown at the padlock size
          return (
            <g
              key={`lock-${i}`}
              role="button"
              tabIndex={0}
              aria-label={`Deblochează: ${a.label}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setActive(i))}
              className="lock cursor-pointer outline-none"
              transform={`translate(${x} ${y}) scale(${u})`}
            >
              <g className="lock-face">
                <rect x={-14} y={-14} width={28} height={28} fill="var(--acc)" />
                {/* A plus: add this area. */}
                <path d="M0 -6.5V6.5M-6.5 0H6.5" fill="none" stroke="var(--on-acc)" strokeWidth={2.5} strokeLinecap="square" vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          );
        })}
      </svg>

      {active !== null && (
        <div className={`absolute z-10 border border-line bg-raised px-3.5 py-3 text-left shadow-xl shadow-black/10 ${isOpen(active) ? 'pointer-events-none' : ''} ${narrow ? '' : 'min-w-48'}`} style={{ ...tip(active), marginLeft: nudge }} ref={tipRef} role="status">
          <div className="mb-2 text-sm font-semibold">{axes[active].label}</div>
          {/* A locked area (your own result): a button instead of numbers. */}
          {!isOpen(active) && (
            <>
              <button onClick={() => startRound(active)} disabled={starting} className="press mt-1 h-10 w-full bg-acc px-4 font-display text-lg font-[800] tracking-wide text-on-acc uppercase disabled:opacity-60">
                {axes[active].answered ? 'Continuă' : 'Începe'}
              </button>
              {unlockError && <p className="mt-2 text-xs text-acc-fg">{unlockError}</p>}
            </>
          )}
          {isOpen(active) && series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-5 py-0.5 font-mono text-xs tabular-nums">
              <span className={`flex items-center gap-2 ${s.focused ? 'text-fg' : 'text-dim'}`}>
                <Swatch s={s} county={county} />
                {s.name}
              </span>
              <span className={s.focused ? 'font-semibold' : 'text-dim'}>{axes[active][s.key] ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      </div>

      {/* Legend, and the switch for which series is highlighted: same look as the age picker. */}
      {series.length > 1 && <div className="mt-3 flex justify-center">
        <div className="inline-flex border border-line bg-raised/60" role="group" aria-label="Evidențiază">
          {series.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={s.focused}
              onClick={() => {
                setFocus(s.key);
                // The page heading follows ("Cum vede Cluj lucrurile").
                dispatchEvent(new CustomEvent('radar-focus', { detail: s.key }));
              }}
              className={`flex h-10 items-center gap-2 px-3.5 font-mono text-[11px] tracking-[0.1em] whitespace-nowrap uppercase transition-colors duration-150 ${i ? 'border-l border-line' : ''} ${
                s.focused ? 'bg-fg text-bg' : 'text-dim [@media(hover:hover)]:hover:bg-fg/[0.05] [@media(hover:hover)]:hover:text-fg'
              }`}
            >
              <Swatch s={s} county={county} inverted={s.focused} />
              {s.name}
            </button>
          ))}
        </div>
      </div>}
    </div>
  );
}

/**
 * Key for a series: a circle for you, the county's outline for its cohort (a globe for the
 * diaspora), the country's outline for Romania. Filled when it's the one drawn; on an inverted
 * (pressed, dark) button the outline is accent too, so the shape reads on the dark button.
 */
function Swatch({ s, county, inverted }: { s: { key: 'you' | 'cohort' | 'ro'; focused: boolean }; county?: string; inverted?: boolean }) {
  const nuts = s.key === 'ro' ? 'RO' : s.key === 'cohort' ? countyByCode(county)?.nuts : undefined;
  const paint = s.focused
    ? { fill: 'var(--acc)', stroke: inverted ? 'var(--on-fg-mark)' : 'var(--acc-fg)' }
    : { fill: 'none', stroke: 'currentColor' };
  return (
    <svg viewBox="-1 -1 26 26" className="size-5 shrink-0 overflow-visible" aria-hidden>
      {s.key === 'you' ? (
        <circle cx={12} cy={12} r={9} {...paint} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : nuts && OUTLINES[nuts] ? (
        <path d={OUTLINES[nuts]} {...paint} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ) : (
        <g {...paint} strokeWidth={1.5}>
          <circle cx={12} cy={12} r={10} vectorEffect="non-scaling-stroke" />
          <ellipse cx={12} cy={12} rx={4.5} ry={10} fill="none" vectorEffect="non-scaling-stroke" />
          <path d="M2 12h20" fill="none" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}
