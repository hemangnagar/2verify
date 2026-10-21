import { requireOrgSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeUsage, dollars, JURISDICTION_FEE_CENTS } from "@/lib/pricing";
import { formatDate } from "@/lib/dates";
import { PageHeader, DescriptionList } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** The customer's view of the one-pager pricing, live from the ledger. */
export default async function UsagePage() {
  const session = await requireOrgSession();
  const org = await db.org.findUniqueOrThrow({ where: { id: session.activeOrgId! }, include: { plan: true } });
  const ledger = await db.creditLedger.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const usage = computeUsage({ plan: org.plan, subscribedStates: org.subscribedStates, termStartsOn: org.termStartsOn, ledger });
  const pct = usage.allotted ? Math.min(100, Math.round((usage.used / usage.allotted) * 100)) : 0;
  const maxMonth = Math.max(1, ...usage.monthly.map((m) => m.verifications));

  return (
    <div className="grid gap-6">
      <PageHeader title="Usage and pricing" description={`${org.plan.name} plan · term ${formatDate(usage.termStartsOn)} to ${formatDate(usage.termEndsOn)} · ${usage.daysLeft} days left`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Jurisdictions are billed per state per year; credits come with the plan tier.</CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                ["Jurisdictions", `${usage.jurisdictions} × ${dollars(JURISDICTION_FEE_CENTS)} = ${dollars(usage.jurisdictionFeeCents)}`],
                ["States", org.subscribedStates.join(", ") || "—"],
                ["Plan", `${org.plan.name} — ${dollars(org.plan.annualPriceCents)}`],
                ["Annual total", <strong key="t">{dollars(usage.annualTotalCents)}</strong>],
                ["Credits included", `${org.plan.creditsPerYear.toLocaleString()} / year`],
                ["Overage", `${dollars(org.plan.overageCents)} per credit`],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Credits</CardTitle>
            <CardDescription>One credit per primary-source verification. Exclusion screening is free.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="h-3 w-full overflow-hidden rounded bg-muted">
              <div className={cn("h-3", pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${pct}%` }} />
            </div>
            <DescriptionList
              items={[
                ["Allotted", usage.allotted.toLocaleString()],
                ...(usage.purchased ? [["Purchased", usage.purchased.toLocaleString()] as [string, React.ReactNode]] : []),
                ...(usage.adjustments ? [["Adjustments", usage.adjustments.toLocaleString()] as [string, React.ReactNode]] : []),
                ["Used", usage.used.toLocaleString()],
                ["Remaining", <span key="r" className={cn("font-semibold", usage.remaining < 0 && "text-destructive")}>{usage.remaining.toLocaleString()}</span>],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Projection</CardTitle>
            <CardDescription>At the current run rate over the trailing 90 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                ["Run rate", `${usage.runRatePerMonth.toFixed(1)} verifications / month`],
                ["Projected use by term end", usage.projectedUsedByTermEnd.toLocaleString()],
                ["Projected overage", usage.projectedOverageCredits ? <span key="o" className="font-semibold text-destructive">{usage.projectedOverageCredits} credits · {dollars(usage.projectedOverageCents)}</span> : <span key="o" className="text-emerald-700">none</span>],
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Verifications by month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-2">
            {usage.monthly.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs">{m.verifications}</span>
                <div className="w-full rounded-t bg-sky-600" style={{ height: `${Math.max(2, (m.verifications / maxMonth) * 120)}px` }} title={`${m.month}: ${m.verifications}`} />
                <span className="text-[10px] text-muted-foreground">{m.month.slice(2)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent credit activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Delta</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.slice(0, 25).map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{formatDate(l.createdAt)}</TableCell>
                  <TableCell>{l.reason}</TableCell>
                  <TableCell className={l.delta < 0 ? "text-destructive" : "text-emerald-700"}>{l.delta > 0 ? `+${l.delta}` : l.delta}</TableCell>
                  <TableCell>{l.balanceAfter.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.note ?? (l.reason === "verification" ? "primary-source verification" : "")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
