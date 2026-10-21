import type { APIRoute } from 'astro';
import { ownedFinished } from '../../lib/quiz-server';
import { clearOwner, ownerToken, setOwner } from '../../lib/owner-cookie';

export const prerender = false;

// GET -> { result: id | null, done, total }: your finished result, from the owner cookie, and how many
// of its areas are open. For the landing page's "Continuă" / "Vezi rezultatul". An owner cookie whose result is gone (deleted) is cleared;
// one still yours is set again, so it keeps going as long as you keep coming back.
export const GET: APIRoute = async ({ cookies, url }) => {
  const headers = { 'Cache-Control': 'private, no-store' };
  const token = ownerToken(cookies);
  try {
    const mine = await ownedFinished(token);
    if (!mine && token) clearOwner(cookies);
    if (!mine) return Response.json({ result: null }, { headers });
    const { owner, ...shown } = mine;
    setOwner(cookies, url, owner);
    return Response.json(shown, { headers });
  } catch (e) {
    console.error(e);
    return Response.json({ result: null }, { status: 502, headers });
  }
};
