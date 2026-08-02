import * as cheerio from 'cheerio';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

export type LinkcoreLyricsError =
  | 'invalid_linkcore_url'
  | 'linkcore_fetch_failed'
  | 'linkcore_invalid_content_type'
  | 'lyrics_not_found';

export class LinkcoreLyricsErrorResponse extends Error {
  public readonly code: LinkcoreLyricsError;

  constructor(code: LinkcoreLyricsError) {
    super(code);
    this.code = code;
  }
}

export function isLinkcoreLyricsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:'
      && url.hostname === 'linkco.re'
      && /^\/[^/]+\/songs\/[^/]+\/lyrics\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function extractLinkcoreLyricsFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const lyricText = $('div.lyric_text').first();
  if (!lyricText.length) return '';

  const paragraphs = lyricText.find('p').toArray();
  const lines = paragraphs.length > 0
    ? paragraphs.map((element) => $(element).text().trim())
    : lyricText.text().split(/\r?\n/).map((line) => line.trim());

  return lines.join('\n')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchLinkcorePage(url: URL): Promise<string> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; jp-lyrics-app/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
        const nextUrl = new URL(location, currentUrl);
        if (!isLinkcoreLyricsUrl(nextUrl.toString())) throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('text/html')) {
        throw new LinkcoreLyricsErrorResponse('linkcore_invalid_content_type');
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > MAX_RESPONSE_BYTES) throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
      const html = await response.text();
      if (html.length > MAX_RESPONSE_BYTES) throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
      return html;
    } catch (error) {
      if (error instanceof LinkcoreLyricsErrorResponse) throw error;
      throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  throw new LinkcoreLyricsErrorResponse('linkcore_fetch_failed');
}

export async function extractLinkcoreLyrics(url: string): Promise<string> {
  if (!isLinkcoreLyricsUrl(url)) throw new LinkcoreLyricsErrorResponse('invalid_linkcore_url');
  const lyrics = extractLinkcoreLyricsFromHtml(await fetchLinkcorePage(new URL(url.trim())));
  if (!lyrics) throw new LinkcoreLyricsErrorResponse('lyrics_not_found');
  return lyrics;
}
