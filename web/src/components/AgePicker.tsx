export const AGE_RANGES = ['18–24', '25–34', '35–44', '45–54', '55–64', '65+'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

/** URL-safe value for each range ("18–24" → "18-24"). */
export const ageSlug = (r: AgeRange) => r.replace('–', '-');

type Props = {
  value: AgeRange | null;
  onChange: (r: AgeRange) => void;
  /** Briefly outlines the group when the visitor tries to start without picking. */
  missing: boolean;
};

// Native radios (arrow keys, form semantics) styled as a segmented row.
export default function AgePicker({ value, onChange, missing }: Props) {
  return (
    <fieldset
      className={`grid grid-cols-6 border bg-raised/60 transition-colors duration-200 ${missing ? 'nudge border-fg' : 'border-line'}`}
    >
      <legend className="sr-only">Vârsta</legend>
      {AGE_RANGES.map((r) => (
        <label
          key={r}
          className={`press relative flex h-11 cursor-pointer items-center justify-center border-line font-mono text-[11px] tracking-tight whitespace-nowrap tabular-nums transition-colors not-first:border-l sm:text-xs ${
            value === r ? 'bg-fg text-bg' : 'text-dim [@media(hover:hover)]:hover:bg-fg/[0.06] [@media(hover:hover)]:hover:text-fg'
          } has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-acc-fg`}
        >
          <input
            type="radio"
            name="varsta"
            value={ageSlug(r)}
            checked={value === r}
            onChange={() => onChange(r)}
            className="sr-only"
          />
          {r}
        </label>
      ))}
    </fieldset>
  );
}
