import { computeDeadlines, generateTasks } from "@/domain/tasks";
import type { Notification, Task } from "@/domain/types";
import { sha256 } from "../crypto";
import { type Repo, nowISO } from "../db";
import type { Actor } from "../auth/session";
import { type AuditActor, audit } from "./audit";
import { NotFoundError, loadCaseBundle } from "./bundle";

/** Upsert auto tasks for a case; close auto tasks that no longer apply. Raise deadline notifications once. */
export async function syncTasks(repo: Repo, actor: AuditActor, caseId: string) {
  const b = await loadCaseBundle(repo, actor.organizationId, caseId);
  const templates = generateTasks(b.kase, b.documents, b.attestations, b.financial);
  const deadlines = computeDeadlines(b.kase, b.student, b.financial, b.attestations, b.rules);
  await repo.transaction(async (tx) => {
    const existing = await tx.list<Task>("tasks", [
      ["organizationId", "==", actor.organizationId],
      ["caseId", "==", caseId],
    ]);
    const now = nowISO();
    const wanted = new Set<string>();
    for (const t of templates) {
      const id = `tk_${sha256(caseId + t.templateKey).slice(0, 20)}`;
      wanted.add(id);
      const cur = existing.find((e) => e.id === id);
      if (cur) {
        if (cur.status === "open" && (cur.title !== t.title || cur.detail !== t.detail)) await tx.update<Task>("tasks", id, { title: t.title, detail: t.detail, updatedAt: now });
        continue;
      }
      await tx.set<Task>("tasks", id, {
        id,
        organizationId: actor.organizationId,
        createdAt: now,
        updatedAt: now,
        caseId,
        studentId: b.kase.studentId,
        templateKey: t.templateKey,
        title: t.title,
        detail: t.detail,
        stage: t.stage,
        dueDate: t.dueDate,
        assigneeId: b.kase.assignedOfficerId,
        status: "open",
        auto: true,
      });
    }
    for (const e of existing.filter((x) => x.auto && x.status === "open" && !wanted.has(x.id))) {
      await tx.update<Task>("tasks", e.id, { status: "done", completedAt: now, completedBy: "system (no longer applicable)", updatedAt: now });
    }
    for (const d of deadlines.filter((x) => x.daysLeft >= 0 && x.daysLeft <= 14)) {
      if (!b.kase.assignedOfficerId) break;
      const id = `nt_dl_${sha256(caseId + d.key + d.date).slice(0, 18)}`;
      if (await tx.get("notifications", id)) continue;
      await tx.set<Notification>("notifications", id, { id, organizationId: actor.organizationId, userId: b.kase.assignedOfficerId, caseId, title: `${d.daysLeft} days: ${d.label}`, body: `${b.kase.studentName} — due ${d.date}`, link: `/cases/${caseId}/tasks`, kind: d.daysLeft <= 7 ? "critical" : "warning", read: false, createdAt: now, updatedAt: now });
    }
  });
}

export async function setTaskStatus(repo: Repo, actor: Actor, taskId: string, done: boolean) {
  await repo.transaction(async (tx) => {
    const t = await tx.get<Task>("tasks", taskId);
    if (!t || t.organizationId !== actor.organizationId) throw new NotFoundError("Task");
    const now = nowISO();
    await tx.update<Task>("tasks", taskId, done ? { status: "done", completedAt: now, completedBy: actor.name, updatedAt: now } : { status: "open", completedAt: undefined, completedBy: undefined, updatedAt: now });
    await audit(tx, actor, { action: done ? "task.completed" : "task.reopened", entity: "tasks", entityId: taskId, caseId: t.caseId, after: { title: t.title } });
  });
}

export async function createManualTask(repo: Repo, actor: Actor, input: { caseId?: string; title: string; detail?: string; dueDate?: string; assigneeId?: string }) {
  const now = nowISO();
  const id = `tk_m_${sha256(now + input.title + actor.id).slice(0, 16)}`;
  await repo.transaction(async (tx) => {
    await tx.set<Task>("tasks", id, { id, organizationId: actor.organizationId, createdAt: now, updatedAt: now, caseId: input.caseId, templateKey: "manual", title: input.title, detail: input.detail, dueDate: input.dueDate, assigneeId: input.assigneeId ?? actor.id, status: "open", auto: false });
    await audit(tx, actor, { action: "task.created", entity: "tasks", entityId: id, caseId: input.caseId, after: input });
  });
}
