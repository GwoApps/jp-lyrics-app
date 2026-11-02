import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArtistProfilePayload, profileDraftFromOverride, resolveArtistDescription, safeArtistExternalHref, sameProfileRecord } from './profile-presentation.ts';

test('empty form inherits automatic metadata and localized biography is selected without inventing translation', () => {
  const draft = profileDraftFromOverride(null);
  assert.deepEqual(buildArtistProfilePayload(draft), { override: {}, confirmIdentity: false });
  assert.deepEqual(resolveArtistDescription({ description: null, descriptions: { en: 'Verified English biography' } }, 'zh-CN'), { text: 'Verified English biography', language: 'en' });
  assert.deepEqual(resolveArtistDescription({ description: 'Legacy text' }, 'ja'), { text: 'Legacy text', language: null });
  assert.deepEqual(resolveArtistDescription({ descriptions: { 'zh-CN': '已核对的简介', en: 'English biography' } }, 'zh-TW'), { text: '已核对的简介', language: 'zh-CN' });
});

test('manual fields preserve aliases containing commas, validate HTTPS and do not guess artist IDs', () => {
  const draft = profileDraftFromOverride(null);
  draft.aliases = ' A, B \nA, B\n別名'; draft.country = 'JP'; draft.kind = 'person';
  draft.descriptions.ja = ' 確認済みの紹介 '; draft.links.website = 'https://example.com/artist';
  const result = buildArtistProfilePayload(draft);
  assert.ok(!('error' in result));
  assert.deepEqual(result.override.aliases, ['A, B', '別名']);
  assert.deepEqual(result.override.descriptions, { ja: '確認済みの紹介' });
  assert.equal(result.override.country, 'JP');
  draft.spotifyArtistId = 'not-an-id';
  assert.deepEqual(buildArtistProfilePayload(draft), { error: 'invalidSpotifyId' });
  draft.spotifyArtistId = '1234567890123456789012';
  assert.deepEqual(buildArtistProfilePayload(draft), { error: 'confirmIdentityRequired' });
  draft.confirmIdentity = true;
  assert.ok(!('error' in buildArtistProfilePayload(draft)));
});

test('unsafe links, malformed entity identifiers and overlong biography never become write payloads', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://127.0.0.1/private', 'https://[::1]/', 'https://localhost/a']) assert.equal(safeArtistExternalHref(url), undefined);
  assert.equal(safeArtistExternalHref('https://open.spotify.com/artist/123'), 'https://open.spotify.com/artist/123');
  const draft = profileDraftFromOverride(null);
  draft.wikidataId = 'q123';
  assert.deepEqual(buildArtistProfilePayload(draft), { error: 'invalidWikidataId' });
  draft.wikidataId = ''; draft.musicbrainzId = 'incomplete';
  assert.deepEqual(buildArtistProfilePayload(draft), { error: 'invalidMusicBrainzId' });
  draft.musicbrainzId = ''; draft.descriptions.en = 'a'.repeat(6001);
  assert.deepEqual(buildArtistProfilePayload(draft), { error: 'textTooLong' });
});

test('replacement writes preserve explicit clears and permit restoring inheritance independently', () => {
  const stored = { imageUrl: null, aliases: [], genres: [], kind: null, country: null, spotifyArtistId: null, sourceUrl: null, descriptions: { en: '' } };
  const draft = profileDraftFromOverride(stored);
  assert.deepEqual(buildArtistProfilePayload(draft), { override: stored, confirmIdentity: false });
  draft.descriptions.ja = '新しい紹介';
  const changed = buildArtistProfilePayload(draft);
  assert.ok(!('error' in changed));
  assert.equal(changed.override.imageUrl, null);
  assert.deepEqual(changed.override.descriptions, { en: '', ja: '新しい紹介' });
  draft.explicitClears = draft.explicitClears.filter((field) => field !== 'imageUrl');
  const inherited = buildArtistProfilePayload(draft);
  assert.ok(!('error' in inherited));
  assert.equal(Object.hasOwn(inherited.override, 'imageUrl'), false);
  assert.deepEqual(resolveArtistDescription({ description: 'Automatic English', descriptions: { en: '', ja: '日本語' } }, 'en'), { text: '', language: 'en' });
});

test('readback equality ignores object-key ordering but detects missing or changed saved fields', () => {
  assert.equal(sameProfileRecord({ aliases: ['A'], links: { website: 'https://example.com' } }, { links: { website: 'https://example.com' }, aliases: ['A'] }), true);
  assert.equal(sameProfileRecord({ aliases: ['A'] }, { aliases: ['B'] }), false);
  assert.equal(sameProfileRecord({ country: 'JP' }, {}), false);
});
