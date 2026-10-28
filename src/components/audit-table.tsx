import Link from "next/link";
import { formatDateTime } from "@/domain/dates";
import type { AuditEntry } from "@/domain/types";
import { Badge, EmptyState, Table, Td, Th } from "./ui/primitives";

function short(v: unknown): string {
  if (v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 220 ? s.slice(0, 220) + "…" : s;
}

export function AuditTable({ entries, showCase }: { entries: AuditEntry[]; showCase?: boolean }) {
  if (!entries.length) return <EmptyState title="No audit entries" />;
  return (
    <Table>
      <thead><tr><Th>#</Th><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Change</Th><Th>Hash</Th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <Td className="text-xs tabular-nums">{e.seq}</Td>
            <Td className="whitespace-nowrap text-xs">{formatDateTime(e.at)}</Td>
            <Td className="text-xs">{e.userName}<div className="text-muted-foreground">{e.role}</div></Td>
            <Td className="text-xs">
              <code>{e.action}</code>
              {e.ai && <div><Badge tone="blue">AI: {e.ai.source} · {e.ai.model} · {e.ai.promptVersion}</Badge></div>}
              {showCase && e.caseId && <div><Link href={`/cases/${e.caseId}/audit`} className="text-primary underline">case</Link></div>}
            </Td>
            <Td className="max-w-md text-[11px] text-muted-foreground">
              {e.before !== undefined && <div><span className="font-medium">before</span> {short(e.before)}</div>}
              {e.after !== undefined && <div><span className="font-medium">after</span> {short(e.after)}</div>}
            </Td>
            <Td className="font-mono text-[10px] text-muted-foreground" title={`prev ${e.prevHash}`}>{e.hash.slice(0, 10)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
