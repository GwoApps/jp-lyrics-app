import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtistProfileError, artistOverrideKey, readArtistJson, safeArtistUrl, validateArtistProfileOverride, validArtistSourceId } from './artist-profile-validation.ts';

const MB = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3';
const SP = '1dfeR4HaWDbWqFHLkxsg1d';
test('override accepts four locales, explicit nullable fields and empty lists, without coercion', () => {
  const input = { descriptions: { 'zh-CN': '中文', 'zh-TW': '繁體', en: '', ja: '日本語' }, imageUrl: null, aliases: [], kind: null, country: null, genres: [], spotifyArtistId: null };
  assert.deepEqual(validateArtistProfileOverride(input), input);
  assert.deepEqual(validateArtistProfileOverride({ aliases: [' A ', 'A'] }), { aliases: ['A'] });
  assert.equal(artistOverrideKey(' Queen '), artistOverrideKey('QUEEN'));
  assert.equal(artistOverrideKey('東京/事変 & 100%?'), 'artist_profile:東京/事変 & 100%?');
});
for (const [label, input] of Object.entries({
  null: null, array: [], unknown: { extra: true }, nestedUnknown: { descriptions: { fr: 'oui' } },
  nestedNull: { descriptions: { en: null } }, tooLong: { descriptions: { en: 'x'.repeat(4001) } },
  tooMany: { aliases: Array.from({ length: 51 }, () => 'A') }, badItem: { genres: [1] },
  emptyItem: { aliases: [' '] }, badKind: { kind: ['person'] }, badCountry: { country: 'ZZ' },
  lowerCountry: { country: 'jp' }, badDate: { updatedAt: '2026' }, unsafeImage: { imageUrl: 'http://example.com/x' },
  unsafeSource: { sourceUrl: 'https://127.0.0.1/x' }, badLink: { links: { spotify: 'https://open.spotify.com/track/'+SP } },
  unknownLink: { links: { wikidata: 'https://www.wikidata.org/wiki/Q1' } }, textControl: { descriptions: { en: '\u0000' } },
  byteLimit: { descriptions: { en: '文'.repeat(4000), ja: '文'.repeat(4000), 'zh-CN': '文'.repeat(4000) } },
})) test(`invalid override fixture: ${label}`, () => assert.throws(() => validateArtistProfileOverride(input), /artist_profile_invalid_override/));

test('stable IDs are literal, exact syntax only; no repair or URL extraction', () => {
  assert.ok(validArtistSourceId('musicbrainz', MB)); assert.ok(validArtistSourceId('spotify', SP)); assert.ok(validArtistSourceId('wikidata', 'Q15862'));
  for (const id of [' '+MB, MB+' ', 'https://musicbrainz.org/artist/'+MB, MB+'?x=1']) assert.equal(validArtistSourceId('musicbrainz', id), false);
  for (const id of ['q1', 'Q0', 'Q01', 'Q1/../Q2', 'Q1%3f']) assert.equal(validArtistSourceId('wikidata', id), false);
  assert.equal(validArtistSourceId('spotify', SP.slice(1)), false);
});
test('URLs reject private IPs, deceptive origins, credentials, redirects supplied as IDs and unsafe protocols', () => {
  for (const url of ['http://example.com', 'javascript:alert(1)', 'data:image/png;a', '//example.com', 'https://127.0.0.1', 'https://[::1]/', 'https://2130706433/', 'https://0x7f000001/', 'https://a.local', 'https://a.internal', 'https://localhost', 'https://u:p@example.com', 'https://example.com:8888', 'https://example.com\\@localhost/', 'https://example.com/\n']) assert.equal(safeArtistUrl(url), null, url);
  assert.equal(safeArtistUrl('https://open.spotify.com.evil.com/artist/'+SP, 'spotify'), null);
  assert.equal(safeArtistUrl('https://youtube.com/watch?v=abc', 'youtube'), null);
  assert.equal(safeArtistUrl('https://open.spotify.com/artist/'+SP, 'spotify'), 'https://open.spotify.com/artist/'+SP);
  assert.ok(safeArtistUrl('https://www.youtube.com/@queen', 'youtube'));
  assert.ok(safeArtistUrl('https://queenonline.com/about'));
});
test('artist names must be nonempty, bounded, and control-free', () => {
  for (const name of ['', ' ', 'x'.repeat(301), 'a\u0000b']) assert.throws(() => artistOverrideKey(name), /artist_profile_invalid_name/);
});
test('JSON request reading bounds declared size, chunked size, UTF-8, malformed JSON and deadline', async () => {
  const error = (e: unknown) => e instanceof ArtistProfileError && e.message === 'bad_body';
  assert.deepEqual(await readArtistJson(new Response('{"a":1}'), 10, 'bad_body'), { a: 1 });
  await assert.rejects(readArtistJson(new Response('{}', { headers: { 'Content-Length': '100' } }), 10, 'bad_body'), error);
  await assert.rejects(readArtistJson(new Response('x'.repeat(11)), 10, 'bad_body'), error);
  await assert.rejects(readArtistJson(new Response('{'), 10, 'bad_body'), error);
  await assert.rejects(readArtistJson(new Response(new Uint8Array([255])), 10, 'bad_body'), error);
  let canceled = false;
  const stream = new ReadableStream({ cancel() { canceled = true; } });
  await assert.rejects(readArtistJson(new Response(stream), 10, 'bad_body', 5), error);
  assert.equal(canceled, true);
});
