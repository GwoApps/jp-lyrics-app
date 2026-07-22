import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBase64Utf8 } from './lyrics-fetcher.ts';

test('decodeBase64Utf8 decodes PetitLyrics Japanese UTF-8 payloads without mojibake', () => {
  const lyrics = 'こんなだらけた暮らしで\r\n案外しあわせなの\r\nどうかしてると思わない?';
  const encoded = Buffer.from(lyrics, 'utf8').toString('base64');

  assert.equal(decodeBase64Utf8(encoded), lyrics);
});

test('decodeBase64Utf8 rejects malformed UTF-8 instead of storing replacement characters', () => {
  const invalidUtf8 = Buffer.from([0xe3, 0x28]).toString('base64');
  assert.throws(() => decodeBase64Utf8(invalidUtf8), TypeError);
});