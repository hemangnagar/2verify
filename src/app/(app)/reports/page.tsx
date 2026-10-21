import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await getSession();
  const entities = await db.entity.findMany({ orderBy: [{ isPrimary: "desc" }, { name: "asc" }] });
  return (
    <div className="grid gap-6">
      <PageHeader title="Reports" description="The exports a URAC, ACHC, or board surveyor asks for. Each one is generated live from the current records." />
      <Card>
        <CardHeader>
          <CardTitle>Survey pack</CardTitle>
          <CardDescription>Per location: all active credentials with last verification date, method, result, and a thumbnail of the evidence (PDF), plus every full-size evidence file and document (ZIP with manifest).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {entities.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2">
              <span className="w-72 font-medium">{e.name}</span>
              <Button asChild size="sm">
                <a href={`/api/reports/survey-pack?entity=${e.id}&format=pdf`} target="_blank" rel="noreferrer">
                  PDF
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`/api/reports/survey-pack?entity=${e.id}&format=zip`}>Evidence ZIP</a>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>CSV exports</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href="/api/reports/csv?kind=credentials">All credentials with last verification</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/reports/csv?kind=screening">Exclusion screening history</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/reports/csv?kind=training">Training completion by employee</a>
          </Button>
          {session?.role === "admin" && (
            <Button asChild variant="outline">
              <a href="/api/reports/csv?kind=audit">Full change log</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
