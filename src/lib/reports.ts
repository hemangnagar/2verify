import JSZip from "jszip";
import { db } from "./db";
import { storage } from "./storage";
import { pdfBuffer } from "./evidence";
import { formatDate, isoDate } from "./dates";

/** RFC 4180 CSV. */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? isoDate(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

/**
 * Survey pack for one entity: every active credential (entity-level and staff at that location)
 * with last verification date, method, result, and a thumbnail of the evidence.
 */
export async function surveyPackPdf(entityId: string): Promise<{ pdf: Buffer; entityName: string }> {
  const entity = await db.entity.findUniqueOrThrow({ where: { id: entityId } });
  const credentials = await db.credential.findMany({
    where: { status: { not: "expired" }, OR: [{ entityId }, { person: { entityId, active: true } }] },
    include: { credentialType: true, person: true, verifications: { orderBy: { verifiedAt: "desc" }, take: 1, include: { verifiedBy: true } } },
    orderBy: [{ subjectType: "desc" }, { person: { lastName: "asc" } }, { credentialType: { name: "asc" } }],
  });
  const now = new Date();
  const evidenceImages = new Map<string, Buffer>();
  for (const c of credentials) {
    const key = c.verifications[0]?.evidenceFileKey;
    if (key && /\.(png|jpe?g)$/i.test(key)) {
      try {
        evidenceImages.set(key, (await storage().get(key)).body);
      } catch {
        /* missing file: shown as text */
      }
    }
  }

  const pdf = await pdfBuffer((doc) => {
    doc.fontSize(20).text("Credential Verification Survey Pack");
    doc.fontSize(12).fillColor("#444").text(entity.name).text(entity.address);
    doc.fillColor("#111").text(`Generated ${now.toISOString().replace("T", " ").slice(0, 16)} UTC`);
    doc.text(`${credentials.length} active credentials · ${credentials.filter((c) => c.verifications.length).length} with primary-source verification on file`);
    doc.moveDown();

    doc.fontSize(13).text("Summary");
    doc.moveDown(0.3);
    doc.fontSize(8);
    // Column widths sum to the printable width (612 - 2 × 54 = 504).
    const cols = [112, 138, 22, 78, 56, 58, 40];
    const header = ["Holder", "Credential", "St", "Number", "Expires", "Last verified", "Result"];
    const x0 = doc.page.margins.left;
    const rowH = 12;
    const drawRow = (cells: string[], bold = false) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const y = doc.y;
      let x = x0;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      cells.forEach((cell, i) => {
        // Truncate to the column rather than wrap: one line per credential keeps the table scannable.
        let text = cell;
        while (text.length > 1 && doc.widthOfString(text) > cols[i] - 4) text = text.slice(0, -2) + "…";
        doc.text(text, x, y, { width: cols[i] - 4, lineBreak: false });
        x += cols[i];
      });
      doc.y = y + rowH;
    };
    drawRow(header, true);
    for (const c of credentials) {
      const v = c.verifications[0];
      drawRow([
        c.person ? `${c.person.lastName}, ${c.person.firstName}` : entity.name,
        c.credentialType.name,
        c.state ?? "",
        c.number ?? "",
        c.expiresOn ? isoDate(c.expiresOn) : "n/a",
        v ? isoDate(v.verifiedAt) : c.credentialType.psvRequired ? "NEVER" : "n/a",
        v ? v.result : "",
      ]);
    }
    doc.font("Helvetica");

    for (const c of credentials.filter((x) => x.credentialType.psvRequired)) {
      doc.addPage();
      const v = c.verifications[0];
      doc.fontSize(14).text(`${c.state ? c.state + " " : ""}${c.credentialType.name}`);
      doc.fontSize(11).fillColor("#444").text(c.person ? `${c.person.firstName} ${c.person.lastName}` : entity.name).fillColor("#111");
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Number: ${c.number ?? "—"}    Issued: ${c.issuedOn ? isoDate(c.issuedOn) : "—"}    Expires: ${c.expiresOn ? isoDate(c.expiresOn) : "does not expire"}    Status: ${c.status}`);
      doc.moveDown(0.5);
      if (!v) {
        doc.fillColor("#b45309").text("No primary-source verification on file.").fillColor("#111");
        continue;
      }
      doc.text(`Verified ${v.verifiedAt.toISOString().replace("T", " ").slice(0, 16)} UTC by ${v.verifiedBy?.name ?? "system (automated API check)"}`);
      doc.text(`Method: ${v.method === "auto_api" ? "automated API lookup" : "manual board lookup"}    Result: ${v.result}    Expiration seen: ${v.expirationSeen ? isoDate(v.expirationSeen) : "—"}    Discipline: ${v.disciplineFlag ? "FLAGGED" : "none"}`);
      doc.text(`Source: ${v.sourceUrl}`);
      if (v.note) doc.text(`Note: ${v.note}`);
      doc.moveDown(0.5);
      const img = v.evidenceFileKey ? evidenceImages.get(v.evidenceFileKey) : undefined;
      if (img) {
        try {
          doc.image(img, { fit: [doc.page.width - doc.page.margins.left - doc.page.margins.right, 330] });
        } catch {
          doc.text(`Evidence file: ${v.evidenceFileKey}`);
        }
      } else {
        doc.text(`Evidence file: ${v.evidenceFileKey ?? "none"} (non-image evidence; included in the ZIP)`);
      }
    }
    doc.fontSize(8).fillColor("#666").text(`Page footer: ${entity.name} — generated ${formatDate(now)}`, doc.page.margins.left, doc.page.height - 40, { lineBreak: false });
  });
  return { pdf, entityName: entity.name };
}

/** ZIP of every full-size evidence file (latest verification per credential) plus the survey pack PDF. */
export async function surveyPackZip(entityId: string): Promise<{ zip: Buffer; entityName: string }> {
  const { pdf, entityName } = await surveyPackPdf(entityId);
  const credentials = await db.credential.findMany({
    where: { status: { not: "expired" }, OR: [{ entityId }, { person: { entityId, active: true } }] },
    include: { credentialType: true, person: true, verifications: { orderBy: { verifiedAt: "desc" }, include: { verifiedBy: true } } },
  });
  const zip = new JSZip();
  zip.file("survey-pack.pdf", pdf);
  const manifest: Array<Record<string, unknown>> = [];
  for (const c of credentials) {
    const holder = c.person ? `${c.person.lastName}-${c.person.firstName}` : "entity";
    const folder = `${holder}/${(c.state ? c.state + "-" : "") + c.credentialType.name}`.replace(/[^A-Za-z0-9/_-]+/g, "_");
    if (c.documentFileKey) {
      try {
        zip.file(`${folder}/document-${c.documentFileKey.split("/").pop()}`, (await storage().get(c.documentFileKey)).body);
      } catch {}
    }
    for (const v of c.verifications) {
      if (!v.evidenceFileKey) continue;
      try {
        const obj = await storage().get(v.evidenceFileKey);
        const name = `${folder}/verification-${isoDate(v.verifiedAt)}-${v.result}-${v.evidenceFileKey.split("/").pop()}`;
        zip.file(name, obj.body);
        manifest.push({ file: name, credential: c.credentialType.name, holder, number: c.number, verifiedAt: v.verifiedAt.toISOString(), verifiedBy: v.verifiedBy?.name ?? "system", method: v.method, result: v.result, sourceUrl: v.sourceUrl, metadata: obj.metadata });
      } catch {}
    }
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return { zip: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), entityName };
}

export async function credentialsCsv(filters: { entityId?: string }) {
  const rows = await db.credential.findMany({
    where: filters.entityId ? { OR: [{ entityId: filters.entityId }, { person: { entityId: filters.entityId } }] } : {},
    include: { credentialType: true, person: { include: { entity: true } }, entity: true, verifications: { orderBy: { verifiedAt: "desc" }, take: 1, include: { verifiedBy: true } } },
    orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }],
  });
  return toCsv(
    rows.map((c) => {
      const v = c.verifications[0];
      return {
        holder: c.person ? `${c.person.lastName}, ${c.person.firstName}` : c.entity?.name,
        holder_type: c.subjectType,
        role: c.person?.role ?? "",
        location: c.person?.entity?.name ?? c.entity?.name ?? "",
        credential: c.credentialType.name,
        category: c.credentialType.category,
        state: c.state,
        number: c.number,
        issued_on: c.issuedOn,
        expires_on: c.expiresOn,
        status: c.status,
        next_verify_due: c.nextVerifyDue,
        last_verified_at: v ? v.verifiedAt.toISOString() : "",
        last_verified_by: v ? (v.verifiedBy?.name ?? "system") : "",
        last_method: v?.method ?? "",
        last_result: v?.result ?? "",
        last_source_url: v?.sourceUrl ?? "",
        evidence_file: v?.evidenceFileKey ?? "",
        document_file: c.documentFileKey ?? "",
      };
    })
  );
}

export async function screeningCsv() {
  const matches = await db.screeningMatch.findMany({ include: { run: true, person: true, reviewedBy: true } });
  const runs = await db.screeningRun.findMany({ orderBy: { runAt: "desc" } });
  const byRun = new Map(runs.map((r) => [r.id, r]));
  const rows: Array<Record<string, unknown>> = runs.map((r) => ({
    run_at: r.runAt.toISOString(),
    source: r.source,
    source_version: r.sourceVersion,
    persons_screened: r.personsScreened,
    matches_found: r.matchesFound,
    report_file: r.reportFileKey,
    match_person: "",
    match_score: "",
    matched_on: "",
    disposition: "",
    reviewed_by: "",
    reviewed_at: "",
    review_note: "",
  }));
  for (const m of matches) {
    const r = byRun.get(m.runId)!;
    rows.push({
      run_at: r.runAt.toISOString(),
      source: r.source,
      source_version: r.sourceVersion,
      persons_screened: r.personsScreened,
      matches_found: r.matchesFound,
      report_file: r.reportFileKey,
      match_person: `${m.person.lastName}, ${m.person.firstName}`,
      match_score: m.score.toFixed(2),
      matched_on: m.matchedOn,
      disposition: m.disposition,
      reviewed_by: m.reviewedBy?.name ?? "",
      reviewed_at: m.reviewedAt?.toISOString() ?? "",
      review_note: m.reviewNote ?? "",
    });
  }
  return toCsv(rows);
}

export async function trainingCsv() {
  const types = await db.credentialType.findMany({ where: { category: "training" }, orderBy: { name: "asc" } });
  const people = await db.person.findMany({ where: { active: true }, include: { entity: true, credentials: { where: { credentialType: { category: "training" } }, include: { credentialType: true } } }, orderBy: [{ lastName: "asc" }] });
  const rows = people.flatMap((p) =>
    types
      .filter((t) => t.requiredForRoles.includes(p.role) || p.credentials.some((c) => c.credentialTypeId === t.id))
      .map((t) => {
        const c = p.credentials.filter((x) => x.credentialTypeId === t.id).sort((a, b) => (b.issuedOn?.getTime() ?? 0) - (a.issuedOn?.getTime() ?? 0))[0];
        return {
          employee: `${p.lastName}, ${p.firstName}`,
          role: p.role,
          location: p.entity?.name ?? "",
          course: t.name,
          required: t.requiredForRoles.includes(p.role) ? "yes" : "no",
          completed_on: c?.issuedOn ?? "",
          expires_on: c?.expiresOn ?? "",
          status: c ? c.status : "MISSING",
          certificate_file: c?.documentFileKey ?? "",
        };
      })
  );
  return toCsv(rows, ["employee", "role", "location", "course", "required", "completed_on", "expires_on", "status", "certificate_file"]);
}

export async function auditCsv() {
  const rows = await db.auditLog.findMany({ orderBy: { at: "desc" }, include: { user: true }, take: 50_000 });
  return toCsv(rows.map((a) => ({ at: a.at.toISOString(), user: a.user?.email ?? "system", table: a.table, row_id: a.rowId, action: a.action, before: a.before ? JSON.stringify(a.before) : "", after: a.after ? JSON.stringify(a.after) : "" })));
}
