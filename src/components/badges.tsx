import { AlertTriangle, CheckCircle2, CircleSlash, Info, ShieldAlert, XOctagon } from "lucide-react";
import { ruleBadge } from "@/domain/rules";
import type { Light, Rule, Severity, Stage } from "@/domain/types";
import { STAGES } from "@/domain/types";
import { Badge } from "./ui/primitives";

export function LightBadge({ light, size = "md" }: { light?: Light; size?: "md" | "lg" }) {
  if (!light) return <Badge tone="neutral"><CircleSlash /> Not assessed</Badge>;
  const tone = light === "GREEN" ? "solidGreen" : light === "AMBER" ? "solidAmber" : "solidRed";
  const Icon = light === "GREEN" ? CheckCircle2 : light === "AMBER" ? AlertTriangle : XOctagon;
  return (
    <Badge tone={tone} className={size === "lg" ? "px-3 py-1 text-sm [&_svg]:size-4" : "[&_svg]:size-3.5"}>
      <Icon /> {light}
    </Badge>
  );
}

export function SeverityBadge({ severity, hardFail }: { severity: Severity; hardFail?: boolean }) {
  if (hardFail) return <Badge tone="solidRed" className="[&_svg]:size-3"><ShieldAlert /> Blocking</Badge>;
  if (severity === "critical") return <Badge tone="red" className="[&_svg]:size-3"><XOctagon /> Critical</Badge>;
  if (severity === "warning") return <Badge tone="amber" className="[&_svg]:size-3"><AlertTriangle /> Warning</Badge>;
  return <Badge tone="blue" className="[&_svg]:size-3"><Info /> Info</Badge>;
}

export function RuleStatusBadge({ rule }: { rule: Rule }) {
  const b = ruleBadge(rule);
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={b.tone}>{b.label}</Badge>
      {rule.seed && <Badge tone="neutral" title={rule.sourceNote}>Seed</Badge>}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  const i = STAGES.indexOf(stage);
  return (
    <Badge tone={i >= 8 ? "green" : i >= 5 ? "blue" : "neutral"}>
      {i + 1}. {stage}
    </Badge>
  );
}

export function SampleBadge() {
  return <Badge tone="neutral" title="Sample data for demonstration — verify before use">Sample data</Badge>;
}
