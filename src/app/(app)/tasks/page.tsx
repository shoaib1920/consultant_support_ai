import Link from "next/link";
import { formatDateTime, todayISO } from "@/domain/dates";
import type { Case, Notification, Task } from "@/domain/types";
import { ActionButton } from "@/components/client-bits";
import { TaskList } from "@/components/task-list";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { markNotificationsReadAction } from "@/server/actions";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const metadata = { title: "Tasks & deadlines" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const actor = await staffPage("case.read");
  const { all } = await searchParams;
  const repo = await getRepo();
  const org: [string, "==", string] = ["organizationId", "==", actor.organizationId];
  const [tasks, cases, notes] = await Promise.all([
    repo.list<Task>("tasks", [org, ["status", "==", "open"]]).then((ts) => ts.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))),
    repo.list<Case>("cases", [org]),
    repo.list<Notification>("notifications", [org, ["userId", "==", actor.id]], { orderBy: "createdAt", desc: true, limit: 50 }),
  ]);
  const mine = all ? tasks : tasks.filter((t) => t.assigneeId === actor.id);
  const names = Object.fromEntries(cases.map((c) => [c.id, c.studentName]));
  const today = todayISO();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <PageHeader title="Tasks & deadlines" description="Auto-generated per country and stage; overdue items in red." actions={<Link href={all ? "/tasks" : "/tasks?all=1"} className="text-sm text-primary underline">{all ? "Show only mine" : "Show everyone's"}</Link>} />
        <Card>
          <CardHeader><CardTitle>{all ? "All open tasks" : "My open tasks"} ({mine.length})</CardTitle></CardHeader>
          <CardContent><TaskList tasks={mine} today={today} showCase caseNames={names} /></CardContent>
        </Card>
      </div>
      <Card id="notifications" className="self-start">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Notifications</CardTitle>
          {notes.some((n) => !n.read) && <ActionButton size="sm" variant="ghost" action={markNotificationsReadAction}>Mark all read</ActionButton>}
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? <EmptyState title="No notifications" /> : (
            <ul className="divide-y">
              {notes.map((n) => (
                <li key={n.id} className={`py-2 text-sm ${n.read ? "text-muted-foreground" : ""}`}>
                  <div className="flex items-center gap-2">{!n.read && <span className="size-2 rounded-full bg-primary" aria-label="unread" />}<Badge tone={n.kind === "critical" ? "red" : n.kind === "warning" ? "amber" : "neutral"}>{n.kind}</Badge> {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}</div>
                  <div className="text-xs">{n.body}</div>
                  <div className="text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
