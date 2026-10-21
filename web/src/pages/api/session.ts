import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { QuizError, start } from '../../lib/quiz-server';
import { isHuman } from '../../lib/turnstile';

export const prerender = false;

// A person can't pick a county and an age range this fast after the page loads.
const MIN_MS_ON_PAGE = 600;

// POST { judet, varsta, website, elapsed, human } -> first question
//   website  honeypot: a field people never see, so it should come back empty
//   elapsed  ms between the landing page loading and the click on "Începe"
//   human    Cloudflare Turnstile token
// At most SESSION_LIMIT sessions a minute from one IP. The IP is only used for that and for
// Turnstile, never stored with the answers.
export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = request.headers.get('cf-connecting-ip');
    if (ip && !(await env.SESSION_LIMIT.limit({ key: ip })).success) {
      return Response.json({ error: 'Prea multe încercări. Mai încearcă peste un minut.' }, { status: 429 });
    }
    const { judet, varsta, website, elapsed, human } = (await request.json()) as Record<string, unknown>;
    if (website || typeof elapsed !== 'number' || elapsed < MIN_MS_ON_PAGE) {
      // Same answer as any other failure: nothing to learn for whoever is probing.
      return Response.json({ error: 'Ceva n-a mers. Încearcă din nou.' }, { status: 400 });
    }
    // Its own status, so the page can get a new token and try once more (an expired token is
    // the usual reason, after a long while in a background tab).
    if (!(await isHuman(human, ip))) return Response.json({ error: 'Verificarea a expirat. Încearcă din nou.' }, { status: 403 });
    return Response.json(await start(String(judet), String(varsta)));
  } catch (e) {
    if (e instanceof QuizError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'Ceva n-a mers. Încearcă din nou.' }, { status: 502 });
  }
};
