import { useEffect, useState } from 'react';

const button =
  'press inline-flex h-14 shrink-0 items-center justify-center gap-3 bg-acc px-7 font-display text-2xl font-[800] tracking-wide text-on-acc uppercase';

// Sharing this result page: its link, and a button to copy it.
export default function ShareButton() {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(location.origin + location.pathname), []);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <div className="flex w-full max-w-[30rem] flex-col gap-2 text-left">
      <span className="font-mono text-[11px] tracking-[0.18em] text-dim uppercase">Distribuie</span>
      <div className="flex">
        <output className="flex h-14 min-w-0 flex-1 items-center overflow-x-auto border border-r-0 border-line px-4 font-mono text-xs whitespace-nowrap text-dim select-all">
          {url.replace(/^https?:\/\//, '')}
        </output>
        <button type="button" onClick={copy} className={button}>
          {copied ? 'Copiat' : 'Copiază'}
          {copied && (
            <svg aria-hidden viewBox="0 0 20 20" className="size-5">
              <path d="M3.5 10.5l4.5 4.5 8.5-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
