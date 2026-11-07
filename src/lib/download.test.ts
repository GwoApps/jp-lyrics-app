import assert from 'node:assert/strict';
import test from 'node:test';
import { exportFilename, filenameFromContentDisposition } from './download.ts';

test('filenameFromContentDisposition prefers RFC 5987 filename*', () => {
  const header = `attachment; filename="download.txt"; filename*=UTF-8''${encodeURIComponent('残酷な天使のテーゼ - 高橋洋子')}.txt`;
  assert.equal(filenameFromContentDisposition(header), '残酷な天使のテーゼ - 高橋洋子.txt');
});

test('filenameFromContentDisposition falls back to the ASCII filename', () => {
  assert.equal(filenameFromContentDisposition('attachment; filename="my song.lrc"'), 'my song.lrc');
});

test('filenameFromContentDisposition tolerates malformed encoding and empty headers', () => {
  assert.equal(filenameFromContentDisposition(`attachment; filename*=UTF-8''%E0%A4%A`), undefined);
  assert.equal(filenameFromContentDisposition(null), undefined);
  assert.equal(filenameFromContentDisposition(''), undefined);
});

test('exportFilename uses the Content-Disposition name when it is meaningful', () => {
  assert.equal(
    exportFilename('attachment; filename*=UTF-8\'\'song.lrc', 'text/plain; charset=utf-8', 'Title', 'Artist', 'lrc'),
    'song.lrc',
  );
});

test('exportFilename ignores the generic download.<ext> header placeholder', () => {
  const header = `attachment; filename="download.txt"; filename*=UTF-8''download.txt`;
  assert.equal(
    exportFilename(header, 'text/plain; charset=utf-8', '残酷な天使のテーゼ', '高橋洋子', 'text'),
    '残酷な天使のテーゼ - 高橋洋子.txt',
  );
});

test('exportFilename prefers the client-provided name over Content-Disposition', () => {
  assert.equal(
    exportFilename(`attachment; filename*=UTF-8''header.txt`, 'text/plain', 'Title', 'Artist', 'text', 'server.txt'),
    'server.txt',
  );
  // The generic `download.<ext>` placeholder never wins over the song name.
  assert.equal(
    exportFilename(null, 'text/plain', 'Title', 'Artist', 'text', 'download.txt'),
    'Title - Artist.txt',
  );
});

test('exportFilename omits the artist when absent and maps html content type', () => {
  assert.equal(exportFilename(null, 'text/html; charset=utf-8', 'Only Title', null, 'html'), 'Only Title.html');
  assert.equal(exportFilename(null, null, 'Only Title', '', 'lrc'), 'Only Title.lrc');
  assert.equal(exportFilename(null, null, '   ', undefined, 'text'), 'lyrics.txt');
});
