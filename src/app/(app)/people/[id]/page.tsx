import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { PageHeader, DescriptionList, Empty } from "@/components/page-header";
import { StatusBadge, DispositionBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reverifyPersonNpi } from "../actions";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.person.findUnique({
    where: { id },
    include: {
      entity: true,
      credentials: { include: { credentialType: true, _count: { select: { verifications: true } } }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }] },
      screeningMatches: { include: { run: true }, orderBy: { run: { runAt: "desc" } } },
    },
  });
  if (!p) notFound();
  const trainingTypes = await db.credentialType.findMany({ where: { category: "training" } });
  const missing = trainingTypes.filter((t) => t.requiredForRoles.includes(p.role) && !p.credentials.some((c) => c.credentialTypeId === t.id));
  const runs = await db.screeningRun.findMany({ orderBy: { runAt: "desc" }, take: 6 });
  const screenedIn = runs.filter((r) => (r.roster as Array<{ id: string }>).some((x) => x.id === p.id));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {p.firstName} {p.lastName}
            {!p.active && <Badge variant="secondary">inactive</Badge>}
          </span>
        }
        description={`${p.role}${p.entity ? ` · ${p.entity.name}` : ""}`}
        actions={
          <>
            <Button asChild>
              <Link href={`/credentials/new?person=${p.id}`}>Add credential</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/people/${p.id}/edit`}>Edit</Link>
            </Button>
            {p.npi && (
              <form action={reverifyPersonNpi.bind(null, p.id)}>
                <Button variant="outline" type="submit">
                  Re-check NPI
                </Button>
              </form>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList items={[["Email", p.email], ["NPI", p.npi], ["Hired", formatDate(p.hireDate)], ["DOB", p.dob ? "on file" : "missing (needed for screening)"]]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Required training</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {trainingTypes.filter((t) => t.requiredForRoles.includes(p.role)).length === 0 ? (
              <span className="text-muted-foreground">None required for this role.</span>
            ) : missing.length === 0 ? (
              <span className="text-emerald-700">All required courses recorded.</span>
            ) : (
              <ul className="list-disc pl-4 text-destructive">
                {missing.map((m) => (
                  <li key={m.id}>{m.name} — no completion recorded</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Exclusion screening</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {screenedIn.length === 0 ? (
              <span className="text-muted-foreground">Not yet screened.</span>
            ) : (
              <ul className="grid gap-1">
                {screenedIn.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link href={`/screening/${r.id}`} className="underline">
                      {r.source === "oig_leie" ? "OIG LEIE" : "SAM"} · {formatDate(r.runAt)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {p.screeningMatches.length > 0 && (
              <div className="mt-2 grid gap-1">
                {p.screeningMatches.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <DispositionBadge disposition={m.disposition} />
                    <Link href={`/screening/matches#${m.id}`} className="text-xs underline">
                      {m.run.source === "oig_leie" ? "LEIE" : "SAM"} match, score {m.score.toFixed(2)}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
        </CardHeader>
        <CardContent>
          {p.credentials.length === 0 ? (
            <Empty>No credentials yet.</Empty>
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
                {p.credentials.map((c) => (
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
                    <TableCell>{!c.credentialType.psvRequired ? "n/a" : c._count.verifications === 0 ? <Badge variant="outline">never</Badge> : `${c._count.verifications}×, next ${formatDate(c.nextVerifyDue)}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
