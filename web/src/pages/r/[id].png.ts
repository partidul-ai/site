import type { APIRoute } from 'astro';
import { results } from '../../lib/quiz-server';
import { mockResult } from '../../lib/results-mock';
import { renderPreview } from '../../lib/og-result';
import { WHEEL } from '../../lib/wheel';

export const prerender = false;

// The link preview of /r/{id}, cached for an hour at the edge: it changes only when the person
// unlocks an area.
export const GET: APIRoute = async ({ params, url, request }) => {
  const cache = typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default;
  const hit = await cache?.match(request);
  if (hit) return hit;

  const id = params.id ?? '';
  const r = id === 'demo' && import.meta.env.DEV ? mockResult(url.searchParams) : await results(id);
  if (!r) return new Response('Nu am găsit rezultatul.', { status: 404 });

  const axes = WHEEL.map((w) => r.axes.find((a) => a.id === w)!).filter(Boolean);
  const png = await renderPreview({
    score: r.score.you,
    axes: axes.map((a) => ({ label: a.label, value: a.open ? a.you : null })),
  });
  const res = new Response(png as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });
  await cache?.put(request, res.clone());
  return res;
};
