import type { APIRoute } from 'astro';
import { QuizError, answer } from '../../lib/quiz-server';
import { setOwner } from '../../lib/owner-cookie';

export const prerender = false;

// POST { token, choices: string[] | null } -> next question, or { done: true }
// The last answer of a quiz (or of a round) also sets the cookie that makes the result yours.
export const POST: APIRoute = async ({ request, cookies, url }) => {
  try {
    const { token, choices } = (await request.json()) as { token?: unknown; choices?: unknown };
    const picked = choices === null ? null : Array.isArray(choices) ? choices.map(String) : [];
    const step = await answer(String(token), picked);
    if (step.done) setOwner(cookies, url, String(token));
    return Response.json(step);
  } catch (e) {
    if (e instanceof QuizError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'Ceva n-a mers. Încearcă din nou.' }, { status: 502 });
  }
};
