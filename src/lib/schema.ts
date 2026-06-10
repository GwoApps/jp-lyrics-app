import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const songs = sqliteTable('songs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  artist: text('artist').notNull().default(''),
  lyricsRaw: text('lyrics_raw').notNull().default(''),
  lyricsFurigana: text('lyrics_furigana').notNull().default('[]'),
  lyricsSynced: text('lyrics_synced').notNull().default(''),
  createdBy: text('created_by').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  isPublic: integer('is_public').notNull().default(1),
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
