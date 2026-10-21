import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, isOrgAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { PageHeader, DescriptionList, Empty } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const e = await db.entity.findUnique({
    where: { id },
    include: {
      credentials: { include: { credentialType: true, _count: { select: { verifications: true } } }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }] },
      people: { where: { active: true }, orderBy: [{ lastName: "asc" }] },
    },
  });
  if (!e) notFound();
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {e.name}
            {e.isPrimary && <Badge variant="secondary">primary</Badge>}
          </span>
        }
        description={e.address}
        actions={
          <>
            <Button asChild>
              <Link href={`/credentials/new?entity=${e.id}`}>Add credential</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/reports/survey-pack?entity=${e.id}&format=pdf`}>Survey pack PDF</a>
            </Button>
            {(session ? isOrgAdmin(session) : false) && (
              <Button asChild variant="outline">
                <Link href={`/entities/${e.id}/edit`}>Edit</Link>
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList items={[["State", e.state], ["NPI", e.npi], ["DEA", e.deaNumber], ["Staff", `${e.people.length} active`]]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Entity credentials</CardTitle>
        </CardHeader>
        <CardContent>
          {e.credentials.length === 0 ? (
            <Empty>No entity-level credentials.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credential</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {e.credentials.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/credentials/${c.id}`} className="font-medium hover:underline">
                        {c.credentialType.name}
                      </Link>
                    </TableCell>
                    <TableCell>{c.state ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.number ?? "—"}</TableCell>
                    <TableCell>{c.expiresOn ? formatDate(c.expiresOn) : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell>{!c.credentialType.psvRequired ? "n/a" : c._count.verifications === 0 ? <Badge variant="outline">never</Badge> : `${c._count.verifications}×`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Staff at this location</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {e.people.map((p) => (
              <li key={p.id}>
                <Link href={`/people/${p.id}`} className="hover:underline">
                  {p.lastName}, {p.firstName}
                </Link>{" "}
                <span className="text-muted-foreground">· {p.role}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
