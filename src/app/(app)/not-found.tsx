import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <EmptyState title="Not found" action={<Link href="/dashboard" className="text-sm text-primary underline">Back to dashboard</Link>}>
      The record does not exist or belongs to another organisation.
    </EmptyState>
  );
}
