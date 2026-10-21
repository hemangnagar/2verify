import { randomUUID } from "node:crypto";
import { db } from "./db";
import { fileKey, storage } from "./storage";
import { recomputeCredential } from "./credentials";
import { fakeNppesResponse, TAXONOMY } from "./nppes-fixture";

const NPPES = "https://npiregistry.cms.hhs.gov/api/?version=2.1&number=";

export type NppesMode = "live" | "fixture" | "off";

/**
 * Verify a person's or entity's NPI against the NPPES registry and record the result as an
 * auto_api verification on their NPI credential (created if missing). Evidence is the raw JSON.
 *
 * Result: active when the registry returns the NPI with a matching name; mismatch when the name
 * differs; not_found when the registry has no record. Network errors are reported, not recorded.
 */
export async function verifyNpi(subject: { personId?: string; entityId?: string }, mode: NppesMode = (process.env.NPPES_MODE as NppesMode) ?? "live") {
  if (mode === "off") return { skipped: true as const, reason: "NPPES_MODE=off" };
  const person = subject.personId ? await db.person.findUniqueOrThrow({ where: { id: subject.personId }, include: { entity: true } }) : null;
  const entity = subject.entityId ? await db.entity.findUniqueOrThrow({ where: { id: subject.entityId } }) : null;
  const npi = person?.npi ?? entity?.npi;
  if (!npi) return { skipped: true as const, reason: "no NPI on record" };

  const type = await db.credentialType.findUniqueOrThrow({ where: { name: "NPI" } });
  let credential = await db.credential.findFirst({ where: { credentialTypeId: type.id, personId: person?.id ?? undefined, entityId: entity?.id ?? undefined } });
  if (!credential) {
    credential = await db.credential.create({
      data: {
        subjectType: person ? "person" : "entity",
        personId: person?.id ?? null,
        entityId: entity?.id ?? null,
        credentialTypeId: type.id,
        number: npi,
        renewalLeadDays: type.defaultLeadDays,
        reverifyDays: type.defaultReverifyDays,
      },
    });
  }

  const at = new Date();
  let json: unknown;
  if (mode === "fixture") {
    const home = person?.entity ?? entity ?? (await db.entity.findFirstOrThrow({ where: { isPrimary: true } }));
    json = fakeNppesResponse(
      person
        ? { npi, kind: "individual", firstName: person.firstName, lastName: person.lastName, credential: person.role === "prescriber" ? "MD" : "PHARMD", taxonomyCode: TAXONOMY.pharmacist.code, taxonomyDesc: TAXONOMY.pharmacist.desc, state: home.state, city: "", address: home.address.split(",")[0], enumerationDate: "2015-01-01" }
        : { npi, kind: "organization", orgName: entity!.name, taxonomyCode: TAXONOMY.specialtyPharmacy.code, taxonomyDesc: TAXONOMY.specialtyPharmacy.desc, state: entity!.state, city: "", address: entity!.address.split(",")[0], enumerationDate: "2015-01-01" },
      at
    );
  } else {
    const res = await fetch(NPPES + encodeURIComponent(npi), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`NPPES returned HTTP ${res.status}`);
    json = await res.json();
  }

  const doc = json as { result_count?: number; results?: Array<{ basic?: Record<string, string>; enumeration_type?: string }> };
  const hit = doc.results?.[0];
  let result: "active" | "not_found" | "mismatch" = "not_found";
  let note = "NPI not found in NPPES.";
  if (hit) {
    const basic = hit.basic ?? {};
    const registryName = (person ? `${basic.first_name ?? ""} ${basic.last_name ?? ""}` : (basic.organization_name ?? "")).trim().toUpperCase();
    const ourName = (person ? `${person.firstName} ${person.lastName}` : entity!.name).trim().toUpperCase();
    const lastMatches = person ? (basic.last_name ?? "").toUpperCase() === person.lastName.toUpperCase() : registryName.startsWith(ourName.split(" ")[0]);
    const status = basic.status ?? "A";
    if (status !== "A") {
      result = "not_found";
      note = `NPPES status ${status} (deactivated).`;
    } else if (lastMatches) {
      result = "active";
      note = `NPPES record matches: ${registryName}.`;
    } else {
      result = "mismatch";
      note = `NPPES name "${registryName}" does not match "${ourName}".`;
    }
  }

  const vid = randomUUID();
  const ownerEntityId = person?.entityId ?? entity?.id ?? (await db.entity.findFirstOrThrow({ where: { isPrimary: true } })).id;
  const evidenceFileKey = fileKey(ownerEntityId, "verification", vid, "nppes-response.json", at);
  await storage().put(evidenceFileKey, JSON.stringify(json, null, 2), { contentType: "application/json", metadata: { verifier: "system", verified_at: at.toISOString(), source_url: NPPES + npi } });
  await db.verification.create({
    data: { id: vid, credentialId: credential.id, verifiedById: null, verifiedAt: at, method: "auto_api", sourceUrl: NPPES + npi, result, expirationSeen: null, disciplineFlag: false, note, evidenceFileKey, statusBefore: credential.status },
  });
  await recomputeCredential(credential.id);
  return { skipped: false as const, result, note, credentialId: credential.id };
}
