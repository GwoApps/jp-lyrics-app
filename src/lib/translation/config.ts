/**
 * Translation configuration: types, defaults and env resolution.
 * Shared by the providers, glossary and payload builders.
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
  /** Admin-overridden system prompt template; falls back to the default when unset. */
  systemPrompt?: string;
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

export interface TranslationTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_OPENAI_MODEL = 'deepseek-v4-flash';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
export const DEFAULT_WORKERS_AI_MODEL = '@cf/google/gemini-3.6-flash';

/** Attempts and backoff for transient failures (1s, 2s). */
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 1000;

// Reasoning models (deepseek-v4-flash, Claude thinking) burn a large chunk
// of the completion budget on their chain of thought; 8k leaves zero room
// for the actual translation on whole-song requests. 32k covers both.
export const MAX_OUTPUT_TOKENS = 32768;

// Lyric chunks are short; heavy reasoning only adds latency and tokens.
// 'low' keeps only the minimal judgment calls (rhetoric mirroring, glossary
// consistency) without a long chain of thought.
export const REASONING_EFFORT = 'low' as const;

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
