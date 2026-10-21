import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { db } from "./db";

const COOKIE = "session";
const SESSION_DAYS = 7;

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set to at least 16 characters");
  return new TextEncoder().encode(s);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function createSession(user: Session) {
  const token = await new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { userId: payload.sub!, email: String(payload.email), name: String(payload.name), role: payload.role as UserRole };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "admin") throw new Error("Admin role required");
  return s;
}

/** Returns the session on success, or an error message. */
export async function login(email: string, password: string): Promise<Session | string> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return "Invalid email or password";
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return "Invalid email or password";
  const session: Session = { userId: user.id, email: user.email, name: user.name, role: user.role };
  await createSession(session);
  return session;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}
