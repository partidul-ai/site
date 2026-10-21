/** sessionStorage key for the current quiz step: set by the start button, read by the quiz page. */
export const QUIZ_KEY = 'quiz-step';

/** sessionStorage key: the county and age picked for the current quiz, for its label ({ c, a }), or the area
 *  being unlocked from the results page ({ t }). */
export const WHERE_KEY = 'quiz-where';

/** Cookie set by the server when a quiz finishes: the last signed token of that quiz, which proves the
 *  result is yours (unlocking areas, deleting it). HttpOnly, so no script on the page can read it; the
 *  landing page asks /api/me instead. */
export const OWNER_COOKIE = 'quiz-owner';

export type MyResult = { result: string; done: number; total: number };

/** Your finished result and how many of its areas are open, or null (none, deleted, or the server
 *  couldn't tell). Browser only. */
export async function myResult(): Promise<MyResult | null> {
  try {
    const res = await fetch('/api/me');
    const me = res.ok ? ((await res.json()) as Partial<MyResult>) : null;
    return me?.result ? (me as MyResult) : null;
  } catch {
    return null;
  }
}
