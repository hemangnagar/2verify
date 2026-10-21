import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ScreeningSource } from "@prisma/client";
import { currentOrgId, db } from "./db";
import { fileKey, storage } from "./storage";
import { leieRowToRecord, matchRoster, parseCsv, type ExclusionRecord, type RosterPerson } from "./matching";
import { screeningReportPdf } from "./evidence";
import { sendMail } from "./email";
import { isoDate } from "./dates";

export type ScreeningMode = "live" | "fixture";

const LEIE_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv";
const SAM_URL = "https://api.sam.gov/entity-information/v4/exclusions";

/**
 * One monthly exclusion screening run for one source.
 * Screens every active person, writes screening_run + screening_match rows, stores a PDF report
 * (even with zero matches), and emails the admins. Returns the run id and match count.
 *
 * mode "fixture" uses the synthetic extracts in prisma/fixtures (demo only).
 */
export async function runScreening(source: ScreeningSource, opts: { mode?: ScreeningMode; now?: Date } = {}) {
  const mode: ScreeningMode = opts.mode ?? ((process.env.SCREENING_MODE as ScreeningMode) || "live");
  const runAt = opts.now ?? new Date();
  const orgId = currentOrgId();
  const people = await db.person.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  const roster: RosterPerson[] = people.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, dob: p.dob, npi: p.npi }));
  const rosterJson = people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, role: p.role, npi: p.npi }));

  const { records, sourceVersion } = source === "oig_leie" ? await loadLeie(mode) : await loadSam(mode, roster);
  const matches = matchRoster(roster, records);

  const primary = await db.entity.findFirst({ where: { isPrimary: true } });
  const entityName = primary ? `${primary.name} (all locations)` : "All locations";
  const runId = randomUUID();
  const pdf = await screeningReportPdf({
    source,
    sourceVersion,
    runAt,
    entityName,
    roster: rosterJson,
    matches: matches.map((m) => ({
      name: rosterJson.find((r) => r.id === m.personId)!.name,
      score: m.score,
      matchedOn: m.matchedOn,
      sourceSummary: `${m.record.lastName}, ${m.record.firstName} ${m.record.middleName ?? ""} — ${m.record.state ?? "?"} — ${String(m.record.exclusionType ?? m.record.exclType ?? "")}`.replace(/\s+/g, " "),
      disposition: "pending",
    })),
  });
  const ownerId = primary?.id ?? "shared";
  const reportFileKey = fileKey(orgId, ownerId, "screening_run", runId, `${source}-report.pdf`, runAt);
  await storage().put(reportFileKey, pdf, { contentType: "application/pdf", metadata: { source, run_at: runAt.toISOString(), source_version: sourceVersion, mode } });

  const run = await db.screeningRun.create({
    data: { id: runId, orgId, runAt, source, sourceVersion, personsScreened: roster.length, matchesFound: matches.length, reportFileKey, roster: rosterJson, isDemo: mode === "fixture" },
  });
  for (const m of matches) {
    await db.screeningMatch.create({ data: { orgId, runId, personId: m.personId, sourceRecord: m.record as object, score: m.score, matchedOn: m.matchedOn, disposition: "pending" } });
  }

  const admins = await db.user.findMany({ where: { role: "org_admin", orgId, active: true }, select: { email: true } });
  const cc = (process.env.ALERT_CC ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const to = [...new Set([...admins.map((a) => a.email), ...cc])];
  if (to.length) {
    const label = source === "oig_leie" ? "OIG LEIE" : "SAM.gov";
    try {
      await sendMail({
        to,
        subject: `[Compliance] Monthly ${label} exclusion screening: ${roster.length} screened, ${matches.length} potential match${matches.length === 1 ? "" : "es"}`,
        text: [
          `${label} exclusion screening ran ${isoDate(runAt)} (${sourceVersion}).`,
          `${roster.length} active staff and prescribers screened; ${matches.length} potential match(es).`,
          matches.length ? `Review: ${process.env.APP_URL ?? "http://localhost:3000"}/screening/matches` : "No action needed. The report is attached and stored for survey evidence.",
        ].join("\n"),
        attachments: [{ filename: `${source}-${isoDate(runAt)}.pdf`, content: pdf, contentType: "application/pdf" }],
      });
    } catch (e) {
      console.error("[screening] report email failed:", (e as Error).message);
    }
  }
  return { runId: run.id, screened: roster.length, matches: matches.length, sourceVersion, mode };
}

function fixturesDir() {
  return path.join(process.cwd(), "prisma", "fixtures");
}

async function loadLeie(mode: ScreeningMode): Promise<{ records: ExclusionRecord[]; sourceVersion: string }> {
  if (mode === "fixture") {
    const text = readFileSync(path.join(fixturesDir(), "leie-sample.csv"), "utf8");
    return { records: parseCsv(text).map(leieRowToRecord), sourceVersion: "LEIE demo fixture (prisma/fixtures/leie-sample.csv)" };
  }
  const res = await fetch(LEIE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`LEIE download failed: HTTP ${res.status}`);
  const text = await res.text();
  const lm = res.headers.get("last-modified");
  return { records: parseCsv(text).map(leieRowToRecord), sourceVersion: `LEIE UPDATED.csv, last modified ${lm ? new Date(lm).toISOString().slice(0, 10) : "unknown"}` };
}

/** SAM has no bulk download without a key tier, so the live mode queries the API once per roster name. */
async function loadSam(mode: ScreeningMode, roster: RosterPerson[]): Promise<{ records: ExclusionRecord[]; sourceVersion: string }> {
  if (mode === "fixture") {
    const doc = JSON.parse(readFileSync(path.join(fixturesDir(), "sam-sample.json"), "utf8")) as { excludedEntity: Array<Record<string, unknown>> };
    return { records: doc.excludedEntity.map(samToRecord), sourceVersion: "SAM demo fixture (prisma/fixtures/sam-sample.json)" };
  }
  const key = process.env.SAM_API_KEY;
  if (!key) throw new Error("SAM_API_KEY is not set");
  const seen = new Map<string, ExclusionRecord>();
  for (const p of roster) {
    const url = `${SAM_URL}?api_key=${encodeURIComponent(key)}&exclusionName=${encodeURIComponent(`${p.lastName}, ${p.firstName}`)}&isActive=Y`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`SAM API failed for ${p.lastName}: HTTP ${res.status}`);
    const doc = (await res.json()) as { excludedEntity?: Array<Record<string, unknown>> };
    for (const e of doc.excludedEntity ?? []) {
      const rec = samToRecord(e);
      seen.set(String(rec.samNumber ?? JSON.stringify(rec)), rec);
    }
  }
  return { records: [...seen.values()], sourceVersion: `SAM.gov Exclusions API v4, queried ${new Date().toISOString().slice(0, 10)}` };
}

export function samToRecord(e: Record<string, unknown>): ExclusionRecord {
  const ind = (e.exclusionIndividual ?? null) as null | { firstName?: string; lastName?: string; middleName?: string; npi?: string | null; dob?: string | null };
  const addr = (e.exclusionPrimaryAddress ?? {}) as { stateOrProvinceCode?: string };
  return {
    lastName: ind?.lastName ?? "",
    firstName: ind?.firstName ?? String(e.exclusionEntityName ?? ""),
    middleName: ind?.middleName,
    npi: ind?.npi ?? null,
    dob: ind?.dob ?? null,
    state: addr.stateOrProvinceCode ?? null,
    source: "sam",
    classification: e.classification,
    samNumber: (e.exclusionIdentification as { samNumber?: string } | undefined)?.samNumber,
    excludingAgency: e.excludingAgencyName,
    exclusionType: e.exclusionType,
    exclusionProgram: e.exclusionProgram,
    activationDate: (e.exclusionDetails as { activationDate?: string } | undefined)?.activationDate,
    terminationDate: (e.exclusionDetails as { terminationDate?: string } | undefined)?.terminationDate,
    address: addr,
  };
}
