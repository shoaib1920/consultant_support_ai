import Link from "next/link";
import { formatDate } from "@/domain/dates";
import type { Task } from "@/domain/types";
import { taskStatusAction } from "@/server/actions";
import { ActionButton } from "./client-bits";
import { Badge, EmptyState } from "./ui/primitives";

export function TaskList({ tasks, today, showCase, caseNames }: { tasks: Task[]; today: string; showCase?: boolean; caseNames?: Record<string, string> }) {
  if (!tasks.length) return <EmptyState title="No open tasks">Tasks are generated automatically from the case stage, checklist and deadlines.</EmptyState>;
  return (
    <ul className="divide-y">
      {tasks.map((t) => {
        const overdue = t.status === "open" && t.dueDate && t.dueDate < today;
        return (
          <li key={t.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className={`text-sm ${t.status === "done" ? "text-muted-foreground line-through" : "font-medium"}`}>{t.title}</div>
              {t.detail && <div className="text-xs text-muted-foreground">{t.detail}</div>}
              <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                {showCase && t.caseId && <Link href={`/cases/${t.caseId}/tasks`} className="underline">{caseNames?.[t.caseId] ?? "case"}</Link>}
                {t.dueDate && <span className={overdue ? "font-medium text-red" : ""}>due {formatDate(t.dueDate)}</span>}
                {t.auto ? <Badge className="py-0">auto</Badge> : <Badge className="py-0">manual</Badge>}
                {t.completedBy && <span>done by {t.completedBy}</span>}
              </div>
            </div>
            <ActionButton size="sm" variant="outline" action={taskStatusAction.bind(null, t.id, t.status === "open")}>{t.status === "open" ? "Mark done" : "Reopen"}</ActionButton>
          </li>
        );
      })}
    </ul>
  );
}
