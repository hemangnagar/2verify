import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOperator();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-slate-900 text-slate-100">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <Link href="/ops" className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoPath} alt={brand.name} className="h-6 w-auto invert" />
            <span className="text-sm font-normal text-slate-300">Operator console</span>
          </Link>
          <nav className="hidden gap-4 text-sm text-slate-300 md:flex">
            <Link href="/ops" className="hover:text-white">
              Customers
            </Link>
            <Link href="/ops/orgs/new" className="hover:text-white">
              New customer
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-300">{session.name} · operator</span>
            <form action={logoutAction}>
              <Button variant="outline" size="sm" type="submit" className="border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700">
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
