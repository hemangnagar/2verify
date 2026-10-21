import Link from "next/link";
import { loadCredentials, formOptions, type CredentialFilters } from "@/lib/credentials";
import { formatDate } from "@/lib/dates";
import { PageHeader, Empty } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CredentialFilterBar } from "./filter-bar";

export const dynamic = "force-dynamic";

export default async function CredentialsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const filters: CredentialFilters = {
    entityId: sp.entity || undefined,
    personId: sp.person || undefined,
    typeId: sp.type || undefined,
    state: sp.state || undefined,
    status: (sp.status as CredentialFilters["status"]) || undefined,
    bucket: (sp.bucket as CredentialFilters["bucket"]) || undefined,
    q: sp.q || undefined,
  };
  const [rows, opts] = await Promise.all([loadCredentials(filters), formOptions()]);
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1])).toString();

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Credentials"
        description={`${rows.length} shown`}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/reports/csv?kind=credentials&${qs}`}>Export CSV</a>
            </Button>
            <Button asChild>
              <Link href="/credentials/new">Add credential</Link>
            </Button>
          </>
        }
      />
      <CredentialFilterBar current={sp} types={opts.types} people={opts.people} entities={opts.entities} states={opts.states} />
      {rows.length === 0 ? (
        <Empty>No credentials match these filters.</Empty>
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
              <TableHead>Verify due</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/credentials/${r.id}`} className="font-medium hover:underline">
                    {r.holder}
                  </Link>
                </TableCell>
                <TableCell>{r.credentialType.name}</TableCell>
                <TableCell>{r.state ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.number ?? "—"}</TableCell>
                <TableCell>{formatDate(r.expiresOn)}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className={r.buckets.verifyDue ? "text-amber-700" : ""}>
                  {r.credentialType.psvRequired ? (r._count.verifications === 0 ? "never verified" : formatDate(r.nextVerifyDue)) : "n/a"}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.locationName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
