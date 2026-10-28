import { NextResponse } from "next/server";
import { aiConfigured } from "@/server/ai";
import { firebaseConfigured } from "@/server/db";

export function GET() {
  return NextResponse.json({ ok: true, datastore: firebaseConfigured() ? "firestore" : "mock", ai: aiConfigured() ? "claude" : "mock" });
}
