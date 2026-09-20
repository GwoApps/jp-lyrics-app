/**
 * Prompt templates for lyric translation and terminology extraction.
 *
 * The translation system prompt is a *template*: `{{targetLang}}`,
 * `{{sourceLang}}`, `{{songContext}}` and `{{glossary}}` placeholders are
 * filled by `renderSystemPrompt`. Admins can override the template from the
 * admin console (stored in the DB); `DEFAULT_SYSTEM_PROMPT` is the fallback
 * and also what the reset button restores.
 */

import type { TranslationContext } from './config.ts';

/**
 * A good/bad few-shot pair that anchors what "natural, faithful" output looks
 * like for one source → target language direction. The GOOD/BAD renderings use
 * the target language so the model's style anchor matches the language it must
 * actually write in; the source line must match the language of the lyrics
 * being translated, otherwise the anchor teaches the wrong reading direction
 * (Cantonese colloquial particles read as Mandarin would be translated
 * word-for-word).
 */
interface FewShotExample {
  /** Human-readable direction label shown in the prompt. */
  label: string;
  /** Source lyric line, in the source language of the example. */
  input: string;
  bad: string;
  good: string;
}

/** Source-language codes with their own few-shot examples, keyed by short tag. */
export const SOURCE_LANG_JA = 'ja';
export const SOURCE_LANG_YUE = 'yue';
export const DEFAULT_SOURCE_LANG = SOURCE_LANG_JA;

/**
 * Few-shot quality examples keyed by source language, then by target-language
 * BCP-47 prefix. Japanese lyrics (the default) reuse the original examples
 * verbatim so their behaviour is unchanged; Cantonese gets its own pair whose
 * BAD anchor shows the failure mode this fix targets: colloquial particles
 * (唔／嘅／咗／係／啲／咁…) read as Mandarin and translated literally.
 */
const FEW_SHOT_EXAMPLES: Record<string, Record<string, FewShotExample>> = {
  ja: {
    zh: {
      label: 'Japanese → Simplified Chinese lyric line',
      input: '涙が落ちる前に、この声が届くなら',
      bad: '泪落之前传声来，韵脚虽齐意已乖',
      good: '若在泪水落下前，这声音能传到你身边',
    },
    'zh-TW': {
      label: 'Japanese → Traditional Chinese lyric line',
      input: '涙が落ちる前に、この声が届くなら',
      bad: '淚落之前傳聲來，韻腳雖齊意已乖',
      good: '若在淚水落下前，這聲音能傳到你身邊',
    },
    'zh-HK': {
      label: 'Japanese → Traditional Chinese (Hong Kong) lyric line',
      input: '涙が落ちる前に、この声が届くなら',
      bad: '淚落之前傳聲來，韻腳雖齊意已乖',
      good: '若在淚水落下前，這聲音能傳到你身邊',
    },
    en: {
      label: 'Japanese → English lyric line',
      input: '涙が落ちる前に、この声が届くなら',
      bad: 'Before the tears fall, my voice send would, the rhyme lands but the sense has gone wrong',
      good: 'If my voice could reach you before the tears fall',
    },
    ja: {
      label: 'Japanese → Japanese lyric line',
      input: '涙が落ちる前に、この声が届くなら',
      bad: '涙が落ちる前に、届けこの声を、韻は合うが意味が歪む',
      good: '涙が落ちる前に、この声が届くなら',
    },
  },
  yue: {
    zh: {
      label: 'Cantonese → Simplified Chinese lyric line',
      input: '唔知點解，我仲係咁掛住你',
      bad: '不知道点解，我仍是那么挂着你想你',
      good: '不知为何，我还是这样想念你',
    },
    'zh-TW': {
      label: 'Cantonese → Traditional Chinese lyric line',
      input: '唔知點解，我仲係咁掛住你',
      bad: '不知道點解，我仍是那麼掛著你想你',
      good: '不知為何，我還是這樣想念你',
    },
    'zh-HK': {
      label: 'Cantonese → Traditional Chinese (Hong Kong) lyric line',
      input: '唔知點解，我仲係咁掛住你',
      bad: '唔知點解，我仲係咁掛住你（原文照抄，沒有翻譯）',
      good: '不知為何，我還是這樣想念你',
    },
    en: {
      label: 'Cantonese → English lyric line',
      input: '唔知點解，我仲係咁掛住你',
      bad: "Don't know why, I still so hang you",
      good: "I don't know why, but I still miss you this much",
    },
    ja: {
      label: 'Cantonese → Japanese lyric line',
      input: '唔知點解，我仲係咁掛住你',
      bad: '知らない点解、僕はまだそんなにあなたを掛ける',
      good: 'なぜか、今もこんなにあなたが恋しい',
    },
  },
};

/**
 * Ordered target-language-prefix keys, most specific first, so prefix matching
 * wins correctly. Shared by every source language.
 */
const FEW_SHOT_PREFIX_ORDER: readonly string[] = ['zh-HK', 'zh-TW', 'zh', 'en', 'ja'];

/** Unknown / missing source languages fall back to Japanese (lyrics default). */
export function normalizeSourceLang(sourceLang?: string): string {
  const lang = (sourceLang ?? '').trim().toLowerCase();
  if (!lang) return DEFAULT_SOURCE_LANG;
  if (lang === 'yue' || lang.startsWith('yue-') || lang === 'zh-yue' || lang === 'cantonese') {
    return SOURCE_LANG_YUE;
  }
  return SOURCE_LANG_JA;
}

/**
 * Pick the few-shot example best matching a source → target language pair.
 * The source language selects the example table (unknown/missing → Japanese,
 * so Japanese-lyric behaviour is unchanged); the target language is matched by
 * BCP-47 prefix and falls back to the table's Simplified Chinese example.
 */
export function pickFewShot(targetLang: string, sourceLang?: string): FewShotExample {
  const target = targetLang.trim();
  const table = FEW_SHOT_EXAMPLES[normalizeSourceLang(sourceLang)] ?? FEW_SHOT_EXAMPLES[DEFAULT_SOURCE_LANG];
  for (const prefix of FEW_SHOT_PREFIX_ORDER) {
    if (target.toLowerCase().startsWith(prefix.toLowerCase()) && table[prefix]) {
      return table[prefix];
    }
  }
  return table.zh;
}

/** Human-readable label for the source language, used by `{{sourceLang}}`. */
function sourceLangLabel(sourceLang?: string): string {
  return normalizeSourceLang(sourceLang) === SOURCE_LANG_YUE ? 'Cantonese' : 'Japanese';
}

/** Render a few-shot example into its prompt block (empty for unknown placeholders). */
function renderFewShot(example: FewShotExample): string {
  return `Quality reference (${example.label}):\n`
    + `Input: ${example.input}\n`
    + `BAD: ${example.bad}\n`
    + '     — forced rhyme: reordered words, distorted meaning\n'
    + `GOOD: ${example.good}\n`
    + '     — faithful meaning, natural word order, line structure kept';
}

/**
 * Cantonese colloquial-particle reading rule. Only injected when the source
 * lyrics are Cantonese, so Japanese requests keep the prompt they had before.
 */
const CANTONESE_READING_RULE = '- The source lyrics are Cantonese; read them by Cantonese semantics before translating: '
  + '唔 = not / don\'t, 嘅 = \'s / of, 咗 = past tense, 係 = is, 啲 = some, 咁 = so / such / like this. '
  + 'Never read these particles as Mandarin characters or translate them word-for-word.\n';

/**
 * Default system prompt template. Rules keep the two quality guarantees the
 * service relies on:
 * 1. Rhetoric (rhyme / parallelism) is only preserved when the ORIGINAL line
 *    itself uses it — never forced at the expense of meaning.
 * 2. A few-shot good/bad pair anchors what "natural, faithful" looks like.
 *
 * `{{sourceLang}}` names the language of the input lyrics; `{{fewShot}}` is
 * filled by `renderSystemPrompt` with the GOOD/BAD example matching the
 * source → target direction, so the style anchor never drifts from the
 * language the model is asked to read or write.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a professional song-lyrics translator. Translate the given {{sourceLang}} lyrics into {{targetLang}}.

Rules:
- Translate every non-empty line faithfully but naturally; keep meaning, mood, and line structure.
- Keep the number of output entries EXACTLY equal to the number of input lines.
- For an empty input line, output an empty string.
- Do not add explanations, headers, or timestamps.
- Respond with ONLY a JSON array of strings.
- Rhetoric: preserve rhyme, parallelism or wordplay ONLY when the original line itself uses it; never force it at the expense of meaning or naturalness — accuracy always wins.
{{sourceRule}}
{{songContext}}{{glossary}}{{fewShot}}
Always translate like GOOD, never like BAD.`;

/** Build the effective system prompt from a (possibly admin-overridden) template. */
export function renderSystemPrompt(
  template: string,
  targetLang: string,
  ctx?: TranslationContext,
): string {
  const sourceLang = normalizeSourceLang(ctx?.sourceLang);
  let songContext = '';
  if (ctx?.title || ctx?.artist) {
    songContext = `Song context — title: "${ctx.title ?? ''}", artist: "${ctx.artist ?? ''}". Use these consistently whenever they appear in the lyrics.\n`;
  }
  let glossary = '';
  if (ctx?.glossary && ctx.glossary.length > 0) {
    glossary = 'Terminology — use exactly these translations for the following terms:\n'
      + ctx.glossary.map((entry) => `- ${entry.original} → ${entry.translation}`).join('\n')
      + '\n';
  }
  return template
    .split('{{targetLang}}').join(targetLang)
    .split('{{sourceLang}}').join(sourceLangLabel(sourceLang))
    .split('{{sourceRule}}').join(sourceLang === SOURCE_LANG_YUE ? CANTONESE_READING_RULE : '')
    .split('{{songContext}}').join(songContext)
    .split('{{glossary}}').join(glossary)
    .split('{{fewShot}}').join(renderFewShot(pickFewShot(targetLang, sourceLang)) + '\n');
}

/** Default prompt for the current target language (back-compat wrapper). */
export const SYSTEM_PROMPT = (targetLang: string, ctx?: TranslationContext) =>
  renderSystemPrompt(DEFAULT_SYSTEM_PROMPT, targetLang, ctx);

export const GLOSSARY_PROMPT = `You extract terminology for translating song lyrics.
Given the song title, artist, and full lyrics, list the proper nouns and
terms whose translations must stay consistent across the whole song
(person/place/brand names, work titles, repeated foreign words).
Return ONLY a JSON array of {"original":"...","translation":"..."} objects.
If there is nothing to extract, return an empty array []. Max 20 entries.`;
