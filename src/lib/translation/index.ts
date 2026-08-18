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

import {
  MAX_OUTPUT_TOKENS,
  REASONING_EFFORT,
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  WORKERS_AI_MODELS,
  TranslationError,
  type GlossaryEntry,
  type TranslationConfig,
  type TranslationContext,
  type TranslationProvider,
  type TranslationTestResult,
} from './config.ts';
import { DEFAULT_SYSTEM_PROMPT, GLOSSARY_PROMPT, renderSystemPrompt } from './prompts.ts';
import { extractJsonArray, normalizeTranslations } from './parse.ts';

// Re-export the public configuration API so `@/lib/translation` keeps its
// original surface (callers are untouched by the module split).
export {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_WORKERS_AI_MODEL,
  MAX_OUTPUT_TOKENS,
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  WORKERS_AI_MODELS,
  TranslationError,
  getTranslationConfig,
  isTranslationConfigured,
  type GlossaryEntry,
  type TranslationConfig,
  type TranslationContext,
  type TranslationProvider,
  type TranslationTestResult,
} from './config.ts';

/**
 * Minimal connectivity check against the configured provider: send a tiny
 * request and report status + latency. Used by the admin "Test" button.
 */
/**
 * Discover the list of models the provider exposes, for the admin config
 * combobox ("auto-discover after a successful connection test").
 *
 * - OpenAI-compatible: GET {base_url}/models with Bearer auth → { data: [{ id }] }
 * - Anthropic: GET {base_url}/v1/models with x-api-key → { data: [{ id }] }
 * - workers-ai: the `env.AI` binding has no model-list API, so it returns
 *   the curated static catalog (WORKERS_AI_MODELS); null when empty.
 *
 * Returns a sorted list of model ids, or null when the provider has no
 * listable model catalog (not supported / request failed). Never throws.
 */
export async function discoverTranslationModels(
  config: TranslationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  if (config.provider === 'workers-ai') {
    return WORKERS_AI_MODELS.length > 0 ? [...WORKERS_AI_MODELS].sort() : null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    if (config.provider === 'anthropic') {
      const base = config.baseUrl.replace(/\/+$/, '');
      const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
      const res = await fetchImpl(url, {
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Array<{ id?: unknown }> };
      const ids = (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
      return ids.length ? [...new Set(ids)].sort() : null;
    }

    // OpenAI-compatible chat-completions APIs expose GET {base_url}/models.
    const url = `${config.baseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ id?: unknown }> };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    return ids.length ? [...new Set(ids)].sort() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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

function systemPromptFor(cfg: TranslationConfig, ctx?: TranslationContext): string {
  return renderSystemPrompt(cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, cfg.targetLang, ctx);
}

/**
 * Build the user message for a translation request.
 *
 * For slice requests (targeting a subset of a longer song) the caller attaches
 * `ctx.fullLyrics` + `ctx.targetIndices`. In that case the full song is embedded
 * as REFERENCE CONTEXT — the model can resolve Japanese omitted subjects,
 * pronouns and proper nouns from the surrounding lyrics — while the explicit
 * TARGET list still dictates the exact output count/order, so parsing and
 * alignment are unaffected. Without slice context it falls back to the plain
 * JSON array of the lines to translate (unchanged behaviour).
 */
function buildUserContent(lines: string[], ctx?: TranslationContext): string {
  if (!ctx?.fullLyrics || !ctx.targetIndices || ctx.targetIndices.length === 0) {
    return JSON.stringify(lines);
  }
  const contextBlock = ctx.fullLyrics
    .map((line, i) => `[${i}] ${line}`)
    .join('\n');
  return 'Translate ONLY the TARGET lines listed at the end into the target language. '
    + 'The full song below is REFERENCE CONTEXT only — use it to resolve omitted '
    + 'subjects, pronouns and proper nouns, but do NOT translate the non-target lines.\n\n'
    + 'FULL SONG (context only):\n' + contextBlock + '\n\n'
    + 'TARGET LINES TO TRANSLATE (output exactly ' + lines.length + ' strings, in this order):\n'
    + JSON.stringify(lines);
}

function buildOpenAIPayload(lines: string[], cfg: TranslationConfig, ctx?: TranslationContext) {
  return {
    model: cfg.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    // Short lyric chunks: low reasoning effort keeps latency and token cost down.
    reasoning_effort: REASONING_EFFORT,
    messages: [
      { role: 'system', content: systemPromptFor(cfg, ctx) },
      { role: 'user', content: buildUserContent(lines, ctx) },
    ],
  };
}

function buildAnthropicPayload(lines: string[], cfg: TranslationConfig, ctx?: TranslationContext) {
  return {
    model: cfg.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    system: systemPromptFor(cfg, ctx),
    messages: [{ role: 'user', content: buildUserContent(lines, ctx) }],
  };
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

/**
 * Run a Workers AI call under the atomic daily-budget guard.
 *
 * Reserves an estimated budget fail-closed (refuses to call the model when
 * the cap is exhausted), then settles with ACTUAL usage (多退少补). Any
 * failure/cancellation releases the reservation; if even the release fails,
 * the stale reservation is folded into used budget by the TTL reclaim in
 * ai-usage.ts, so the hard cap is never silently widened.
 */
async function runWithAiQuota<T>(
  estimatedNeurons: number,
  execute: () => Promise<{ value: T; actualNeurons: number }>,
): Promise<T> {
  const { reserveAiBudget, settleAiBudget, releaseAiBudget } = await import('@/lib/ai-usage');
  const reservation = await reserveAiBudget(estimatedNeurons);
  if (!reservation.ok) {
    throw new TranslationError(
      'ai_quota_exceeded',
      `Daily AI quota reached (${reservation.used + reservation.reserved}/${reservation.limit} neurons)`,
    );
  }
  try {
    const { value, actualNeurons } = await execute();
    try {
      await settleAiBudget(reservation.requestId, actualNeurons);
    } catch (error) {
      // Accounting failed after the model already ran — the reservation is
      // left 'reserved' and the TTL reclaim converts it into used budget
      // (fail-closed). Surface loudly instead of silently swallowing it.
      console.error(
        `[ai-usage] settlement failed for ${reservation.requestId} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return value;
  } catch (error) {
    try {
      await releaseAiBudget(reservation.requestId);
    } catch (releaseError) {
      console.warn(
        `[ai-usage] release failed for ${reservation.requestId} — ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
      );
    }
    throw error;
  }
}

async function requestWorkersAI(lines: string[], cfg: TranslationConfig, ctx?: TranslationContext): Promise<string> {
  const ai = await getWorkersAiBinding();
  if (!ai) {
    throw new TranslationError('translation_failed', 'Workers AI binding unavailable');
  }
  const { estimateTokens, neuronsForTokens } = await import('@/lib/ai-usage');
  const prompt = systemPromptFor(cfg, ctx);
  const inputText = `${prompt}\n${buildUserContent(lines, ctx)}`;
  // Daily Neurons guard: atomically reserve an estimated budget BEFORE the
  // model runs so concurrent requests can never collectively exceed the hard
  // cap, then settle with actual usage (多退少补) afterwards. Dynamic import
  // keeps the node test runner (no @ alias) from resolving the DB-backed
  // usage module unless the workers-ai path is actually used.
  const estimate = neuronsForTokens(estimateTokens(inputText), 0);
  return await runWithAiQuota(estimate, async () => {
    const data = await ai.run(cfg.model, {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: buildUserContent(lines, ctx) },
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
    return { value: text, actualNeurons: neuronsForTokens(inputTokens, outputTokens) };
  });
}

/**
 * Extract a terminology table from the full song.
 *
 * Return contract — three distinguishable states:
 *  - `GlossaryEntry[]` — extraction succeeded; may be an EMPTY array when the
 *    song genuinely has no terms worth pinning (the caller may persist it to
 *    remember that and skip future extractions);
 *  - `null` — extraction FAILED (upstream error / malformed response). The
 *    caller must treat this run as "no terminology" but must NOT persist it,
 *    otherwise a transient failure would permanently pin the song to empty
 *    and never retry.
 */
export async function extractLyricsGlossary(
  title: string,
  artist: string,
  lines: string[],
  cfg: TranslationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GlossaryEntry[] | null> {
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
        const { estimateTokens, neuronsForTokens } = await import('@/lib/ai-usage');
        // Glossary extraction is also a billed Workers AI call and MUST go
        // through the same atomic reservation guard (it can otherwise burn
        // the daily budget without being counted).
        const estimate = neuronsForTokens(estimateTokens(input), 4096);
        return await runWithAiQuota(estimate, async () => {
          const ai = await getWorkersAiBinding();
          if (!ai) throw new TranslationError('translation_failed', 'Workers AI binding unavailable');
          const data = await ai.run(cfg.model, { messages, max_tokens: 4096, temperature: 0 });
          const response = data?.response ?? '';
          const usage = (data as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
          const inputTokens = usage?.input_tokens ?? estimateTokens(input);
          const outputTokens = usage?.output_tokens ?? estimateTokens(response);
          return { value: response, actualNeurons: neuronsForTokens(inputTokens, outputTokens) };
        });
      }
      const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: 4096, temperature: 0 }),
      });
      if (!res.ok) throw new TranslationError('translation_failed', `upstream status ${res.status}`, res.status >= 500 || res.status === 429);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    }, RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS);

    const parsed = extractJsonArray(text);
    // A compliant model always answers with a JSON array (empty `[]` when
    // there is genuinely nothing to extract). Anything else — prose, a JSON
    // object, an empty body — is a malformed/unsuccessful response, so we
    // return null instead of pinning the song to "no terms" forever.
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((item): item is GlossaryEntry =>
        typeof item === 'object' && item !== null
        && typeof (item as GlossaryEntry).original === 'string'
        && typeof (item as GlossaryEntry).translation === 'string')
      .slice(0, 20);
  } catch (error) {
    // Terminology is best-effort — but a silent failure hides provider/network issues.
    console.warn(`[translation] glossary extraction failed — ${error instanceof Error ? error.message : String(error)}`);
    return null;
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
  signal?: AbortSignal,
): Promise<string[]> {
  let text: string;
  if (cfg.provider === 'workers-ai') {
    const { estimateTokens, neuronsForTokens } = await import('@/lib/ai-usage');
    const prompt = systemPromptFor(cfg, ctx);
    const inputText = `${prompt}\n${buildUserContent(lines, ctx)}`;
    const estimate = neuronsForTokens(estimateTokens(inputText), 0);
    text = await runWithAiQuota(estimate, async () => {
      const ai = await getWorkersAiBinding();
      if (!ai) throw new TranslationError('translation_failed', 'Workers AI binding unavailable');
      const data = await ai.run(cfg.model, {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: buildUserContent(lines, ctx) },
        ],
        temperature: 0.2,
      });
      const response = data?.response ?? '';
      if (!response.trim()) throw new TranslationError('translation_invalid_response', 'empty model response');
      const usage = (data as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      const inputTokens = usage?.input_tokens ?? estimateTokens(inputText);
      const outputTokens = usage?.output_tokens ?? estimateTokens(response);
      return { value: response, actualNeurons: neuronsForTokens(inputTokens, outputTokens) };
    });
    onDelta({ type: 'translation', text });
  } else if (cfg.provider === 'anthropic') {
    text = await streamAnthropic(lines, cfg, onDelta, fetchImpl, ctx, signal);
  } else {
    text = await streamOpenAI(lines, cfg, onDelta, fetchImpl, ctx, signal);
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
  externalSignal?: AbortSignal,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  // 5-minute safety timeout, plus an optional external signal (client
  // disconnect) so an aborted request stops the upstream call immediately
  // instead of burning quota until the timeout fires.
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    if (externalSignal?.aborted) controller.abort();
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
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Anthropic Messages streaming (thinking + text deltas). */
async function streamAnthropic(
  lines: string[],
  cfg: TranslationConfig,
  onDelta: (chunk: { type: 'reasoning' | 'translation'; text: string }) => void,
  fetchImpl: typeof fetch,
  ctx?: TranslationContext,
  externalSignal?: AbortSignal,
): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const controller = new AbortController();
  // 5-minute safety timeout, plus an optional external signal (client
  // disconnect) so an aborted request stops the upstream call immediately
  // instead of burning quota until the timeout fires.
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    if (externalSignal?.aborted) controller.abort();
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
    externalSignal?.removeEventListener('abort', onExternalAbort);
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
