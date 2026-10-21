import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { auditCsv, credentialsCsv, screeningCsv, trainingCsv } from "@/lib/reports";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("unauthorized", { status: 401 });
  const kind = req.nextUrl.searchParams.get("kind") ?? "credentials";
  let csv: string;
  switch (kind) {
    case "credentials":
      csv = await credentialsCsv({ entityId: req.nextUrl.searchParams.get("entity") || undefined });
      break;
    case "screening":
      csv = await screeningCsv();
      break;
    case "training":
      csv = await trainingCsv();
      break;
    case "audit":
      if (session.role !== "admin") return new NextResponse("forbidden", { status: 403 });
      csv = await auditCsv();
      break;
    default:
      return new NextResponse("unknown kind", { status: 400 });
  }
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-${date}.csv"` },
  });
}
