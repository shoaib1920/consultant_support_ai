import { MessageCircle, Mail } from "lucide-react";
import { formatDate, todayISO } from "@/domain/dates";
import { computeDeadlines } from "@/domain/tasks";
import { buildTemplates } from "@/domain/templates";
import type { Organization, Task } from "@/domain/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/client-bits";
import { TaskList } from "@/components/task-list";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { createTaskAction } from "@/server/actions";
import { can } from "@/server/auth/rbac";
import { getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";
import { loadCaseBundle } from "@/server/services/bundle";

export const metadata = { title: "Tasks & messages" };

export default async function CaseTasks({ params }: { params: Promise<{ id: string }> }) {
  const actor = await staffPage("case.read");
  const { id } = await params;
  const repo = await getRepo();
  const b = await loadCaseBundle(repo, actor.organizationId, id);
  const tasks = (await repo.list<Task>("tasks", [["organizationId", "==", actor.organizationId], ["caseId", "==", id]])).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const org = await repo.get<Organization>("organizations", actor.organizationId);
  const deadlines = computeDeadlines(b.kase, b.student, b.financial, b.attestations, b.rules);
  const templates = buildTemplates(b.student, b.kase, b.documents, deadlines, org?.name ?? "Your consultancy");
  const today = todayISO();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader><CardTitle>Open tasks</CardTitle></CardHeader>
          <CardContent><TaskList tasks={tasks.filter((t) => t.status === "open")} today={today} /></CardContent>
        </Card>
        {can(actor.role, "case.write") && (
          <Card>
            <CardHeader><CardTitle>Add a manual task</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={createTaskAction} resetOnSuccess>
                <input type="hidden" name="caseId" value={id} />
                <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                  <Field label="Task"><Input name="title" required minLength={3} /></Field>
                  <Field label="Due"><Input name="dueDate" type="date" /></Field>
                  <SubmitButton>Add</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Copy-ready messages</CardTitle>
            <CardDescription>Nothing is sent automatically. Copy, check, and send from your own WhatsApp/email. Internal scores are never included.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {templates.map((t) => (
              <div key={t.key} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">{t.channel === "whatsapp" ? <MessageCircle className="size-4" /> : <Mail className="size-4" />} {t.label} <Badge>{t.channel}</Badge></span>
                  <CopyButton text={t.subject ? `Subject: ${t.subject}\n\n${t.body}` : t.body} />
                </div>
                {t.subject && <div className="mb-1 text-xs font-medium">Subject: {t.subject}</div>}
                <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">{t.body}</pre>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle>Countdowns</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {deadlines.map((d) => (
                <li key={d.key} className="flex items-start justify-between gap-2 text-sm">
                  <span className="text-xs">{d.label}<br /><span className="text-muted-foreground">{formatDate(d.date)}</span></span>
                  <Badge tone={d.daysLeft < 0 ? "solidRed" : d.severity === "critical" ? "red" : d.severity === "warning" ? "amber" : "neutral"}>{d.daysLeft < 0 ? `${-d.daysLeft}d ago` : `${d.daysLeft}d`}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Completed</CardTitle></CardHeader>
          <CardContent><TaskList tasks={tasks.filter((t) => t.status === "done").slice(0, 20)} today={today} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
