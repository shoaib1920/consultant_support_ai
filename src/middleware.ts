// Edge guard: unauthenticated requests to app pages go to /login. Real verification (signature,
// user active, role) happens server-side in requireActor() on every page and action.

import { NextResponse, type NextRequest } from "next/server";

// API routes authenticate themselves (cookie or Bearer token) and return 401/403 JSON.
const PUBLIC = ["/login", "/intake", "/api"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("vg_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"] };
