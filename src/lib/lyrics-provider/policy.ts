/**
 * Deployment-level network policy for HTTP lyrics providers (ISSUE #148).
 *
 * The default is the most restrictive: HTTPS + public addresses only. Deployers
 * may relax HTTP / private-network access via two deployment-level env vars that
 * cannot be overridden from the UI or database:
 *
 *   LYRICS_PROVIDER_ALLOW_HTTP=false
 *   LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK=false
 *
 * Boolean env vars only accept an explicit "true" (case-normalised); missing,
 * empty or any other value is treated as false (fail-closed). Cloud metadata
 * targets are ALWAYS forbidden regardless of the switches.
 *
 * This generalises the translation-provider SSRF guard (ssrf-guard.ts) into a
 * reusable URL guard used by save / test / manifest / search — every path runs
 * the same evaluator and re-resolves DNS before each request.
 */

/** PRIVATE_IP_RANGES: RFC1918 + loopback + link-local + metadata + CGNAT. */
export const PRIVATE_IP_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 (current network / "this" host)
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local incl. AWS metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
];

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const int = ipv4ToInt(parts[0], parts[1], parts[2], parts[3]);
  return PRIVATE_IP_RANGES.some(([lo, hi]) => int >= lo && int <= hi);
}

/**
 * Convert an IPv4-mapped IPv6 literal into its embedded dotted IPv4 address, or
 * null when the literal is not an IPv4-mapped address. Handles both the dotted
 * form WHATWG emits for `::ffff:127.0.0.1` and the hex-mapped form it emits for
 * `[::ffff:169.254.169.254]` → `::ffff:a9fe:a9fe`. Without this, hex-mapped
 * addresses slip past the private/metadata checks and are treated as public.
 */
function mappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  // Dotted form: ::ffff:127.0.0.1
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  // Hex form: ::ffff:a9fe:a9fe (one or two 16-bit groups after the prefix).
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4})(?::([0-9a-f]{1,4}))?$/);
  if (!hex) return null;
  const first = parseInt(hex[1], 16);
  const second = hex[2] !== undefined ? parseInt(hex[2], 16) : -1;
  if (second < 0) {
    // Single group covers the whole 32-bit IPv4 (e.g. ::ffff:ffff → 255.255.255.255).
    if (first > 0xffffffff) return null;
    return [
      (first >>> 24) & 0xff,
      (first >>> 16) & 0xff,
      (first >>> 8) & 0xff,
      first & 0xff,
    ].join('.');
  }
  const int = ((first << 16) | second) >>> 0;
  return [(int >>> 24) & 0xff, (int >>> 16) & 0xff, (int >>> 8) & 0xff, int & 0xff].join('.');
}

/** IPv6 loopback / link-local / unique-local / unspecified / v4-mapped checks. */
export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  if (lower.startsWith('::ffff:')) {
    const mapped = mappedIpv4(lower);
    if (mapped) return isPrivateIpv4(mapped);
  }
  return false;
}

/** True when an IPv6 literal embeds a cloud-metadata IPv4 (mapped or not). */
export function isMetadataIpv6(ip: string): boolean {
  if (isMetadataHost(ip)) return true;
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const mapped = mappedIpv4(ip);
    if (mapped && METADATA_HOSTS.has(mapped)) return true;
  }
  return false;
}

/** Cloud metadata hostnames/IPs that are permanently forbidden. */
const METADATA_HOSTS = new Set([
  '169.254.169.254', 'metadata.google.internal', 'metadata.google',
  'metadata', 'instance-data', '100.100.100.200',
]);
const DANGEROUS_HOSTS = new Set([
  'localhost', 'localhost.localdomain',
]);
const DANGEROUS_SUFFIXES = [
  '.localhost', '.local', '.internal', '.intranet', '.lan',
  '.home.arpa', '.example', '.test', '.invalid',
];

function isMetadataHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return METADATA_HOSTS.has(h);
}

function isDangerousHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (DANGEROUS_HOSTS.has(h) || isMetadataHost(h)) return true;
  return DANGEROUS_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

interface ResolvedIp {
  address: string;
  family: 4 | 6;
}

async function resolveNode(hostname: string): Promise<ResolvedIp[] | null> {
  try {
    const dns = await import('node:dns');
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
  } catch {
    return null;
  }
}

async function resolveDoh(hostname: string): Promise<ResolvedIp[] | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
    if (!data.Answer) return null;
    return data.Answer
      .filter((a) => a.type === 1)
      .map((a) => ({ address: a.data, family: 4 as const }));
  } catch {
    return null;
  }
}

async function resolvePublic(hostname: string): Promise<ResolvedIp[] | null> {
  const node = await resolveNode(hostname);
  if (node) return node;
  const doh = await resolveDoh(hostname);
  if (doh) return doh;
  return null;
}

function readBoolEnv(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return raw.trim().toLowerCase() === 'true';
}

/** Deployment policy snapshot (also served to the admin UI to gate save/test). */
export interface NetworkPolicy {
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
}

export function getNetworkPolicy(): NetworkPolicy {
  return {
    allowHttp: readBoolEnv('LYRICS_PROVIDER_ALLOW_HTTP'),
    allowPrivateNetwork: readBoolEnv('LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK'),
  };
}

/** Language-neutral error codes returned by the policy evaluator. */
export type PolicyError =
  | 'invalid_url'
  | 'http_disallowed'
  | 'unsafe_host'
  | 'metadata_forbidden'
  | 'dns_failed';

/**
 * Validate a provider `base_url` against the deployment policy BEFORE any
 * network call. Returns null when safe, otherwise a language-neutral error code.
 */
export async function validateProviderBaseUrl(
  rawUrl: string,
  policy?: NetworkPolicy,
): Promise<PolicyError | null> {
  const p = policy ?? getNetworkPolicy();

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'invalid_url';
  }

  if (url.username || url.password) return 'invalid_url';
  if (url.search || url.hash) return 'invalid_url';

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid_url';
  if (url.protocol === 'http:' && !p.allowHttp) return 'http_disallowed';

  const hostname = url.hostname.toLowerCase();
  // Cloud metadata is ALWAYS forbidden, regardless of switches.
  if (isMetadataHost(hostname)) return 'metadata_forbidden';
  if (isDangerousHostname(hostname)) return p.allowPrivateNetwork ? null : 'unsafe_host';

  // IP-literal hosts.
  const ipLiteral = hostname.match(/^\[?([0-9a-f:.]+)\]?$/);
  if (ipLiteral) {
    const ip = ipLiteral[1];
    const isIpv6 = ip.includes(':');
    // Metadata is ALWAYS forbidden, including IPv4-mapped IPv6 forms.
    if (isIpv6 && isMetadataIpv6(ip)) return 'metadata_forbidden';
    const isPrivate = isIpv6 ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
    if (isPrivate && !p.allowPrivateNetwork) return 'unsafe_host';
    return null; // public IP literal, or private allowed
  }

  // Hostname: resolve and require every address to satisfy the policy.
  const addresses = await resolvePublic(hostname);
  if (!addresses || addresses.length === 0) return 'dns_failed';
  for (const addr of addresses) {
    const isPrivate = addr.family === 6 ? isPrivateIpv6(addr.address) : isPrivateIpv4(addr.address);
    // Metadata IP literal targets must never be contacted even when private net allowed.
    if (METADATA_HOSTS.has(addr.address)) return 'metadata_forbidden';
    if (isPrivate && !p.allowPrivateNetwork) return 'unsafe_host';
  }
  return null;
}

/** True when the given base_url would be served over insecure plaintext HTTP. */
export function isInsecureTransport(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Normalise a provider base_url for storage + endpoint derivation.
 *  - absolute http(s) URL
 *  - no userinfo / query / fragment
 *  - keeps the full path prefix (provider identity is NOT the Origin)
 *  - trailing slashes trimmed except the root path
 */
export function normalizeProviderBaseUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let path = url.pathname;
  // Trim trailing '/' but never strip the root '/'.
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, ''); // ensure no trailing slash (except root)
}

/** Derive fixed sub-endpoints relative to the base path (never resets to origin). */
export function deriveEndpoints(baseUrl: string): { manifestUrl: string; searchUrl: string } {
  const withSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return {
    manifestUrl: new URL('manifest.json', withSlash).toString(),
    searchUrl: new URL('v1/search', withSlash).toString(),
  };
}
