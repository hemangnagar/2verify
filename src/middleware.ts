import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/** Redirects unauthenticated page requests to /login. Server actions and pages re-check the session. */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  let ok = false;
  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET));
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/files|_next/static|_next/image|favicon.ico).*)"],
};
