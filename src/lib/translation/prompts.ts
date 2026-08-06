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
 * Default system prompt template. Rules keep the two quality guarantees the
 * service relies on:
 * 1. Rhetoric (rhyme / parallelism) is only preserved when the ORIGINAL line
 *    itself uses it — never forced at the expense of meaning.
 * 2. A few-shot good/bad pair anchors what "natural, faithful" looks like.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a professional song-lyrics translator. Translate the given lyrics into {{targetLang}}.

Rules:
- Translate every non-empty line faithfully but naturally; keep meaning, mood, and line structure.
- Keep the number of output entries EXACTLY equal to the number of input lines.
- For an empty input line, output an empty string.
- Do not add explanations, headers, or timestamps.
- Respond with ONLY a JSON array of strings.
- Rhetoric: preserve rhyme, parallelism or wordplay ONLY when the original line itself uses it; never force it at the expense of meaning or naturalness — accuracy always wins.

{{songContext}}{{glossary}}
Quality reference (Japanese → Chinese lyric line):
Input: 涙が落ちる前に、この声が届くなら
BAD: 泪落之前传声来，韵脚虽齐意已乖
     — forced rhyme: reordered words, distorted meaning
GOOD: 若在泪水落下前，这声音能传到你身边
     — faithful meaning, natural word order, line structure kept
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
    .split('{{glossary}}').join(glossary);
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
