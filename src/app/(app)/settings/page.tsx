import { Bot, Database, KeyRound, RotateCcw } from "lucide-react";
import type { Organization, User } from "@/domain/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ActionButton } from "@/components/client-bits";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { createUserAction, resetDemoAction, toggleUserAction } from "@/server/actions";
import { aiConfigured } from "@/server/ai";
import { ROLE_LABELS, can } from "@/server/auth/rbac";
import { demoMode } from "@/server/auth/session";
import { firebaseConfigured, getRepo } from "@/server/db";
import { staffPage } from "@/server/page-guard";

export const maxDuration = 300;
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await staffPage("case.read");
  const repo = await getRepo();
  const [org, users] = await Promise.all([repo.get<Organization>("organizations", actor.organizationId), repo.list<User>("users", [["organizationId", "==", actor.organizationId]])]);
  const manage = can(actor.role, "users.manage");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" description={org?.name} />
      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><Database className="size-5" /><div><div className="text-sm font-medium">Datastore</div><div className="text-xs text-muted-foreground">{firebaseConfigured() ? "Firestore (firebase-admin)" : <>MOCK — local JSON file <Badge tone="amber">mock</Badge></>}</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Bot className="size-5" /><div><div className="text-sm font-medium">AI provider</div><div className="text-xs text-muted-foreground">{aiConfigured() ? `Claude (${process.env.ANTHROPIC_MODEL || "claude-opus-5-5"})` : <>MOCK extractor/narrator <Badge tone="amber">mock</Badge></>}</div></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><KeyRound className="size-5" /><div><div className="text-sm font-medium">Authentication</div><div className="text-xs text-muted-foreground">{firebaseConfigured() ? "Firebase Auth session cookies" : <>MOCK — demo sign-in <Badge tone="amber">mock</Badge></>}</div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Users & roles</CardTitle><CardDescription>Roles are enforced on the server and mirrored in Firestore security rules.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {users.sort((a, b) => a.role.localeCompare(b.role)).map((u) => (
                <tr key={u.id}>
                  <Td>{u.name}</Td><Td className="text-xs">{u.email}</Td><Td><Badge>{ROLE_LABELS[u.role]}</Badge></Td>
                  <Td>{u.active ? <Badge tone="green">active</Badge> : <Badge tone="red">inactive</Badge>}</Td>
                  <Td>{manage && u.id !== actor.id && <ActionButton size="sm" variant="ghost" action={toggleUserAction.bind(null, u.id)}>{u.active ? "Deactivate" : "Activate"}</ActionButton>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {manage && (
            <ActionForm action={createUserAction} resetOnSuccess>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end">
                <Field label="Name"><Input name="name" required /></Field>
                <Field label="Email"><Input name="email" type="email" required /></Field>
                <Field label="Role"><Select name="role"><option value="officer">Processing Officer</option><option value="counsellor">Counsellor</option><option value="manager">Manager</option><option value="owner">Owner / Admin</option></Select></Field>
                <SubmitButton>Add user</SubmitButton>
              </div>
            </ActionForm>
          )}
        </CardContent>
      </Card>

      {demoMode() && can(actor.role, "demo.reset") && (
        <Card className="border-amber/50">
          <CardHeader><CardTitle>Demo mode</CardTitle><CardDescription>Deletes all demo-organisation data (students, cases, uploads, audit log) and re-creates the six scenarios.</CardDescription></CardHeader>
          <CardContent><ActionButton variant="outline" action={resetDemoAction} confirm="Reset all demo data? Everything you changed will be lost."><RotateCcw /> One-click reset</ActionButton></CardContent>
        </Card>
      )}
    </div>
  );
}
