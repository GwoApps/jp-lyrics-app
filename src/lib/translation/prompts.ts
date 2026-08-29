/**
 * Prompt templates for lyric translation and terminology extraction.
 *
 * The translation system prompt is a *template*: `{{targetLang}}`,
 * `{{songContext}}` and `{{glossary}}` placeholders are filled by
 * `renderSystemPrompt`. Admins can override the template from the admin
 * console (stored in the DB); `DEFAULT_SYSTEM_PROMPT` is the fallback and
 * also what the reset button restores.
 */

import type { TranslationContext } from './config.ts';

/**
 * A good/bad few-shot pair that anchors what "natural, faithful" output looks
 * like for one target language. The source lyric line is always Japanese; the
 * GOOD/BAD renderings use the target language so the model's style anchor
 * matches the language it must actually write in.
 */
interface FewShotExample {
  /** Human-readable direction label shown in the prompt. */
  label: string;
  /** Source (Japanese) line shared by every example. */
  input: string;
  bad: string;
  good: string;
}

/** Per-target-language few-shot quality examples, keyed by BCP-47 prefix. */
const FEW_SHOT_EXAMPLES: Record<string, FewShotExample> = {
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
};

/** Ordered language-prefix keys, most specific first, so prefix matching wins correctly. */
const FEW_SHOT_PREFIX_ORDER: readonly string[] = ['zh-HK', 'zh-TW', 'zh', 'en', 'ja'];

/**
 * Pick the few-shot example best matching a target-language tag. Falls back to
 * the default Simplified Chinese example when no prefix matches.
 */
export function pickFewShot(targetLang: string): FewShotExample {
  const lang = targetLang.trim();
  for (const prefix of FEW_SHOT_PREFIX_ORDER) {
    if (lang.toLowerCase().startsWith(prefix.toLowerCase())) {
      return FEW_SHOT_EXAMPLES[prefix];
    }
  }
  return FEW_SHOT_EXAMPLES.zh;
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
 * Default system prompt template. Rules keep the two quality guarantees the
 * service relies on:
 * 1. Rhetoric (rhyme / parallelism) is only preserved when the ORIGINAL line
 *    itself uses it — never forced at the expense of meaning.
 * 2. A few-shot good/bad pair anchors what "natural, faithful" looks like.
 *
 * `{{fewShot}}` is filled by `renderSystemPrompt` with the GOOD/BAD example
 * matching the target language, so the style anchor never drifts from the
 * language the model is asked to write in.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a professional song-lyrics translator. Translate the given lyrics into {{targetLang}}.

Rules:
- Translate every non-empty line faithfully but naturally; keep meaning, mood, and line structure.
- Keep the number of output entries EXACTLY equal to the number of input lines.
- For an empty input line, output an empty string.
- Do not add explanations, headers, or timestamps.
- Respond with ONLY a JSON array of strings.
- Rhetoric: preserve rhyme, parallelism or wordplay ONLY when the original line itself uses it; never force it at the expense of meaning or naturalness — accuracy always wins.

{{songContext}}{{glossary}}{{fewShot}}
Always translate like GOOD, never like BAD.`;

/** Build the effective system prompt from a (possibly admin-overridden) template. */
export function renderSystemPrompt(
  template: string,
  targetLang: string,
  ctx?: TranslationContext,
): string {
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
    .split('{{songContext}}').join(songContext)
    .split('{{glossary}}').join(glossary)
    .split('{{fewShot}}').join(renderFewShot(pickFewShot(targetLang)) + '\n');
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
