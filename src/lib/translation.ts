/**
 * Server-side lyric translation service.
 *
 * Provider-agnostic: works with any OpenAI-compatible chat-completions API
 * (DeepSeek, OpenAI, Qwen, local vLLM, ...), the Anthropic Messages API,
 * or the Cloudflare Workers AI binding (no API key needed).
 *
 * Features:
 * - Optional terminology extraction (glossary) for consistent proper-noun
 *   translations across batches, plus song title/artist context.
 * - Automatic retry with exponential backoff for transient failures
 *   (network errors, 5xx, provider 429). Quota errors are never retried.
 * - JSON-array-first response parsing with a newline fallback and strict
 *   line-count normalization.
 *
 * Environment variables:
 *   TRANSLATION_PROVIDER  'openai' | 'anthropic' | 'workers-ai'  (default: openai)
 *   TRANSLATION_BASE_URL  base URL without the path suffix   (default: DeepSeek / Anthropic)
 *   TRANSLATION_API_KEY   API key                            (fallback: DEEPSEEK_API_KEY)
 *   TRANSLATION_MODEL     model name                         (defaults per provider)
 *   TRANSLATION_TARGET_LANG  target language for lyrics      (default: zh-CN)
 *
 * The workers-ai provider uses the Worker's AI binding (wrangler `ai`
 * config, env.AI) via the Workers AI SDK — perfect for Cloudflare
 * deployments: free tier, no key management. The wrangler.jsonc in this
 * repo sets TRANSLATION_PROVIDER=workers-ai for CF deploys, so the
 * default model there is Gemini 3.6 Flash.
 */

export type TranslationProvider = 'openai' | 'anthropic' | 'workers-ai';

export interface GlossaryEntry {
  original: string;
  translation: string;
}

/** Per-request translation context: song identity + terminology table. */
export interface TranslationContext {
  title?: string;
  artist?: string;
  glossary?: GlossaryEntry[];
}

export interface TranslationConfig {
  provider: TranslationProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLang: string;
}

export class TranslationError extends Error {
  code: 'translation_failed' | 'translation_invalid_response' | 'ai_quota_exceeded';
  /** True when retrying might help (5xx / provider 429 / network). */
  retryable: boolean;

  constructor(code: 'translation_failed' | 'translation_invalid_response' | 'ai_quota_exceeded', message: string, retryable = false) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.retryable = retryable;
  }
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_OPENAI_MODEL = 'deepseek-v4-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const DEFAULT_WORKERS_AI_MODEL = '@cf/google/gemini-3.6-flash';

/** Attempts and backoff for transient failures (1s, 2s). */
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface TranslationTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

/**
 * Minimal connectivity check against the configured provider: send a tiny
 * request and report status + latency. Used by the admin "Test" button.
 */
export async function testTranslationConnection(config: TranslationConfig): Promise<TranslationTestResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    if (config.provider === 'workers-ai') {
      const ai = await getWorkersAiBinding();
      if (!ai) {
        return { ok: false, latencyMs: Date.now() - t0, message: 'Workers AI binding unavailable (deploy on Cloudflare)' };
      }
      const data = await ai.run(config.model, {
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 16,
      });
      return { ok: true, latencyMs: Date.now() - t0, message: data?.response?.slice(0, 100) ?? '' };
    }
    if (config.provider === 'anthropic') {
      const base = config.baseUrl.replace(/\/+$/, '');
      const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }),
        signal: controller.signal,
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - t0, message: `HTTP ${res.status} ${text.slice(0, 200)}` };
      }
      const data = JSON.parse(text) as { content?: { type?: string; text?: string }[] };
      return { ok: true, latencyMs: Date.now() - t0, message: data.content?.[0]?.text?.slice(0, 100) ?? '' };
    }

    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, latencyMs: Date.now() - t0, message: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    return { ok: true, latencyMs: Date.now() - t0, message: data.choices?.[0]?.message?.content?.slice(0, 100) ?? '' };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - t0, message: error instanceof Error ? error.message : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

export function getTranslationConfig(env: Record<string, string | undefined> = process.env): TranslationConfig | null {
  const provider: TranslationProvider = env.TRANSLATION_PROVIDER === 'anthropic'
    ? 'anthropic'
    : env.TRANSLATION_PROVIDER === 'workers-ai'
      ? 'workers-ai'
      : 'openai';
  // workers-ai authenticates via the Worker's AI binding — no key required.
  const apiKey = provider === 'workers-ai'
    ? ''
    : env.TRANSLATION_API_KEY || env.DEEPSEEK_API_KEY || '';
  if (!apiKey && provider !== 'workers-ai') return null;
  const defaultModel = provider === 'anthropic'
    ? DEFAULT_ANTHROPIC_MODEL
    : provider === 'workers-ai'
      ? DEFAULT_WORKERS_AI_MODEL
      : DEFAULT_OPENAI_MODEL;
  const defaultBaseUrl = provider === 'anthropic'
    ? DEFAULT_ANTHROPIC_BASE_URL
    : DEFAULT_OPENAI_BASE_URL;
  return {
    provider,
    baseUrl: env.TRANSLATION_BASE_URL || defaultBaseUrl,
    apiKey,
    model: env.TRANSLATION_MODEL || defaultModel,
    targetLang: env.TRANSLATION_TARGET_LANG || 'zh-CN',
  };
}

export function isTranslationConfigured(): boolean {
  return getTranslationConfig() !== null;
}

const SYSTEM_PROMPT = (targetLang: string, ctx?: TranslationContext) => {
  const parts = [
    `You are a professional song-lyrics translator. Translate the given lyrics into ${targetLang}.`,
    'Rules:',
    '- Translate every non-empty line faithfully but naturally; keep meaning, mood, and line structure.',
    '- Keep the number of output entries EXACTLY equal to the number of input lines.',
    '- For an empty input line, output an empty string.',
    '- Do not add explanations, headers, or timestamps.',
    '- Respond with ONLY a JSON array of strings.',
  ];
  if (ctx?.title || ctx?.artist) {
    parts.push(`Song context — title: "${ctx.title ?? ''}", artist: "${ctx.artist ?? ''}". Use these consistently whenever they appear in the lyrics.`);
  }
  if (ctx?.glossary && ctx.glossary.length > 0) {
    parts.push('Terminology — use exactly these translations for the following terms:');
    ctx.glossary.forEach((entry) => parts.push(`- ${entry.original} → ${entry.translation}`));
  }
  return parts.join('\n');
};

const GLOSSARY_PROMPT = `You extract terminology for translating song lyrics.
Given the song title, artist, and full lyrics, list the proper nouns and
terms whose translations must stay consistent across the whole song
(person/place/brand names, work titles, repeated foreign words).
Return ONLY a JSON array of {"original":"...","translation":"..."} objects.
If there is nothing to extract, return an empty array []. Max 20 entries.`;

// Reasoning models (deepseek-v4-flash, Claude thinking) burn a large chunk
// of the completion budget on their chain of thought; 8k leaves zero room
// for the actual translation on whole-song requests. 32k covers both.
const MAX_OUTPUT_TOKENS = 32768;

function buildOpenAIPayload(lines: string[], cfg: TranslationConfig, ctx?: TranslationContext) {
  return {
    model: cfg.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT(cfg.targetLang, ctx) },
      { role: 'user', content: JSON.stringify(lines) },
    ],
  };
}

function buildAnthropicPayload(lines: string[], cfg: TranslationConfig, ctx?: TranslationContext) {
  return {
    model: cfg.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    system: SYSTEM_PROMPT(cfg.targetLang, ctx),
    messages: [{ role: 'user', content: JSON.stringify(lines) }],
  };
}

/** Extract the first JSON array found in a model response. */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Normalize a parsed array to exactly match the source line count; empty source lines stay empty. */
function normalizeTranslations(sourceLines: string[], parsed: unknown): string[] {
  const raw = Array.isArray(parsed)
    ? parsed.map((item) => (typeof item === 'string' ? item : String(item ?? '')))
    : [];
  return sourceLines.map((source, i) => (source.trim() ? (raw[i] ?? '').trim() : ''));
}

/** Retry helper with exponential backoff; only retries transient failures. */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TranslationError
        ? error.retryable
        : true; // network errors etc.
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

async function requestOpenAI(lines: string[], cfg: TranslationConfig, fetchImpl: typeof fetch, ctx?: TranslationContext): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  // Whole-song requests can take a while — allow up to 5 minutes.
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(buildOpenAIPayload(lines, cfg, ctx)),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TranslationError('translation_failed', `upstream status ${response.status}`, response.status >= 500 || response.status === 429);
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new TranslationError('translation_invalid_response', 'empty model response');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function requestAnthropic(lines: string[], cfg: TranslationConfig, fetchImpl: typeof fetch, ctx?: TranslationContext): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const controller = new AbortController();
  // Whole-song requests can take a while — allow up to 5 minutes.
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildAnthropicPayload(lines, cfg, ctx)),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TranslationError('translation_failed', `upstream status ${response.status}`, response.status >= 500 || response.status === 429);
    }
    const data = await response.json() as { content?: { type?: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new TranslationError('translation_invalid_response', 'empty model response');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve the Workers AI binding (env.AI) on Cloudflare; null elsewhere. */
async function getWorkersAiBinding(): Promise<{ run: (model: string, inputs: unknown) => Promise<{ response?: string }> } | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    const ai = (ctx.env as Record<string, unknown>).AI as
      | { run: (model: string, inputs: unknown) => Promise<{ response?: string }> }
      | undefined;
    return ai ?? null;
  } catch {
    return null;
  }
}

async function requestWorkersAI(lines: string[], cfg: TranslationConfig, ctx?: TranslationContext): Promise<string> {
  const ai = await getWorkersAiBinding();
  if (!ai) {
    throw new TranslationError('translation_failed', 'Workers AI binding unavailable');
  }
  // Daily Neurons guard: refuse up-front if this request would bust the
  // budget (estimated from input size), then record actual usage after.
  // Dynamic import keeps the node test runner (no @ alias) from resolving
  // the DB-backed usage module unless the workers-ai path is actually used.
  const { checkAiQuota, estimateTokens, neuronsForTokens, recordAiUsage } = await import('@/lib/ai-usage');
  const prompt = SYSTEM_PROMPT(cfg.targetLang, ctx);
  const inputText = `${prompt}\n${JSON.stringify(lines)}`;
  const quota = await checkAiQuota(neuronsForTokens(estimateTokens(inputText), 0));
  if (!quota.ok) {
    throw new TranslationError(
      'ai_quota_exceeded',
      `Daily AI quota reached (${quota.used}/${quota.limit} neurons)`,
    );
  }
  const data = await ai.run(cfg.model, {
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(lines) },
    ],
    temperature: 0.2,
  });
  const text = data?.response;
  if (typeof text !== 'string' || !text.trim()) {
    throw new TranslationError('translation_invalid_response', 'empty model response');
  }
  // Prefer the model's own token usage; fall back to estimates.
  const usage = (data as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const inputTokens = usage?.input_tokens ?? estimateTokens(inputText);
  const outputTokens = usage?.output_tokens ?? estimateTokens(text);
  await recordAiUsage(neuronsForTokens(inputTokens, outputTokens));
  return text;
}

/**
 * Extract a terminology table from the full song. Returns [] on any
 * failure so translation can proceed without it (best-effort feature).
 */
export async function extractLyricsGlossary(
  title: string,
  artist: string,
  lines: string[],
  cfg: TranslationConfig,
): Promise<GlossaryEntry[]> {
  const input = JSON.stringify({ title, artist, lyrics: lines });
  try {
    const text = await withRetry(async () => {
      const messages = [
        { role: 'system', content: GLOSSARY_PROMPT },
        { role: 'user', content: input },
      ];
      if (cfg.provider === 'anthropic') {
        return await requestAnthropicRaw(messages, cfg);
      }
      if (cfg.provider === 'workers-ai') {
        const ai = await getWorkersAiBinding();
        if (!ai) throw new TranslationError('translation_failed', 'Workers AI binding unavailable');
        const data = await ai.run(cfg.model, { messages, max_tokens: 4096, temperature: 0 });
        return data?.response ?? '';
      }
      const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: 4096, temperature: 0 }),
      });
      if (!res.ok) throw new TranslationError('translation_failed', `upstream status ${res.status}`, res.status >= 500 || res.status === 429);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    }, RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS);

    const parsed = extractJsonArray(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is GlossaryEntry =>
        typeof item === 'object' && item !== null
        && typeof (item as GlossaryEntry).original === 'string'
        && typeof (item as GlossaryEntry).translation === 'string')
      .slice(0, 20);
  } catch (error) {
    // Terminology is best-effort — but a silent failure hides provider/network issues.
    console.warn(`[translation] glossary extraction failed — ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Minimal Anthropic messages call shared by glossary extraction. */
async function requestAnthropicRaw(
  messages: { role: string; content: string }[],
  cfg: TranslationConfig,
): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: 4096, temperature: 0 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new TranslationError('translation_failed', `upstream status ${res.status}`, res.status >= 500 || res.status === 429);
    const data = await res.json() as { content?: { type?: string; text?: string }[] };
    return data.content?.find((block) => block.type === 'text')?.text ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming counterpart of translateLyricLines: calls the provider with
 * stream:true and forwards reasoning/translation deltas via onDelta, then
 * returns the final line-aligned translation array (parsed & normalized).
 * Workers AI has no streaming — it falls back to a single non-streamed
 * call and emits one translation delta. No retries here (a mid-stream
 * failure is surfaced to the client instead of replaying deltas).
 */
export async function streamTranslateLyricLines(
  lines: string[],
  cfg: TranslationConfig,
  onDelta: (chunk: { type: 'reasoning' | 'translation'; text: string }) => void,
  fetchImpl: typeof fetch = fetch,
  ctx?: TranslationContext,
): Promise<string[]> {
  let text: string;
  if (cfg.provider === 'workers-ai') {
    const { checkAiQuota, estimateTokens, neuronsForTokens, recordAiUsage } = await import('@/lib/ai-usage');
    const prompt = SYSTEM_PROMPT(cfg.targetLang, ctx);
    const inputText = `${prompt}\n${JSON.stringify(lines)}`;
    const quota = await checkAiQuota(neuronsForTokens(estimateTokens(inputText), 0));
    if (!quota.ok) {
      throw new TranslationError('ai_quota_exceeded', `Daily AI quota reached (${quota.used}/${quota.limit} neurons)`);
    }
    const ai = await getWorkersAiBinding();
    if (!ai) throw new TranslationError('translation_failed', 'Workers AI binding unavailable');
    const data = await ai.run(cfg.model, {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify(lines) },
      ],
      temperature: 0.2,
    });
    text = data?.response ?? '';
    if (!text.trim()) throw new TranslationError('translation_invalid_response', 'empty model response');
    const usage = (data as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    const inputTokens = usage?.input_tokens ?? estimateTokens(inputText);
    const outputTokens = usage?.output_tokens ?? estimateTokens(text);
    await recordAiUsage(neuronsForTokens(inputTokens, outputTokens));
    onDelta({ type: 'translation', text });
  } else if (cfg.provider === 'anthropic') {
    text = await streamAnthropic(lines, cfg, onDelta, fetchImpl, ctx);
  } else {
    text = await streamOpenAI(lines, cfg, onDelta, fetchImpl, ctx);
  }

  const parsed = extractJsonArray(text);
  if (parsed !== null) return normalizeTranslations(lines, parsed);
  const fallback = text.split('\n').map((line) => line.trim());
  return normalizeTranslations(lines, fallback);
}

/** OpenAI-compatible streaming chat completions (DeepSeek etc.). */
async function streamOpenAI(
  lines: string[],
  cfg: TranslationConfig,
  onDelta: (chunk: { type: 'reasoning' | 'translation'; text: string }) => void,
  fetchImpl: typeof fetch,
  ctx?: TranslationContext,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        ...buildOpenAIPayload(lines, cfg, ctx),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new TranslationError('translation_failed', `upstream status ${response.status} ${bodyText.slice(0, 200)}`, response.status >= 500 || response.status === 429);
    }
    if (!response.body) throw new TranslationError('translation_failed', 'empty stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reasoning = '';
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let parsed: { choices?: { delta?: { content?: string; reasoning_content?: string } }[] };
          try {
            parsed = JSON.parse(payload);
          } catch { continue; }
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onDelta({ type: 'reasoning', text: delta.reasoning_content });
          }
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onDelta({ type: 'translation', text: delta.content });
          }
        }
      }
    }
    if (!content.trim()) throw new TranslationError('translation_invalid_response', 'empty model response');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Anthropic Messages streaming (thinking + text deltas). */
async function streamAnthropic(
  lines: string[],
  cfg: TranslationConfig,
  onDelta: (chunk: { type: 'reasoning' | 'translation'; text: string }) => void,
  fetchImpl: typeof fetch,
  ctx?: TranslationContext,
): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ ...buildAnthropicPayload(lines, cfg, ctx), stream: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new TranslationError('translation_failed', `upstream status ${response.status} ${bodyText.slice(0, 200)}`, response.status >= 500 || response.status === 429);
    }
    if (!response.body) throw new TranslationError('translation_failed', 'empty stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const dataLine = event.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        let parsed: { type?: string; delta?: { type?: string; text?: string; thinking?: string }; content_block?: { type?: string; thinking?: string } };
        try {
          parsed = JSON.parse(payload);
        } catch { continue; }
        if (parsed.type === 'content_block_delta') {
          if (parsed.delta?.type === 'thinking_delta' && typeof parsed.delta.thinking === 'string' && parsed.delta.thinking) {
            onDelta({ type: 'reasoning', text: parsed.delta.thinking });
          }
          if (parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string' && parsed.delta.text) {
            content += parsed.delta.text;
            onDelta({ type: 'translation', text: parsed.delta.text });
          }
        } else if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking' && typeof parsed.content_block.thinking === 'string' && parsed.content_block.thinking) {
          onDelta({ type: 'reasoning', text: parsed.content_block.thinking });
        }
      }
    }
    if (!content.trim()) throw new TranslationError('translation_invalid_response', 'empty model response');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate lyric lines. The returned array has the same length as `lines`;
 * empty source lines always map to empty strings. Transient failures are
 * retried with exponential backoff; quota errors fail fast.
 */
export async function translateLyricLines(
  lines: string[],
  cfg: TranslationConfig,
  fetchImpl: typeof fetch = fetch,
  ctx?: TranslationContext,
): Promise<string[]> {
  const text = await withRetry(async () => {
    if (cfg.provider === 'anthropic') {
      return await requestAnthropic(lines, cfg, fetchImpl, ctx);
    }
    if (cfg.provider === 'workers-ai') {
      return await requestWorkersAI(lines, cfg, ctx);
    }
    return await requestOpenAI(lines, cfg, fetchImpl, ctx);
  }, RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS);

  // Prefer a JSON array; fall back to newline-separated plain text.
  const parsed = extractJsonArray(text);
  if (parsed !== null) return normalizeTranslations(lines, parsed);

  const fallback = text.split('\n').map((line) => line.trim());
  return normalizeTranslations(lines, fallback);
}
