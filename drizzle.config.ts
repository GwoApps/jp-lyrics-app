import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration — supports 3 backends via environment variables.
 *
 * Cloudflare D1 (HTTP API):
 *   DB_DRIVER=d1-http
 *   CLOUDFLARE_ACCOUNT_ID=<account_id>
 *   CLOUDFLARE_DATABASE_ID=<database_id>
 *   CLOUDFLARE_API_TOKEN=*** *
 * Cloudflare D1 (local, via Wrangler):
 *   DB_DRIVER=d1
 *
 * Turso / libSQL:
 *   TURSO_URL=libsql://xxx.turso.io
 *   TURSO_AUTH_TOKEN=*** *
 * Local SQLite (default, no env vars):
 *   Uses file:data/local.db via @libsql/client
 */

const driver = process.env.DB_DRIVER || undefined;
const credentials =
  driver === 'd1-http'
    ? {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
        databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
        token: process.env.CLOUDFLARE_API_TOKEN!,
      }
    : driver === 'd1'
      ? { wranglerConfig: './wrangler.toml' }
      : process.env.TURSO_URL
        ? { url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN }
        : { url: 'file:data/local.db' };

export default defineConfig({
  schema: './src/lib/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  ...(driver ? { driver } : {}),
  dbCredentials: credentials,
});
