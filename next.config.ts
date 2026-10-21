import type { NextConfig } from "next";

/** Public hostname(s) allowed to post server actions. Needed when the app sits behind a tunnel or proxy. */
function allowedOrigins(): string[] {
  const out = new Set<string>(["localhost:3000"]);
  for (const v of [process.env.APP_URL, ...(process.env.APP_ALLOWED_ORIGINS ?? "").split(",")]) {
    const s = v?.trim();
    if (!s) continue;
    try {
      out.add(new URL(s.includes("://") ? s : `https://${s}`).host);
    } catch {
      out.add(s);
    }
  }
  return [...out];
}

const nextConfig: NextConfig = {
  // Produces .next/standalone for the Docker image.
  output: "standalone",
  serverExternalPackages: ["pdfkit", "pngjs", "bcryptjs", "nodemailer", "jszip", "playwright-core"],
  experimental: {
    // Evidence screenshots are posted through server actions.
    serverActions: { bodySizeLimit: "25mb", allowedOrigins: allowedOrigins() },
  },
};

export default nextConfig;
