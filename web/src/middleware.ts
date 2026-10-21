// Security headers on every page the Worker renders (the quiz's API, results pages). The static
// pages get the same ones from public/_headers: keep the two in step.
// On a live host, a page asked for over plain HTTP is sent to HTTPS (the static pages need
// Cloudflare's "Always Use HTTPS" for that). Only page loads: an API call is never redirected, as
// the page that makes it would lose its answer.
import { defineMiddleware } from 'astro:middleware';

// Report-only while it proves it blocks nothing the site needs (Turnstile, the inline scripts).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy-Report-Only': CSP,
};

const LIVE = new Set(['partidul.ai', 'www.partidul.ai']);

export const onRequest = defineMiddleware(async ({ url, request, isPrerendered }, next) => {
  if (!isPrerendered && url.protocol === 'http:' && LIVE.has(url.hostname) && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 301, headers: { Location: `https://${url.host}${url.pathname}${url.search}` } });
  }
  const res = await next();
  if (isPrerendered) return res;
  // Some responses (redirects, fetched assets) have read-only headers: copy those first.
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
});
