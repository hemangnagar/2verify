import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { surveyPackPdf, surveyPackZip } from "@/lib/reports";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("unauthorized", { status: 401 });
  const entityId = req.nextUrl.searchParams.get("entity");
  if (!entityId) return new NextResponse("entity required", { status: 400 });
  const format = req.nextUrl.searchParams.get("format") ?? "pdf";
  const date = new Date().toISOString().slice(0, 10);
  if (format === "zip") {
    const { zip, entityName } = await surveyPackZip(entityId);
    return new NextResponse(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slug(entityName)}-evidence-${date}.zip"` } });
  }
  const { pdf, entityName } = await surveyPackPdf(entityId);
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${slug(entityName)}-survey-pack-${date}.pdf"` } });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
