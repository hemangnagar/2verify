/**
 * Demo seed: three fictional customer pharmacy groups on different plan tiers.
 *
 *   sierra   Sierra Specialty Pharmacy     NV CA AZ      Advanced  active  2,400 credits, 588 used  (the walkthrough org)
 *   harbor   Harbor Compounding            CA            Core      active    240 credits, 201 used  (overage projected)
 *   prairie  Prairie Infusion Partners     TX OK KS MO   Team      trial   1,200 credits,  40 used  (fresh trial)
 *
 * Everything is synthetic: names, addresses, NPIs (random digits with a valid check digit), DEA
 * numbers, license numbers, evidence files, and screening extracts. Dates are relative to the day the
 * seed runs. "Used" credits are real verification rows with evidence, one ledger debit each, so the
 * ledger reconciles by construction.
 *
 * Requires the catalog seed (make seed). Refuses to run if demo orgs already exist (make demo-reset).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { AlertKind, OrgStatus, PersonRole, VerificationMethod, VerificationResult } from "@prisma/client";
import { asOrg, asSystem, db, dbRaw } from "../src/lib/db";
import { fileKey, storage } from "../src/lib/storage";
import { fakeDea, fakeLicenseNumber, fakeNpi, mulberry32 } from "../src/lib/ids";
import { addDays, dateOnly, firstOfMonth, isoDate } from "../src/lib/dates";
import { computeNextVerifyDue, computeStatus, expiryAlertsDueBy } from "../src/lib/status";
import { leieRowToRecord, matchRoster, parseCsv } from "../src/lib/matching";
import { placeholderBoardScreenshot, placeholderCertificatePdf, screeningReportPdf } from "../src/lib/evidence";
import { fakeNppesResponse, TAXONOMY } from "../src/lib/nppes-fixture";
import { fillTemplate } from "../src/lib/board";
import { samToRecord } from "../src/lib/screening";
import { checkLedger } from "../src/lib/pricing";

const today = dateOnly(new Date());
const D = (days: number) => dateOnly(addDays(today, days));
const NPPES_URL = "https://npiregistry.cms.hhs.gov/api/?version=2.1&number=";
const DEA_URL = "https://apps.deadiversion.usdoj.gov/webforms2/spring/validationLogin";
const URAC_URL = "https://accreditnet.urac.org/directory";
const ADMIN_PASSWORD = process.env.SEED_ORG_ADMIN_PASSWORD ?? "admin1234";

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

interface PersonSpec {
  key: string;
  first: string;
  last: string;
  role: PersonRole;
  loc: string | null; // entity key
  dob: string;
  hired: number; // days ago
  npi?: boolean;
  active?: boolean;
  taxonomy?: keyof typeof TAXONOMY;
  credential?: string;
}
interface EntitySpec {
  key: string;
  name: string;
  state: string;
  address: string;
  primary?: boolean;
}
interface OrgSpec {
  slug: string;
  name: string;
  planName: string;
  status: OrgStatus;
  states: string[];
  termStartedDaysAgo: number;
  targetUsed: number;
  adminName: string;
  seed: number;
  /** Range (days ago) for ordinary historical verifications; must stay inside the term. */
  recent: [number, number];
  entities: EntitySpec[];
  people: PersonSpec[];
  build: (b: OrgBuilder) => Promise<void>;
  extraUsers?: Array<{ email: string; name: string; role: "verifier" | "org_admin"; password: string }>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface VerifySpec {
  daysAgo: number;
  result?: VerificationResult;
  method?: VerificationMethod;
  expirationSeen?: Date | null;
  note?: string;
  expiresBefore?: Date;
}
interface CredSpec {
  subject: { person?: string; entity?: string };
  type: string;
  state?: string | null;
  number?: string | null;
  issuedDaysAgo?: number;
  expiresIn?: number | null;
  verifications?: VerifySpec[];
  neverVerifiedSince?: Date;
  document?: boolean;
  notes?: string;
}

class OrgBuilder {
  rand: () => number;
  orgId = "";
  entities = new Map<string, Awaited<ReturnType<typeof db.entity.create>>>();
  people = new Map<string, Awaited<ReturnType<typeof db.person.create>>>();
  types = new Map<string, Awaited<ReturnType<typeof db.credentialType.findMany>>[number]>();
  lookups: Awaited<ReturnType<typeof db.boardLookup.findMany>> = [];
  verifierIds: string[] = [];
  pendingVerifications: Array<{ id: string; at: Date }> = [];
  counts = { credentials: 0, verifications: 0, alerts: 0, files: 0 };
  pngCache = new Map<string, Buffer>();
  constructor(public spec: OrgSpec) {
    this.rand = mulberry32(spec.seed);
  }
  between(lo: number, hi: number) {
    return lo + Math.floor(this.rand() * (hi - lo + 1));
  }
  pick<T>(arr: T[]) {
    return arr[Math.floor(this.rand() * arr.length)];
  }
  T(name: string) {
    const t = this.types.get(name);
    if (!t) throw new Error(`credential type missing: ${name}`);
    return t;
  }
  P(key: string) {
    return this.people.get(key)!;
  }
  E(key: string) {
    return this.entities.get(key)!;
  }
  lic(state: string, kind: Parameters<typeof fakeLicenseNumber>[2]) {
    return fakeLicenseNumber(this.rand, state, kind);
  }
  V(daysAgo: number, extra: Partial<VerifySpec> = {}): VerifySpec {
    return { daysAgo, ...extra };
  }
  recent(): VerifySpec[] {
    return [this.V(this.between(this.spec.recent[0], this.spec.recent[1]))];
  }
  lookupFor(state: string | null, typeId: string) {
    return this.lookups.find((l) => l.state === state && l.credentialTypeId === typeId) ?? null;
  }

  async alert(credentialId: string, holderEmail: string | null, kind: AlertKind, at: Date, subject: string) {
    const cc = (process.env.ALERT_CC ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const recipients = [...new Set([...(holderEmail ? [holderEmail] : []), ...cc, `admin@${this.spec.slug}.example.com`])];
    for (const to of recipients) {
      await db.alert.create({ data: { orgId: this.orgId, credentialId, sentTo: to, sentAt: at, kind, subject, isDemo: true } });
      this.counts.alerts++;
    }
  }

  /** Insert a verification row with evidence. Ledger debits are written afterwards in time order. */
  async verification(c: { id: string; number: string | null; state: string | null; expiresOn: Date | null; typeName: string; typeId: string; personKey?: string; entityKey?: string }, v: VerifySpec) {
    const type = this.T(c.typeName);
    const person = c.personKey ? this.P(c.personKey) : null;
    const entity = c.entityKey ? this.E(c.entityKey) : person?.entityId ? [...this.entities.values()].find((e) => e.id === person.entityId)! : [...this.entities.values()][0];
    const holderName = person ? `${person.firstName} ${person.lastName}` : entity.name;
    const ownerEntityId = person ? (person.entityId ?? entity.id) : entity.id;
    const at = new Date(D(-v.daysAgo).getTime() + this.between(9, 17) * 3600_000);
    const method: VerificationMethod = v.method ?? (type.name === "NPI" ? "auto_api" : "manual_board");
    const result = v.result ?? "active";
    const vid = randomUUID();
    const lookup = this.lookupFor(c.state, type.id);
    const sourceUrl =
      method === "auto_api"
        ? NPPES_URL + (person?.npi ?? entity.npi)
        : lookup
          ? fillTemplate(lookup.urlTemplate, { number: c.number, lastName: person?.lastName, firstName: person?.firstName })
          : type.name === "DEA Registration"
            ? DEA_URL
            : type.name.includes("URAC")
              ? URAC_URL
              : "https://example.com/manual-check";
    const seen = v.expirationSeen === undefined ? c.expiresOn : v.expirationSeen;
    let evidenceFileKey: string;
    if (method === "auto_api") {
      const ps = this.spec.people.find((p) => p.key === c.personKey);
      const json = fakeNppesResponse(
        person
          ? { npi: person.npi!, kind: "individual", firstName: person.firstName, lastName: person.lastName, credential: ps?.credential ?? "PHARMD", taxonomyCode: TAXONOMY[ps?.taxonomy ?? "pharmacist"].code, taxonomyDesc: TAXONOMY[ps?.taxonomy ?? "pharmacist"].desc, state: entity.state, city: "", address: entity.address.split(",")[0], enumerationDate: isoDate(D(-this.between(2000, 6000))) }
          : { npi: entity.npi!, kind: "organization", orgName: entity.name, taxonomyCode: TAXONOMY.specialtyPharmacy.code, taxonomyDesc: TAXONOMY.specialtyPharmacy.desc, state: entity.state, city: "", address: entity.address.split(",")[0], enumerationDate: isoDate(D(-this.between(2000, 6000))) },
        at
      );
      evidenceFileKey = fileKey(this.orgId, ownerEntityId, "verification", vid, "nppes-response.json", at);
      await storage().put(evidenceFileKey, JSON.stringify(json, null, 2), { contentType: "application/json", metadata: { verifier: "system", verified_at: at.toISOString(), source_url: sourceUrl } });
    } else {
      const cacheKey = `${c.id}:${result}:${seen ? isoDate(seen) : ""}`;
      let png = this.pngCache.get(cacheKey);
      if (!png) {
        png = placeholderBoardScreenshot({ boardName: lookup?.boardName ?? (type.name === "DEA Registration" ? "DEA Registration Validation" : type.name), licenseNumber: c.number ?? "", holderName, status: result.toUpperCase(), expires: seen ? isoDate(seen) : "N/A", capturedAt: isoDate(at) });
        this.pngCache.set(cacheKey, png);
      }
      evidenceFileKey = fileKey(this.orgId, ownerEntityId, "verification", vid, "board-screenshot.png", at);
      await storage().put(evidenceFileKey, png, { contentType: "image/png", metadata: { verifier: "demo", verified_at: at.toISOString(), source_url: sourceUrl } });
    }
    this.counts.files++;
    await db.verification.create({
      data: {
        id: vid,
        orgId: this.orgId,
        credentialId: c.id,
        verifiedById: method === "auto_api" ? null : this.pick(this.verifierIds),
        verifiedAt: at,
        method,
        sourceUrl,
        result,
        expirationSeen: seen,
        disciplineFlag: false,
        note: v.note ?? (method === "auto_api" ? "NPPES record matched name and taxonomy." : "Board record matches. No disciplinary actions listed."),
        evidenceFileKey,
        statusBefore: v.expiresBefore ? "active" : null,
        expiresBefore: v.expiresBefore ?? null,
      },
    });
    this.counts.verifications++;
    this.pendingVerifications.push({ id: vid, at });
    if (v.expiresBefore) {
      await this.alert(c.id, person?.email ?? null, "status_change", at, `[Compliance] ${type.name} for ${holderName}: expiration updated from ${isoDate(v.expiresBefore)} to ${seen ? isoDate(seen) : "n/a"} after board verification`);
    }
  }

  async cred(c: CredSpec) {
    const type = this.T(c.type);
    const person = c.subject.person ? this.P(c.subject.person) : null;
    const entity = c.subject.entity ? this.E(c.subject.entity) : person?.entityId ? [...this.entities.values()].find((e) => e.id === person.entityId)! : [...this.entities.values()][0];
    const holderName = person ? `${person.firstName} ${person.lastName}` : entity.name;
    const ownerEntityId = person ? (person.entityId ?? entity.id) : entity.id;
    const expiresOn = c.expiresIn === null ? null : c.expiresIn === undefined ? D(this.between(100, 700)) : D(c.expiresIn);
    const issuedOn = D(-(c.issuedDaysAgo ?? this.between(400, 2500)));
    const id = randomUUID();

    let documentFileKey: string | null = null;
    if ((c.document ?? ["license", "permit", "registration", "insurance", "accreditation"].includes(type.category)) && type.name !== "NPI") {
      const pdf = await placeholderCertificatePdf({
        title: type.name,
        holder: holderName,
        number: c.number ?? "—",
        issued: isoDate(issuedOn),
        expires: expiresOn ? isoDate(expiresOn) : "n/a",
        issuer: this.lookupFor(c.state ?? null, type.id)?.boardName ?? (type.name === "DEA Registration" ? "Drug Enforcement Administration" : type.name.includes("Insurance") ? "Demo Mutual Insurance Co." : type.name.includes("URAC") ? "URAC" : "Issuing Authority"),
      });
      documentFileKey = fileKey(this.orgId, ownerEntityId, "credential", id, `${type.name.replace(/\W+/g, "-").toLowerCase()}.pdf`, issuedOn);
      await storage().put(documentFileKey, pdf, { contentType: "application/pdf", metadata: { source: "demo-seed", holder: holderName } });
      this.counts.files++;
    }

    const vlist = c.verifications ?? [];
    const latest = vlist[vlist.length - 1];
    const status = computeStatus({ expiresOn, renewalLeadDays: type.defaultLeadDays, latestResult: latest ? (latest.result ?? "active") : null }, today);
    const nextVerifyDue = type.psvRequired ? computeNextVerifyDue(latest ? D(-latest.daysAgo) : null, type.defaultReverifyDays, c.neverVerifiedSince ?? person?.hireDate ?? issuedOn) : null;

    await db.credential.create({
      data: {
        id,
        orgId: this.orgId,
        subjectType: person ? "person" : "entity",
        personId: person?.id ?? null,
        entityId: person ? null : entity.id,
        credentialTypeId: type.id,
        state: type.stateSpecific ? (c.state ?? null) : null,
        number: c.number ?? null,
        issuedOn,
        expiresOn,
        renewalLeadDays: type.defaultLeadDays,
        reverifyDays: type.defaultReverifyDays,
        nextVerifyDue,
        status,
        documentFileKey,
        notes: c.notes,
        isDemo: true,
      },
    });
    this.counts.credentials++;
    const ref = { id, number: c.number ?? null, state: type.stateSpecific ? (c.state ?? null) : null, expiresOn, typeName: type.name, typeId: type.id, personKey: c.subject.person, entityKey: c.subject.entity };
    for (const v of vlist) await this.verification(ref, v);

    if (expiresOn) {
      for (const a of expiryAlertsDueBy(expiresOn, today)) {
        const subject = a.kind === "overdue" ? `[Compliance] OVERDUE: ${c.state ?? ""} ${type.name} for ${holderName} expired ${isoDate(expiresOn)}` : `[Compliance] ${c.state ?? ""} ${type.name} for ${holderName} expires in ${a.kind.replace("lead_", "")} days (${isoDate(expiresOn)})`;
        await this.alert(id, person?.email ?? null, a.kind, new Date(a.on.getTime() + 2 * 3600_000), subject.replace(/\s+/g, " "));
      }
    }
    return ref;
  }

  /** Standard training rows: HIPAA for everyone, FWA for a subset. */
  async training(keys: string[], course: string, prefix: string) {
    for (const k of keys) {
      const done = this.between(30, 240);
      await this.cred({ subject: { person: k }, type: course, number: `${prefix}-${today.getUTCFullYear()}-${k.toUpperCase()}`, issuedDaysAgo: done, expiresIn: 365 - done, document: true });
    }
  }

  /**
   * Add historical verifications until the org's count reaches the target, round-robin over PSV
   * credentials that already have at least one (so never-verified stories stay intact), spread
   * uniformly across the term so the usage page's run rate reflects steady use.
   */
  async densify(target: number) {
    const creds = await db.credential.findMany({ where: { credentialType: { psvRequired: true }, verifications: { some: {} } }, include: { credentialType: true, person: true, entity: true } });
    if (!creds.length) return;
    const hi = Math.max(2, this.spec.termStartedDaysAgo - 1);
    let i = 0;
    while (this.counts.verifications < target) {
      const c = creds[i++ % creds.length];
      await this.verification(this.refOf(c), { daysAgo: this.between(1, hi) });
    }
  }
  private refOf(c: { id: string; number: string | null; state: string | null; expiresOn: Date | null; credentialType: { name: string; id: string }; person: { id: string } | null; entity: { id: string } | null }) {
    const personKey = c.person ? [...this.people.entries()].find(([, p]) => p.id === c.person!.id)?.[0] : undefined;
    const entityKey = c.entity ? [...this.entities.entries()].find(([, e]) => e.id === c.entity!.id)?.[0] : undefined;
    return { id: c.id, number: c.number, state: c.state, expiresOn: c.expiresOn, typeName: c.credentialType.name, typeId: c.credentialType.id, personKey, entityKey };
  }

  /** Allotment at term start, then one debit per verification in time order. */
  async writeLedger(creditsPerYear: number, planName: string) {
    const termStart = D(-this.spec.termStartedDaysAgo);
    let balance = creditsPerYear;
    await dbRaw.creditLedger.create({ data: { orgId: this.orgId, delta: creditsPerYear, reason: "allotment", balanceAfter: balance, note: `Annual allotment (${planName})`, createdAt: termStart } });
    const rows = [...this.pendingVerifications].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const v of rows) {
      if (v.at < termStart) throw new Error(`verification ${v.id} dated before term start`);
      balance -= 1;
      await dbRaw.creditLedger.create({ data: { orgId: this.orgId, delta: -1, reason: "verification", verificationId: v.id, balanceAfter: balance, createdAt: v.at } });
    }
    const all = await dbRaw.creditLedger.findMany({ where: { orgId: this.orgId } });
    const check = checkLedger(all);
    if (!check.ok) throw new Error(`ledger invariant failed for ${this.spec.slug}: ${check.problem}`);
    return balance;
  }

  async screening() {
    const roster = [...this.people.values()].filter((p) => p.active);
    const rosterJson = roster.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, role: p.role, npi: p.npi }));
    const runAt = new Date(firstOfMonth(today, -1).getTime() + 3 * 3600_000);
    const fixtures = path.join(__dirname, "fixtures");
    const leie = matchRoster(roster, parseCsv(readFileSync(path.join(fixtures, "leie-sample.csv"), "utf8")).map(leieRowToRecord));
    const samDoc = JSON.parse(readFileSync(path.join(fixtures, "sam-sample.json"), "utf8")) as { excludedEntity: Array<Record<string, unknown>> };
    const sam = matchRoster(roster, samDoc.excludedEntity.map(samToRecord));
    const primary = [...this.entities.values()][0];
    for (const [source, matches, version] of [
      ["oig_leie", leie, `LEIE updated ${isoDate(addDays(runAt, -6))} (demo fixture)`],
      ["sam", sam, `SAM Exclusions API extract ${isoDate(runAt)} (demo fixture)`],
    ] as const) {
      const runId = randomUUID();
      const pdf = await screeningReportPdf({
        source,
        sourceVersion: version,
        runAt,
        entityName: `${this.spec.name} (all locations)`,
        roster: rosterJson,
        matches: matches.map((m) => ({ name: rosterJson.find((r) => r.id === m.personId)!.name, score: m.score, matchedOn: m.matchedOn, sourceSummary: `${m.record.lastName}, ${m.record.firstName} ${m.record.middleName ?? ""} — ${m.record.state ?? "?"}`.replace(/\s+/g, " "), disposition: "pending" })),
      });
      const reportFileKey = fileKey(this.orgId, primary.id, "screening_run", runId, `${source}-report.pdf`, runAt);
      await storage().put(reportFileKey, pdf, { contentType: "application/pdf", metadata: { source, run_at: runAt.toISOString() } });
      this.counts.files++;
      await db.screeningRun.create({ data: { id: runId, orgId: this.orgId, runAt, source, sourceVersion: version, personsScreened: roster.length, matchesFound: matches.length, reportFileKey, roster: rosterJson, isDemo: true } });
      for (const m of matches) await db.screeningMatch.create({ data: { orgId: this.orgId, runId, personId: m.personId, sourceRecord: m.record as object, score: m.score, matchedOn: m.matchedOn, disposition: "pending" } });
    }
    return { leie: leie.length, sam: sam.length };
  }
}

// ---------------------------------------------------------------------------
// Org specs
// ---------------------------------------------------------------------------

const SIERRA: OrgSpec = {
  slug: "sierra",
  name: "Sierra Specialty Pharmacy",
  planName: "Advanced",
  status: "active",
  states: ["NV", "CA", "AZ"],
  termStartedDaysAgo: 300,
  targetUsed: 588,
  adminName: "Megan Whitfield",
  seed: 20261020,
  recent: [30, 290],
  extraUsers: [{ email: "verifier@sierra-rx.example.com", name: "Megan Whitfield", role: "verifier", password: "verifier1234" }],
  entities: [
    { key: "reno", name: "Sierra Specialty Pharmacy", state: "NV", address: "1200 Sierra Vista Way, Suite 140, Reno, NV 89502", primary: true },
    { key: "sac", name: "Sierra Specialty Pharmacy – Sacramento", state: "CA", address: "455 Capitol Mall Dr, Suite 210, Sacramento, CA 95814" },
  ],
  people: [
    { key: "priya", first: "Priya", last: "Ramaswamy", role: "pharmacist", loc: "reno", dob: "1981-04-12", hired: 2100, npi: true },
    { key: "daniel", first: "Daniel", last: "Okonkwo", role: "pharmacist", loc: "reno", dob: "1986-09-30", hired: 1500, npi: true },
    { key: "hannah", first: "Hannah", last: "Lindqvist", role: "pharmacist", loc: "reno", dob: "1990-01-22", hired: 800, npi: true },
    { key: "marcus", first: "Marcus", last: "Delgado", role: "technician", loc: "reno", dob: "1994-07-08", hired: 1200 },
    { key: "aisha", first: "Aisha", last: "Rahman", role: "technician", loc: "reno", dob: "1997-11-03", hired: 600 },
    { key: "tyler", first: "Tyler", last: "Brennan", role: "technician", loc: "reno", dob: "1992-03-15", hired: 1900 },
    { key: "sofia", first: "Sofia", last: "Castellanos", role: "technician", loc: "reno", dob: "1999-05-27", hired: 300 },
    { key: "jordan", first: "Jordan", last: "Pham", role: "intern", loc: "reno", dob: "2001-08-19", hired: 150 },
    { key: "megan", first: "Megan", last: "Whitfield", role: "staff", loc: "reno", dob: "1979-12-02", hired: 2300 },
    { key: "luis", first: "Luis", last: "Ortega", role: "staff", loc: "reno", dob: "1988-06-14", hired: 900 },
    { key: "elena", first: "Elena", last: "Vasquez", role: "pharmacist", loc: "sac", dob: "1984-02-09", hired: 75, npi: true },
    { key: "kevin", first: "Kevin", last: "Nakamura", role: "pharmacist", loc: "sac", dob: "1977-10-25", hired: 1700, npi: true },
    { key: "brianna", first: "Brianna", last: "Holt", role: "technician", loc: "sac", dob: "1996-04-01", hired: 1000 },
    { key: "omar", first: "Omar", last: "Siddiqui", role: "technician", loc: "sac", dob: "1993-09-17", hired: 450 },
    { key: "rachel", first: "Rachel", last: "Kim", role: "technician", loc: "reno", dob: "1995-01-30", hired: 1600, active: false },
    { key: "okafor", first: "Robert", last: "Okafor", role: "prescriber", loc: null, dob: "1972-05-05", hired: 1400, npi: true, taxonomy: "oncology", credential: "MD" },
    { key: "moreau", first: "Catherine", last: "Moreau", role: "prescriber", loc: null, dob: "1980-08-23", hired: 900, npi: true, taxonomy: "rheumatology", credential: "MD" },
    { key: "adeyemi", first: "Samuel", last: "Adeyemi", role: "prescriber", loc: null, dob: "1968-11-11", hired: 2000, npi: true, taxonomy: "internalMedicine", credential: "MD" },
  ],
  async build(b) {
    const reno = b.E("reno");
    const sac = b.E("sac");
    const V = b.V.bind(b);
    await b.cred({ subject: { entity: "reno" }, type: "Pharmacy Permit", state: "NV", number: b.lic("NV", "pharmacy"), verifications: b.recent() });
    await b.cred({ subject: { entity: "reno" }, type: "Nonresident Pharmacy Permit", state: "AZ", number: b.lic("AZ", "pharmacy"), verifications: b.recent() });
    await b.cred({ subject: { entity: "reno" }, type: "Nonresident Pharmacy Permit", state: "CA", number: b.lic("CA", "pharmacy"), verifications: b.recent() });
    await b.cred({ subject: { entity: "reno" }, type: "DEA Registration", number: reno.deaNumber, verifications: b.recent() });
    await b.cred({ subject: { entity: "reno" }, type: "NPI", number: reno.npi, expiresIn: null, verifications: [V(b.between(20, 200), { method: "auto_api" })] });
    await b.cred({ subject: { entity: "reno" }, type: "State Controlled Substance Registration", state: "NV", number: `CS${b.lic("NV", "pharmacy").slice(2)}`, verifications: b.recent() });
    await b.cred({ subject: { entity: "reno" }, type: "Professional Liability Insurance", number: "DMI-PL-4471920", expiresIn: 27, issuedDaysAgo: 338, notes: "Demo Mutual Insurance Co. Renewal quote requested." });
    await b.cred({ subject: { entity: "reno" }, type: "URAC Specialty Pharmacy Accreditation", number: "URAC-SP-DEMO-2024", expiresIn: 400, issuedDaysAgo: 695, verifications: [V(200)] });
    await b.cred({ subject: { entity: "sac" }, type: "Pharmacy Permit", state: "CA", number: b.lic("CA", "pharmacy"), expiresIn: 62, issuedDaysAgo: 303, verifications: [V(250)] });
    await b.cred({ subject: { entity: "sac" }, type: "Nonresident Pharmacy Permit", state: "AZ", number: b.lic("AZ", "pharmacy"), verifications: b.recent() });
    await b.cred({ subject: { entity: "sac" }, type: "DEA Registration", number: sac.deaNumber, verifications: b.recent() });
    await b.cred({ subject: { entity: "sac" }, type: "NPI", number: sac.npi, expiresIn: null, verifications: [V(b.between(20, 200), { method: "auto_api" })] });
    await b.cred({ subject: { entity: "sac" }, type: "Professional Liability Insurance", number: "DMI-PL-4471921", expiresIn: 210, issuedDaysAgo: 155 });
    // STORY: Priya's NV license expires in 21 days
    await b.cred({ subject: { person: "priya" }, type: "Pharmacist License", state: "NV", number: b.lic("NV", "pharmacist"), expiresIn: 21, issuedDaysAgo: 709, verifications: [V(280)] });
    await b.cred({ subject: { person: "priya" }, type: "Pharmacist License", state: "CA", number: b.lic("CA", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "priya" }, type: "Pharmacist License", state: "AZ", number: b.lic("AZ", "pharmacist"), verifications: b.recent() });
    // STORY: Daniel's NV license renewed; the later verification caught the new expiry
    await b.cred({ subject: { person: "daniel" }, type: "Pharmacist License", state: "NV", number: b.lic("NV", "pharmacist"), expiresIn: 410, issuedDaysAgo: 1460, verifications: [V(280, { expirationSeen: D(45) }), V(120, { expirationSeen: D(410), expiresBefore: D(45), note: "Board shows renewal processed; expiration moved out one cycle." })] });
    await b.cred({ subject: { person: "daniel" }, type: "Pharmacist License", state: "CA", number: b.lic("CA", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "hannah" }, type: "Pharmacist License", state: "NV", number: b.lic("NV", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "hannah" }, type: "Pharmacist License", state: "AZ", number: b.lic("AZ", "pharmacist"), verifications: b.recent() });
    // STORY: Elena, hired 75 days ago, never verified
    await b.cred({ subject: { person: "elena" }, type: "Pharmacist License", state: "CA", number: b.lic("CA", "pharmacist"), expiresIn: 300, issuedDaysAgo: 430, neverVerifiedSince: D(-75), notes: "New hire. Onboarding PSV not yet completed." });
    await b.cred({ subject: { person: "elena" }, type: "Pharmacist License", state: "NV", number: b.lic("NV", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "kevin" }, type: "Pharmacist License", state: "CA", number: b.lic("CA", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "kevin" }, type: "Pharmacist License", state: "NV", number: b.lic("NV", "pharmacist"), verifications: b.recent() });
    for (const k of ["priya", "daniel", "hannah", "elena", "kevin"]) await b.cred({ subject: { person: k }, type: "NPI", number: b.P(k).npi, expiresIn: null, verifications: [V(b.between(20, 280), { method: "auto_api" })] });
    // STORY: Marcus's NV technician license expired 12 days ago, never verified
    await b.cred({ subject: { person: "marcus" }, type: "Pharmacy Technician License", state: "NV", number: b.lic("NV", "technician"), expiresIn: -12, issuedDaysAgo: 742, neverVerifiedSince: D(-12), notes: "Renewal application submitted to the board per Marcus; awaiting confirmation." });
    await b.cred({ subject: { person: "aisha" }, type: "Pharmacy Technician License", state: "NV", number: b.lic("NV", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "tyler" }, type: "Pharmacy Technician License", state: "NV", number: b.lic("NV", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "tyler" }, type: "Pharmacy Technician License", state: "CA", number: b.lic("CA", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "sofia" }, type: "Pharmacy Technician License", state: "NV", number: b.lic("NV", "technician"), verifications: b.recent() });
    // STORY: Brianna's CA license expires in 45 days
    await b.cred({ subject: { person: "brianna" }, type: "Pharmacy Technician License", state: "CA", number: b.lic("CA", "technician"), expiresIn: 45, issuedDaysAgo: 685, verifications: [V(280)] });
    await b.cred({ subject: { person: "omar" }, type: "Pharmacy Technician License", state: "CA", number: b.lic("CA", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "omar" }, type: "Pharmacy Technician License", state: "NV", number: b.lic("NV", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "jordan" }, type: "Pharmacy Intern License", state: "NV", number: b.lic("NV", "intern"), verifications: b.recent() });
    // STORY: Dr. Okafor's DEA expires in 80 days
    await b.cred({ subject: { person: "okafor" }, type: "Prescriber State License", state: "NV", number: b.lic("NV", "medical"), verifications: b.recent() });
    await b.cred({ subject: { person: "okafor" }, type: "DEA Registration", number: fakeDea(b.rand, "Okafor", "B"), expiresIn: 80, issuedDaysAgo: 1015, verifications: [V(200)] });
    await b.cred({ subject: { person: "okafor" }, type: "NPI", number: b.P("okafor").npi, expiresIn: null, verifications: [V(b.between(20, 280), { method: "auto_api" })] });
    await b.cred({ subject: { person: "moreau" }, type: "Prescriber State License", state: "CA", number: b.lic("CA", "medical"), verifications: b.recent() });
    await b.cred({ subject: { person: "moreau" }, type: "DEA Registration", number: fakeDea(b.rand, "Moreau", "B"), verifications: b.recent() });
    await b.cred({ subject: { person: "moreau" }, type: "NPI", number: b.P("moreau").npi, expiresIn: null, verifications: [V(b.between(20, 280), { method: "auto_api" })] });
    await b.cred({ subject: { person: "adeyemi" }, type: "Prescriber State License", state: "NV", number: b.lic("NV", "medical"), verifications: b.recent() });
    await b.cred({ subject: { person: "adeyemi" }, type: "DEA Registration", number: fakeDea(b.rand, "Adeyemi", "B"), verifications: b.recent() });
    await b.cred({ subject: { person: "adeyemi" }, type: "NPI", number: b.P("adeyemi").npi, expiresIn: null, verifications: [V(b.between(20, 280), { method: "auto_api" })] });
    const staff = SIERRA.people.filter((p) => p.role !== "prescriber" && p.active !== false).map((p) => p.key);
    await b.training(staff, "HIPAA Training", "HIPAA");
    await b.training(SIERRA.people.filter((p) => p.loc === "reno" && (p.role === "pharmacist" || p.role === "technician")).map((p) => p.key), "Fraud, Waste & Abuse Training", "FWA");
  },
};

const HARBOR: OrgSpec = {
  slug: "harbor",
  name: "Harbor Compounding",
  planName: "Core",
  status: "active",
  states: ["CA"],
  termStartedDaysAgo: 240,
  targetUsed: 201,
  adminName: "Dana Whitcombe",
  seed: 7781,
  recent: [15, 230],
  entities: [{ key: "main", name: "Harbor Compounding Pharmacy", state: "CA", address: "2210 Harbor Blvd, Suite B, Long Beach, CA 90806", primary: true }],
  people: [
    { key: "dana", first: "Dana", last: "Whitcombe", role: "pharmacist", loc: "main", dob: "1978-03-14", hired: 2600, npi: true },
    { key: "felix", first: "Felix", last: "Oyelaran", role: "pharmacist", loc: "main", dob: "1989-07-21", hired: 900, npi: true },
    { key: "grace", first: "Grace", last: "Tanaka", role: "technician", loc: "main", dob: "1995-10-02", hired: 1300 },
    { key: "mateo", first: "Mateo", last: "Ruiz", role: "technician", loc: "main", dob: "1998-01-19", hired: 500 },
    { key: "nina", first: "Nina", last: "Kowalski", role: "technician", loc: "main", dob: "1993-05-09", hired: 2000 },
    { key: "ivy", first: "Ivy", last: "Marchetti", role: "staff", loc: "main", dob: "1985-11-27", hired: 1800 },
    { key: "bauer", first: "Henrik", last: "Bauer", role: "prescriber", loc: null, dob: "1970-02-02", hired: 1100, npi: true, taxonomy: "internalMedicine", credential: "MD" },
  ],
  async build(b) {
    const main = b.E("main");
    const V = b.V.bind(b);
    await b.cred({ subject: { entity: "main" }, type: "Pharmacy Permit", state: "CA", number: b.lic("CA", "pharmacy"), expiresIn: 140, issuedDaysAgo: 225, verifications: b.recent() });
    await b.cred({ subject: { entity: "main" }, type: "DEA Registration", number: main.deaNumber, verifications: b.recent() });
    await b.cred({ subject: { entity: "main" }, type: "NPI", number: main.npi, expiresIn: null, verifications: [V(b.between(20, 200), { method: "auto_api" })] });
    await b.cred({ subject: { entity: "main" }, type: "Professional Liability Insurance", number: "DMI-PL-5520018", expiresIn: 95, issuedDaysAgo: 270 });
    await b.cred({ subject: { person: "dana" }, type: "Pharmacist License", state: "CA", number: b.lic("CA", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "felix" }, type: "Pharmacist License", state: "CA", number: b.lic("CA", "pharmacist"), expiresIn: 38, issuedDaysAgo: 692, verifications: b.recent() });
    for (const k of ["dana", "felix"]) await b.cred({ subject: { person: k }, type: "NPI", number: b.P(k).npi, expiresIn: null, verifications: [V(b.between(20, 200), { method: "auto_api" })] });
    await b.cred({ subject: { person: "grace" }, type: "Pharmacy Technician License", state: "CA", number: b.lic("CA", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "mateo" }, type: "Pharmacy Technician License", state: "CA", number: b.lic("CA", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "nina" }, type: "Pharmacy Technician License", state: "CA", number: b.lic("CA", "technician"), expiresIn: -3, issuedDaysAgo: 733, verifications: [V(200)], notes: "Renewal fee paid; board shows pending." });
    await b.cred({ subject: { person: "bauer" }, type: "Prescriber State License", state: "CA", number: b.lic("CA", "medical"), verifications: b.recent() });
    await b.cred({ subject: { person: "bauer" }, type: "DEA Registration", number: fakeDea(b.rand, "Bauer", "B"), verifications: b.recent() });
    await b.cred({ subject: { person: "bauer" }, type: "NPI", number: b.P("bauer").npi, expiresIn: null, verifications: [V(b.between(20, 200), { method: "auto_api" })] });
    const staff = HARBOR.people.filter((p) => p.role !== "prescriber").map((p) => p.key);
    await b.training(staff, "HIPAA Training", "HIPAA");
    await b.training(staff.filter((k) => k !== "ivy"), "Fraud, Waste & Abuse Training", "FWA");
  },
};

const PRAIRIE: OrgSpec = {
  slug: "prairie",
  name: "Prairie Infusion Partners",
  planName: "Team",
  status: "trial",
  states: ["TX", "OK", "KS", "MO"],
  termStartedDaysAgo: 45,
  targetUsed: 40,
  adminName: "Tom Lindgren",
  seed: 4142,
  recent: [2, 40],
  entities: [
    { key: "tulsa", name: "Prairie Infusion Partners", state: "OK", address: "8800 E 61st St, Tulsa, OK 74133", primary: true },
    { key: "dallas", name: "Prairie Infusion Partners – Dallas", state: "TX", address: "3400 Oak Lawn Ave, Dallas, TX 75219" },
  ],
  people: [
    { key: "tom", first: "Tom", last: "Lindgren", role: "pharmacist", loc: "tulsa", dob: "1975-06-30", hired: 3000, npi: true },
    { key: "asha", first: "Asha", last: "Venkataraman", role: "pharmacist", loc: "tulsa", dob: "1987-12-12", hired: 700, npi: true },
    { key: "cole", first: "Cole", last: "Abernathy", role: "pharmacist", loc: "dallas", dob: "1983-09-05", hired: 1100, npi: true },
    { key: "lena", first: "Lena", last: "Petrov", role: "technician", loc: "tulsa", dob: "1996-02-18", hired: 800 },
    { key: "jamal", first: "Jamal", last: "Whitaker", role: "technician", loc: "tulsa", dob: "1994-08-08", hired: 1500 },
    { key: "sun", first: "Sun", last: "Park", role: "technician", loc: "dallas", dob: "1999-03-23", hired: 200 },
    { key: "rosa", first: "Rosa", last: "Delacruz", role: "technician", loc: "dallas", dob: "1991-11-01", hired: 1900 },
    { key: "nate", first: "Nate", last: "Olsen", role: "staff", loc: "tulsa", dob: "1982-04-04", hired: 2200 },
    { key: "harper", first: "Lydia", last: "Harper", role: "prescriber", loc: null, dob: "1969-10-10", hired: 400, npi: true, taxonomy: "rheumatology", credential: "MD" },
    { key: "nwosu", first: "Emeka", last: "Nwosu", role: "prescriber", loc: null, dob: "1976-01-15", hired: 300, npi: true, taxonomy: "oncology", credential: "MD" },
  ],
  async build(b) {
    const V = b.V.bind(b);
    const tulsa = b.E("tulsa");
    const dallas = b.E("dallas");
    await b.cred({ subject: { entity: "tulsa" }, type: "Pharmacy Permit", state: "OK", number: b.lic("OK", "pharmacy"), verifications: b.recent() });
    await b.cred({ subject: { entity: "tulsa" }, type: "Nonresident Pharmacy Permit", state: "KS", number: b.lic("KS", "pharmacy") });
    await b.cred({ subject: { entity: "tulsa" }, type: "Nonresident Pharmacy Permit", state: "MO", number: b.lic("MO", "pharmacy") });
    await b.cred({ subject: { entity: "tulsa" }, type: "DEA Registration", number: tulsa.deaNumber, verifications: b.recent() });
    await b.cred({ subject: { entity: "tulsa" }, type: "NPI", number: tulsa.npi, expiresIn: null, verifications: [V(b.between(2, 40), { method: "auto_api" })] });
    await b.cred({ subject: { entity: "tulsa" }, type: "Professional Liability Insurance", number: "DMI-PL-7710442", expiresIn: 310, issuedDaysAgo: 55 });
    await b.cred({ subject: { entity: "dallas" }, type: "Pharmacy Permit", state: "TX", number: b.lic("TX", "pharmacy"), verifications: b.recent() });
    await b.cred({ subject: { entity: "dallas" }, type: "DEA Registration", number: dallas.deaNumber });
    await b.cred({ subject: { entity: "dallas" }, type: "NPI", number: dallas.npi, expiresIn: null, verifications: [V(b.between(2, 40), { method: "auto_api" })] });
    await b.cred({ subject: { person: "tom" }, type: "Pharmacist License", state: "OK", number: b.lic("OK", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "tom" }, type: "Pharmacist License", state: "KS", number: b.lic("KS", "pharmacist") });
    await b.cred({ subject: { person: "asha" }, type: "Pharmacist License", state: "OK", number: b.lic("OK", "pharmacist"), verifications: b.recent() });
    await b.cred({ subject: { person: "asha" }, type: "Pharmacist License", state: "MO", number: b.lic("MO", "pharmacist") });
    await b.cred({ subject: { person: "cole" }, type: "Pharmacist License", state: "TX", number: b.lic("TX", "pharmacist"), verifications: b.recent() });
    for (const k of ["tom", "asha", "cole"]) await b.cred({ subject: { person: k }, type: "NPI", number: b.P(k).npi, expiresIn: null, verifications: [V(b.between(2, 40), { method: "auto_api" })] });
    await b.cred({ subject: { person: "lena" }, type: "Pharmacy Technician License", state: "OK", number: b.lic("OK", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "jamal" }, type: "Pharmacy Technician License", state: "OK", number: b.lic("OK", "technician") });
    await b.cred({ subject: { person: "sun" }, type: "Pharmacy Technician License", state: "TX", number: b.lic("TX", "technician"), expiresIn: 25, issuedDaysAgo: 705 });
    await b.cred({ subject: { person: "rosa" }, type: "Pharmacy Technician License", state: "TX", number: b.lic("TX", "technician"), verifications: b.recent() });
    await b.cred({ subject: { person: "harper" }, type: "Prescriber State License", state: "OK", number: b.lic("OK", "medical") });
    await b.cred({ subject: { person: "harper" }, type: "DEA Registration", number: fakeDea(b.rand, "Harper", "B") });
    await b.cred({ subject: { person: "harper" }, type: "NPI", number: b.P("harper").npi, expiresIn: null, verifications: [V(b.between(2, 40), { method: "auto_api" })] });
    await b.cred({ subject: { person: "nwosu" }, type: "Prescriber State License", state: "TX", number: b.lic("TX", "medical") });
    await b.cred({ subject: { person: "nwosu" }, type: "DEA Registration", number: fakeDea(b.rand, "Nwosu", "B") });
    await b.cred({ subject: { person: "nwosu" }, type: "NPI", number: b.P("nwosu").npi, expiresIn: null, verifications: [V(b.between(2, 40), { method: "auto_api" })] });
    await b.training(PRAIRIE.people.filter((p) => p.role !== "prescriber").map((p) => p.key), "HIPAA Training", "HIPAA");
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function seedOrg(spec: OrgSpec) {
  const plan = await db.plan.findUniqueOrThrow({ where: { name: spec.planName } });
  const org = await asSystem(() =>
    db.org.create({ data: { name: spec.name, slug: spec.slug, planId: plan.id, status: spec.status, subscribedStates: spec.states, termStartsOn: D(-spec.termStartedDaysAgo), isDemo: true } })
  );
  return asOrg(org.id, async () => {
    const b = new OrgBuilder(spec);
    b.orgId = org.id;
    b.types = new Map((await db.credentialType.findMany()).map((t) => [t.name, t]));
    b.lookups = await db.boardLookup.findMany();

    const admin = await db.user.create({ data: { orgId: org.id, email: `admin@${spec.slug}.example.com`, name: spec.adminName, role: "org_admin", passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) } });
    b.verifierIds = [admin.id];
    for (const u of spec.extraUsers ?? []) {
      const row = await db.user.create({ data: { orgId: org.id, email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) } });
      b.verifierIds.push(row.id, row.id);
    }

    for (const e of spec.entities) {
      b.entities.set(e.key, await db.entity.create({ data: { orgId: org.id, name: e.name, npi: fakeNpi(b.rand), deaNumber: fakeDea(b.rand, e.name, "B"), state: e.state, address: e.address, isPrimary: !!e.primary, isDemo: true } }));
    }
    for (const p of spec.people) {
      b.people.set(
        p.key,
        await db.person.create({
          data: { orgId: org.id, entityId: p.loc ? b.E(p.loc).id : null, firstName: p.first, lastName: p.last, email: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@${spec.slug}.example.com`, role: p.role, dob: new Date(p.dob + "T00:00:00Z"), npi: p.npi ? fakeNpi(b.rand) : null, hireDate: D(-p.hired), active: p.active ?? true, isDemo: true },
        })
      );
    }
    await spec.build(b);
    await b.densify(spec.targetUsed);
    const balance = await b.writeLedger(plan.creditsPerYear, plan.name);
    const screening = await b.screening();

    const all = await db.credential.findMany({ include: { credentialType: true, _count: { select: { verifications: true } } } });
    const left = (d: Date | null) => (d ? Math.round((d.getTime() - today.getTime()) / 86_400_000) : null);
    return {
      org: spec.slug,
      plan: plan.name,
      people: [...b.people.values()].filter((p) => p.active).length,
      credentials: b.counts.credentials,
      verifications: b.counts.verifications,
      creditsLeft: balance,
      alerts: b.counts.alerts,
      files: b.counts.files,
      exp30: all.filter((c) => left(c.expiresOn) !== null && left(c.expiresOn)! >= 0 && left(c.expiresOn)! <= 30).length,
      exp31to90: all.filter((c) => left(c.expiresOn) !== null && left(c.expiresOn)! > 30 && left(c.expiresOn)! <= 90).length,
      overdue: all.filter((c) => left(c.expiresOn) !== null && left(c.expiresOn)! < 0).length,
      neverVerified: all.filter((c) => c.credentialType.psvRequired && c._count.verifications === 0 && !(c.expiresOn && c.expiresOn < today)).length,
      samMatches: screening.sam,
      leieMatches: screening.leie,
    };
  });
}

async function main() {
  if (await dbRaw.org.count({ where: { isDemo: true } })) throw new Error("Demo organizations already exist. Run `make demo-reset` to wipe and reload.");
  if (!(await dbRaw.user.findFirst({ where: { role: "operator" } }))) console.warn("No operator user yet: set SEED_OPERATOR_EMAIL/PASSWORD and run make seed to get the /ops console.");
  const results = [];
  for (const spec of [SIERRA, HARBOR, PRAIRIE]) results.push(await seedOrg(spec));
  console.table(results);
  console.log(`Org admins: admin@sierra.example.com, admin@harbor.example.com, admin@prairie.example.com (password: ${ADMIN_PASSWORD}); verifier@sierra-rx.example.com / verifier1234`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => dbRaw.$disconnect());
