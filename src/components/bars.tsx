// Single-series horizontal bars: one hue, value label in text ink, hover title per bar.

export function Bars({ rows, format = (n) => String(n) }: { rows: { label: string; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-1.5" role="table">
      {rows.map((r) => (
        <div key={r.label} role="row" className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${format(r.value)}${r.sub ? ` — ${r.sub}` : ""}`}>
          <span role="cell" className="truncate text-muted-foreground">{r.label}</span>
          <span role="cell" className="h-3 rounded-r-[4px] bg-muted">
            <span className="block h-full rounded-r-[4px] bg-primary/80" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0 }} />
          </span>
          <span role="cell" className="w-10 text-right font-medium tabular-nums">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
