import type { APIRoute } from 'astro';
import { QuizError, deleteSession } from '../../lib/quiz-server';
import { clearOwner, ownerToken } from '../../lib/owner-cookie';

export const prerender = false;

// POST -> deletes your result (from your results page; the owner cookie says which)
export const POST: APIRoute = async ({ cookies }) => {
  try {
    await deleteSession(ownerToken(cookies));
    clearOwner(cookies);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof QuizError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'Ceva n-a mers. Încearcă din nou.' }, { status: 502 });
  }
};
