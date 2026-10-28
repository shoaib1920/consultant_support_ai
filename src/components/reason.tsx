import Link from "next/link";
import type { Reason } from "@/domain/types";
import { SeverityBadge } from "./badges";
import { Badge } from "./ui/primitives";

export function ReasonItem({ r, caseId, compact }: { r: Reason; caseId: string; compact?: boolean }) {
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={r.severity} hardFail={r.hardFail} />
        <span className="text-sm font-medium">{r.title}</span>
        {r.insufficientData && <Badge tone="neutral">Insufficient data</Badge>}
        <Badge tone="neutral" className="ml-auto">{r.category}</Badge>
      </div>
      {!compact && <p className="text-xs text-muted-foreground">{r.detail}</p>}
      {r.fix && <p className="text-xs"><span className="font-medium">Fix: </span>{r.fix}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>Based on:</span>
        {r.refs.map((ref, i) => {
          const href = ref.type === "rule" && ref.id ? `/rules?focus=${ref.id}` : ref.type === "document" ? `/cases/${caseId}/documents#${ref.id}` : ref.type === "analysis" ? `/cases/${caseId}/financial` : ref.type === "programme" ? `/programmes` : undefined;
          return href ? (
            <Link key={i} href={href} className="rounded border px-1 hover:bg-muted">{ref.label}</Link>
          ) : (
            <span key={i} className="rounded border px-1">{ref.label}</span>
          );
        })}
        <span>· confidence {r.confidence}</span>
      </div>
    </li>
  );
}
