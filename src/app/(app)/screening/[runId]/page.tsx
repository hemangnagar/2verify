import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader, DescriptionList, Empty } from "@/components/page-header";
import { DispositionBadge } from "@/components/status-badge";
import { FileLink } from "@/components/file-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ScreeningRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await db.screeningRun.findUnique({ where: { id: runId }, include: { matches: { include: { person: true, reviewedBy: true } } } });
  if (!run) notFound();
  const roster = run.roster as Array<{ id: string; name: string; role: string; npi: string | null }>;
  return (
    <div className="grid gap-6">
      <PageHeader title={`${run.source === "oig_leie" ? "OIG LEIE" : "SAM.gov"} screening · ${run.runAt.toISOString().slice(0, 10)}`} actions={<FileLink fileKey={run.reportFileKey} label="Download report PDF" variant="default" />} />
      <Card>
        <CardHeader>
          <CardTitle>Run</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList items={[["Run at", run.runAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"], ["Source version", run.sourceVersion], ["Persons screened", run.personsScreened], ["Potential matches", run.matchesFound]]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Matches</CardTitle>
        </CardHeader>
        <CardContent>
          {run.matches.length === 0 ? (
            <Empty>No potential matches in this run.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Matched on</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead>Reviewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.matches.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Link href={`/screening/matches#${m.id}`} className="font-medium hover:underline">
                        {m.person.firstName} {m.person.lastName}
                      </Link>
                    </TableCell>
                    <TableCell>{m.matchedOn.replace("_", " ")}</TableCell>
                    <TableCell>{m.score.toFixed(2)}</TableCell>
                    <TableCell>
                      <DispositionBadge disposition={m.disposition} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.reviewedBy ? `${m.reviewedBy.name}, ${m.reviewedAt?.toISOString().slice(0, 10)}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Roster screened ({roster.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((p) => (
              <li key={p.id}>
                <Link href={`/people/${p.id}`} className="hover:underline">
                  {p.name}
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
