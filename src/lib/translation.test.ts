import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTranslationConfig,
  isTranslationConfigured,
  translateLyricLines,
  TranslationError,
  type TranslationConfig,
} from './translation.ts';

interface CapturedCall {
  input: string | URL | Request;
  init: RequestInit;
}

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;
}

function captureFetch(fetchImpl: typeof fetch, captured: { current?: CapturedCall }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.current = { input, init: init ?? {} };
    return fetchImpl(input, init);
  }) as typeof fetch;
}

function openAIBody(captured: CapturedCall): { model: string; messages: { role: string; content: string }[] } {
  return JSON.parse(String(captured.init.body)) as { model: string; messages: { role: string; content: string }[] };
}

const CFG: TranslationConfig = {
  provider: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'test-key',
  model: 'deepseek-chat',
  targetLang: 'zh-CN',
};

test('returns null when no API key is configured', () => {
  const cfg = getTranslationConfig({});
  assert.equal(cfg, null);
  assert.equal(isTranslationConfigured(), false);
});

test('falls back to DEEPSEEK_API_KEY with openai provider defaults', () => {
  const cfg = getTranslationConfig({ DEEPSEEK_API_KEY: 'sk-fallback' });
  assert.ok(cfg);
  assert.equal(cfg!.provider, 'openai');
  assert.equal(cfg!.apiKey, 'sk-fallback');
  assert.equal(cfg!.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(cfg!.model, 'deepseek-chat');
  assert.equal(cfg!.targetLang, 'zh-CN');
});

test('honours explicit TRANSLATION_* overrides', () => {
  const cfg = getTranslationConfig({
    TRANSLATION_PROVIDER: 'openai',
    TRANSLATION_BASE_URL: 'https://custom.example/v1',
    TRANSLATION_API_KEY: 'sk-custom',
    TRANSLATION_MODEL: 'qwen-turbo',
    TRANSLATION_TARGET_LANG: 'en',
  });
  assert.ok(cfg);
  assert.equal(cfg!.baseUrl, 'https://custom.example/v1');
  assert.equal(cfg!.model, 'qwen-turbo');
  assert.equal(cfg!.targetLang, 'en');
});

test('switches to anthropic provider with its defaults', () => {
  const cfg = getTranslationConfig({ TRANSLATION_PROVIDER: 'anthropic', TRANSLATION_API_KEY: 'sk-ant' });
  assert.ok(cfg);
  assert.equal(cfg!.provider, 'anthropic');
  assert.equal(cfg!.baseUrl, 'https://api.anthropic.com');
  assert.equal(cfg!.model, 'claude-sonnet-4-5');
});

test('translates via OpenAI-compatible API and preserves line structure', async () => {
  const captured: { current?: CapturedCall } = {};
  const out = await translateLyricLines(
    ['こんにちは', '世界', ''],
    CFG,
    captureFetch(mockFetch(200, { choices: [{ message: { content: '["你好","世界",""]' } }] }), captured),
  );
  assert.deepEqual(out, ['你好', '世界', '']);
  assert.ok(captured.current);
  assert.equal(String(captured.current.input), 'https://api.deepseek.com/v1/chat/completions');
  const headers = captured.current.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
  const body = openAIBody(captured.current);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(JSON.parse(body.messages[1].content).length, 3);
});

test('falls back to newline-separated text when JSON parsing fails', async () => {
  const out = await translateLyricLines(
    ['line one', 'line two', ''],
    CFG,
    mockFetch(200, { choices: [{ message: { content: '第一行\n第二行\n' } }] }),
  );
  assert.deepEqual(out, ['第一行', '第二行', '']);
});

test('normalises mismatched response length', async () => {
  const short = await translateLyricLines(['a', 'b', 'c'], CFG, mockFetch(200, {
    choices: [{ message: { content: '["一"]' } }],
  }));
  assert.deepEqual(short, ['一', '', '']);

  const long = await translateLyricLines(['a', 'b'], CFG, mockFetch(200, {
    choices: [{ message: { content: '["一","二","三"]' } }],
  }));
  assert.deepEqual(long, ['一', '二']);
});

test('empty source lines force empty translations even when the model returns text', async () => {
  const out = await translateLyricLines(['', '歌'], CFG, mockFetch(200, {
    choices: [{ message: { content: '["空","歌曲"]' } }],
  }));
  assert.deepEqual(out, ['', '歌曲']);
});

test('throws translation_failed on non-2xx upstream status', async () => {
  await assert.rejects(
    translateLyricLines(['a'], CFG, mockFetch(429, { error: { message: 'rate limited' } })),
    (error: unknown) => error instanceof TranslationError && error.code === 'translation_failed',
  );
});

test('throws translation_invalid_response on empty model content', async () => {
  await assert.rejects(
    translateLyricLines(['a'], CFG, mockFetch(200, { choices: [{ message: { content: '' } }] })),
    (error: unknown) => error instanceof TranslationError && error.code === 'translation_invalid_response',
  );
});

test('translates via Anthropic Messages API', async () => {
  const captured: { current?: CapturedCall } = {};
  const out = await translateLyricLines(
    ['one', 'two'],
    { ...CFG, provider: 'anthropic', baseUrl: 'https://api.anthropic.com' },
    captureFetch(mockFetch(200, { content: [{ type: 'text', text: '["翻译一","翻译二"]' }] }), captured),
  );
  assert.deepEqual(out, ['翻译一', '翻译二']);
  assert.ok(captured.current);
  assert.equal(String(captured.current.input), 'https://api.anthropic.com/v1/messages');
  const headers = captured.current.init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'test-key');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(String(captured.current.init.body)) as { model: string; system: string };
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(typeof body.system, 'string');
});

test('does not duplicate /v1 when base URL already ends with it', async () => {
  const captured: { current?: CapturedCall } = {};
  await translateLyricLines(
    ['a'],
    { ...CFG, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    captureFetch(mockFetch(200, { content: [{ type: 'text', text: '[]' }] }), captured),
  );
  assert.ok(captured.current);
  assert.equal(String(captured.current.input), 'https://api.anthropic.com/v1/messages');
});
