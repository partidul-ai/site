import { useEffect, useRef } from 'react';
import { COUNTIES } from '../data/counties';
import { DOTS, DOT_COUNTIES, DOT_VIEW } from '../data/dots';

/** Discs drawn apart from the map, in map units. Diaspora top-left, i.e. west, where most of it lives;
 *  București mirrored top-right, since its 5 dots on the map are hard to hit. */
export const DISCS = [
  { code: 'DIASPORA', label: 'Diaspora', x: 78, y: 88, r: 50 },
  { code: 'B', label: 'București', x: 922, y: 88, r: 50 },
];

// Dot colours come from the theme tokens in global.css.
function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { dot: v('--dot'), diaspora: v('--dot-diaspora'), hover: v('--dot-hover'), sel: v('--dot-sel'), zone: v('--zone') };
}

/** r: dot radius; z: 0..1, how far the selected-zone fill behind this dot has grown. */
/** disc: drawn in one of the DISCS, not on the map. */
type Dot = { x: number; y: number; code: string; r: number; z: number; delay: number; disc?: boolean };

function buildDots(): Dot[] {
  const codeByNuts = Object.fromEntries(COUNTIES.filter((c) => c.nuts).map((c) => [c.nuts, c.code]));
  const cx = DOT_VIEW.width / 2, cy = DOT_VIEW.height / 2;
  const out: Dot[] = [];
  for (let i = 0; i < DOTS.length; i += 3) {
    const x = DOTS[i], y = DOTS[i + 1];
    out.push({ x, y, code: codeByNuts[DOT_COUNTIES[DOTS[i + 2]]], r: 0, z: 0, delay: Math.hypot(x - cx, y - cy) * 1.4 });
  }
  // Each disc: a hex disc of dots on the same grid spacing.
  const s = DOT_VIEW.step, row = (s * Math.sqrt(3)) / 2;
  for (const c of DISCS)
    for (let j = -6; j <= 6; j++)
      for (let i = -6; i <= 6; i++) {
        const x = c.x + i * s + (j % 2 ? s / 2 : 0), y = c.y + j * row;
        if (Math.hypot(x - c.x, y - c.y) <= c.r)
          out.push({ x, y, code: c.code, r: 0, z: 0, delay: 650 + Math.hypot(x - c.x, y - c.y) * 4, disc: true });
      }
  return out;
}

type Props = {
  selected: string | null;
  hovered: string | null;
  onSelect: (code: string) => void;
  onHover: (code: string | null) => void;
};

/**
 * Romania drawn as dots, one per patch of land. Canvas rather than SVG: ~4.5k dots
 * that each ease their own radius toward a target (hover, selection, cursor proximity).
 */
export default function DotMap({ selected, hovered, onSelect, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ selected, hovered, onSelect, onHover, pointer: null as null | { x: number; y: number }, wake: () => {} });
  Object.assign(state.current, { selected, hovered, onSelect, onHover });

  useEffect(() => state.current.wake(), [selected, hovered]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dots = buildDots();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let scale = 1, raf = 0;
    let colors = readColors();

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (w === canvas.width && h === canvas.height) return;
      // Setting the size clears the canvas, so repaint in the same frame instead of
      // waiting for the next one (that blank frame reads as a flash).
      canvas.width = w;
      canvas.height = h;
      scale = (width / DOT_VIEW.width) * dpr;
      cancelAnimationFrame(raf);
      frame(performance.now());
    };

    const base = DOT_VIEW.step * 0.24;
    const frame = (now: number) => {
      raf = 0;
      const { selected, hovered, pointer } = state.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let moving = false;
      const hasZone = !!colors.zone && colors.zone !== 'transparent';
      // With a zone fill the dots stay small so the colour shows; without one they grow instead.
      const selGrow = hasZone ? 1.05 : 1.55;
      const ease = (v: number, to: number) => {
        const next = reduced ? to : v + (to - v) * 0.2;
        if (Math.abs(next - to) > 0.01) return (moving = true), next;
        return to;
      };
      for (const d of dots) {
        const started = reduced || now - t0 > d.delay;
        let target = 0;
        if (started) {
          target = d.code === selected ? base * selGrow : d.code === hovered ? base * 1.3 : base;
          if (pointer) {
            const dist = Math.hypot(d.x - pointer.x, d.y - pointer.y);
            if (dist < 70) target *= 1 + 0.9 * (1 - dist / 70) ** 2;
          }
        }
        d.r = ease(d.r, target);
        d.z = ease(d.z, d.code === selected ? 1 : 0);
      }

      // Light theme: the selected county gets a highlighter fill. Overlapping discs
      // (radius > step/√3) merge into one solid shape behind the dots.
      if (hasZone) {
        ctx.fillStyle = colors.zone;
        ctx.beginPath();
        for (const d of dots) {
          if (d.z <= 0.01) continue;
          const zr = DOT_VIEW.step * 0.66 * d.z * scale;
          ctx.moveTo(d.x * scale + zr, d.y * scale);
          ctx.arc(d.x * scale, d.y * scale, zr, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // One path per colour, filled once: the colours are translucent, so dots grown into each
      // other near the cursor would otherwise darken where they overlap.
      const paths = new Map<string, Path2D>();
      for (const d of dots) {
        if (d.r <= 0.05) continue;
        const color =
          d.code === selected ? colors.sel : d.code === hovered ? colors.hover : d.disc ? colors.diaspora : colors.dot;
        let p = paths.get(color);
        if (!p) paths.set(color, (p = new Path2D()));
        p.moveTo(d.x * scale + d.r * scale, d.y * scale);
        p.arc(d.x * scale, d.y * scale, d.r * scale, 0, Math.PI * 2);
      }
      for (const [color, p] of paths) {
        ctx.fillStyle = color;
        ctx.fill(p);
      }
      if (moving || (!reduced && now - t0 < 1600)) wake();
    };

    function wake() {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    state.current.wake = wake;

    const toMap = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * DOT_VIEW.width, y: ((e.clientY - r.top) / r.height) * DOT_VIEW.height };
    };
    // Nearest dot within reach decides the county under the pointer.
    const hit = (p: { x: number; y: number }) => {
      let best: Dot | null = null, bd = DOT_VIEW.step * 1.2;
      for (const d of dots) {
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist < bd) (bd = dist), (best = d);
      }
      return best?.code ?? null;
    };

    const move = (e: PointerEvent) => {
      const p = toMap(e);
      // Only fine pointers get the magnifying ripple; on touch it would stick after the tap.
      state.current.pointer = e.pointerType === 'mouse' ? p : null;
      const code = hit(p);
      canvas.style.cursor = code ? 'pointer' : '';
      if (e.pointerType === 'mouse') state.current.onHover(code);
      wake();
    };
    const leave = () => {
      state.current.pointer = null;
      state.current.onHover(null);
      wake();
    };
    const click = (e: PointerEvent) => {
      const code = hit(toMap(e));
      if (code) state.current.onSelect(code);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Theme can change via the toggle (data-theme) or the system setting.
    const recolor = () => {
      colors = readColors();
      wake();
    };
    const mo = new MutationObserver(recolor);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', recolor);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerup', click);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      scheme.removeEventListener('change', recolor);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerup', click);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full touch-manipulation" />;
}
