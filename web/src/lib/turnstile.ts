// Cloudflare Turnstile, the server half: checks the token the start button sends (see
// components/Hero.tsx). Server only.
import { env } from 'cloudflare:workers';

/** True if Cloudflare says `token` came from a person who just loaded our page. */
export async function isHuman(token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = (await res.json()) as { success?: boolean; action?: string; metadata?: { result_with_testing_key?: boolean } };
    // Cloudflare's test keys (dev) answer without an action.
    return out.success === true && (out.action === 'start' || out.metadata?.result_with_testing_key === true);
  } catch (e) {
    // Fail closed: a bot shouldn't get in because Cloudflare was slow to answer.
    console.error('turnstile', e);
    return false;
  }
}
