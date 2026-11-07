/**
 * Client-side helpers for saving an export. The export API answers with an
 * error JSON body on 4xx/5xx, so downloads go through fetch + blob instead of a
 * bare `<a download>`, which would save that body as a file.
 */

/** Response content type → extension actually saved. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'text/plain': 'txt',
  'text/html': 'html',
};

/** Requested format → extension, used when the content type is unexpected. */
const EXTENSION_BY_FORMAT: Record<string, string> = {
  text: 'txt',
  lrc: 'lrc',
  html: 'html',
};

function extensionOf(contentType: string | null, format: string): string {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSION_BY_TYPE[type] ?? EXTENSION_BY_FORMAT[format] ?? format;
}

/** Pull the server-suggested name (`filename*`, then `filename`) out of Content-Disposition. */
export function filenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // Malformed percent-encoding: fall through to the ASCII variant.
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header);
  const value = (plain?.[1] ?? plain?.[2])?.trim();
  return value || undefined;
}

/** Extension the export of `format` ends up with (`text` → `txt`). */
export function extensionForFormat(format: string): string {
  return EXTENSION_BY_FORMAT[format] ?? format;
}

/** `<title> - <artist>.<ext>` — the name the download dialog shows and prefers. */
export function fallbackFilename(title: string, artist: string | null | undefined, extension: string): string {
  const base = [title.trim(), artist?.trim()].filter(Boolean).join(' - ') || 'lyrics';
  return `${base}.${extension}`;
}

/**
 * Name for a downloaded export. Prefers an explicit client name over the
 * Content-Disposition header, ignores the ASCII `download.<ext>` placeholder,
 * and never derives an extension from a URL path.
 */
export function exportFilename(
  contentDisposition: string | null,
  contentType: string | null,
  title: string,
  artist: string | null | undefined,
  format: string,
  preferredName?: string | null,
): string {
  const ext = extensionOf(contentType, format);
  const placeholder = `download.${ext}`;
  if (preferredName && preferredName !== placeholder) return preferredName;
  const headerName = filenameFromContentDisposition(contentDisposition);
  if (headerName && headerName !== placeholder) return headerName;
  return fallbackFilename(title, artist, ext);
}

/** Trigger a browser save for an in-memory blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
