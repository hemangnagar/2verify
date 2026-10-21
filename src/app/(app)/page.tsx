import { db } from "@/lib/db";
import { bucketOf } from "@/lib/status";
import { formatDate } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Scaffold dashboard: the four tiles and the attention list, enough to verify the seed end to end.
 * The full dashboard (tabs, filters, verification-due bucket) lands with the Phase 1 pages.
 */
export default async function DashboardPage() {
  const today = new Date();
  const credentials = await db.credential.findMany({
    include: {
      credentialType: true,
      person: true,
      entity: true,
      _count: { select: { verifications: true } },
    },
    orderBy: [{ expiresOn: "asc" }],
  });

  const rows = credentials.map((c) => ({
    ...c,
    buckets: bucketOf({ expiresOn: c.expiresOn, nextVerifyDue: c.nextVerifyDue, verificationCount: c._count.verifications, psvRequired: c.credentialType.psvRequired }, today),
    subject: c.person ? `${c.person.firstName} ${c.person.lastName}` : (c.entity?.name ?? "—"),
  }));

  const tiles = [
    { label: "Expiring ≤ 30 days", value: rows.filter((r) => r.buckets.expiring30).length },
    { label: "Expiring ≤ 90 days", value: rows.filter((r) => r.buckets.expiring90).length },
    { label: "Overdue", value: rows.filter((r) => r.buckets.overdue).length },
    { label: "Never verified", value: rows.filter((r) => r.buckets.neverVerified).length },
  ];

  const attention = rows.filter((r) => r.buckets.overdue || r.buckets.expiring90 || r.buckets.neverVerified);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verifications</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attention.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.subject}</TableCell>
                  <TableCell>{r.credentialType.name}</TableCell>
                  <TableCell>{r.state ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.number ?? "—"}</TableCell>
                  <TableCell>{formatDate(r.expiresOn)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "expired" || r.status === "suspended"
                          ? "destructive"
                          : r.status === "expiring"
                            ? "warning"
                            : r.status === "active"
                              ? "success"
                              : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!r.credentialType.psvRequired ? (
                      <span className="text-muted-foreground">n/a</span>
                    ) : r._count.verifications === 0 ? (
                      <Badge variant="outline">never</Badge>
                    ) : (
                      r._count.verifications
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
