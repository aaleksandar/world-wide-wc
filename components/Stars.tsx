/** A 1–5 rating. `value` of 0 means nobody has said, and shows as five empty stars. */
export function Stars({ value, label }: { value: number; label?: string }) {
  const filled = Math.round(value);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={value ? `${value.toFixed(1)} out of 5` : "not rated"}
    >
      {[1, 2, 3, 4, 5].map((position) => (
        <svg
          key={position}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`size-3.5 ${
            value && position <= filled
              ? "fill-amber-400"
              : "fill-zinc-200 dark:fill-zinc-700"
          }`}
        >
          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9l-5.3 2.7 1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
      ))}
      {label ? <span className="ml-1.5 text-xs text-zinc-500">{label}</span> : null}
    </span>
  );
}
