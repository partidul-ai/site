// Cloudflare Turnstile, the browser half. The widget runs as soon as the form shows, so the
// token is usually ready by the time "Începe" is clicked. It stays invisible unless Cloudflare
// wants the person to tick a box. Checked on the server by lib/turnstile.ts.

// Site keys are public. In dev, Cloudflare's test key: always passes, never asks anything.
// PUBLIC_TURNSTILE_SITE_KEY overrides it, e.g. to try a production build locally with the test key.
const TEST_KEY = '1x00000000000000000000AA';
const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? (import.meta.env.DEV ? TEST_KEY : '0x4AAAAAAFatuXOwF34yxWaZ');
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
const load = () =>
  (loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile!);
    s.onerror = () => {
      loading = null;
      reject(new Error('Nu s-a putut încărca verificarea. Reîncarcă pagina.'));
    };
    document.head.appendChild(s);
  }));

// Cloudflare accepts a token for 300 s. A tab left in the background can hold one past that
// without hearing it expired (timers there are throttled), so older than this counts as stale.
const FRESH_MS = 240_000;
// How long token() waits for Cloudflare before giving up.
const WAIT_MS = 20_000;

/** Mounts the widget in `el`. token() waits for a fresh token; reset() after one was used.
 *  onInteractive(true) when Cloudflare wants a box ticked, (false) once it's done. */
export function mountTurnstile(el: HTMLElement, onInteractive: (needed: boolean) => void = () => {}) {
  let token: string | null = null;
  let issued = 0;
  let waiting: { resolve: (t: string) => void; reject: (e: Error) => void }[] = [];
  let failed: Error | null = null;
  let id: string | null = null;
  let gone = false;
  const fail = (e: Error) => {
    failed = e;
    waiting.forEach((w) => w.reject(e));
    waiting = [];
  };

  load()
    .then((ts) => {
      if (gone) return;
      id = ts.render(el, {
        sitekey: SITE_KEY,
        action: 'start',
        appearance: 'interaction-only',
        language: 'ro',
        // The site's theme, which can differ from the system's (the toggle in the header).
        theme: document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
        'refresh-expired': 'auto',
        'before-interactive-callback': () => onInteractive(true),
        'after-interactive-callback': () => onInteractive(false),
        callback: (t: string) => {
          token = t;
          issued = Date.now();
          failed = null;
          waiting.forEach((w) => w.resolve(t));
          waiting = [];
        },
        'expired-callback': () => (token = null),
        'error-callback': () => fail(new Error('Verificarea n-a mers. Reîncarcă pagina.')),
      });
    })
    .catch(fail);

  const reset = () => {
    token = null;
    failed = null;
    if (id) window.turnstile?.reset(id);
  };

  return {
    // A stale token, or an earlier error (often from a long stay in the background), gets a new
    // check rather than failing the click.
    token: () =>
      new Promise<string>((resolve, reject) => {
        if (token && Date.now() - issued < FRESH_MS) return resolve(token);
        if (token || (failed && id)) reset();
        else if (failed) return reject(failed); // the script never loaded
        const w = { resolve, reject };
        waiting.push(w);
        setTimeout(() => {
          if (!waiting.includes(w)) return;
          waiting = waiting.filter((x) => x !== w);
          reject(new Error('Verificarea durează prea mult. Încearcă din nou.'));
        }, WAIT_MS);
      }),
    reset,
    remove: () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
    },
  };
}
