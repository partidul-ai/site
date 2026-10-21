// Cloudflare Turnstile, the server half: checks the token the start button sends (see
// components/Hero.tsx). Server only.
import { env } from 'cloudflare:workers';

// The pages a token may come from: ours, not a copy of the start button on another site.
const HOSTS = new Set(['partidul.ai', 'www.partidul.ai']);

/** True if Cloudflare says `token` came from a person who just loaded our page. */
export async function isHuman(token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = (await res.json()) as { success?: boolean; action?: string; hostname?: string; metadata?: { result_with_testing_key?: boolean } };
    if (out.success !== true) return false;
    // Cloudflare's test keys answer without an action or our hostname; only the dev server uses them.
    if (import.meta.env.DEV && out.metadata?.result_with_testing_key === true) return true;
    return out.action === 'start' && HOSTS.has(out.hostname ?? '');
  } catch (e) {
    // Fail closed: a bot shouldn't get in because Cloudflare was slow to answer.
    console.error('turnstile', e);
    return false;
  }
}
