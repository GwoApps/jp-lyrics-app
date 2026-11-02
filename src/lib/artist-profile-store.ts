import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';
import type { ArtistProfileOverride } from './artist-profile-types.ts';
import { artistOverrideKey, ArtistProfileError, MAX_ARTIST_PROFILE_BYTES, validateArtistProfileOverride } from './artist-profile-validation.ts';

type ProfileDB = Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'select' | 'insert' | 'delete'>;

/** One global settings row per canonical artist, avoiding whole-map lost updates. */
export async function getArtistProfileOverride(db: ProfileDB, name: string): Promise<ArtistProfileOverride | null> {
  const key = artistOverrideKey(name);
  const row = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (!row) return null;
  try {
    if (new TextEncoder().encode(row.value).byteLength > MAX_ARTIST_PROFILE_BYTES) throw new Error('oversized');
    return validateArtistProfileOverride(JSON.parse(row.value));
  } catch {
    // Existing but untrustworthy identity is NOT absence: public resolution must
    // fail neutral rather than name-search a possibly unrelated artist.
    throw new ArtistProfileError('artist_profile_load_failed', 500);
  }
}

export async function setArtistProfileOverride(db: ProfileDB, name: string, input: ArtistProfileOverride, now = new Date()): Promise<ArtistProfileOverride> {
  const key = artistOverrideKey(name);
  const override = { ...validateArtistProfileOverride(input), updatedAt: now.toISOString() };
  const value = JSON.stringify(override);
  // Validate after stamping as well, so even boundary-size records remain bounded.
  validateArtistProfileOverride(override);
  // RETURNING is persistence proof from this same atomic statement on libSQL
  // and D1. Concurrent replacements are last-commit-wins, but each caller gets
  // its own written row, not a later writer's value from a separate SELECT.
  const stored = await db.insert(schema.settings).values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .returning({ value: schema.settings.value }).get();
  if (!stored || stored.value !== value) throw new Error('artist_profile_save_failed');
  return validateArtistProfileOverride(JSON.parse(stored.value));
}

export async function deleteArtistProfileOverride(db: ProfileDB, name: string): Promise<void> {
  const key = artistOverrideKey(name);
  // Success is absence at this statement's commit (including an already absent
  // row), not a promise that another writer cannot subsequently recreate it.
  await db.delete(schema.settings).where(eq(schema.settings.key, key))
    .returning({ key: schema.settings.key }).all();
}
