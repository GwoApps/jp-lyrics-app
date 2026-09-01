import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, apiRequest, jsonRequest } from './request.ts';

test('apiRequest returns parsed JSON for a successful response', async () => {
  const result = await apiRequest<{ ok: boolean }>('/test', {}, async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  assert.deepEqual(result, { ok: true });
});

test('apiRequest throws ApiError with a language-neutral server code', async () => {
  await assert.rejects(
    apiRequest('/test', {}, async () =>
      new Response(JSON.stringify({ error: 'invalid_provider' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'invalid_provider');
      return true;
    },
  );
});

test('jsonRequest sets JSON headers and serializes its body', async () => {
  let captured: RequestInit | undefined;
  const result = await jsonRequest<{ saved: boolean }>('/test', {
    method: 'PUT',
    body: { enabled: true },
  }, async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ saved: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.equal(new Headers(captured?.headers).get('Content-Type'), 'application/json');
  assert.equal(captured?.body, JSON.stringify({ enabled: true }));
  assert.deepEqual(result, { saved: true });
});

test('apiRequest rejects malformed successful JSON responses', async () => {
  await assert.rejects(
    apiRequest('/test', {}, async () => new Response('{broken', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 200);
      assert.equal(error.code, 'invalid_response');
      return true;
    },
  );
});

test('apiRequest accepts an empty 204 response', async () => {
  assert.equal(await apiRequest('/test', {}, async () => new Response(null, { status: 204 })), undefined);
});
