import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBase64Utf8, parsePetitLyricsResponse, petitLyricsXmlToLrc, unescapeLyrics } from './lyrics-fetcher.ts';

test('decodeBase64Utf8 decodes PetitLyrics Japanese UTF-8 payloads without mojibake', () => {
  const lyrics = 'こんなだらけた暮らしで\r\n案外しあわせなの\r\nどうかしてると思わない?';
  const encoded = Buffer.from(lyrics, 'utf8').toString('base64');

  assert.equal(decodeBase64Utf8(encoded), lyrics);
});

test('decodeBase64Utf8 rejects malformed UTF-8 instead of storing replacement characters', () => {
  const invalidUtf8 = Buffer.from([0xe3, 0x28]).toString('base64');
  assert.throws(() => decodeBase64Utf8(invalidUtf8), TypeError);
});

test('unescapeLyrics decodes named, decimal, and hexadecimal HTML entities', () => {
  assert.equal(unescapeLyrics('Tom &amp; Jerry &#39;A&#39; &#x266A; &quot;歌&quot;'), "Tom & Jerry 'A' ♪ \"歌\"");
});

test('parses PetitLyrics candidate metadata and converts its WYSIWYG timing to line LRC', () => {
  const timingXml = '<wsy><line><linestring>第一行</linestring><word><starttime>1470</starttime><wordstring>第一行</wordstring></word></line></wsy>';
  const response = `<response><song><title>テスト曲</title><artist>歌手 A</artist><lyricsType>3</lyricsType><lyricsData>${Buffer.from(timingXml, 'utf8').toString('base64')}</lyricsData></song></response>`;
  const candidate = parsePetitLyricsResponse(response, 3);
  assert.deepEqual(candidate, { type: 3, data: timingXml, title: 'テスト曲', artist: '歌手 A' });
  assert.equal(petitLyricsXmlToLrc(candidate!.data), '[00:01.47]第一行');
});