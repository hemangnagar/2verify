import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { brand } from "@/config/brand";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.role === "operator" && !s.activeOrgId ? "/ops" : "/");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoPath} alt={brand.name} className="h-8 w-auto" />
        <p className="text-sm text-muted-foreground">{brand.tagline}</p>
      </div>
      <LoginForm />
      <p className="max-w-sm text-center text-xs text-muted-foreground">{brand.legal}</p>
    </main>
  );
}
