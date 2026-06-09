import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['kuroshiro', 'kuroshiro-analyzer-kuromoji'],
};

export default nextConfig;
