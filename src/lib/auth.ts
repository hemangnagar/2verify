import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { dbRaw } from "./db";

const COOKIE = "session";
const SESSION_DAYS = 7;

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  /** The user's own org; null for operators. */
  orgId: string | null;
  /** The org currently being worked in: the user's own, or the org an operator switched into. */
  activeOrgId: string | null;
  activeOrgName: string | null;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set to at least 16 characters");
  return new TextEncoder().encode(s);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

async function writeCookie(session: Session) {
  const token = await new SignJWT({
    email: session.email,
    name: session.name,
    role: session.role,
    orgId: session.orgId,
    activeOrgId: session.activeOrgId,
    activeOrgName: session.activeOrgName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: payload.sub!,
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as UserRole,
      orgId: (payload.orgId as string | null) ?? null,
      activeOrgId: (payload.activeOrgId as string | null) ?? null,
      activeOrgName: (payload.activeOrgName as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Org admin, or an operator who has switched into an org. */
export function isOrgAdmin(s: Session): boolean {
  return s.role === "org_admin" || (s.role === "operator" && !!s.activeOrgId);
}

export async function requireOrgAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!isOrgAdmin(s)) throw new Error("Organization admin role required");
  return s;
}

export async function requireOperator(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "operator") throw new Error("Operator role required");
  return s;
}

/** An org must be in scope for every customer page. Operators without one are sent to /ops. */
export async function requireOrgSession(): Promise<Session> {
  const s = await requireSession();
  if (!s.activeOrgId) redirect(s.role === "operator" ? "/ops" : "/login");
  return s;
}

/** Returns the session on success, or an error message. */
export async function login(email: string, password: string): Promise<Session | string> {
  const user = await dbRaw.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { org: true } });
  if (!user || !user.active) return "Invalid email or password";
  if (user.org && user.org.status === "suspended") return "This organization is suspended. Contact support.";
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return "Invalid email or password";
  const session: Session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    activeOrgId: user.orgId,
    activeOrgName: user.org?.name ?? null,
  };
  await writeCookie(session);
  return session;
}

/** Operator: switch into an org (or out with null). Re-issues the cookie. */
export async function switchActiveOrg(orgId: string | null) {
  const s = await requireOperator();
  const org = orgId ? await dbRaw.org.findUniqueOrThrow({ where: { id: orgId } }) : null;
  await writeCookie({ ...s, activeOrgId: org?.id ?? null, activeOrgName: org?.name ?? null });
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}
