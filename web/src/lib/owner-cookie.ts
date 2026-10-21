// Who owns a result: the last token of a finished quiz, kept in an HttpOnly cookie (see
// lib/quiz-storage.ts). Server only.
import type { AstroCookies } from 'astro';
import { ownerOf } from './quiz-server';
import { OWNER_COOKIE } from './quiz-storage';

// The server never expires an owner token. Browsers keep a cookie at most 400 days, so it is set
// again on every visit (/api/me): it only goes if you stay away that long, or clear it.
const MAX_AGE = 400 * 24 * 60 * 60;

// Before /api/me, the result id also sat in a readable cookie. Cleared wherever we see it.
const OLD_RESULT_COOKIE = 'quiz-result';

/** After a quiz or a round finishes, and on every visit: remember that its result is yours, in this browser. */
export function setOwner(cookies: AstroCookies, url: URL, token: string) {
  // SameSite=Lax: never sent with another site's POST, so no other page can act as you.
  cookies.set(OWNER_COOKIE, token, { path: '/', sameSite: 'lax', secure: url.protocol === 'https:', maxAge: MAX_AGE, httpOnly: true });
  if (cookies.has(OLD_RESULT_COOKIE)) cookies.delete(OLD_RESULT_COOKIE, { path: '/' });
}

export function clearOwner(cookies: AstroCookies) {
  cookies.delete(OWNER_COOKIE, { path: '/' });
  if (cookies.has(OLD_RESULT_COOKIE)) cookies.delete(OLD_RESULT_COOKIE, { path: '/' });
}

export const ownerToken = (cookies: AstroCookies) => cookies.get(OWNER_COOKIE)?.value ?? '';

/** The result id this browser owns, or null. */
export const ownedResult = (cookies: AstroCookies) => ownerOf(ownerToken(cookies));
