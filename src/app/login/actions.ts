"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(email, password);
  if (typeof result === "string") return { error: result };
  redirect(result.role === "operator" ? "/ops" : "/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
