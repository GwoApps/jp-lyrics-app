import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinkcoreLyricsFromHtml, isLinkcoreLyricsUrl } from './linkcore-lyrics.ts';

const page = `
  <section><div class="lyric_text">
    <p>First &amp; second</p><p></p><p>♪ &#x266A;</p>
  </div></section>
`;

test('accepts only HTTPS Linkcore song lyrics pages', () => {
  assert.equal(isLinkcoreLyricsUrl('https://linkco.re/HAfSh9ET/songs/2701676/lyrics'), true);
  assert.equal(isLinkcoreLyricsUrl('https://linkco.re/HAfSh9ET/songs/2701676/lyrics/'), true);
  assert.equal(isLinkcoreLyricsUrl('http://linkco.re/HAfSh9ET/songs/2701676/lyrics'), false);
  assert.equal(isLinkcoreLyricsUrl('https://evil.example/HAfSh9ET/songs/2701676/lyrics'), false);
  assert.equal(isLinkcoreLyricsUrl('https://linkco.re/HAfSh9ET'), false);
});

test('extracts Linkcore lyric paragraphs and decodes entities', () => {
  assert.equal(extractLinkcoreLyricsFromHtml(page), 'First & second\n\n♪ ♪');
  assert.equal(extractLinkcoreLyricsFromHtml('<div class="other">none</div>'), '');
});
