import type { ArtistProfile } from './types';

interface Job {
  run: () => void;
  signal: AbortSignal;
  cancel: () => void;
}

/** Bound optional profile requests across all visible cards, not per component. */
export function createProfileQueue(concurrency = 4) {
  const pending: Job[] = [];
  let active = 0;

  function drain() {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      job.signal.removeEventListener('abort', job.cancel);
      if (!job.signal.aborted) job.run();
    }
  }

  return function requestProfile(name: string, signal: AbortSignal): Promise<ArtistProfile> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) {
        abort();
        return;
      }
      const job: Job = {
        signal,
        cancel: () => {
          const index = pending.indexOf(job);
          if (index !== -1) pending.splice(index, 1);
          abort();
        },
        run: () => {
          active += 1;
          void fetch(`/api/artists/${encodeURIComponent(name)}/profile`, { signal, cache: 'no-store' })
            .then(async (response) => {
              if (!response.ok) throw new Error('profile_load_failed');
              const body = await response.json() as { profile?: ArtistProfile };
              if (!body.profile || !Array.isArray(body.profile.genres)) throw new Error('invalid_profile');
              if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
              return body.profile;
            })
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              drain();
            });
        },
      };
      signal.addEventListener('abort', job.cancel, { once: true });
      pending.push(job);
      drain();
    });
  };
}

export const requestArtistProfile = createProfileQueue();

/** Only remote HTTP(S) source URLs may become attribution links. */
export function profileSourceHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
