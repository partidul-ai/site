// Small helpers for the API routes. Server only.
import { QuizError } from './quiz-server';

// Every request body is a few short strings: a token, some ids. Anything larger isn't ours.
const MAX_BODY = 16 * 1024;

/** The request's JSON body, turned down if it is larger than any of ours. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) throw new QuizError('Cerere prea mare.');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new QuizError('Cerere prea mare.');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new QuizError('Cerere invalidă.');
  }
}

/** The rate limit's key for an IP: an IPv6 address by its /64, the block one household or device
 *  usually gets, so a new address from the same block isn't a new key. */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
