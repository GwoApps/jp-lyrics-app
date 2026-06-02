import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'kuroshiro', 'kuroshiro-analyzer-kuromoji'],
};

export default nextConfig;
