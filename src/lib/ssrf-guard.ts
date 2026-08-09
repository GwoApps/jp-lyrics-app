/**
 * SSRF guard for the admin translation-config "test connection" feature
 * (ISSUE #82, safety P0).
 *
 * Rules:
 *  - HTTPS only (unless the provider never makes a network call, e.g. workers-ai).
 *  - Known providers fall back to their default host allowlist.
 *  - Custom hosts must resolve to public addresses only: loopback, RFC1918,
 *    link-local, cloud metadata (169.254.169.254) and CGNAT ranges are rejected.
 *  - DNS is resolved via a trusted DoH resolver (or Node's dns on non-Workers
 *    runtimes) before connecting, so hostnames that resolve to private ranges
 *    are refused up front (mitigates simple DNS-rebinding).
 */

import { DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_OPENAI_BASE_URL } from './translation/config';

/** RFC1918 + loopback + link-local + metadata + CGNAT / CGN ranges. */
export const PRIVATE_IP_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 (current network / "this" host)
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x12700000, 0x127fffff], // 127.0.0.0/8 (loopback)
  [0x16925400, 0x169254ff], // 169.254.0.0/16 (link-local incl. AWS metadata)
  [0x17216000, 0x17231fff], // 172.16.0.0/12
  [0x19216800, 0x192168ff], // 192.168.0.0/16
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0x7f000001, 0x7f000001], // redundant, covered above
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

/** IPv6 loopback / link-local / unique-local / unspecified / v4-mapped checks. */
export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  // IPv4-mapped IPv6 like ::ffff:127.0.0.1
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** Known dangerous hostnames that should never be contacted regardless of DNS. */
const DANGEROUS_HOSTS = new Set([
  'localhost', 'localhost.localdomain',
  'metadata.google.internal', 'metadata.google',
  '169.254.169.254', 'metadata', 'instance-data',
  '100.100.100.200', // Alibaba metadata
]);

const DANGEROUS_SUFFIXES = [
  '.localhost', '.local', '.internal', '.intranet', '.lan',
  '.home.arpa', '.example', '.test', '.invalid',
];

function isDangerousHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (DANGEROUS_HOSTS.has(h)) return true;
  return DANGEROUS_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

interface ResolvedIp {
  address: string;
  family: 4 | 6;
}

/** Try Node's dns.lookup on non-Workers runtimes. */
async function resolveNode(hostname: string): Promise<ResolvedIp[] | null> {
  try {
    const dns = await import('node:dns');
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
  } catch {
    return null;
  }
}

/** Cloudflare DoH JSON API as a portable fallback (works on Workers too). */
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

/** Allowed-by-default hosts for known providers. */
const DEFAULT_ALLOWLIST = new Set([
  new URL(DEFAULT_OPENAI_BASE_URL).hostname.toLowerCase(),
  new URL(DEFAULT_ANTHROPIC_BASE_URL).hostname.toLowerCase(),
  'api.openai.com',
  'api.anthropic.com',
]);

/**
 * Validate a candidate base URL for the translation provider before any
 * network call is made. Returns null when safe, otherwise a language-neutral
 * error code.
 */
export async function validateTranslationBaseUrl(rawUrl: string, provider: string): Promise<string | null> {
  if (provider === 'workers-ai') return null; // binding-backed, no URL

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'invalid_url';
  }

  if (url.protocol !== 'https:') return 'https_required';
  const hostname = url.hostname.toLowerCase();

  if (isDangerousHostname(hostname)) return 'unsafe_host';
  // IP-literal hosts are only allowed when public.
  const ipLiteral = hostname.match(/^\[?([0-9a-f:.]+)\]?$/);
  if (ipLiteral) {
    const ip = ipLiteral[1];
    if (ip.includes(':') ? isPrivateIpv6(ip) : isPrivateIpv4(ip)) return 'unsafe_host';
    return null; // explicit public IP literal is acceptable
  }

  // Known provider defaults are trusted.
  if (DEFAULT_ALLOWLIST.has(hostname)) return null;

  // Custom hostname: resolve and require every address to be public.
  const addresses = await resolvePublic(hostname);
  if (!addresses || addresses.length === 0) return 'dns_failed';
  for (const addr of addresses) {
    if (addr.family === 6 ? isPrivateIpv6(addr.address) : isPrivateIpv4(addr.address)) {
      return 'unsafe_host';
    }
  }
  return null;
}

/** Simple in-memory rate limiter for the low-frequency admin test endpoint. */
const TEST_RATE_WINDOW_MS = 60_000;
const TEST_RATE_MAX = 6;
const testHits = new Map<string, number[]>();

export function rateLimitTest(key: string): boolean {
  const now = Date.now();
  const recent = (testHits.get(key) ?? []).filter((t) => now - t < TEST_RATE_WINDOW_MS);
  if (recent.length >= TEST_RATE_MAX) {
    testHits.set(key, recent);
    return true; // limited
  }
  recent.push(now);
  testHits.set(key, recent);
  return false;
}
