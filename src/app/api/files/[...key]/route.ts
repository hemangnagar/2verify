import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { keyOrg, storage, verifyLocalSignature } from "@/lib/storage";

/**
 * File access. The URL carries an HMAC signature and expiry (produced by storage().signedUrl()), so
 * it behaves like a presigned link; without a valid signature the caller must be signed in and
 * inside the file's org. The app streams the object from whichever storage driver is configured,
 * so the bucket never needs to be reachable from the browser.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  if (key.includes("..")) return new NextResponse("bad key", { status: 400 });

  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const signed = sig && verifyLocalSignature(key, exp, sig);
  if (!signed) {
    const session = await getSession();
    if (!session) return new NextResponse("unauthorized", { status: 401 });
    // Files are namespaced by org; a session may only reach its active org's prefix.
    if (session.role !== "operator" && keyOrg(key) !== session.activeOrgId) return new NextResponse("forbidden", { status: 403 });
  }

  try {
    const obj = await storage().get(key);
    return new NextResponse(new Uint8Array(obj.body), {
      headers: {
        "content-type": obj.contentType,
        "cache-control": "private, max-age=0",
        "content-disposition": `inline; filename="${key.split("/").pop()}"`,
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
