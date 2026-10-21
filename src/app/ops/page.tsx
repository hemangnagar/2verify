import Link from "next/link";
import { asSystem, db } from "@/lib/db";
import { addDays, dateOnly, firstOfMonth } from "@/lib/dates";
import { dollars, jurisdictionFeeCents } from "@/lib/pricing";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { switchIntoOrgAction } from "./actions";

export const dynamic = "force-dynamic";

/** Every customer org on one screen. Queries run unscoped (operator), whatever org the cookie currently points at. */
export default async function OpsPage() {
  const today = dateOnly(new Date());
  const rows = await asSystem(async () => {
    const orgs = await db.org.findMany({ include: { plan: true }, orderBy: [{ status: "asc" }, { name: "asc" }] });
    return Promise.all(
      orgs.map(async (o) => {
        const [last, verifMonth, expiring30, openMatches, people] = await Promise.all([
          db.creditLedger.findFirst({ where: { orgId: o.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
          db.verification.count({ where: { orgId: o.id, verifiedAt: { gte: firstOfMonth(today) } } }),
          db.credential.count({ where: { orgId: o.id, expiresOn: { gte: today, lte: addDays(today, 30) } } }),
          db.screeningMatch.count({ where: { orgId: o.id, disposition: "pending" } }),
          db.person.count({ where: { orgId: o.id, active: true } }),
        ]);
        return { ...o, balance: last?.balanceAfter ?? 0, verifMonth, expiring30, openMatches, people };
      })
    );
  });
  const arr = rows.reduce((s, r) => s + r.plan.annualPriceCents + jurisdictionFeeCents(r.subscribedStates.length), 0);
  const verifMonth = rows.reduce((s, r) => s + r.verifMonth, 0);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Customers"
        description="This is the business on one screen."
        actions={
          <Button asChild>
            <Link href="/ops/orgs/new">New customer</Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Customer orgs" value={String(rows.length)} sub={`${rows.filter((r) => r.status === "active").length} active · ${rows.filter((r) => r.status === "trial").length} trial`} />
        <Stat label="Annual contract value" value={dollars(arr)} sub="plans + jurisdiction fees" />
        <Stat label="Verifications this month" value={String(verifMonth)} sub="one credit each" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Jurisdictions</TableHead>
            <TableHead>Credits</TableHead>
            <TableHead>Verifications (month)</TableHead>
            <TableHead>Expiring ≤30d</TableHead>
            <TableHead>Open matches</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/ops/orgs/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {r.slug} · {r.people} people
                </div>
              </TableCell>
              <TableCell>
                {r.plan.name}
                <div className="text-xs text-muted-foreground">{dollars(r.plan.annualPriceCents)}/yr</div>
              </TableCell>
              <TableCell>
                {r.subscribedStates.length} <span className="text-xs text-muted-foreground">({r.subscribedStates.join(", ")})</span>
                <div className="text-xs text-muted-foreground">{dollars(jurisdictionFeeCents(r.subscribedStates.length))}/yr</div>
              </TableCell>
              <TableCell>
                <span className={r.balance < 0 ? "font-medium text-destructive" : r.balance < r.plan.creditsPerYear * 0.2 ? "font-medium text-amber-700" : ""}>{r.balance.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground"> / {r.plan.creditsPerYear.toLocaleString()}</span>
              </TableCell>
              <TableCell>{r.verifMonth}</TableCell>
              <TableCell>{r.expiring30 > 0 ? <Badge variant="warning">{r.expiring30}</Badge> : "0"}</TableCell>
              <TableCell>{r.openMatches > 0 ? <Badge variant="destructive">{r.openMatches}</Badge> : "0"}</TableCell>
              <TableCell>
                <Badge variant={r.status === "active" ? "success" : r.status === "trial" ? "secondary" : "destructive"}>{r.status}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <form action={switchIntoOrgAction.bind(null, r.id)}>
                  <Button size="sm" type="submit">
                    Switch into org
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
