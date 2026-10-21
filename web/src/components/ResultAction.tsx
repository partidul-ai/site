import { useEffect, useState } from 'react';
import DeleteResult from './DeleteResult';
import ShareButton from './ShareButton';

const buttonClass =
  'press inline-flex h-14 items-center justify-center gap-3 bg-acc px-7 font-display text-2xl font-[800] tracking-wide text-on-acc uppercase';

// Your own result (finished in this tab): share it, or delete it. Anyone else's: go take the quiz.
// Decided in the browser; until then the button's space is reserved so nothing jumps.
export default function ResultAction() {
  const [mine, setMine] = useState<boolean | null>(null);
  // Set on <html> by the page before first paint, from the token this tab kept.
  useEffect(() => setMine('mine' in document.documentElement.dataset), []);

  if (mine === null) return <div className="h-14" aria-hidden />;
  if (mine)
    return (
      <div className="flex w-full flex-col items-center gap-5 lg:items-start">
        <ShareButton />
        <DeleteResult />
      </div>
    );
  return (
    <a href="/" className={buttonClass}>
      Spune și tu →
    </a>
  );
}
