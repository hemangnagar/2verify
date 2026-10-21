import Link from "next/link";
import { loadCredentials } from "@/lib/credentials";
import { enabledAdapterMap } from "@/lib/boards";
import { formatDate, daysBetween } from "@/lib/dates";
import { PageHeader, Empty } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/** Verification queue: PSV-required credentials never verified or due within 30 days, grouped by state. */
export default async function VerifyQueuePage() {
  const today = new Date();
  const [all, adapters] = await Promise.all([loadCredentials({}, today), enabledAdapterMap()]);
  const due = all
    .filter((c) => c.credentialType.psvRequired && (c.buckets.neverVerified || c.buckets.verifyDue || c.buckets.overdue))
    .sort((a, b) => (a.nextVerifyDue?.getTime() ?? 0) - (b.nextVerifyDue?.getTime() ?? 0));
  const groups = new Map<string, typeof due>();
  for (const c of due) {
    const k = c.state ?? "Federal / not state-specific";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Verification queue"
        description={`${due.length} credential${due.length === 1 ? "" : "s"} due for primary-source verification within 30 days. "Automated" means an adapter checks the board for you; everything else is a one-minute guided lookup.`}
      />
      {due.length === 0 && <Empty>Nothing is due. The nightly job rebuilds this queue.</Empty>}
      {[...groups.entries()].map(([state, rows]) => (
        <Card key={state}>
          <CardHeader>
            <CardTitle>{state}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holder</TableHead>
                  <TableHead>Credential</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verification due</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const left = c.nextVerifyDue ? daysBetween(today, c.nextVerifyDue) : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.holder}</TableCell>
                      <TableCell>
                        {c.credentialType.name}
                        {c.state && adapters.has(`${c.state}:${c.credentialTypeId}`) && (
                          <Badge variant="success" className="ml-2">
                            Automated
                          </Badge>
                        )}
                        {c.lastAutoError && <div className="max-w-xs whitespace-normal text-xs text-destructive">Automated check failed: {c.lastAutoError}. Verify manually.</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.number ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        {c._count.verifications === 0 ? (
                          <Badge variant="outline">never verified</Badge>
                        ) : (
                          <span className={left !== null && left < 0 ? "text-destructive" : ""}>
                            {formatDate(c.nextVerifyDue)}
                            {left !== null && <span className="ml-1 text-xs text-muted-foreground">({left < 0 ? `${-left}d overdue` : `in ${left}d`})</span>}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm">
                          <Link href={`/verify/${c.id}`}>Verify</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
