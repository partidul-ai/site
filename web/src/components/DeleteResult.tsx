import { useRef, useState } from 'react';

// "Șterge rezultatul" on your own result: asks once, then deletes it (and takes it out of the
// averages) and goes home.
export default function DeleteResult() {
  const ask = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/delete', { method: 'POST' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Ceva n-a mers.');
      location.href = '/';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => ask.current?.showModal()}
        className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase underline-offset-4 hover:text-fg hover:underline"
      >
        Șterge rezultatul
      </button>
      <dialog
        ref={ask}
        onClick={(e) => e.target === e.currentTarget && ask.current?.close()}
        className="leave-dialog m-auto w-[min(26rem,calc(100%-2rem))] border border-line bg-raised p-6 text-left text-fg shadow-2xl shadow-black/30 sm:p-8"
      >
        {/* Focus starts on the X, so a stray Enter doesn't delete. */}
        <button autoFocus onClick={() => ask.current?.close()} aria-label="Închide" className="absolute top-3 right-3 grid size-9 place-items-center text-dim hover:text-fg">
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
        </button>
        <h2 className="pr-8 font-display text-4xl leading-[0.95] font-[850] uppercase">Ștergi rezultatul?</h2>
        <button onClick={remove} disabled={busy} className="press mt-6 h-12 w-full bg-acc font-display text-xl font-[800] tracking-wide text-on-acc uppercase disabled:opacity-60">
          Șterge
        </button>
        {error && <p className="mt-3 text-sm text-acc-fg">{error}</p>}
      </dialog>
    </>
  );
}
