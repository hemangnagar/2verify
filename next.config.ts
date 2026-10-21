import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone for the Docker image.
  output: "standalone",
  serverExternalPackages: ["pdfkit", "pngjs", "bcryptjs", "nodemailer"],
};

export default nextConfig;
