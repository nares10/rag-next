import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // The "N" route indicator shows up in screenshots and demos; compile and runtime
  // errors are still surfaced without it.
  devIndicators: false,
};

export default nextConfig;
