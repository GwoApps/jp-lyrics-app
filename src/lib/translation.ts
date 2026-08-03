/**
 * Server-side lyric translation service.
 *
 * Provider-agnostic: works with any OpenAI-compatible chat-completions API
 * (DeepSeek, OpenAI, Qwen, local vLLM, ...) or the Anthropic Messages API.
 *
 * Environment variables:
 *   TRANSLATION_PROVIDER  'openai' | 'anthropic'             (default: openai)
 *   TRANSLATION_BASE_URL  base URL without the path suffix   (default: DeepSeek / Anthropic)
 *   TRANSLATION_API_KEY   API key                            (fallback: DEEPSEEK_API_KEY)
 *   TRANSLATION_MODEL     model name                         (default: deepseek-chat / claude-sonnet-4-5)
 *   TRANSLATION_TARGET_LANG  target language for lyrics      (default: zh-CN)
 */

export type TranslationProvider = 'openai' | 'anthropic';

export interface TranslationConfig {
  provider: TranslationProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLang: string;
}

export class TranslationError extends Error {
  code: 'translation_failed' | 'translation_invalid_response';

  constructor(code: 'translation_failed' | 'translation_invalid_response', message: string) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
  }
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_OPENAI_MODEL = 'deepseek-v4-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';

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
  const provider: TranslationProvider = env.TRANSLATION_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
  const apiKey = env.TRANSLATION_API_KEY || env.DEEPSEEK_API_KEY || '';
  if (!apiKey) return null;
  return {
    provider,
    baseUrl: env.TRANSLATION_BASE_URL || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL),
    apiKey,
    model: env.TRANSLATION_MODEL || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL),
    targetLang: env.TRANSLATION_TARGET_LANG || 'zh-CN',
  };
}

export function isTranslationConfigured(): boolean {
  return getTranslationConfig() !== null;
}

const SYSTEM_PROMPT = (targetLang: string) =>
  `You are a professional song-lyrics translator. Translate the given lyrics into ${targetLang}.
Rules:
- Translate every non-empty line faithfully but naturally; keep meaning, mood, and line structure.
- Keep the number of output entries EXACTLY equal to the number of input lines.
- For an empty input line, output an empty string.
- Do not add explanations, headers, or timestamps.
- Respond with ONLY a JSON array of strings.`;

function buildOpenAIPayload(lines: string[], cfg: TranslationConfig) {
  return {
    model: cfg.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT(cfg.targetLang) },
      { role: 'user', content: JSON.stringify(lines) },
    ],
  };
}

function buildAnthropicPayload(lines: string[], cfg: TranslationConfig) {
  return {
    model: cfg.model,
    max_tokens: 4096,
    temperature: 0.2,
    system: SYSTEM_PROMPT(cfg.targetLang),
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

async function requestOpenAI(lines: string[], cfg: TranslationConfig, fetchImpl: typeof fetch): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(buildOpenAIPayload(lines, cfg)),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TranslationError('translation_failed', `upstream status ${response.status}`);
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

async function requestAnthropic(lines: string[], cfg: TranslationConfig, fetchImpl: typeof fetch): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(buildAnthropicPayload(lines, cfg)),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new TranslationError('translation_failed', `upstream status ${response.status}`);
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

/**
 * Translate lyric lines. The returned array has the same length as `lines`;
 * empty source lines always map to empty strings.
 */
export async function translateLyricLines(
  lines: string[],
  cfg: TranslationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const text = cfg.provider === 'anthropic'
    ? await requestAnthropic(lines, cfg, fetchImpl)
    : await requestOpenAI(lines, cfg, fetchImpl);

  // Prefer a JSON array; fall back to newline-separated plain text.
  const parsed = extractJsonArray(text);
  if (parsed !== null) return normalizeTranslations(lines, parsed);

  const fallback = text.split('\n').map((line) => line.trim());
  return normalizeTranslations(lines, fallback);
}
