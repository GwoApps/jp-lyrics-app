import { isSameOriginRequest } from './admin.ts';
import type { ArtistProfile } from './artists.ts';
import type { ArtistProfileLookup } from './artist-profile-lookup.ts';
import type { ArtistProfileOverride } from './artist-profile-types.ts';
import { ArtistProfileError, artistOverrideKey, isRecord, MAX_ARTIST_PROFILE_BYTES, readArtistJson, validateArtistProfileOverride, validArtistSourceId } from './artist-profile-validation.ts';

interface ProfileAdminDependencies<TRequest extends Request> {
  getUser: (request: TRequest) => Promise<{ isAdmin?: boolean; email?: string } | null>;
  getOverride: (name: string) => Promise<ArtistProfileOverride | null>;
  setOverride: (name: string, value: ArtistProfileOverride) => Promise<ArtistProfileOverride>;
  deleteOverride: (name: string) => Promise<void>;
  lookup: ArtistProfileLookup;
}
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const failed = (error: unknown, fallback: string) => error instanceof ArtistProfileError
  ? json({ error: error.message }, error.status) : json({ error: fallback }, 500);

/** NextURL normalizes loopback hosts, so real HTTP Host is the browser authority.
 * Plain Web Requests without Next metadata use their URL; neither path trusts Origin. */
const sameOrigin = (request: Request & { nextUrl?: { host: string } }) => isSameOriginRequest({
  headers: request.headers,
  nextUrl: { host: request.nextUrl ? request.headers.get('Host') ?? request.nextUrl.host : new URL(request.url).host },
});

/** Auth executes before origin checks, body parsing, DB access, or upstream lookup, on every verb. */
export function createArtistProfileAdminHandlers<TRequest extends Request>(deps: ProfileAdminDependencies<TRequest>) {
  return {
    async get(request: TRequest, name: string) {
      try {
        if (!(await deps.getUser(request))?.isAdmin) return json({ error: 'forbidden' }, 403);
        artistOverrideKey(name);
        return json({ override: await deps.getOverride(name) });
      } catch (error) { return failed(error, 'artist_profile_load_failed'); }
    },
    async put(request: TRequest, name: string) {
      try {
        if (!(await deps.getUser(request))?.isAdmin) return json({ error: 'forbidden' }, 403);
        if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
        artistOverrideKey(name);
        const body = await readArtistJson(request, MAX_ARTIST_PROFILE_BYTES, 'artist_profile_invalid_body');
        if (!isRecord(body) || !('override' in body) || Object.keys(body).some((key) => !['override', 'confirmIdentity'].includes(key))
          || (body.confirmIdentity !== undefined && typeof body.confirmIdentity !== 'boolean')) throw new ArtistProfileError('artist_profile_invalid_body');
        const override = validateArtistProfileOverride(body.override);
        if ((override.spotifyArtistId || override.musicbrainzId || override.wikidataId) && body.confirmIdentity !== true) {
          throw new ArtistProfileError('artist_profile_confirmation_required');
        }
        return json({ override: await deps.setOverride(name, override) });
      } catch (error) { return failed(error, 'artist_profile_save_failed'); }
    },
    async delete(request: TRequest, name: string) {
      try {
        if (!(await deps.getUser(request))?.isAdmin) return json({ error: 'forbidden' }, 403);
        if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
        artistOverrideKey(name);
        await deps.deleteOverride(name);
        return json({ override: null });
      } catch (error) { return failed(error, 'artist_profile_save_failed'); }
    },
    async lookup(request: TRequest) {
      try {
        const user = await deps.getUser(request);
        if (!user?.isAdmin) return json({ error: 'forbidden' }, 403);
        if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
        const body = await readArtistJson(request, 1024, 'artist_profile_invalid_body');
        if (!isRecord(body) || Object.keys(body).some((key) => !['source', 'id'].includes(key))
          || typeof body.source !== 'string' || !['musicbrainz', 'wikidata', 'spotify'].includes(body.source)) throw new ArtistProfileError('artist_profile_invalid_lookup');
        const source = body.source as 'musicbrainz' | 'wikidata' | 'spotify';
        if (!validArtistSourceId(source, body.id)) throw new ArtistProfileError('artist_profile_invalid_id');
        const profile: ArtistProfile = await deps.lookup(source, body.id, user.email);
        return json({ profile });
      } catch (error) { return failed(error, 'artist_profile_lookup_unavailable'); }
    },
  };
}
