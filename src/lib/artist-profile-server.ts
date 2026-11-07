import { getAuthUser } from './auth';
import { getDB } from './db';
import { createArtistProfileAdminHandlers } from './artist-profile-admin.ts';
import { createManagedArtistProfileResolver } from './artist-profile-managed.ts';
import { lookupArtistProfile } from './artist-profile-lookup.ts';
import { deleteArtistProfileOverride, getArtistProfileOverride, setArtistProfileOverride } from './artist-profile-store.ts';

export const getManagedArtistProfile = createManagedArtistProfileResolver({
  getOverride: (name) => getArtistProfileOverride(getDB(), name),
});
export const artistProfileAdminHandlers = createArtistProfileAdminHandlers({
  getUser: getAuthUser,
  getOverride: (name) => getArtistProfileOverride(getDB(), name),
  setOverride: (name, override) => setArtistProfileOverride(getDB(), name, override),
  deleteOverride: (name) => deleteArtistProfileOverride(getDB(), name),
  lookup: lookupArtistProfile,
});
