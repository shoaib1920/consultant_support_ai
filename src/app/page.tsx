import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";

export default async function Home() {
  const a = await getActor();
  redirect(!a ? "/login" : a.role === "student" ? "/portal" : "/dashboard");
}
