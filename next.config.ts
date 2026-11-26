import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "@/lib/security-headers";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Covers Worker/SSR responses (HTML, API routes, redirects). Static assets
  // served directly by Cloudflare are covered in public/_headers.
  // CSP is deliberately report-only; see src/lib/security-headers.ts.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

// Cloudflare's local workerd bridge is only needed for `next dev`.
// Loading it during a Linux/Alpine production build attempts to spawn the
// glibc-targeted workerd binary, which is unavailable in the Docker image.
if (process.env.NODE_ENV === 'development') {
  import('@opennextjs/cloudflare').then((m) => m.initOpenNextCloudflareForDev());
}
