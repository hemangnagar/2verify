import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession, isOrgAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { PageHeader, Empty } from "@/components/page-header";
import { DispositionBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DispositionForm } from "./disposition-form";

export const dynamic = "force-dynamic";

export default async function MatchReviewPage() {
  const session = await getSession();
  const matches = await db.screeningMatch.findMany({
    include: { person: { include: { entity: true } }, run: true, reviewedBy: true },
    orderBy: [{ disposition: "desc" }, { run: { runAt: "desc" } }],
    take: 100,
  });
  const pending = matches.filter((m) => m.disposition === "pending");
  const resolved = matches.filter((m) => m.disposition !== "pending");
  return (
    <div className="grid gap-6">
      <PageHeader title="Match review" description="Compare each flagged person with the exclusion record and set a disposition. Every decision is logged with who made it and when." />
      {pending.length === 0 && <Empty>No pending matches.</Empty>}
      {pending.map((m) => (
        <MatchCard key={m.id} m={m} canReview={(session ? isOrgAdmin(session) : false)} />
      ))}
      {resolved.length > 0 && (
        <>
          <h2 className="text-lg font-semibold">Resolved</h2>
          {resolved.map((m) => (
            <MatchCard key={m.id} m={m} canReview={false} />
          ))}
        </>
      )}
    </div>
  );
}

type Match = Prisma.ScreeningMatchGetPayload<{ include: { person: { include: { entity: true } }; run: true; reviewedBy: true } }>;

function MatchCard({ m, canReview }: { m: Match; canReview: boolean }) {
  const rec = m.sourceRecord as Record<string, unknown>;
  const left: Array<[string, string]> = [
    ["Name", `${m.person.lastName}, ${m.person.firstName}`],
    ["Role", m.person.role],
    ["Location", m.person.entity?.name ?? "—"],
    ["DOB", m.person.dob ? formatDate(m.person.dob) : "not on file"],
    ["NPI", m.person.npi ?? "—"],
  ];
  const skip = new Set(["address", "source"]);
  const right: Array<[string, string]> = Object.entries(rec)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
  const addr = rec.address as Record<string, string> | undefined;
  return (
    <Card id={m.id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          <Link href={`/people/${m.person.id}`} className="hover:underline">
            {m.person.firstName} {m.person.lastName}
          </Link>
          <DispositionBadge disposition={m.disposition} />
          <span className="text-sm font-normal text-muted-foreground">
            {m.run.source === "oig_leie" ? "OIG LEIE" : "SAM.gov"} · {formatDate(m.run.runAt)} · matched on {m.matchedOn.replace("_", " ")} · score {m.score.toFixed(2)}
          </span>
        </CardTitle>
        {m.reviewedBy && (
          <CardDescription>
            {m.disposition.replace("_", " ")} by {m.reviewedBy.name} on {formatDate(m.reviewedAt)}
            {m.reviewNote ? ` — "${m.reviewNote}"` : ""}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Our record</h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {left.map(([k, v]) => (
              <Fragment2 key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Exclusion record</h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {right.map(([k, v]) => (
              <Fragment2 key={k} k={k} v={v} />
            ))}
            {addr && <Fragment2 k="address" v={Object.values(addr).join(", ")} />}
          </dl>
        </div>
        {canReview && m.disposition === "pending" && (
          <div className="lg:col-span-2">
            <DispositionForm matchId={m.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Fragment2({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}
