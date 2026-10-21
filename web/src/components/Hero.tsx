import { useCallback, useEffect, useRef, useState } from 'react';
import { countyByCode } from '../data/counties';
import { QUIZ_KEY, WHERE_KEY, myResult, type MyResult } from '../lib/quiz-storage';
import { mountTurnstile } from '../lib/turnstile-client';
import { DOT_VIEW } from '../data/dots';
import AgePicker, { AGE_RANGES, ageSlug, type AgeRange } from './AgePicker';
import CountyCombobox from './CountyCombobox';
import DotMap, { DISCS } from './DotMap';

const STORAGE_KEY = 'judet';
const AGE_KEY = 'varsta';

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const RESULT_WAIT_MS = 1200;

function Readout({ code, ref }: { code: string | null; ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="pointer-events-none flex h-10 w-full items-end justify-end lg:h-13" aria-live="polite">
      <div className="font-display text-2xl leading-none font-[800] tracking-tight uppercase lg:text-4xl">
        {countyByCode(code)?.name}
      </div>
    </div>
  );
}

export default function Hero() {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [age, setAge] = useState<AgeRange | null>(null);
  const [ageMissing, setAgeMissing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // A quiz started in this tab: the form gives way to a single "Continuă". One finished in this
  // tab: "Continuă", or "Vezi rezultatul" once all its areas are done (asked from /api/me).
  const [resume, setResume] = useState<{ n: number; total: number } | null>(null);
  const [result, setResult] = useState<MyResult | null>(null);
  // Which of the two to show is only known after asking the server (myResult), so the controls
  // wait for that, then fade in.
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapColRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const humanRef = useRef<HTMLDivElement>(null);
  const turnstile = useRef<ReturnType<typeof mountTurnstile> | null>(null);
  // Cloudflare wants a box ticked: shown as a dialog, but only once "Începe" was clicked.
  const [needsCheck, setNeedsCheck] = useState(false);
  // Bumped when the dialog is dismissed, so a token that arrives later doesn't start the quiz.
  const attempt = useRef(0);
  const [mapWidth, setMapWidth] = useState(0);
  const { width: W, height: H } = DOT_VIEW;

  // Largest map that fits the column with the readout under it. Measured in JS rather than
  // with container-query units, which some browsers don't recompute when the window grows.
  useEffect(() => {
    const col = mapColRef.current!;
    const ro = new ResizeObserver(() => {
      const free = col.clientHeight - (readoutRef.current?.offsetHeight ?? 0);
      setMapWidth(Math.max(0, Math.floor(Math.min(col.clientWidth, (free * W) / H))));
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    let inQuiz = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (countyByCode(saved)) setSelected(saved);
      const savedAge = AGE_RANGES.find((r) => r === localStorage.getItem(AGE_KEY));
      if (savedAge) setAge(savedAge);
      const step = JSON.parse(sessionStorage.getItem(QUIZ_KEY) ?? 'null');
      if (step && !step.done) {
        inQuiz = true;
        setResume({ n: step.n, total: step.total });
        const { c } = JSON.parse(sessionStorage.getItem(WHERE_KEY) ?? '{}');
        if (countyByCode(c)) setSelected(c);
      }
    } catch {}
    if (inQuiz) return setReady(true);
    // Don't hold the form back for a slow answer: past the timeout, a late result is dropped.
    let late = false;
    const timeout = setTimeout(() => ((late = true), setReady(true)), RESULT_WAIT_MS);
    myResult().then((r) => {
      if (late) return;
      clearTimeout(timeout);
      setResult(r);
      setReady(true);
    });
    return () => clearTimeout(timeout);
  }, []);

  /** Props for the i-th piece of the controls: hidden until ready, then fading in. */
  const appear = (i: number) =>
    ready ? { className: 'fade-in', style: { '--i': i } as React.CSSProperties } : { className: 'invisible' };

  // The bot check runs while the form is up, so its token is ready by the click.
  const showForm = !resume && !result;
  useEffect(() => {
    if (!showForm || !humanRef.current) return;
    const t = (turnstile.current = mountTurnstile(humanRef.current, setNeedsCheck));
    return () => t.remove();
  }, [showForm]);

  const checking = needsCheck && starting;
  const cancelCheck = () => {
    attempt.current++;
    setStarting(false);
  };
  useEffect(() => {
    if (!checking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelCheck();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [checking]);

  const pickAge = (r: AgeRange) => {
    setAge(r);
    setAgeMissing(false);
    try {
      localStorage.setItem(AGE_KEY, r);
    } catch {}
  };

  const select = useCallback((code: string) => {
    setSelected(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {}
  }, []);

  const start = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (starting) return;
    if (!age) {
      setAgeMissing(true);
      setTimeout(() => setAgeMissing(false), 1400);
      return;
    }
    if (!selected) {
      inputRef.current?.focus();
      return;
    }
    // The click creates the quiz session; /quiz only continues one. So crawlers and
    // link previews that open the quiz URL never touch the database, and bots get the honeypot.
    const honeypot = new FormData(e.currentTarget).get('website');
    if (honeypot) return;
    setStarting(true);
    setStartError(null);
    const mine = ++attempt.current;
    try {
      const post = async () => {
        const human = await turnstile.current!.token();
        if (mine !== attempt.current) return null; // the check was dismissed meanwhile
        return fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ judet: selected, varsta: ageSlug(age), website: '', elapsed: Math.round(performance.now()), human }),
        });
      };
      let res = await post();
      // 403: Cloudflare didn't accept the token (usually expired). A token works once, so get a
      // new one and try once more before saying anything.
      if (res?.status === 403) {
        turnstile.current!.reset();
        res = await post();
      }
      if (!res) return;
      const step = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(step.error ?? 'Ceva n-a mers. Încearcă din nou.');
      sessionStorage.setItem(QUIZ_KEY, JSON.stringify(step));
      sessionStorage.setItem(WHERE_KEY, JSON.stringify({ c: selected, a: ageSlug(age) }));
      window.location.href = '/quiz';
    } catch (err) {
      setStartError((err as Error).message);
      setStarting(false);
      turnstile.current?.reset(); // a token works once
    }
  };

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-[1440px] flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-x-16 gap-y-4 px-4 sm:px-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-2 lg:gap-y-10">
      {/* Headline */}
      <div className="flex flex-col justify-end lg:row-start-1">
        {/* Two lines, kept under the full width ("SPUNE CE MERGE." is ~6.2em) so the map gets the room. */}
        <h1 className="font-display text-[min(calc((100vw-2rem)/7.4),7.5dvh)] leading-[0.86] font-[850] tracking-[-0.01em] whitespace-nowrap uppercase sm:text-[min(calc((100vw-4rem)/7.4),9dvh)] lg:text-[clamp(2.75rem,4.6vw,6rem)]">
          <span className="line-mask"><span style={{ '--i': 0 } as React.CSSProperties}>Spune ce merge.</span></span>
          <span className="line-mask"><span style={{ '--i': 1 } as React.CSSProperties}><span className="hl">Și ce nu.</span></span></span>
        </h1>
      </div>

      {/* Map */}
      <div
        ref={mapColRef}
        className="fade-up relative min-h-0 min-w-0 overflow-hidden lg:col-start-2 lg:row-span-2 lg:row-start-1"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        {/* Absolutely positioned, so the map's size can never feed back into the column it is measured from. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="relative max-w-full" style={{ width: mapWidth, aspectRatio: `${W} / ${H}` }}>
            <DotMap selected={selected} hovered={hovered} onSelect={select} onHover={setHovered} />
            {/* Centred under each disc; on phones flush with its outer edge, so the label stays on screen. */}
            {DISCS.map((c) => (
              <div
                key={c.code}
                className={`pointer-events-none absolute font-mono text-[9px] tracking-[0.2em] uppercase transition-colors sm:left-(--c) sm:right-auto sm:-translate-x-1/2 sm:text-[10px] ${c.x < W / 2 ? 'left-(--e)' : 'right-(--e)'} ${selected === c.code ? 'text-acc-fg' : 'text-dim'}`}
                style={{ '--c': pct(c.x, W), '--e': c.x < W / 2 ? pct(c.x - c.r, W) : pct(W - c.x - c.r, W), top: pct(c.y + c.r + 10, H) } as React.CSSProperties}
              >
                {c.label}
              </div>
            ))}
          </div>
          <div className="w-full" style={{ maxWidth: mapWidth || undefined }}>
            <Readout ref={readoutRef} code={hovered ?? selected} />
          </div>
        </div>
      </div>

      {/* Form, or "Continuă" when a quiz is under way in this tab */}
      <div className="lg:row-start-2">
        {resume || result ? (
          <div className="flex flex-col gap-2">
            <p {...appear(2)}>
              <span className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">
                {resume ? `Chestionar început · ${resume.n} / ${resume.total - 1}` : `${result!.done} / ${result!.total} domenii completate`}
              </span>
            </p>
            <div {...appear(3)}>
            {/* A result with areas still locked: "Continuă" to it, where they unlock. */}
            <a
              href={resume ? '/quiz' : `/r/${result!.result}`}
              className="press group inline-flex h-14 items-center justify-center gap-3 bg-acc px-7 font-display text-2xl font-[800] tracking-wide text-on-acc uppercase"
            >
              {resume || result!.done < result!.total ? 'Continuă' : 'Vezi rezultatul'}
              <svg aria-hidden viewBox="0 0 20 20" className="size-5 transition-transform duration-200 ease-out [@media(hover:hover)]:group-hover:translate-x-1">
                <path d="M3 10h13m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
              </svg>
            </a>
            </div>
          </div>
        ) : (
        <form onSubmit={start} className="flex flex-col gap-2">
          {/* Honeypot: off-screen and skipped by keyboard and screen readers, so only bots fill it in. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="pointer-events-none absolute -left-[10000px] h-px w-px opacity-0"
          />
          <div {...appear(2)}>
            <AgePicker value={age} onChange={pickAge} missing={ageMissing} />
          </div>
          <div {...appear(3)}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch lg:flex-col">
            <CountyCombobox value={selected} onChange={select} inputRef={inputRef} />
            <button
              type="submit"
              disabled={starting}
              className="press group inline-flex h-14 shrink-0 items-center justify-center gap-3 bg-acc px-7 font-display text-2xl font-[800] tracking-wide text-on-acc uppercase disabled:opacity-60"
            >
              Începe
              <svg aria-hidden viewBox="0 0 20 20" className="size-5 transition-transform duration-200 ease-out [@media(hover:hover)]:group-hover:translate-x-1">
                <path d="M3 10h13m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
              </svg>
            </button>
          </div>
          </div>
          {/* Cloudflare's bot check. Usually silent; when it wants a box ticked, that shows as a
              dialog after "Începe". Faded out rather than display:none, so the check can still run. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Verificare"
            aria-hidden={!checking}
            onClick={(e) => e.target === e.currentTarget && cancelCheck()}
            className={`fixed inset-0 z-50 flex items-center justify-center bg-bg/85 backdrop-blur-sm transition-opacity duration-200 ${checking ? '' : 'pointer-events-none opacity-0'}`}
          >
            <div ref={humanRef} />
          </div>
          {startError && <p className="font-mono text-[11px] tracking-[0.12em] text-acc-fg uppercase">{startError}</p>}
        </form>
        )}
      </div>
    </div>
  );
}
