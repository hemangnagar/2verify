import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { exitOrgAction } from "@/app/ops/actions";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/credentials", label: "Credentials" },
  { href: "/people", label: "People" },
  { href: "/entities", label: "Locations" },
  { href: "/verify", label: "Verify" },
  { href: "/screening", label: "Screening" },
  { href: "/reports", label: "Reports" },
  { href: "/usage", label: "Usage" },
];
const ADMIN_NAV = [
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.activeOrgId) redirect(session.role === "operator" ? "/ops" : "/login");
  const admin = session.role === "org_admin" || session.role === "operator";
  return (
    <div className="flex min-h-screen flex-col">
      {session.role === "operator" && (
        <div className="bg-amber-500 text-amber-950">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-1.5 text-sm">
            <span>
              Operating as <strong>{brand.name}</strong> inside <strong>{session.activeOrgName}</strong>. Everything you do here is logged under your operator account.
            </span>
            <form action={exitOrgAction} className="ml-auto">
              <Button size="sm" variant="outline" type="submit" className="h-7 border-amber-900/30 bg-amber-100 text-amber-950 hover:bg-amber-200">
                Exit to console
              </Button>
            </form>
          </div>
        </div>
      )}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoPath} alt={brand.name} className="h-6 w-auto" />
            <span className="sr-only">{brand.name}</span>
          </Link>
          <nav className="hidden gap-4 text-sm text-muted-foreground md:flex">
            {[...NAV, ...(admin ? ADMIN_NAV : [])].map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {session.activeOrgName} · {session.name} · {session.role.replace("_", " ")}
            </span>
            <form action={logoutAction}>
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
