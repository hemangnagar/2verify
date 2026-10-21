import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone for the Docker image.
  output: "standalone",
  serverExternalPackages: ["pdfkit", "pngjs", "bcryptjs", "nodemailer", "jszip"],
  experimental: {
    // Evidence screenshots are posted through server actions.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
