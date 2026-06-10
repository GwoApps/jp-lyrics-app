import { createHash } from 'crypto';

/**
 * Generate a short anonymous display name from an email address.
 * Uses SHA-256 prefix to produce a stable, non-reversible identifier.
 * Example: "user@example.com" → "a3f1b2c8"
 */
export function anonymizeEmail(email: string): string {
  if (!email) return '';
  return createHash('sha256').update(email).digest('hex').slice(0, 8);
}
