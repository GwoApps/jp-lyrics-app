/**
 * Prompt templates for lyric translation and terminology extraction.
 */

import type { TranslationContext } from './config.ts';

export const SYSTEM_PROMPT = (targetLang: string, ctx?: TranslationContext) => {
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

export const GLOSSARY_PROMPT = `You extract terminology for translating song lyrics.
Given the song title, artist, and full lyrics, list the proper nouns and
terms whose translations must stay consistent across the whole song
(person/place/brand names, work titles, repeated foreign words).
Return ONLY a JSON array of {"original":"...","translation":"..."} objects.
If there is nothing to extract, return an empty array []. Max 20 entries.`;
