import { useEffect, useRef, useState } from 'react';
import { countyByCode } from '../data/counties';
import { QUIZ_KEY, WHERE_KEY } from '../lib/quiz-storage';

type Question = {
  id: string;
  type: 'single' | 'yesno' | 'scale' | 'multi';
  text: string;
  maxSelect?: number;
  minSelect?: number; // the topic pick: exactly this many, and no skipping
  scale?: { minLabel: string; maxLabel: string };
  choices: { id: string; label: string }[];
};
type Step = { done: false; token: string; n: number; total: number; question: Question } | { done: true; n: number; total: number; result: string };

async function post(path: string, body: unknown): Promise<Step> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as Step & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Ceva n-a mers.');
  return data;
}

const optionClass = (on: boolean) =>
  `press w-full border px-4 py-3.5 text-left text-base transition-colors sm:text-lg lg:px-5 lg:py-4 ${
    on ? 'border-fg bg-fg text-bg' : 'border-line bg-raised/60 hover:border-faint'
  }`;

export default function Quiz() {
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [where, setWhere] = useState('');
  // "Renunță" asks once more in a dialog, so a stray tap doesn't lose the quiz.
  const leave = useRef<HTMLDialogElement>(null);
  const quit = () => {
    try {
      sessionStorage.removeItem(QUIZ_KEY);
      sessionStorage.removeItem(WHERE_KEY);
    } catch {}
    location.href = '/';
  };

  // The session is created by the start button on the landing page; this page only
  // continues it (and resumes it after a reload). Opened directly, it creates nothing.
  useEffect(() => {
    let saved: Step | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(QUIZ_KEY) ?? 'null');
      // t: an area being unlocked from the results page; otherwise the county and age.
      const { c, a, t } = JSON.parse(sessionStorage.getItem(WHERE_KEY) ?? '{}');
      const county = countyByCode(c);
      if (t) setWhere(t);
      else if (county) setWhere(`${county.code} ${a ?? ''}`);
    } catch {}
    if (saved) setStep(saved);
    else setError('Alege județul și vârsta pe prima pagină.');
  }, []);

  useEffect(() => {
    try {
      if (step && !step.done) sessionStorage.setItem(QUIZ_KEY, JSON.stringify(step));
      else if (step?.done) sessionStorage.removeItem(QUIZ_KEY);
    } catch {}
  }, [step]);

  const send = async (choices: string[] | null) => {
    if (!step || step.done || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Let the question finish leaving before the next one comes in, however fast the answer is.
      const [nextStep] = await Promise.all([post('/api/answer', { token: step.token, choices }), new Promise((r) => setTimeout(r, 200))]);
      if (nextStep.done) {
        sessionStorage.removeItem(QUIZ_KEY);
        sessionStorage.removeItem(WHERE_KEY);
        // Stay busy (the question stays gone) while the results page loads.
        location.href = `/r/${nextStep.result}`;
        return;
      }
      setStep(nextStep);
      setPicked([]);
      setBusy(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // Fills the screen: on large screens the question sits left in big type and the answers right.
  if (error && !step)
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-4">
        <p className="text-lg lg:text-2xl">{error}</p>
        <a href="/" className="font-mono text-[11px] tracking-[0.18em] uppercase underline underline-offset-4">← Înapoi</a>
      </div>
    );

  if (!step) return <p className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">Se încarcă…</p>;

  if (step.done)
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-6">
        <p className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">{where}</p>
        <h1 className="font-display text-[clamp(3.5rem,12vw,10rem)] leading-[0.95] font-[850] uppercase">
          Mulțumim.
          <br />
          <span className="hl">Ai spus-o.</span>
        </h1>
        <a href="/" className="font-mono text-[11px] tracking-[0.18em] uppercase underline underline-offset-4 decoration-acc-fg">← Înapoi</a>
      </div>
    );

  const q = step.question;
  const na = q.choices.find((c) => c.id === 'na');
  const real = q.choices.filter((c) => c.id !== 'na');
  const multi = q.type === 'multi';
  const max = q.maxSelect ?? real.length;
  const min = q.minSelect ?? 1;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-x-clip" aria-busy={busy}>
      <div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 font-mono text-[11px] tracking-[0.18em] text-dim uppercase">
          <span className="truncate">{where}</span>
          {/* The topic pick (step 0) isn't counted as a question: 0 / 20 on it, 20 / 20 on the last. */}
          <span className="tabular-nums">{step.n} / {step.total - 1}</span>
          <span className="flex justify-end">
            <button onClick={() => leave.current?.showModal()} className="uppercase hover:text-fg">Renunță ✕</button>
          </span>
        </div>
        <div className="mt-2 h-1 bg-line">
          <div className="h-full bg-acc-fg transition-[width] duration-300" style={{ width: `${(step.n / (step.total - 1)) * 100}%` }} />
        </div>
      </div>

      {/* One card per question: leaves to the left once answered, the next comes in from the right. */}
      <div key={step.n} className={`q-card ${busy ? 'q-leave' : ''} grid flex-1 content-start gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:content-center lg:items-center lg:gap-20 lg:pb-[6vh]`}>
        <h1 className="text-2xl leading-snug font-semibold text-balance sm:text-3xl lg:text-[clamp(2.25rem,3.4vw,4rem)] lg:leading-[1.1] lg:tracking-[-0.01em]">
          {q.text}
        </h1>

        <div className="flex flex-col gap-6">
          {q.type === 'scale' ? (
            <div>
              <div className="grid grid-cols-5 gap-2">
                {real.map((c) => (
                  <button
                    key={c.id}
                    disabled={busy}
                    onClick={() => send([c.id])}
                    className="press h-14 border border-line bg-raised/60 font-display text-2xl font-[800] hover:border-faint lg:h-24 lg:text-5xl"
                  >
                    {c.id}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-between gap-4 text-sm text-dim lg:text-base">
                <span>{q.scale?.minLabel}</span>
                <span className="text-right">{q.scale?.maxLabel}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {multi && <p className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">{min === max ? `Alege ${max} · ${picked.length} / ${max}` : `Alege cel mult ${max}`}</p>}
              {real.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => (multi ? toggle(c.id) : send([c.id]))}
                  className={optionClass(picked.includes(c.id))}
                >
                  {c.label}
                </button>
              ))}
              {multi && (
                <button
                  disabled={busy || picked.length < min}
                  onClick={() => send(picked)}
                  className="press mt-2 h-14 bg-acc font-display text-2xl font-[800] tracking-wide text-on-acc uppercase disabled:opacity-40"
                >
                  Continuă →
                </button>
              )}
            </div>
          )}

          {!q.minSelect && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {na ? (
              <button disabled={busy} onClick={() => send(['na'])} className="text-left text-dim underline-offset-4 hover:text-fg hover:underline">
                {na.label}
              </button>
            ) : <span />}
            <button disabled={busy} onClick={() => send(null)} className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase hover:text-fg">
              Sari peste →
            </button>
          </div>}

          {error && <p className="text-sm text-acc-fg">{error}</p>}
        </div>
      </div>

      <dialog
        ref={leave}
        onClick={(e) => e.target === e.currentTarget && leave.current?.close()}
        className="leave-dialog m-auto w-[min(26rem,calc(100%-2rem))] border border-line bg-raised p-6 text-fg shadow-2xl shadow-black/30 sm:p-8"
      >
        {/* Focus starts on the X, so a stray Enter doesn't quit. */}
        <button autoFocus onClick={() => leave.current?.close()} aria-label="Închide" className="absolute top-3 right-3 grid size-9 place-items-center text-dim hover:text-fg">
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
        <h2 className="font-display text-4xl leading-[0.95] font-[850] uppercase">Renunți?</h2>
        <p className="mt-3 text-dim">Răspunsurile de până acum nu intră în rezultate.</p>
        <button onClick={quit} className="press mt-6 h-12 w-full bg-acc font-display text-xl font-[800] tracking-wide text-on-acc uppercase">
          Renunță
        </button>
      </dialog>
    </div>
  );
}
