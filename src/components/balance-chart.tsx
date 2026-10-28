// Daily balance line vs the required amount, with the holding window shaded.
// Single series (no legend box); hover a day for its exact balance.

import { formatDate } from "@/domain/dates";

export function BalanceChart({ daily, required, window, currency, failDate }: { daily: { date: string; balance: number }[]; required: number; window?: { start: string; end: string }; currency: string; failDate?: string }) {
  if (!daily.length) return null;
  const W = 720;
  const H = 200;
  const P = { l: 64, r: 12, t: 12, b: 24 };
  const max = Math.max(required, ...daily.map((d) => d.balance)) * 1.08;
  const min = Math.min(required, ...daily.map((d) => d.balance)) * 0.9;
  const x = (i: number) => P.l + (i / Math.max(1, daily.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const path = daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join(" ");
  const wi = window ? [daily.findIndex((d) => d.date === window.start), daily.findIndex((d) => d.date === window.end)] : [-1, -1];
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
  const fi = failDate ? daily.findIndex((d) => d.date === failDate) : -1;
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Daily balance in ${currency} against required ${fmt(required)}`}>
        {wi[0] >= 0 && <rect x={x(wi[0])} y={P.t} width={Math.max(2, x(wi[1] >= 0 ? wi[1] : daily.length - 1) - x(wi[0]))} height={H - P.t - P.b} className="fill-accent" />}
        {[0, 0.5, 1].map((t) => {
          const v = min + t * (max - min);
          return (
            <g key={t}>
              <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
              <text x={P.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{fmt(v)}</text>
            </g>
          );
        })}
        <line x1={P.l} x2={W - P.r} y1={y(required)} y2={y(required)} className="stroke-red" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - P.r} y={y(required) - 4} textAnchor="end" className="fill-red text-[10px] font-medium">required {fmt(required)}</text>
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />
        {fi >= 0 && <circle cx={x(fi)} cy={y(daily[fi].balance)} r={5} className="fill-red stroke-card" strokeWidth={2} />}
        <text x={P.l} y={H - 6} className="fill-muted-foreground text-[10px]">{formatDate(daily[0].date)}</text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">{formatDate(daily[daily.length - 1].date)}</text>
        {daily.map((d, i) => (
          <rect key={d.date} x={x(i) - (W - P.l - P.r) / daily.length / 2} y={P.t} width={(W - P.l - P.r) / daily.length} height={H - P.t - P.b} fill="transparent">
            <title>{`${formatDate(d.date)}: ${currency} ${Math.round(d.balance).toLocaleString("en-GB")}${d.balance < required ? " — below requirement" : ""}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="mt-1 text-[11px] text-muted-foreground">Shaded = holding window tested. Dashed red = required amount. Red dot = first day below requirement. Hover for daily balance.</figcaption>
    </figure>
  );
}
