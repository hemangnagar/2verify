import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, isOrgAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { PageHeader, DescriptionList, Empty } from "@/components/page-header";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { FileLink, EvidenceThumb } from "@/components/file-link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteCredentialButton } from "./delete-button";
import { changedFields } from "@/lib/audit-format";

export const dynamic = "force-dynamic";

export default async function CredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const c = await db.credential.findUnique({
    where: { id },
    include: {
      credentialType: true,
      person: { include: { entity: true } },
      entity: true,
      verifications: { orderBy: { verifiedAt: "desc" }, include: { verifiedBy: true } },
      alerts: { orderBy: { sentAt: "desc" } },
    },
  });
  if (!c) notFound();
  const audit = await db.auditLog.findMany({ where: { table: "Credential", rowId: id }, orderBy: { at: "desc" }, include: { user: true }, take: 50 });
  const holder = c.person ? `${c.person.firstName} ${c.person.lastName}` : c.entity!.name;
  const holderHref = c.person ? `/people/${c.person.id}` : `/entities/${c.entity!.id}`;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.state ? `${c.state} ` : ""}
            {c.credentialType.name} <StatusBadge status={c.status} />
          </span>
        }
        description={
          <>
            <Link href={holderHref} className="underline">
              {holder}
            </Link>
            {c.number && <span className="ml-2 font-mono">#{c.number}</span>}
          </>
        }
        actions={
          <>
            {c.credentialType.psvRequired && (
              <Button asChild>
                <Link href={`/verify/${c.id}`}>Verify now</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`/credentials/${c.id}/edit`}>Edit</Link>
            </Button>
            {(session ? isOrgAdmin(session) : false) && c.verifications.length === 0 && <DeleteCredentialButton id={c.id} />}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Record</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                ["Issued", formatDate(c.issuedOn)],
                ["Expires", c.expiresOn ? formatDate(c.expiresOn) : "does not expire"],
                ["Renewal lead", `${c.renewalLeadDays} days`],
                ["Re-verify every", c.credentialType.psvRequired ? `${c.reverifyDays} days` : "n/a (not a PSV type)"],
                ["Next verification due", c.credentialType.psvRequired ? (c.verifications.length ? formatDate(c.nextVerifyDue) : <Badge variant="outline">never verified</Badge>) : "n/a"],
                ["Location", c.person?.entity?.name ?? c.entity?.name ?? "—"],
                ["Notes", c.notes],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Document</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {c.documentFileKey ? (
              <>
                <span className="truncate text-muted-foreground">{c.documentFileKey.split("/").pop()}</span>
                <div>
                  <FileLink fileKey={c.documentFileKey} label="Open document" />
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">No document uploaded.</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verification history</CardTitle>
        </CardHeader>
        <CardContent>
          {c.verifications.length === 0 ? (
            <Empty>
              No primary-source verification on record.
              {c.credentialType.psvRequired && (
                <>
                  {" "}
                  <Link href={`/verify/${c.id}`} className="underline">
                    Verify it now.
                  </Link>
                </>
              )}
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Verified</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Expiration seen</TableHead>
                  <TableHead>Discipline</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.verifications.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.verifiedAt.toISOString().replace("T", " ").slice(0, 16)}</TableCell>
                    <TableCell>{v.verifiedBy?.name ?? "system"}</TableCell>
                    <TableCell>{v.method === "auto_api" ? "API" : v.method === "auto_board" ? <Badge variant="success">board (automated)</Badge> : "board (manual)"}</TableCell>
                    <TableCell>
                      <ResultBadge result={v.result} />
                    </TableCell>
                    <TableCell>
                      {formatDate(v.expirationSeen)}
                      {v.expiresBefore && v.expirationSeen && v.expiresBefore.getTime() !== v.expirationSeen.getTime() && (
                        <span className="ml-1 text-xs text-amber-700">(was {formatDate(v.expiresBefore)})</span>
                      )}
                    </TableCell>
                    <TableCell>{v.disciplineFlag ? <Badge variant="destructive">flag</Badge> : "none"}</TableCell>
                    <TableCell>
                      <a href={v.sourceUrl} target="_blank" rel="noreferrer" className="max-w-48 truncate text-xs underline block">
                        {new URL(v.sourceUrl).hostname}
                      </a>
                    </TableCell>
                    <TableCell>
                      <EvidenceThumb fileKey={v.evidenceFileKey} className="h-12 w-auto rounded border" />
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">{v.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alert history</CardTitle>
          </CardHeader>
          <CardContent>
            {c.alerts.length === 0 ? (
              <Empty>No alerts sent.</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sent</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.alerts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{formatDate(a.sentAt)}</TableCell>
                      <TableCell>
                        <Badge variant={a.kind === "overdue" ? "destructive" : a.kind === "status_change" ? "warning" : "secondary"}>{a.kind.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{a.sentTo}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change log</CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <Empty>No changes recorded.</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Changed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.at.toISOString().replace("T", " ").slice(0, 16)}</TableCell>
                      <TableCell>{a.user?.name ?? "system"}</TableCell>
                      <TableCell>{a.action}</TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground">{changedFields(a.before, a.after)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
