import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COUNTIES, countyByCode } from '../data/counties';

// "brasov" should match "Brașov": strip diacritics before comparing.
const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const SEARCH = COUNTIES.map((c) => ({
  county: c,
  key: fold(c.code === 'DIASPORA' ? `${c.name} strainatate` : c.name),
}));

function search(query: string) {
  const q = fold(query);
  if (!q) return COUNTIES;
  const starts = [], contains = [];
  for (const { county, key } of SEARCH) {
    if (key.startsWith(q) || key.split(/[\s-]/).some((w) => w.startsWith(q)) || fold(county.code) === q)
      starts.push(county);
    else if (key.includes(q)) contains.push(county);
  }
  return [...starts, ...contains];
}

type Props = {
  value: string | null;
  onChange: (code: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
};

export default function CountyCombobox({ value, onChange, inputRef }: Props) {
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);

  const results = useMemo(() => search(query), [query]);
  const selectedName = countyByCode(value)?.name ?? '';

  // Open upwards when there isn't room below (the page never scrolls).
  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropUp(window.innerHeight - r.bottom < 280 && r.top > window.innerHeight - r.bottom);
  }, [open, inputRef]);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    setOpen(true);
    setQuery('');
    const i = COUNTIES.findIndex((c) => c.code === value);
    setActive(Math.max(0, i));
  };

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[active]) {
        e.preventDefault();
        choose(results[active].code);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={`${id}-input`} className="sr-only">
        Județul
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-opt-${results[active].code}` : undefined}
        size={1}
        autoComplete="off"
        spellCheck={false}
        placeholder={selectedName || 'Alege județul'}
        value={open ? query : selectedName}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="h-14 w-full border border-line bg-raised/60 pr-11 pl-4 text-lg text-fg outline-none transition-colors duration-150 placeholder:text-faint hover:border-faint focus:border-acc-fg"
      />
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-dim transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      >
        <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      </svg>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label="Județe"
          style={{ '--from': dropUp ? '6px' : '-6px', transformOrigin: dropUp ? 'bottom' : 'top' } as React.CSSProperties}
          className={`listbox absolute right-0 left-0 z-20 max-h-72 overflow-y-auto overscroll-contain border border-line bg-raised p-1 shadow-2xl shadow-black/60 ${dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          {results.length === 0 && (
            <li className="px-3 py-2.5 font-mono text-xs tracking-wider text-dim uppercase">Nimic găsit</li>
          )}
          {results.map((c, i) => (
            <li
              key={c.code}
              id={`${id}-opt-${c.code}`}
              data-index={i}
              role="option"
              aria-selected={c.code === value}
              // Keep focus in the input so blur doesn't close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c.code)}
              onMouseMove={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2.5 text-base ${i === active ? 'bg-fg/[0.07]' : ''} ${c.code === value ? 'text-acc-fg' : ''}`}
            >
              <span>{c.name}</span>
              <span className={`font-mono text-[11px] tracking-wider ${c.code === value ? 'text-acc-fg' : 'text-faint'}`}>
                {c.code === 'DIASPORA' ? '' : c.code}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
