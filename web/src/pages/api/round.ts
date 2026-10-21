import type { APIRoute } from 'astro';
import { QuizError, startRound } from '../../lib/quiz-server';
import { ownerToken } from '../../lib/owner-cookie';
import { readJson } from '../../lib/http';

export const prerender = false;

// POST { area } -> first question of a round in that area (from your results page; the owner
// cookie says which result)
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { area } = await readJson(request);
    return Response.json(await startRound(ownerToken(cookies), String(area)));
  } catch (e) {
    if (e instanceof QuizError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'Ceva n-a mers. Încearcă din nou.' }, { status: 502 });
  }
};
