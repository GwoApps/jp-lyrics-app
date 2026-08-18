import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTranslationConfig,
  isTranslationConfigured,
  translateLyricLines,
  TranslationError,
  type TranslationConfig,
} from './translation/index.ts';
import { DEFAULT_SYSTEM_PROMPT, renderSystemPrompt, SYSTEM_PROMPT } from './translation/prompts.ts';

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

function openAIBody(captured: CapturedCall): { model: string; reasoning_effort?: string; messages: { role: string; content: string }[] } {
  return JSON.parse(String(captured.init.body)) as { model: string; reasoning_effort?: string; messages: { role: string; content: string }[] };
}

const CFG: TranslationConfig = {
  provider: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'test-key',
  model: 'deepseek-v4-flash',
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
  assert.equal(cfg!.model, 'deepseek-v4-flash');
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
  assert.equal(body.model, 'deepseek-v4-flash');
  assert.equal(JSON.parse(body.messages[1].content).length, 3);
});

test('slice requests embed full-song context but keep the target list as the parseable payload', async () => {
  const captured: { current?: CapturedCall } = {};
  // Translate a single line (line 4, absolute index 3) of a longer song with
  // slice context attached — the model must still see the surrounding lyrics.
  const out = await translateLyricLines(
    ['そのまま'],
    CFG,
    captureFetch(mockFetch(200, { choices: [{ message: { content: '["就这样"]' } }] }), captured),
    {
      title: '夜',
      artist: 'AAA',
      fullLyrics: ['風が', '吹いて', '君の', 'そのまま', '君の', '声を'],
      targetIndices: [3],
    },
  );
  assert.deepEqual(out, ['就这样']);
  assert.ok(captured.current);
  const body = openAIBody(captured.current);
  const user = body.messages[1].content;
  // The full song is embedded as reference context…
  assert.match(user, /FULL SONG \(context only\)/);
  assert.match(user, /風が/);
  assert.match(user, /君の/);
  // …while the TARGET list stays the exact payload, so line alignment holds.
  assert.match(user, /TARGET LINES TO TRANSLATE/);
  const target = user.slice(user.indexOf('TARGET LINES TO TRANSLATE'));
  assert.deepEqual(JSON.parse(target.slice(target.indexOf('['))), ['そのまま']);
  // Explicitly instruct the model to only translate the targets.
  assert.match(user, /Translate ONLY the TARGET lines/);
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
  assert.equal(body.model, 'deepseek-v4-flash');
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

test('default system prompt keeps rhetoric conditional and carries a good/bad few-shot pair', () => {
  const rendered = SYSTEM_PROMPT('zh-CN');
  // Rhetoric must be conditional: preserve only when the original uses it.
  assert.match(rendered, /ONLY when the original line itself uses it/);
  assert.match(rendered, /never force it at the expense of meaning/);
  // Few-shot good/bad pair anchors what "faithful and natural" means.
  assert.match(rendered, /Quality reference/);
  assert.match(rendered, /BAD:/);
  assert.match(rendered, /GOOD:/);
  // Placeholders are filled — no raw braces left behind.
  assert.ok(!rendered.includes('{{'));
});

test('few-shot quality example follows the target language (en / zh-TW / ja)', () => {
  const en = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, 'en');
  assert.match(en, /Japanese → English lyric line/);
  assert.match(en, /GOOD: If my voice could reach you before the tears fall/);
  // English example must not leak the Chinese renderings.
  assert.ok(!en.includes('泪落之前'));
  assert.ok(!en.includes('若在泪水落下前'));

  const tw = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, 'zh-TW');
  assert.match(tw, /Japanese → Traditional Chinese lyric line/);
  assert.match(tw, /若在淚水落下前，這聲音能傳到你身邊/);
  assert.ok(!tw.includes('泪落之前'), 'zh-TW must not use simplified zh example');

  const ja = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, 'ja');
  assert.match(ja, /Japanese → Japanese lyric line/);
  assert.match(ja, /GOOD: 涙が落ちる前に、この声が届くなら/);
  assert.ok(!ja.includes('泪落之前'), 'ja must not use zh example');

  // Any other BCP-47 prefix falls back to the default Simplified Chinese example.
  const kr = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, 'ko');
  assert.match(kr, /Japanese → Simplified Chinese lyric line/);
  assert.match(kr, /若在泪水落下前，这声音能传到你身边/);
});

test('few-shot selection is unaffected by song context and glossary injection', () => {
  const rendered = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, 'en', {
    title: '花火',
    artist: 'AAA',
    glossary: [{ original: '花火', translation: 'Fireworks' }],
  });
  // Target-language example still selected…
  assert.match(rendered, /Japanese → English lyric line/);
  assert.match(rendered, /If my voice could reach you before the tears fall/);
  // …while context and glossary are injected normally.
  assert.match(rendered, /title: "花火", artist: "AAA"/);
  assert.match(rendered, /花火 → Fireworks/);
  assert.ok(!rendered.includes('{{'));
});

test('renderSystemPrompt fills song context and glossary placeholders', () => {
  const rendered = renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, 'zh-CN', {
    title: '花火',
    artist: 'AAA',
    glossary: [{ original: '花火', translation: '烟花' }],
  });
  assert.match(rendered, /title: "花火", artist: "AAA"/);
  assert.match(rendered, /花火 → 烟花/);
  assert.ok(!rendered.includes('{{'));
});

test('admin-overridden system prompt replaces the default template', async () => {
  const captured: { current?: CapturedCall } = {};
  const custom = 'Translate like a poet. Target: {{targetLang}}';
  await translateLyricLines(
    ['a'],
    { ...CFG, systemPrompt: custom },
    captureFetch(mockFetch(200, { choices: [{ message: { content: '["译"]' } }] }), captured),
  );
  assert.ok(captured.current);
  const body = openAIBody(captured.current);
  const system = body.messages[0].content;
  assert.match(system, /Translate like a poet/);
  assert.match(system, /Target: zh-CN/);
  assert.ok(!system.includes('{{'));
});

test('OpenAI payload requests low reasoning effort', async () => {
  const captured: { current?: CapturedCall } = {};
  await translateLyricLines(
    ['a'],
    CFG,
    captureFetch(mockFetch(200, { choices: [{ message: { content: '["译"]' } }] }), captured),
  );
  assert.ok(captured.current);
  const body = openAIBody(captured.current);
  assert.equal(body.reasoning_effort, 'low');
});

test('glossary extraction returns an array on success (possibly empty = genuinely no terms)', async () => {
  const { extractLyricsGlossary } = await import('./translation/index.ts');
  const found = await extractLyricsGlossary('花火', 'AAA', ['花火'], CFG, mockFetch(200, {
    choices: [{ message: { content: '[{"original":"花火","translation":"烟花"}]' } }],
  }));
  assert.deepEqual(found, [{ original: '花火', translation: '烟花' }]);

  const none = await extractLyricsGlossary('花火', 'AAA', ['花火'], CFG, mockFetch(200, {
    choices: [{ message: { content: '[]' } }],
  }));
  assert.deepEqual(none, []); // empty array: extraction succeeded, no terms
});

test('glossary extraction returns null on upstream failure so callers retry instead of pinning empty', async () => {
  const { extractLyricsGlossary } = await import('./translation/index.ts');
  // 5xx upstream → null (never retried internally once RETRY_ATTEMPTS exhausted).
  const failed = await extractLyricsGlossary('花火', 'AAA', ['花火'], CFG, mockFetch(503, { error: 'boom' }));
  assert.equal(failed, null);
});

test('glossary extraction returns null on a malformed (non-array) response', async () => {
  const { extractLyricsGlossary } = await import('./translation/index.ts');
  const malformed = await extractLyricsGlossary('花火', 'AAA', ['花火'], CFG, mockFetch(200, {
    choices: [{ message: { content: 'no json array here' } }],
  }));
  assert.equal(malformed, null);
});

test('streaming translation aborts the upstream fetch when the external signal fires', async () => {
  const { streamTranslateLyricLines } = await import('./translation/index.ts');
  const controller = new AbortController();
  let signalSeen: AbortSignal | undefined;
  let resolveIssued: () => void;
  const issued = new Promise<void>((resolve) => { resolveIssued = resolve; });
  const streamFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    signalSeen = init?.signal as AbortSignal | undefined;
    resolveIssued();
    // Simulate an upstream that keeps streaming until aborted.
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        const encoder = new TextEncoder();
        const push = () => {
          if (init?.signal?.aborted) {
            streamController.error(new DOMException('aborted', 'AbortError'));
            return;
          }
          streamController.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"[\"译\"]"}}]}\n\n`));
          setTimeout(push, 5);
        };
        push();
      },
      cancel() { /* upstream cancelled */ },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;

  const run = streamTranslateLyricLines(['a'], CFG, () => {}, streamFetch, undefined, controller.signal);
  await issued; // upstream request is in flight
  assert.ok(signalSeen, 'upstream fetch received a signal');
  assert.ok(!signalSeen!.aborted, 'upstream not aborted yet');
  controller.abort(); // client cancels → the fetch's signal must abort
  await assert.rejects(run, (error: unknown) => error instanceof Error);
  assert.ok(signalSeen!.aborted, 'upstream fetch signal aborted after cancel');
});

test('discovers and sorts models from an OpenAI-compatible /models endpoint', async () => {
  const { discoverTranslationModels } = await import('./translation/index.ts');
  const captured: { current?: CapturedCall } = {};
  const models = await discoverTranslationModels(
    { ...CFG, baseUrl: 'https://api.deepseek.com/v1' },
    captureFetch(mockFetch(200, { data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] }), captured),
  );
  assert.deepEqual(models, ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash']);
  assert.ok(captured.current);
  assert.equal(String(captured.current.input), 'https://api.deepseek.com/v1/models');
  const headers = captured.current.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
});

test('discovers Anthropic models via /v1/models without duplicating /v1', async () => {
  const { discoverTranslationModels } = await import('./translation/index.ts');
  const captured: { current?: CapturedCall } = {};
  const models = await discoverTranslationModels(
    { ...CFG, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    captureFetch(mockFetch(200, { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }] }), captured),
  );
  assert.deepEqual(models, ['claude-opus-4-1', 'claude-sonnet-4-5']);
  assert.ok(captured.current);
  assert.equal(String(captured.current.input), 'https://api.anthropic.com/v1/models');
  const headers = captured.current.init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'test-key');
  assert.equal(headers['anthropic-version'], '2023-06-01');
});

test('model discovery returns null on non-2xx or malformed data', async () => {
  const { discoverTranslationModels } = await import('./translation/index.ts');
  // Non-2xx response.
  assert.equal(
    await discoverTranslationModels(CFG, mockFetch(401, { error: 'bad key' })),
    null,
  );
  // Malformed body (no data array).
  assert.equal(
    await discoverTranslationModels(CFG, mockFetch(200, { nope: true })),
    null,
  );
});

test('workers-ai model discovery returns the curated static catalog', async () => {
  const { discoverTranslationModels, WORKERS_AI_MODELS } = await import('./translation/index.ts');
  const models = await discoverTranslationModels({ ...CFG, provider: 'workers-ai' });
  assert.ok(models, 'workers-ai must have a discoverable catalog');
  assert.equal(models!.length, WORKERS_AI_MODELS.length);
  assert.deepEqual(models, [...WORKERS_AI_MODELS].sort());
  // Catalog only contains @cf/ binding-backed text-generation models.
  for (const id of models!) {
    assert.ok(id.startsWith('@cf/'), `unexpected non-binding id: ${id}`);
  }
  assert.ok(!models!.some((id) => id.includes('lora') || id.includes('whisper') || id.includes('flux')), 'no LoRA/ASR/image models leaked in');
});
