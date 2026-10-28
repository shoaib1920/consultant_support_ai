// Session handling.
//  - Firebase mode: Firebase Auth ID token -> Firebase session cookie (verified with firebase-admin).
//  - MOCK mode (no Firebase): HMAC-signed cookie issued by the demo login.
// Every server action / route calls requireActor(), which re-loads the user from the datastore
// so role changes and deactivation take effect immediately.

import { cookies } from "next/headers";
import { firebaseConfigured, getRepo } from "../db";
import { signPayload, verifyPayload } from "../crypto";
import { AuthError, can, type Permission } from "./rbac";
import type { Role, User } from "@/domain/types";

export const SESSION_COOKIE = "vg_session";
const SESSION_DAYS = 5;

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
  studentId?: string;
}

function toActor(u: User): Actor {
  return { id: u.id, name: u.name, email: u.email, role: u.role, organizationId: u.organizationId, studentId: u.studentId };
}

export async function actorFromToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  let uid: string | undefined;
  // Firebase session cookies are JWTs (3 segments); mock tokens are body.sig (2 segments).
  if (firebaseConfigured() && token.split(".").length === 3) {
    try {
      const { getAuth } = await import("firebase-admin/auth");
      const { getAdminApp } = await import("../firebase-admin");
      uid = (await getAuth(getAdminApp()).verifySessionCookie(token, true)).uid;
    } catch {
      return null;
    }
  } else {
    // Demo-login cookies are only honoured in demo mode, or when there is no Firebase at all (local mock).
    if (firebaseConfigured() && !demoMode()) return null;
    const p = verifyPayload<{ uid: string; exp: number }>(token);
    if (!p || p.exp < Date.now()) return null;
    uid = p.uid;
  }
  const repo = await getRepo();
  const user = await repo.get<User>("users", uid);
  if (!user || !user.active) return null;
  return toActor(user);
}

export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  return actorFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function requireActor(perm?: Permission): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new AuthError("Not signed in", 401);
  if (perm && !can(a.role, perm)) throw new AuthError(`Your role (${a.role}) is not allowed to do this (${perm}).`);
  return a;
}

export function assertCan(a: Actor, perm: Permission) {
  if (!can(a.role, perm)) throw new AuthError(`Your role (${a.role}) is not allowed to do this (${perm}).`);
}

export function assertSameOrg(a: Actor, rec: { organizationId: string } | null | undefined): asserts rec {
  if (!rec || rec.organizationId !== a.organizationId) throw new AuthError("Record not found", 403);
}

export async function issueMockSession(uid: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signPayload({ uid, exp: Date.now() + SESSION_DAYS * 86_400_000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function issueFirebaseSession(idToken: string) {
  const { getAuth } = await import("firebase-admin/auth");
  const { getAdminApp } = await import("../firebase-admin");
  const { uid } = await getAuth(getAdminApp()).verifyIdToken(idToken);
  const user = await (await getRepo()).get<User>("users", uid);
  if (!user) throw new AuthError("This login is not linked to any consultancy yet. Ask your administrator to add you.", 403);
  if (!user.active) throw new AuthError("Your account has been deactivated. Contact your administrator.", 403);
  const expiresIn = SESSION_DAYS * 86_400_000;
  const cookie = await getAuth(getAdminApp()).createSessionCookie(idToken, { expiresIn });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: expiresIn / 1000 });
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  // revoke the Firebase session too, so a copied cookie stops working at logout
  if (token && firebaseConfigured() && token.split(".").length === 3) {
    try {
      const { getAuth } = await import("firebase-admin/auth");
      const { getAdminApp } = await import("../firebase-admin");
      const auth = getAuth(getAdminApp());
      await auth.revokeRefreshTokens((await auth.verifySessionCookie(token)).uid);
    } catch {
      // already invalid; nothing to revoke
    }
  }
}

/** Demo mode is opt-in: only DEMO_MODE=true enables demo login, demo banner and auto-seeding. */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}
