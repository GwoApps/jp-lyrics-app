import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;

// Cloudflare's local workerd bridge is only needed for `next dev`.
// Loading it during a Linux/Alpine production build attempts to spawn the
// glibc-targeted workerd binary, which is unavailable in the Docker image.
if (process.env.NODE_ENV === 'development') {
  import('@opennextjs/cloudflare').then((m) => m.initOpenNextCloudflareForDev());
}
