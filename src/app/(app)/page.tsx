import Link from "next/link";
import { db } from "@/lib/db";
import { loadCredentials, formOptions, type CredentialFilters } from "@/lib/credentials";
import { formatDate, daysBetween } from "@/lib/dates";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CredentialFilterBar } from "./credentials/filter-bar";
import { Empty } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS: Array<{ key: NonNullable<CredentialFilters["bucket"]>; label: string; tone: string }> = [
  { key: "expiring30", label: "Expiring ≤ 30 days", tone: "text-amber-700" },
  { key: "expiring90", label: "Expiring ≤ 90 days", tone: "text-amber-700" },
  { key: "overdue", label: "Overdue", tone: "text-destructive" },
  { key: "neverVerified", label: "Never verified", tone: "text-destructive" },
  { key: "verifyDue", label: "Verification due", tone: "text-sky-700" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = new Date();
  const filters: CredentialFilters = { entityId: sp.entity || undefined, personId: sp.person || undefined, typeId: sp.type || undefined, state: sp.state || undefined, status: (sp.status as CredentialFilters["status"]) || undefined, q: sp.q || undefined };
  const [all, opts] = await Promise.all([loadCredentials(filters, today), formOptions()]);
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "expiring90") as NonNullable<CredentialFilters["bucket"]>;
  const rows = all.filter((r) => r.buckets[tab]);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, all.filter((r) => r.buckets[t.key]).length]));
  const qs = (t: string) => "?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== "tab")), tab: t }).toString();
  const [lastRun, pendingMatches] = await Promise.all([db.screeningRun.findFirst({ orderBy: { runAt: "desc" } }), db.screeningMatch.count({ where: { disposition: "pending" } })]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {all.length} credentials · last exclusion screening {lastRun ? formatDate(lastRun.runAt) : "never"}
          {pendingMatches > 0 && (
            <>
              {" · "}
              <Link href="/screening/matches" className="font-medium text-amber-700 underline">
                {pendingMatches} screening match{pendingMatches === 1 ? "" : "es"} to review
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {TABS.map((t) => (
          <Link key={t.key} href={qs(t.key)}>
            <Card className={cn("h-full transition-colors hover:bg-muted/40", tab === t.key && "ring-2 ring-ring")}>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("text-3xl font-semibold", counts[t.key] > 0 && t.tone)}>{counts[t.key]}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <CredentialFilterBar current={sp} types={opts.types} people={opts.people} entities={opts.entities} states={opts.states} showBucket={false} />
      <Card>
        <CardHeader>
          <CardTitle>{TABS.find((t) => t.key === tab)!.label}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>Nothing here.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holder</TableHead>
                  <TableHead>Credential</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const left = r.expiresOn ? daysBetween(today, r.expiresOn) : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/credentials/${r.id}`} className="font-medium hover:underline">
                          {r.holder}
                        </Link>
                      </TableCell>
                      <TableCell>{r.credentialType.name}</TableCell>
                      <TableCell>{r.state ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.number ?? "—"}</TableCell>
                      <TableCell>
                        {formatDate(r.expiresOn)}
                        {left !== null && <span className={cn("ml-1 text-xs", left < 0 ? "text-destructive" : "text-muted-foreground")}>({left < 0 ? `${-left}d ago` : `${left}d`})</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {!r.credentialType.psvRequired ? (
                          <span className="text-muted-foreground">n/a</span>
                        ) : r._count.verifications === 0 ? (
                          <Link href={`/verify/${r.id}`}>
                            <Badge variant="outline">never — verify</Badge>
                          </Link>
                        ) : (
                          <span className={r.buckets.verifyDue ? "text-sky-700" : ""}>due {formatDate(r.nextVerifyDue)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.locationName}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
