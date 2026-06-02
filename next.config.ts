import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'kuroshiro', 'kuroshiro-analyzer-kuromoji'],
};

export default nextConfig;
