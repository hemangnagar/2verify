/**
 * Demo seed: "Sierra Specialty Pharmacy", a fictional two-location specialty pharmacy group.
 *
 * Everything is synthetic: names, addresses, NPIs (random digits with a valid check digit),
 * DEA numbers (same), license numbers, evidence screenshots, certificates, and screening extracts.
 * Dates are relative to the day the seed runs, so the dashboard story is the same whenever it is shown.
 *
 * Requires the catalog seed (make seed). Refuses to run if demo rows already exist (use make demo-reset).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { AlertKind, PersonRole, VerificationMethod, VerificationResult } from "@prisma/client";
import { db } from "../src/lib/db";
import { fileKey, storage } from "../src/lib/storage";
import { fakeDea, fakeLicenseNumber, fakeNpi, mulberry32 } from "../src/lib/ids";
import { addDays, dateOnly, firstOfMonth, isoDate } from "../src/lib/dates";
import { computeNextVerifyDue, computeStatus, expiryAlertsDueBy } from "../src/lib/status";
import { leieRowToRecord, matchRoster, parseCsv, type ExclusionRecord } from "../src/lib/matching";
import { placeholderBoardScreenshot, placeholderCertificatePdf, screeningReportPdf } from "../src/lib/evidence";
import { fakeNppesResponse, TAXONOMY } from "../src/lib/nppes-fixture";
import { fillTemplate } from "../src/lib/board";

const rand = mulberry32(20261020);
const today = dateOnly(new Date());
const D = (days: number) => dateOnly(addDays(today, days));
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const ALERT_CC = (process.env.ALERT_CC ?? "compliance@sierra-rx.example.com").split(",").map((s) => s.trim()).filter(Boolean);
const NPPES_URL = "https://npiregistry.cms.hhs.gov/api/?version=2.1&number=";
const DEA_URL = "https://apps.deadiversion.usdoj.gov/webforms2/spring/validationLogin";
const URAC_URL = "https://accreditnet.urac.org/directory";

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

interface PersonSpec {
  key: string;
  first: string;
  last: string;
  role: PersonRole;
  loc: "reno" | "sac" | null;
  dob: string;
  hired: number; // days ago
  npi?: boolean;
  title?: string;
  active?: boolean;
  taxonomy?: keyof typeof TAXONOMY;
  credential?: string;
}

const PEOPLE: PersonSpec[] = [
  // Reno
  { key: "priya", first: "Priya", last: "Ramaswamy", role: "pharmacist", loc: "reno", dob: "1981-04-12", hired: 2100, npi: true, title: "Pharmacist in Charge" },
  { key: "daniel", first: "Daniel", last: "Okonkwo", role: "pharmacist", loc: "reno", dob: "1986-09-30", hired: 1500, npi: true },
  { key: "hannah", first: "Hannah", last: "Lindqvist", role: "pharmacist", loc: "reno", dob: "1990-01-22", hired: 800, npi: true },
  { key: "marcus", first: "Marcus", last: "Delgado", role: "technician", loc: "reno", dob: "1994-07-08", hired: 1200 },
  { key: "aisha", first: "Aisha", last: "Rahman", role: "technician", loc: "reno", dob: "1997-11-03", hired: 600 },
  { key: "tyler", first: "Tyler", last: "Brennan", role: "technician", loc: "reno", dob: "1992-03-15", hired: 1900 },
  { key: "sofia", first: "Sofia", last: "Castellanos", role: "technician", loc: "reno", dob: "1999-05-27", hired: 300 },
  { key: "jordan", first: "Jordan", last: "Pham", role: "intern", loc: "reno", dob: "2001-08-19", hired: 150 },
  { key: "megan", first: "Megan", last: "Whitfield", role: "staff", loc: "reno", dob: "1979-12-02", hired: 2300, title: "Compliance Lead" },
  { key: "luis", first: "Luis", last: "Ortega", role: "staff", loc: "reno", dob: "1988-06-14", hired: 900, title: "Billing Coordinator" },
  // Sacramento
  { key: "elena", first: "Elena", last: "Vasquez", role: "pharmacist", loc: "sac", dob: "1984-02-09", hired: 75, npi: true },
  { key: "kevin", first: "Kevin", last: "Nakamura", role: "pharmacist", loc: "sac", dob: "1977-10-25", hired: 1700, npi: true, title: "Pharmacist in Charge" },
  { key: "brianna", first: "Brianna", last: "Holt", role: "technician", loc: "sac", dob: "1996-04-01", hired: 1000 },
  { key: "omar", first: "Omar", last: "Siddiqui", role: "technician", loc: "sac", dob: "1993-09-17", hired: 450 },
  // Former staff: inactive, not screened, no live credentials
  { key: "rachel", first: "Rachel", last: "Kim", role: "technician", loc: "reno", dob: "1995-01-30", hired: 1600, active: false },
  // Prescribers
  { key: "okafor", first: "Robert", last: "Okafor", role: "prescriber", loc: null, dob: "1972-05-05", hired: 1400, npi: true, taxonomy: "oncology", credential: "MD" },
  { key: "moreau", first: "Catherine", last: "Moreau", role: "prescriber", loc: null, dob: "1980-08-23", hired: 900, npi: true, taxonomy: "rheumatology", credential: "MD" },
  { key: "adeyemi", first: "Samuel", last: "Adeyemi", role: "prescriber", loc: null, dob: "1968-11-11", hired: 2000, npi: true, taxonomy: "internalMedicine", credential: "MD" },
];

// ---------------------------------------------------------------------------

async function main() {
  if (await db.entity.count({ where: { isDemo: true } })) {
    throw new Error("Demo data already loaded. Run `make demo-reset` to wipe and reload.");
  }
  const types = new Map((await db.credentialType.findMany()).map((t) => [t.name, t]));
  const T = (name: string) => {
    const t = types.get(name);
    if (!t) throw new Error(`credential type missing: ${name} (run make seed first)`);
    return t;
  };
  const lookups = await db.boardLookup.findMany();
  const lookupFor = (state: string | null, typeId: string) => lookups.find((l) => l.state === state && l.credentialTypeId === typeId) ?? null;

  const admin = await db.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No admin user. Set SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD and run make seed.");
  const verifier = await db.user.upsert({
    where: { email: "verifier@sierra-rx.example.com" },
    create: { email: "verifier@sierra-rx.example.com", name: "Megan Whitfield", role: "verifier", passwordHash: await bcrypt.hash("verifier1234", 10) },
    update: {},
  });
  const verifiers = [verifier, verifier, admin]; // most manual checks done by the compliance lead

  const store = storage();
  const counts = { credentials: 0, verifications: 0, alerts: 0, files: 0 };

  // ---- Entities -----------------------------------------------------------
  const reno = await db.entity.create({
    data: {
      name: "Sierra Specialty Pharmacy",
      npi: fakeNpi(rand),
      deaNumber: fakeDea(rand, "Sierra", "B"),
      state: "NV",
      address: "1200 Sierra Vista Way, Suite 140, Reno, NV 89502",
      isPrimary: true,
      isDemo: true,
    },
  });
  const sac = await db.entity.create({
    data: {
      name: "Sierra Specialty Pharmacy – Sacramento",
      npi: fakeNpi(rand),
      deaNumber: fakeDea(rand, "Sierra", "B"),
      state: "CA",
      address: "455 Capitol Mall Dr, Suite 210, Sacramento, CA 95814",
      isPrimary: false,
      isDemo: true,
    },
  });
  const entityOf = { reno, sac };

  // ---- People -------------------------------------------------------------
  const people = new Map<string, Awaited<ReturnType<typeof db.person.create>>>();
  for (const p of PEOPLE) {
    const row = await db.person.create({
      data: {
        entityId: p.loc ? entityOf[p.loc].id : null,
        firstName: p.first,
        lastName: p.last,
        email: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.com`,
        role: p.role,
        dob: new Date(p.dob + "T00:00:00Z"),
        npi: p.npi ? fakeNpi(rand) : null,
        hireDate: D(-p.hired),
        active: p.active ?? true,
        isDemo: true,
      },
    });
    people.set(p.key, row);
  }
  const P = (key: string) => people.get(key)!;
  const spec = (key: string) => PEOPLE.find((p) => p.key === key)!;

  // ---- Credential helper --------------------------------------------------
  interface VerifySpec {
    daysAgo: number;
    result?: VerificationResult;
    method?: VerificationMethod;
    expirationSeen?: Date | null;
    note?: string;
    statusBefore?: Date; // expires_before snapshot when the verification found a different expiry
  }
  interface CredSpec {
    subject: { person?: string; entity?: "reno" | "sac" };
    type: string;
    state?: string | null;
    number?: string | null;
    issuedDaysAgo?: number;
    expiresIn?: number | null; // days from today; null = never expires
    verifications?: VerifySpec[]; // oldest first
    neverVerifiedSince?: Date; // when verification became due (never-verified story)
    document?: boolean;
    notes?: string;
  }

  async function cred(c: CredSpec) {
    const type = T(c.type);
    const person = c.subject.person ? P(c.subject.person) : null;
    const entity = c.subject.entity ? entityOf[c.subject.entity] : person?.entityId ? (person.entityId === reno.id ? reno : sac) : reno;
    const holderName = person ? `${person.firstName} ${person.lastName}` : entity.name;
    const ownerEntityId = person ? (person.entityId ?? reno.id) : entity.id;
    const expiresOn = c.expiresIn === null || c.expiresIn === undefined ? (c.expiresIn === null ? null : D(between(100, 700))) : D(c.expiresIn);
    const issuedOn = D(-(c.issuedDaysAgo ?? between(400, 2500)));
    const id = randomUUID();

    // Document (certificate / permit PDF) for anything that would have one.
    let documentFileKey: string | null = null;
    if (c.document ?? ["license", "permit", "registration", "insurance", "accreditation"].includes(type.category)) {
      if (type.name !== "NPI") {
        const pdf = await placeholderCertificatePdf({
          title: type.name,
          holder: holderName,
          number: c.number ?? "—",
          issued: isoDate(issuedOn),
          expires: expiresOn ? isoDate(expiresOn) : "n/a",
          issuer: lookupFor(c.state ?? null, type.id)?.boardName ?? (type.name === "DEA Registration" ? "Drug Enforcement Administration" : type.name.includes("Insurance") ? "Demo Mutual Insurance Co." : type.name.includes("URAC") ? "URAC" : "Issuing Authority"),
        });
        documentFileKey = fileKey(ownerEntityId, "credential", id, `${type.name.replace(/\W+/g, "-").toLowerCase()}.pdf`, issuedOn);
        await store.put(documentFileKey, pdf, { contentType: "application/pdf", metadata: { source: "demo-seed", holder: holderName } });
        counts.files++;
      }
    }

    const vlist = c.verifications ?? [];
    const latest = vlist[vlist.length - 1];
    const latestAt = latest ? D(-latest.daysAgo) : null;
    const status = computeStatus({ expiresOn, renewalLeadDays: type.defaultLeadDays, latestResult: latest?.result ?? (latest ? "active" : null) }, today);
    const nextVerifyDue = type.psvRequired
      ? computeNextVerifyDue(latestAt, type.defaultReverifyDays, c.neverVerifiedSince ?? person?.hireDate ?? issuedOn)
      : null;

    const row = await db.credential.create({
      data: {
        id,
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
    counts.credentials++;

    // Verifications with evidence files.
    for (const v of vlist) {
      const at = new Date(D(-v.daysAgo).getTime() + between(9, 17) * 3600_000);
      const method: VerificationMethod = v.method ?? (type.name === "NPI" ? "auto_api" : "manual_board");
      const result = v.result ?? "active";
      const vid = randomUUID();
      const lookup = lookupFor(c.state ?? null, type.id);
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
      const seen = v.expirationSeen === undefined ? expiresOn : v.expirationSeen;
      let evidenceFileKey: string;
      if (method === "auto_api") {
        const s = spec(c.subject.person ?? "");
        const json = fakeNppesResponse(
          person
            ? { npi: person.npi!, kind: "individual", firstName: person.firstName, lastName: person.lastName, credential: s.credential ?? "PHARMD", taxonomyCode: TAXONOMY[s.taxonomy ?? "pharmacist"].code, taxonomyDesc: TAXONOMY[s.taxonomy ?? "pharmacist"].desc, state: entity.state, city: entity.state === "NV" ? "Reno" : "Sacramento", address: entity.address.split(",")[0], enumerationDate: isoDate(D(-between(2000, 6000))) }
            : { npi: entity.npi!, kind: "organization", orgName: entity.name, taxonomyCode: TAXONOMY.specialtyPharmacy.code, taxonomyDesc: TAXONOMY.specialtyPharmacy.desc, state: entity.state, city: entity.state === "NV" ? "Reno" : "Sacramento", address: entity.address.split(",")[0], enumerationDate: isoDate(D(-between(2000, 6000))) },
          at
        );
        evidenceFileKey = fileKey(ownerEntityId, "verification", vid, "nppes-response.json", at);
        await store.put(evidenceFileKey, JSON.stringify(json, null, 2), { contentType: "application/json", metadata: { verifier: "system", verified_at: at.toISOString(), source_url: sourceUrl } });
      } else {
        const who = pick(verifiers);
        const png = placeholderBoardScreenshot({
          boardName: lookup?.boardName ?? (type.name === "DEA Registration" ? "DEA Registration Validation" : type.name),
          licenseNumber: c.number ?? "",
          holderName,
          status: result.toUpperCase(),
          expires: seen ? isoDate(seen) : "N/A",
          capturedAt: isoDate(at),
        });
        evidenceFileKey = fileKey(ownerEntityId, "verification", vid, "board-screenshot.png", at);
        await store.put(evidenceFileKey, png, { contentType: "image/png", metadata: { verifier: who.email, verified_at: at.toISOString(), source_url: sourceUrl } });
      }
      counts.files++;
      await db.verification.create({
        data: {
          id: vid,
          credentialId: id,
          verifiedById: method === "auto_api" ? null : pick(verifiers).id,
          verifiedAt: at,
          method,
          sourceUrl,
          result,
          expirationSeen: seen,
          disciplineFlag: false,
          note: v.note ?? (method === "auto_api" ? "NPPES record matched name and taxonomy." : "Board record matches. No disciplinary actions listed."),
          evidenceFileKey,
          statusBefore: v.statusBefore ? "active" : null,
          expiresBefore: v.statusBefore ?? null,
        },
      });
      counts.verifications++;
      if (v.statusBefore) {
        await alert(id, person?.email ?? null, "status_change", at, `[Compliance] ${type.name} for ${holderName}: expiration updated from ${isoDate(v.statusBefore)} to ${seen ? isoDate(seen) : "n/a"} after board verification`);
      }
    }

    // Back-dated expiry alerts, exactly what the nightly job would have sent by today.
    if (expiresOn) {
      for (const a of expiryAlertsDueBy(expiresOn, today)) {
        const subject =
          a.kind === "overdue"
            ? `[Compliance] OVERDUE: ${c.state ?? ""} ${type.name} for ${holderName} expired ${isoDate(expiresOn)}`
            : `[Compliance] ${c.state ?? ""} ${type.name} for ${holderName} expires in ${a.kind.replace("lead_", "")} days (${isoDate(expiresOn)})`;
        await alert(id, person?.email ?? null, a.kind, new Date(a.on.getTime() + 2 * 3600_000), subject.replace(/\s+/g, " "));
      }
    }
    return row;
  }

  async function alert(credentialId: string, holderEmail: string | null, kind: AlertKind, at: Date, subject: string) {
    const recipients = [...new Set([...(holderEmail ? [holderEmail] : []), ...ALERT_CC])];
    for (const to of recipients) {
      await db.alert.create({ data: { credentialId, sentTo: to, sentAt: at, kind, subject, isDemo: true } });
      counts.alerts++;
    }
  }

  const V = (daysAgo: number, extra: Partial<VerifySpec> = {}): VerifySpec => ({ daysAgo, ...extra });
  const recent = () => [V(between(30, 330))];
  const lic = (state: string, kind: Parameters<typeof fakeLicenseNumber>[2]) => fakeLicenseNumber(rand, state, kind);

  // ---- Entity credentials (13) -------------------------------------------
  await cred({ subject: { entity: "reno" }, type: "Pharmacy Permit", state: "NV", number: lic("NV", "pharmacy"), verifications: recent() });
  await cred({ subject: { entity: "reno" }, type: "Nonresident Pharmacy Permit", state: "AZ", number: lic("AZ", "pharmacy"), verifications: recent() });
  await cred({ subject: { entity: "reno" }, type: "Nonresident Pharmacy Permit", state: "CA", number: lic("CA", "pharmacy"), verifications: recent() });
  await cred({ subject: { entity: "reno" }, type: "DEA Registration", number: reno.deaNumber, verifications: recent() });
  await cred({ subject: { entity: "reno" }, type: "NPI", number: reno.npi, expiresIn: null, verifications: [V(between(20, 200), { method: "auto_api" })] });
  await cred({ subject: { entity: "reno" }, type: "State Controlled Substance Registration", state: "NV", number: `CS${lic("NV", "pharmacy").slice(2)}`, verifications: recent() });
  // STORY: expiring in 27 days
  await cred({ subject: { entity: "reno" }, type: "Professional Liability Insurance", number: "DMI-PL-4471920", expiresIn: 27, issuedDaysAgo: 338, notes: "Demo Mutual Insurance Co. Renewal quote requested." });
  await cred({ subject: { entity: "reno" }, type: "URAC Specialty Pharmacy Accreditation", number: "URAC-SP-DEMO-2024", expiresIn: 400, issuedDaysAgo: 695, verifications: [V(200)] });

  // STORY: Sacramento CA pharmacy permit expiring in 62 days
  await cred({ subject: { entity: "sac" }, type: "Pharmacy Permit", state: "CA", number: lic("CA", "pharmacy"), expiresIn: 62, issuedDaysAgo: 303, verifications: [V(250)] });
  await cred({ subject: { entity: "sac" }, type: "Nonresident Pharmacy Permit", state: "AZ", number: lic("AZ", "pharmacy"), verifications: recent() });
  await cred({ subject: { entity: "sac" }, type: "DEA Registration", number: sac.deaNumber, verifications: recent() });
  await cred({ subject: { entity: "sac" }, type: "NPI", number: sac.npi, expiresIn: null, verifications: [V(between(20, 200), { method: "auto_api" })] });
  await cred({ subject: { entity: "sac" }, type: "Professional Liability Insurance", number: "DMI-PL-4471921", expiresIn: 210, issuedDaysAgo: 155 });

  // ---- Pharmacists ---------------------------------------------------------
  // STORY: Priya's NV license expires in 21 days
  await cred({ subject: { person: "priya" }, type: "Pharmacist License", state: "NV", number: lic("NV", "pharmacist"), expiresIn: 21, issuedDaysAgo: 709, verifications: [V(300)] });
  await cred({ subject: { person: "priya" }, type: "Pharmacist License", state: "CA", number: lic("CA", "pharmacist"), verifications: recent() });
  await cred({ subject: { person: "priya" }, type: "Pharmacist License", state: "AZ", number: lic("AZ", "pharmacist"), verifications: recent() });
  // STORY: Daniel's NV license was renewed; the second verification caught the new expiry (status_change alert)
  {
    const newExp = D(410);
    await cred({
      subject: { person: "daniel" }, type: "Pharmacist License", state: "NV", number: lic("NV", "pharmacist"), expiresIn: 410, issuedDaysAgo: 1460,
      verifications: [V(310, { expirationSeen: D(45) }), V(120, { expirationSeen: newExp, statusBefore: D(45), note: "Board shows renewal processed; expiration moved out one cycle." })],
    });
  }
  await cred({ subject: { person: "daniel" }, type: "Pharmacist License", state: "CA", number: lic("CA", "pharmacist"), verifications: recent() });
  await cred({ subject: { person: "hannah" }, type: "Pharmacist License", state: "NV", number: lic("NV", "pharmacist"), verifications: recent() });
  await cred({ subject: { person: "hannah" }, type: "Pharmacist License", state: "AZ", number: lic("AZ", "pharmacist"), verifications: recent() });
  // STORY: Elena, hired 75 days ago, never verified
  await cred({ subject: { person: "elena" }, type: "Pharmacist License", state: "CA", number: lic("CA", "pharmacist"), expiresIn: 300, issuedDaysAgo: 430, neverVerifiedSince: D(-75), notes: "New hire. Onboarding PSV not yet completed." });
  await cred({ subject: { person: "elena" }, type: "Pharmacist License", state: "NV", number: lic("NV", "pharmacist"), verifications: recent() });
  await cred({ subject: { person: "kevin" }, type: "Pharmacist License", state: "CA", number: lic("CA", "pharmacist"), verifications: recent() });
  await cred({ subject: { person: "kevin" }, type: "Pharmacist License", state: "NV", number: lic("NV", "pharmacist"), verifications: recent() });
  for (const k of ["priya", "daniel", "hannah", "elena", "kevin"]) {
    await cred({ subject: { person: k }, type: "NPI", number: P(k).npi, expiresIn: null, verifications: [V(between(20, 300), { method: "auto_api" })] });
  }

  // ---- Technicians ---------------------------------------------------------
  // STORY: Marcus's NV technician license expired 12 days ago, never verified in this system
  await cred({ subject: { person: "marcus" }, type: "Pharmacy Technician License", state: "NV", number: lic("NV", "technician"), expiresIn: -12, issuedDaysAgo: 742, neverVerifiedSince: D(-12), notes: "Renewal application submitted to the board per Marcus; awaiting confirmation." });
  await cred({ subject: { person: "aisha" }, type: "Pharmacy Technician License", state: "NV", number: lic("NV", "technician"), verifications: recent() });
  await cred({ subject: { person: "tyler" }, type: "Pharmacy Technician License", state: "NV", number: lic("NV", "technician"), verifications: recent() });
  await cred({ subject: { person: "tyler" }, type: "Pharmacy Technician License", state: "CA", number: lic("CA", "technician"), verifications: recent() });
  await cred({ subject: { person: "sofia" }, type: "Pharmacy Technician License", state: "NV", number: lic("NV", "technician"), verifications: recent() });
  // STORY: Brianna's CA license expires in 45 days
  await cred({ subject: { person: "brianna" }, type: "Pharmacy Technician License", state: "CA", number: lic("CA", "technician"), expiresIn: 45, issuedDaysAgo: 685, verifications: [V(280)] });
  await cred({ subject: { person: "omar" }, type: "Pharmacy Technician License", state: "CA", number: lic("CA", "technician"), verifications: recent() });
  await cred({ subject: { person: "omar" }, type: "Pharmacy Technician License", state: "NV", number: lic("NV", "technician"), verifications: recent() });
  await cred({ subject: { person: "jordan" }, type: "Pharmacy Intern License", state: "NV", number: lic("NV", "intern"), verifications: recent() });

  // ---- Prescribers ---------------------------------------------------------
  // STORY: Dr. Okafor's DEA expires in 80 days
  await cred({ subject: { person: "okafor" }, type: "Prescriber State License", state: "NV", number: lic("NV", "medical"), verifications: recent() });
  await cred({ subject: { person: "okafor" }, type: "DEA Registration", number: fakeDea(rand, "Okafor", "B"), expiresIn: 80, issuedDaysAgo: 1015, verifications: [V(200)] });
  await cred({ subject: { person: "okafor" }, type: "NPI", number: P("okafor").npi, expiresIn: null, verifications: [V(between(20, 300), { method: "auto_api" })] });
  await cred({ subject: { person: "moreau" }, type: "Prescriber State License", state: "CA", number: lic("CA", "medical"), verifications: recent() });
  await cred({ subject: { person: "moreau" }, type: "DEA Registration", number: fakeDea(rand, "Moreau", "B"), verifications: recent() });
  await cred({ subject: { person: "moreau" }, type: "NPI", number: P("moreau").npi, expiresIn: null, verifications: [V(between(20, 300), { method: "auto_api" })] });
  await cred({ subject: { person: "adeyemi" }, type: "Prescriber State License", state: "NV", number: lic("NV", "medical"), verifications: recent() });
  await cred({ subject: { person: "adeyemi" }, type: "DEA Registration", number: fakeDea(rand, "Adeyemi", "B"), verifications: recent() });
  await cred({ subject: { person: "adeyemi" }, type: "NPI", number: P("adeyemi").npi, expiresIn: null, verifications: [V(between(20, 300), { method: "auto_api" })] });

  // ---- Training (HIPAA for all 14 staff, FWA for Reno pharmacists + technicians only) ----
  const staff = PEOPLE.filter((p) => p.role !== "prescriber" && p.active !== false);
  for (const p of staff) {
    const done = between(30, 240);
    await cred({ subject: { person: p.key }, type: "HIPAA Training", number: `HIPAA-${today.getUTCFullYear()}-${p.key.toUpperCase()}`, issuedDaysAgo: done, expiresIn: 365 - done, document: true });
  }
  for (const p of staff.filter((s) => s.loc === "reno" && (s.role === "pharmacist" || s.role === "technician"))) {
    const done = between(30, 240);
    await cred({ subject: { person: p.key }, type: "Fraud, Waste & Abuse Training", number: `FWA-${today.getUTCFullYear()}-${p.key.toUpperCase()}`, issuedDaysAgo: done, expiresIn: 365 - done, document: true });
  }

  // ---- Screening: last month's OIG LEIE and SAM runs --------------------------------
  const roster = [...people.values()].filter((p) => p.active);
  const rosterJson = roster.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, role: p.role, npi: p.npi }));
  const runAt = new Date(firstOfMonth(today, -1).getTime() + 3 * 3600_000);
  const fixtures = path.join(__dirname, "fixtures");

  const leieRecords = parseCsv(readFileSync(path.join(fixtures, "leie-sample.csv"), "utf8")).map(leieRowToRecord);
  const leieMatches = matchRoster(roster, leieRecords);
  if (leieMatches.length !== 0) throw new Error(`seed expectation failed: LEIE should produce 0 matches, got ${leieMatches.length}`);

  const samDoc = JSON.parse(readFileSync(path.join(fixtures, "sam-sample.json"), "utf8")) as { excludedEntity: Array<Record<string, unknown>> };
  const samRecords: ExclusionRecord[] = samDoc.excludedEntity.map((e) => {
    const ind = (e.exclusionIndividual ?? null) as null | { firstName: string; lastName: string; middleName?: string; npi?: string | null; dob?: string | null };
    const addr = e.exclusionPrimaryAddress as { stateOrProvinceCode?: string };
    return { lastName: ind?.lastName ?? "", firstName: ind?.firstName ?? (e.exclusionEntityName as string) ?? "", middleName: ind?.middleName, npi: ind?.npi ?? null, dob: ind?.dob ?? null, state: addr?.stateOrProvinceCode ?? null, source: "sam", classification: e.classification, samNumber: (e.exclusionIdentification as { samNumber: string })?.samNumber, excludingAgency: e.excludingAgencyName, exclusionType: e.exclusionType, activationDate: (e.exclusionDetails as { activationDate: string })?.activationDate, address: addr };
  });
  const samMatches = matchRoster(roster, samRecords);
  if (samMatches.length !== 1 || samMatches[0].personId !== P("okafor").id) {
    throw new Error(`seed expectation failed: SAM should produce exactly one match on Okafor, got ${JSON.stringify(samMatches.map((m) => [m.personId, m.score]))}`);
  }

  for (const [source, matches, version] of [
    ["oig_leie", leieMatches, `LEIE updated ${isoDate(addDays(runAt, -6))} (demo fixture)`],
    ["sam", samMatches, `SAM Exclusions API extract ${isoDate(runAt)} (demo fixture)`],
  ] as const) {
    const runId = randomUUID();
    const pdf = await screeningReportPdf({
      source,
      sourceVersion: version,
      runAt,
      entityName: "Sierra Specialty Pharmacy (all locations)",
      roster: rosterJson,
      matches: matches.map((m) => ({ name: rosterJson.find((r) => r.id === m.personId)!.name, score: m.score, matchedOn: m.matchedOn, sourceSummary: `${m.record.lastName}, ${m.record.firstName} ${m.record.middleName ?? ""} — ${m.record.state ?? "?"} — ${String(m.record.exclusionType ?? m.record.exclType ?? "")}`.replace(/\s+/g, " "), disposition: "pending" })),
    });
    const reportFileKey = fileKey(reno.id, "screening_run", runId, `${source}-report.pdf`, runAt);
    await store.put(reportFileKey, pdf, { contentType: "application/pdf", metadata: { source, run_at: runAt.toISOString() } });
    counts.files++;
    await db.screeningRun.create({
      data: { id: runId, runAt, source, sourceVersion: version, personsScreened: roster.length, matchesFound: matches.length, reportFileKey, roster: rosterJson, isDemo: true },
    });
    for (const m of matches) {
      await db.screeningMatch.create({ data: { runId, personId: m.personId, sourceRecord: m.record as object, score: m.score, matchedOn: m.matchedOn, disposition: "pending" } });
    }
  }

  // ---- Summary ------------------------------------------------------------
  const all = await db.credential.findMany({ where: { isDemo: true }, include: { credentialType: true, _count: { select: { verifications: true } } } });
  const left = (d: Date | null) => (d ? Math.round((d.getTime() - today.getTime()) / 86_400_000) : null);
  const summary = {
    entities: 2,
    people: roster.length,
    inactivePeople: PEOPLE.length - roster.length,
    credentials: counts.credentials,
    verifications: counts.verifications,
    alerts: counts.alerts,
    files: counts.files,
    expiring30: all.filter((c) => left(c.expiresOn) !== null && left(c.expiresOn)! >= 0 && left(c.expiresOn)! <= 30).length,
    expiring31to90: all.filter((c) => left(c.expiresOn) !== null && left(c.expiresOn)! > 30 && left(c.expiresOn)! <= 90).length,
    overdue: all.filter((c) => left(c.expiresOn) !== null && left(c.expiresOn)! < 0).length,
    neverVerified: all.filter((c) => c.credentialType.psvRequired && c._count.verifications === 0 && !(c.expiresOn && c.expiresOn < today)).length,
    screeningRuns: 2,
    pendingMatches: 1,
  };
  console.table(summary);
  console.log("Sign in: admin from env, or verifier@sierra-rx.example.com / verifier1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
