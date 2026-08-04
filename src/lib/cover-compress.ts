/**
 * Client-side cover image preparation: files over the upload cap are
 * downscaled and re-encoded to JPEG in the browser, so uploads always fit
 * the 1.5MB limit (which exists because Cloudflare D1 rows cap at 2MB).
 *
 * - Small files are returned untouched (byte-for-byte).
 * - Animated GIFs are never re-encoded (would lose animation); if over the
 *   cap they are rejected by the caller.
 * - Transparent PNG/WebP get a white background (JPEG has no alpha).
 */

export const MAX_COVER_BYTES = 1.5 * 1024 * 1024;
export const MAX_COVER_DIM = 1024;

const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** True if the file must be rejected (over cap and not compressible). */
export function isCoverRejected(file: File): boolean {
  return file.size > MAX_COVER_BYTES && !COMPRESSIBLE.has(file.type);
}

/**
 * Returns a File ready for upload: the original when it fits, otherwise a
 * downscaled JPEG. If even the smallest encode exceeds the cap, the
 * original is returned and the caller shows the too-large error.
 */
export async function prepareCoverFile(file: File): Promise<File> {
  if (file.size <= MAX_COVER_BYTES || !COMPRESSIBLE.has(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Fallback for browsers without createImageBitmap: decode via <img>.
    bitmap = await loadViaImage(file);
  }

  try {
    const scale = Math.min(1, MAX_COVER_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // White backdrop so transparent artwork doesn't turn black in JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= MAX_COVER_BYTES) {
        return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
}

function loadViaImage(file: File): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      createImageBitmap(img).then(resolve, reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode_failed'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
