import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { COUNTRIES } from "@/domain/countries";
import { formatDate } from "@/domain/dates";
import { STAGES } from "@/domain/types";
import { LightBadge } from "@/components/badges";
import { CaseTabs } from "@/components/case-tabs";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { NotFoundError, loadCaseBundle } from "@/server/services/bundle";

export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const b = await loadCaseBundle(await getRepo(), actor.organizationId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const k = b.kase;
  const idx = STAGES.indexOf(k.stage);
  const stale = b.eligibility && b.eligibility.dataVersion !== k.dataVersion;
  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/cases" className="hover:underline">Cases</Link> <ChevronRight className="size-3" /> <Link href={`/students/${k.studentId}`} className="hover:underline">{k.studentName}</Link>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{k.studentName}</h1>
          <p className="text-sm text-muted-foreground">
            {k.universityName} · {k.programmeName} · {COUNTRIES[k.country].name} · intake {formatDate(k.intakeStartDate)}
          </p>
          {k.demoTag && <p className="mt-1 text-xs text-amber">Demo scenario: {k.demoTag}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Risk score</div>
            <div className="text-2xl font-semibold tabular-nums">{b.eligibility?.score ?? "—"}<span className="text-sm text-muted-foreground">/100</span></div>
          </div>
          <LightBadge light={b.eligibility?.light} size="lg" />
        </div>
      </div>
      {stale && <div className="text-xs text-amber">Case data changed since the last assessment — it will be re-run before any gate.</div>}
      <ol className="no-print flex gap-1 overflow-x-auto pb-1" aria-label="Case stages">
        {STAGES.map((s, i) => (
          <li key={s} className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${i < idx ? "border-green/30 bg-green-soft text-green" : i === idx ? "border-primary bg-accent font-semibold text-primary" : "text-muted-foreground"}`} aria-current={i === idx ? "step" : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <CaseTabs id={k.id} />
      <div>{children}</div>
    </div>
  );
}
