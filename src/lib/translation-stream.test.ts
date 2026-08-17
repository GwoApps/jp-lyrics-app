import assert from 'node:assert/strict';
import test from 'node:test';
import { readTranslationStream, type TranslationProgress } from './translation-stream.ts';

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

test('readTranslationStream surfaces a unified progress payload with request + coverage', async () => {
  const progresses: TranslationProgress[] = [];
  const stream = sseBody([
    'event: progress\ndata: {"requestDone":1,"requestTotal":2,"covered":3,"coverable":10}\n\n',
    'event: progress\ndata: {"requestDone":2,"requestTotal":2,"covered":5,"coverable":10}\n\n',
    'event: done\ndata: {"start":0,"count":2,"translations":["a","b"],"lang":"zh-CN","requestDone":2,"requestTotal":2,"covered":5,"coverable":10}\n\n',
  ]);
  const result = await readTranslationStream(stream, () => {}, (p) => progresses.push(p));

  assert.deepEqual(progresses, [
    { requestDone: 1, requestTotal: 2, covered: 3, coverable: 10 },
    { requestDone: 2, requestTotal: 2, covered: 5, coverable: 10 },
  ]);
  assert.deepEqual(result.translations, ['a', 'b']);
  assert.equal(result.lang, 'zh-CN');
  assert.equal(result.error, null);
});

test('readTranslationStream parses an error event with consistent request + coverage', async () => {
  const progresses: TranslationProgress[] = [];
  const stream = sseBody([
    'event: progress\ndata: {"requestDone":1,"requestTotal":2,"covered":4,"coverable":10}\n\n',
    'event: error\ndata: {"error":"translation_cancelled","requestDone":1,"requestTotal":2,"covered":4,"coverable":10}\n\n',
  ]);
  const result = await readTranslationStream(stream, () => {}, (p) => progresses.push(p));

  assert.equal(result.error, 'translation_cancelled');
  assert.equal(result.translations, null);
  // The error carries the same full-song coverage the client should show.
  assert.deepEqual(result.progress, { requestDone: 1, requestTotal: 2, covered: 4, coverable: 10 });
});

test('readTranslationStream falls back to legacy done/total fields', async () => {
  const progresses: TranslationProgress[] = [];
  const stream = sseBody([
    'event: progress\ndata: {"done":1,"total":2}\n\n',
    'event: error\ndata: {"error":"translation_failed","done":1,"total":2}\n\n',
  ]);
  const result = await readTranslationStream(stream, () => {}, (p) => progresses.push(p));

  // Legacy servers only know request progress; coverage is conservatively the
  // same scale so the client never shows a mixed/guessed denominator.
  assert.deepEqual(progresses[0], { requestDone: 1, requestTotal: 2, covered: 1, coverable: 2 });
  assert.deepEqual(result.progress, { requestDone: 1, requestTotal: 2, covered: 1, coverable: 2 });
});

test('readTranslationStream splits events split across chunks', async () => {
  const progresses: TranslationProgress[] = [];
  // The progress event is split in the middle of its JSON.
  const stream = sseBody([
    'event: progress\ndata: {"requestDone":1,"req',
    'uestTotal":2,"covered":3,"coverable":10}\n\nevent: done\ndata: {"translations":["x"],"requestDone":1,"requestTotal":2,"covered":3,"coverable":10}\n\n',
  ]);
  const result = await readTranslationStream(stream, () => {}, (p) => progresses.push(p));
  assert.deepEqual(progresses, [{ requestDone: 1, requestTotal: 2, covered: 3, coverable: 10 }]);
  assert.deepEqual(result.translations, ['x']);
});
