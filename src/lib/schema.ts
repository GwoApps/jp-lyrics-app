import { sqliteTable, text, integer, primaryKey, blob, index as sqliteIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const songs = sqliteTable('songs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  artist: text('artist').notNull().default(''),
  lyricsRaw: text('lyrics_raw').notNull().default(''),
  lyricsFurigana: text('lyrics_furigana').notNull().default('[]'),
  readingScheme: text('reading_scheme').notNull().default('ja-kana'),
  readingSchemeConfirmed: integer('reading_scheme_confirmed').notNull().default(0),
  lyricsSynced: text('lyrics_synced').notNull().default(''),
  lyricsTranslation: text('lyrics_translation').notNull().default('[]'),
  // The BCP-47 target language the current `lyrics_translation` cache was
  // generated in (e.g. 'zh-CN' | 'en-US'). NULL means unknown/mixed (legacy
  // data or manual corrections) — treated as incompatible with any current
  // target language so the cache is re-translated on the next request.
  lyricsTranslationLang: text('lyrics_translation_lang'),
  lyricsTranslationReasoning: text('lyrics_translation_reasoning'),
  lyricsGlossary: text('lyrics_glossary'),
  coverUrl: text('cover_url'),
  coverPalette: text('cover_palette'),
  spotifyTrackId: text('spotify_track_id'),
  spotifyUri: text('spotify_uri'),
  spotifyAlbum: text('spotify_album'),
  spotifyDurationMs: integer('spotify_duration_ms'),
  spotifyCanonicalTitle: text('spotify_canonical_title'),
  spotifyCanonicalArtist: text('spotify_canonical_artist'),
  lyricsSource: text('lyrics_source').notNull().default('manual'),
  lyricsConfidence: integer('lyrics_confidence').notNull().default(100),
  // 1 when the lyrics came from a low-confidence / non-exact match that the
  // user has not explicitly accepted yet (see lib/lyrics-hit.ts).
  lyricsNeedsReview: integer('lyrics_needs_review').notNull().default(0),
  lyricsFetchedAt: text('lyrics_fetched_at'),
  createdBy: text('created_by').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  isPublic: integer('is_public').notNull().default(0),
  publicRequested: integer('public_requested').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

export const spotifyAuth = sqliteTable('spotify_auth', {
  userEmail: text('user_email').primaryKey(),
  accessToken: text('access_token').notNull().default(''),
  refreshToken: text('refresh_token').notNull().default(''),
  expiresAt: integer('expires_at').notNull().default(0),
  displayName: text('display_name').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

export const favorites = sqliteTable('favorites', {
  userEmail: text('user_email').notNull(),
  songId: text('song_id').notNull().references(() => songs.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
}, (t) => [
  primaryKey({ columns: [t.userEmail, t.songId] }),
]);

export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  userEmail: text('user_email').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

export const collectionSongs = sqliteTable('collection_songs', {
  collectionId: text('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  songId: text('song_id').notNull().references(() => songs.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.collectionId, t.songId] }),
]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  isAdmin: integer('is_admin').notNull().default(0),
  isBlocked: integer('is_blocked').notNull().default(0),
  blockedReason: text('blocked_reason').notNull().default(''),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

// Key-value store for admin-managed settings (e.g. translation service overrides).
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * Admin-managed global HTTP lyrics providers (ISSUE #148, Phase 2).
 *
 * All rows are GLOBAL providers — there is deliberately no owner_user_id,
 * personal scope or per-user override (a user-level hotplug would open SSRF /
 * credential-exfiltration / multi-tenant isolation risks). Only admins can
 * create / edit / test / reorder / enable-disable / delete these through
 * /api/admin/*. The effective (enabled, ordered) chain drives every sync,
 * single-song import and playlist import.
 */
export const lyricsProviderConfigs = sqliteTable('lyrics_provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // 'builtin' = trusted in-app source (LRCLIB / PetitLyrics / Uta-Net /
  // ytmusic) managed like any other provider row; 'http' = runtime plugin.
  kind: text('kind', { enum: ['builtin', 'http'] }).notNull().default('http'),
  // Nullable for builtin providers (they have no external URL).
  baseUrl: text('base_url'),
  authType: text('auth_type', { enum: ['none', 'bearer'] }).notNull().default('none'),
  // AES-GCM ciphertext (v1:<iv>:<cipher>); NEVER returned by GET / audit.
  authSecretCiphertext: text('auth_secret_ciphertext'),
  enabled: integer('enabled').notNull().default(1),
  priority: integer('priority').notNull().default(0),
  timeoutMs: integer('timeout_ms'),
  protocolVersion: integer('protocol_version').notNull().default(1),
  manifestJson: text('manifest_json'),
  lastCheckStatus: text('last_check_status', { enum: ['ok', 'failed', 'unchecked'] }).notNull().default('unchecked'),
  lastCheckCode: text('last_check_code'),
  lastCheckLatencyMs: integer('last_check_latency_ms'),
  checkedAt: text('checked_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

// Per-user personal settings (non-admin preferences: theme, locale, font size,
// reading mode, romanize furigana, show translation, follow playing, translation
// target lang). One row per (user_id, key); value holds the JSON-encoded value.
// Reading precedence: user setting > admin/global config > built-in default.
// Unauthenticated users keep their existing localStorage-only behaviour.
export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
}, (t) => [
  primaryKey({ columns: [t.userId, t.key] }),
]);

// User-uploaded custom cover artwork, stored as a BLOB so it works on both
// local SQLite and Cloudflare D1 (Workers have no persistent filesystem).
// Spotify artwork is never stored here — its CDN URL is reused directly.
export const songCovers = sqliteTable('song_covers', {
  songId: text('song_id').primaryKey().references(() => songs.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: blob('data').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

// Daily Workers AI usage counter — a hard cap so the free Neurons
// allocation can never be exceeded (paid plans bill above it).
export const aiUsage = sqliteTable('ai_usage', {
  usageDate: text('usage_date').primaryKey(),
  neurons: integer('neurons').notNull().default(0),
  requests: integer('requests').notNull().default(0),
});

// In-flight reservations for the daily Workers AI budget. A request
// atomically reserves an estimated budget *before* calling the model and
// settles it (多退少补) afterwards, so concurrent requests can never
// collectively exceed the daily limit. Entries that outlive
// AI_RESERVATION_TTL_MS are reclaimed by the next reservation.
export const aiUsageReservations = sqliteTable('ai_usage_reservations', {
  requestId: text('request_id').primaryKey(),
  usageDate: text('usage_date').notNull(),
  estimatedNeurons: integer('estimated_neurons').notNull(),
  status: text('status', { enum: ['reserved', 'settled', 'released'] }).notNull().default('reserved'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Long-running Spotify playlist imports (job-based so a single Worker request
 * never has to fetch lyrics for the whole list). One row per import; the
 * client drives it with chunked `PUT` requests and can resume after a timeout.
 * Track statuses are persisted separately in `playlist_import_track_results`.
 */
export const playlistImportJobs = sqliteTable('playlist_import_jobs', {
  id: text('id').primaryKey(),
  userEmail: text('user_email').notNull(),
  playlistId: text('playlist_id').notNull(),
  status: text('status').notNull().default('pending'), // pending | running | completed | failed | cancelled
  total: integer('total').notNull().default(0),
  processed: integer('processed').notNull().default(0),
  imported: integer('imported').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', 'localtime'))`),
});

/**
 * Append-only admin audit trail (see ISSUE #82). Every high-risk admin write
 * (promote/demote/block/unblock/delete user, approve/reject/publish/unpublish/
 * delete song, translation-config change/clear) is recorded atomically with
 * the business update.
 *
 * Privacy rules:
 *  - before_json/after_json only keep the whitelisted, non-secret fields;
 *  - never store API keys, Spotify tokens, cookies, full lyrics or full prompts;
 *  - the table is append-only: no DELETE/UPDATE path is exposed by the app.
 */
export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(), // 'user' | 'song' | 'translation_config'
  targetId: text('target_id').notNull(),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  reason: text('reason').notNull().default(''),
  result: text('result').notNull().default('success'), // success | failure
  occurredAt: text('occurred_at').notNull().default(sql`(datetime('now', 'localtime'))`),
}, (t) => [
  sqliteIndex('admin_audit_log_occurred_at_idx').on(t.occurredAt),
  sqliteIndex('admin_audit_log_actor_occurred_idx').on(t.actorUserId, t.occurredAt),
  sqliteIndex('admin_audit_log_target_idx').on(t.targetType, t.targetId, t.occurredAt),
]);

/** One row per track with its final outcome (idempotent by Spotify track id). */
export const playlistImportTrackResults = sqliteTable('playlist_import_track_results', {
  jobId: text('job_id').notNull().references(() => playlistImportJobs.id, { onDelete: 'cascade' }),
  spotifyTrackId: text('spotify_track_id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  status: text('status').notNull(), // imported | skipped | failed
  needsReview: integer('needs_review').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', 'localtime'))`),
}, (t) => [
  primaryKey({ columns: [t.jobId, t.spotifyTrackId] }),
]);
