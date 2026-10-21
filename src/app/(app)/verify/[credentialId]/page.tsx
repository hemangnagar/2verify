import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { fillTemplate } from "@/lib/board";
import { formatDate, isoDate } from "@/lib/dates";
import { brand } from "@/config/brand";
import { PageHeader, DescriptionList } from "@/components/page-header";
import { StatusBadge, ResultBadge } from "@/components/status-badge";
import { EvidenceThumb } from "@/components/file-link";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "./verify-form";
import { submitVerification } from "../actions";
import { adapterFor } from "@/lib/boards";
import { AutoVerifyButton } from "./auto-verify-button";

export const dynamic = "force-dynamic";

const FALLBACK_SOURCES: Record<string, { name: string; url: string; notes: string }> = {
  "DEA Registration": { name: "DEA Registration Validation", url: "https://apps.deadiversion.usdoj.gov/webforms2/spring/validationLogin", notes: "Sign in with the pharmacy's DEA number, then validate the registration number. Capture the validation result page." },
  "URAC Specialty Pharmacy Accreditation": { name: "URAC Accreditation Directory", url: "https://accreditnet.urac.org/directory", notes: "Search the organization name; capture the directory entry showing program and expiration." },
  "State Controlled Substance Registration": { name: "State controlled-substance registry", url: "https://example.com/state-cs-registry", notes: "Use the issuing state's registry; capture the result." },
};

export default async function VerifyPage({ params }: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await params;
  const c = await db.credential.findUnique({
    where: { id: credentialId },
    include: { credentialType: true, person: true, entity: true, verifications: { orderBy: { verifiedAt: "desc" }, take: 1, include: { verifiedBy: true } } },
  });
  if (!c) notFound();
  // Training, insurance and other non-PSV types are tracked for expiry only; there is no source to verify against.
  if (!c.credentialType.psvRequired) redirect(`/credentials/${c.id}`);
  const holder = c.person ? `${c.person.firstName} ${c.person.lastName}` : c.entity!.name;
  const lookup = c.state ? await db.boardLookup.findUnique({ where: { state_credentialTypeId: { state: c.state, credentialTypeId: c.credentialTypeId } } }) : null;
  const fallback = FALLBACK_SOURCES[c.credentialType.name];
  const source = lookup
    ? { name: lookup.boardName, url: fillTemplate(lookup.urlTemplate, { number: c.number, lastName: c.person?.lastName, firstName: c.person?.firstName }), notes: lookup.notes ?? "" }
    : fallback ?? { name: "Issuing source", url: "https://example.com/", notes: `No board lookup is configured for ${c.state ?? "this"} ${c.credentialType.name}. Add one under Settings → Board lookups.` };
  const prev = c.verifications[0] ?? null;
  const auto = c.number ? await adapterFor(c) : null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Verify: ${c.state ? c.state + " " : ""}${c.credentialType.name}`}
        description={
          <Link href={`/credentials/${c.id}`} className="underline">
            {holder}
          </Link>
        }
      />
      {auto && (
        <Card className="border-emerald-300 bg-emerald-50/50">
          <CardHeader>
            <CardTitle>Automated check available — {auto.adapter.board}</CardTitle>
            <CardDescription>
              {brand.name} queries the board directly, captures the page, and writes the same locked evidence record and credit debit as a manual check. If the board is unreachable, the guided form below still works.
              {c.lastAutoError && <span className="block text-destructive">Last automated attempt failed: {c.lastAutoError}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AutoVerifyButton credentialId={c.id} />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What the system has</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  ["Holder", holder],
                  ["Number", c.number ? <span className="font-mono">{c.number}</span> : "—"],
                  ["Expires", formatDate(c.expiresOn)],
                  ["Status", <StatusBadge key="s" status={c.status} />],
                  ["Next verification due", formatDate(c.nextVerifyDue)],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Previous verification</CardTitle>
            </CardHeader>
            <CardContent>
              {prev ? (
                <div className="grid gap-3">
                  <DescriptionList
                    items={[
                      ["Verified", `${formatDate(prev.verifiedAt)} by ${prev.verifiedBy?.name ?? "system"}`],
                      ["Result", <ResultBadge key="r" result={prev.result} />],
                      ["Expiration seen", formatDate(prev.expirationSeen)],
                      ["Note", prev.note],
                    ]}
                  />
                  <EvidenceThumb fileKey={prev.evidenceFileKey} className="h-40 w-auto rounded border" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Never verified. This will be the first evidence record.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Check the source</CardTitle>
              <CardDescription>{source.name}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open board lookup ↗
                  </a>
                </Button>
                {c.number && <CopyButton value={c.number} />}
                {c.person && <CopyButton value={c.person.lastName} label={`Last: ${c.person.lastName}`} />}
                {c.person && <CopyButton value={c.person.firstName} label={`First: ${c.person.firstName}`} />}
              </div>
              <p className="text-muted-foreground">{source.notes}</p>
              <p className="truncate text-xs text-muted-foreground">{source.url}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>2. Record what the board shows</CardTitle>
              <CardDescription>Saved as an immutable evidence record stamped with you, the time, and the board URL.</CardDescription>
            </CardHeader>
            <CardContent>
              <VerifyForm action={submitVerification.bind(null, c.id)} sourceUrl={source.url} defaultExpiration={c.expiresOn ? isoDate(c.expiresOn) : ""} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
