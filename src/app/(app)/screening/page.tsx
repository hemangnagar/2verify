import Link from "next/link";
import { db } from "@/lib/db";
import { getSession, isOrgAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { PageHeader, Empty } from "@/components/page-header";
import { FileLink } from "@/components/file-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunButtons } from "./run-buttons";

export const dynamic = "force-dynamic";

export default async function ScreeningPage() {
  const session = await getSession();
  const [runs, pending] = await Promise.all([
    db.screeningRun.findMany({ orderBy: { runAt: "desc" }, include: { _count: { select: { matches: true } } }, take: 48 }),
    db.screeningMatch.count({ where: { disposition: "pending" } }),
  ]);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Exclusion screening"
        description="Every active staff member and prescriber is screened monthly against the OIG LEIE and SAM.gov exclusion lists. A report is stored for every run, including runs with no matches."
        actions={
          <Button asChild variant={pending ? "default" : "outline"}>
            <Link href="/screening/matches">
              {pending ? `${pending} pending match${pending === 1 ? "" : "es"} to review` : "Match review"}
            </Link>
          </Button>
        }
      />
      {(session ? isOrgAdmin(session) : false) && <RunButtons mode={process.env.SCREENING_MODE ?? "live"} />}
      {runs.length === 0 ? (
        <Empty>No screening runs yet.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Source version</TableHead>
              <TableHead>Screened</TableHead>
              <TableHead>Matches</TableHead>
              <TableHead>Report</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/screening/${r.id}`} className="font-medium hover:underline">
                    {formatDate(r.runAt)}
                  </Link>
                </TableCell>
                <TableCell>{r.source === "oig_leie" ? "OIG LEIE" : "SAM.gov"}</TableCell>
                <TableCell className="max-w-72 truncate text-xs text-muted-foreground">{r.sourceVersion}</TableCell>
                <TableCell>{r.personsScreened}</TableCell>
                <TableCell>{r.matchesFound === 0 ? <Badge variant="success">0</Badge> : <Badge variant="warning">{r.matchesFound}</Badge>}</TableCell>
                <TableCell>
                  <FileLink fileKey={r.reportFileKey} label="PDF" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
