import type { APIRoute } from 'astro';
import { QuizError, deleteSession } from '../../lib/quiz-server';
import { clearOwner, ownerToken } from '../../lib/owner-cookie';

export const prerender = false;

// POST -> deletes your result (from your results page; the owner cookie says which), and its link
// preview from this data centre's cache (pages/r/[id].png.ts).
export const POST: APIRoute = async ({ cookies, url }) => {
  try {
    const id = await deleteSession(ownerToken(cookies));
    clearOwner(cookies);
    if (typeof caches !== 'undefined') await (caches as unknown as { default: Cache }).default.delete(`${url.origin}/r/${id}.png`).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof QuizError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'Ceva n-a mers. Încearcă din nou.' }, { status: 502 });
  }
};
