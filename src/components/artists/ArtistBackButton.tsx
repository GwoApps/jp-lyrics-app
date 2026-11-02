'use client';

import { useSyncExternalStore } from 'react';
import { ArrowLeft, UsersRound } from 'lucide-react';
import { Link, useTransitionRouter } from 'next-view-transitions';
import { useI18n } from '@/lib/i18n';
import { canNavigateBack, navigateArtistBack } from './artist-back-navigation';

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}
function hasPreviousEntry() {
  const navigation = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
  return canNavigateBack(window.history.length, navigation?.canGoBack);
}
function hasConfirmedPreviousEntry() {
  const navigation = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
  return navigation?.canGoBack ?? window.history.length > 1;
}
const noPreviousEntry = () => false;

export default function ArtistBackButton() {
  const { t } = useI18n();
  const router = useTransitionRouter();
  const canGoBack = useSyncExternalStore(subscribe, hasPreviousEntry, noPreviousEntry);
  const confirmed = useSyncExternalStore(subscribe, hasConfirmedPreviousEntry, noPreviousEntry);
  return (
    <div className="artist-back-navigation">
      {canGoBack && <button className="artists-back" type="button" title={t('artists.backHint')}
        onClick={() => navigateArtistBack(hasPreviousEntry(), window.history, (path) => router.replace(path))}>
        <ArrowLeft size={15} aria-hidden="true" /><span>{t('artists.back')}</span>
      </button>}
      {/* An explicit destination remains available when history is empty or
          opaque (e.g. direct entry or a cross-origin previous document). */}
      {!confirmed && <Link className="artists-back" href="/artists" replace title={t('artists.allArtists')}>
        <UsersRound size={15} aria-hidden="true" /><span>{t('artists.allArtists')}</span>
      </Link>}
    </div>
  );
}
