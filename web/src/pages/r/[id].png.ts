import type { APIRoute } from 'astro';
import { results } from '../../lib/quiz-server';
import { mockResult } from '../../lib/results-mock';
import { renderPreview } from '../../lib/og-result';
import { WHEEL } from '../../lib/wheel';

export const prerender = false;

// The link preview of /r/{id}, cached at the edge: it changes only when the person unlocks an area.
// Ten minutes, so a deleted result's preview doesn't outlive it by long (deleting also drops it
// from this data centre's cache: pages/api/delete.ts). Keyed by the id alone, so a query string
// can't make it render again.
export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id ?? '';
  const cache = typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default;
  const key = new Request(`${url.origin}/r/${encodeURIComponent(id)}.png`);
  const hit = await cache?.match(key);
  if (hit) return hit;

  const r = id === 'demo' && import.meta.env.DEV ? mockResult(url.searchParams) : await results(id);
  if (!r) return new Response('Nu am găsit rezultatul.', { status: 404 });

  const axes = WHEEL.map((w) => r.axes.find((a) => a.id === w)!).filter(Boolean);
  const png = await renderPreview({
    score: r.score.you,
    axes: axes.map((a) => ({ label: a.label, value: a.open ? a.you : null })),
  });
  const res = new Response(png as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' } });
  if (id !== 'demo') await cache?.put(key, res.clone());
  return res;
};
