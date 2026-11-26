/**
 * Baseline security response headers shared by the Next config (Worker/SSR
 * responses) and `public/_headers` (static assets served by Cloudflare).
 *
 * CSP is report-only so it cannot break Next.js inline bootstrap scripts,
 * inline styles, or PiP/share canvases; it only tells the browser to report
 * violations to /api/csp-report while we observe real traffic.
 *
 * frame-ancestors 'self' blocks clickjacking but still allows same-origin
 * embedding; no third-party embedding is used today (issue #495).
 */
export type ResponseHeaderEntry = { key: string; value: string };

export const CSP_REPORT_ONLY_VALUE =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report";

export const SECURITY_HEADERS: ResponseHeaderEntry[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY_VALUE },
];

/** Lowercase key → value map, for callers that need header lookups. */
export function securityHeaders(): Record<string, string> {
  return Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]));
}

/** Cloudflare `_headers` file format: one indented `Key: Value` line per rule. */
export function renderHeadersFile(rules: ReadonlyArray<string>): string {
  const lines = [...rules];
  for (const { key, value } of SECURITY_HEADERS) {
    lines.push(`  ${key}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Browsers send CSP reports as `application/csp-report` or `application/reports+json`. */
export function isCspReportContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return /application\/(csp-report|reports\+json)/i.test(contentType);
}

/** Extract just the interesting fields so logs stay small and useful. */
export function parseCspReport(body: unknown): Record<string, string> | null {
  if (!body || typeof body !== 'object') return null;
  const report = (body as { 'csp-report'?: unknown })['csp-report'] ?? body;
  if (!report || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const pick = (key: string): string | undefined =>
    typeof r[key] === 'string' ? (r[key] as string).slice(0, 500) : undefined;
  const result = {
    ...(pick('document-uri') ? { documentUri: pick('document-uri')! } : {}),
    ...(pick('violated-directive') ? { directive: pick('violated-directive')! } : {}),
    ...(pick('effective-directive') ? { effectiveDirective: pick('effective-directive')! } : {}),
    ...(pick('blocked-uri') ? { blockedUri: pick('blocked-uri')! } : {}),
    ...(pick('source-file') ? { sourceFile: pick('source-file')! } : {}),
    ...(pick('original-policy') ? { originalPolicy: pick('original-policy')! } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}
