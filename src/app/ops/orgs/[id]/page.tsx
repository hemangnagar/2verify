import Link from "next/link";
import { notFound } from "next/navigation";
import { asSystem, db } from "@/lib/db";
import { computeUsage, dollars } from "@/lib/pricing";
import { formatDate } from "@/lib/dates";
import { PageHeader, DescriptionList } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { renewTermAction, setOrgStatusAction, switchIntoOrgAction } from "../../actions";
import { AdjustForm } from "./adjust-form";
import { JurisdictionForm } from "./jurisdiction-form";

export const dynamic = "force-dynamic";

export default async function OrgDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const data = await asSystem(async () => {
    const org = await db.org.findUnique({ where: { id }, include: { plan: true, users: { orderBy: { email: "asc" } }, jurisdictions: { orderBy: { addedOn: "asc" } } } });
    if (!org) return null;
    const [ledger, counts] = await Promise.all([
      db.creditLedger.findMany({ where: { orgId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { createdBy: true }, take: 60 }),
      Promise.all([db.entity.count({ where: { orgId: id } }), db.person.count({ where: { orgId: id, active: true } }), db.credential.count({ where: { orgId: id } }), db.verification.count({ where: { orgId: id } })]),
    ]);
    const all = await db.creditLedger.findMany({ where: { orgId: id }, select: { delta: true, reason: true, createdAt: true } });
    return { org, ledger, counts, usage: computeUsage({ plan: org.plan, subscribedStates: org.subscribedStates, termStartsOn: org.termStartsOn, ledger: all }) };
  });
  if (!data) notFound();
  const { org, ledger, counts, usage } = data;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {org.name} <Badge variant={org.status === "active" ? "success" : org.status === "trial" ? "secondary" : "destructive"}>{org.status}</Badge>
          </span>
        }
        description={`${org.slug} · ${org.plan.name} · ${org.subscribedStates.join(", ") || "no jurisdictions"}`}
        actions={
          <>
            <form action={switchIntoOrgAction.bind(null, org.id)}>
              <Button type="submit">Switch into org</Button>
            </form>
            {org.status !== "suspended" ? (
              <form action={setOrgStatusAction.bind(null, org.id, "suspended")}>
                <Button type="submit" variant="outline">
                  Suspend
                </Button>
              </form>
            ) : (
              <form action={setOrgStatusAction.bind(null, org.id, "active")}>
                <Button type="submit" variant="outline">
                  Reactivate
                </Button>
              </form>
            )}
            <form action={renewTermAction.bind(null, org.id)}>
              <Button type="submit" variant="outline">
                Renew term (+{org.plan.creditsPerYear} credits)
              </Button>
            </form>
          </>
        }
      />
      {msg && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contract</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                ["Plan", `${org.plan.name} — ${dollars(org.plan.annualPriceCents)}/yr`],
                ["Jurisdictions", `${usage.jurisdictions} × $400 = ${dollars(usage.jurisdictionFeeCents)}/yr`],
                ["Annual total", dollars(usage.annualTotalCents)],
                ["Term", `${formatDate(usage.termStartsOn)} → ${formatDate(usage.termEndsOn)}`],
                ["Overage rate", `${dollars(org.plan.overageCents)} / credit`],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Credits</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                ["Allotted this term", usage.allotted.toLocaleString()],
                ["Used this term", usage.used.toLocaleString()],
                ["Balance", <span key="b" className={usage.remaining < 0 ? "font-medium text-destructive" : ""}>{usage.remaining.toLocaleString()}</span>],
                ["Run rate", `${usage.runRatePerMonth.toFixed(0)} / month`],
                ["Projected overage", usage.projectedOverageCredits ? `${usage.projectedOverageCredits} credits · ${dollars(usage.projectedOverageCents)}` : "none"],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList items={[["Locations", counts[0]], ["Active people", counts[1]], ["Credentials", counts[2]], ["Verifications (all time)", counts[3]]]} />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {org.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-xs">{u.email}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{u.role.replace("_", " ")}</TableCell>
                    <TableCell>{u.active ? "yes" : "no"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Post credits</CardTitle>
          </CardHeader>
          <CardContent>
            <AdjustForm orgId={org.id} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Jurisdictions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.jurisdictions.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="font-medium">{j.state}</TableCell>
                  <TableCell>{formatDate(j.addedOn)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{j.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <JurisdictionForm orgId={org.id} existing={org.subscribedStates} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Credit ledger (latest 60, insert-only)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (UTC)</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Delta</TableHead>
                <TableHead>Balance after</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{l.createdAt.toISOString().replace("T", " ").slice(0, 16)}</TableCell>
                  <TableCell>{l.reason}</TableCell>
                  <TableCell className={l.delta < 0 ? "text-destructive" : "text-emerald-700"}>{l.delta > 0 ? `+${l.delta}` : l.delta}</TableCell>
                  <TableCell>{l.balanceAfter.toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{l.verificationId ? <Link href={`/ops/orgs/${org.id}`}>{l.verificationId.slice(0, 8)}…</Link> : "—"}</TableCell>
                  <TableCell className="text-xs">{l.createdBy?.name ?? "system"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
