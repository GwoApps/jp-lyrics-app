/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import AdminTabs from '@/components/admin/AdminTabs';
import AdminUserList, { type UserRoleFilter, type UserStatusFilter } from '@/components/admin/AdminUserList';
import AdminSongList, { type SongOrder, type SongReviewFilter, type SongSort, type SongStatusFilter } from '@/components/admin/AdminSongList';
import AdminQueueList from '@/components/admin/AdminQueueList';
import AdminQueueDetail from '@/components/admin/AdminQueueDetail';
import AdminSystemPanel from '@/components/admin/AdminSystemPanel';
import SongPreviewDialog from '@/components/admin/SongPreviewDialog';
import BlockUserDialog from '@/components/admin/BlockUserDialog';
import {
  adminErrorMessage,
  type AdminPage,
  type AdminSong,
  type AdminUser,
  type AdminView,
} from '@/components/admin/admin-types';
import { useI18n } from '@/lib/i18n';
import { useAuthSession } from '@/lib/auth-session';

const PAGE_LIMIT = 25;

function viewFromParam(value: string | null): AdminView {
  return value === 'content' || value === 'people' || value === 'system' ? value : 'queue';
}

function songFiltersFromParams(searchParams: URLSearchParams) {
  return {
    q: searchParams.get('q') ?? '',
    status: (searchParams.get('status') ?? 'all') as SongStatusFilter,
    review: (searchParams.get('review') ?? 'all') as SongReviewFilter,
    sort: (searchParams.get('sort') ?? 'updated') as SongSort,
    order: (searchParams.get('order') ?? 'desc') as SongOrder,
  };
}

function userFiltersFromParams(searchParams: URLSearchParams) {
  return {
    q: searchParams.get('q') ?? '',
    role: (searchParams.get('role') ?? 'all') as UserRoleFilter,
    status: (searchParams.get('status') ?? 'all') as UserStatusFilter,
  };
}

export default function AdminPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  // View + URL-synced filters (ISSUE #82: URL restores view, search & filters).
  const view = viewFromParam(searchParams.get('view'));
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Pending queue (view=queue) — the default entry.
  const [queueSongs, setQueueSongs] = useState<AdminSong[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);

  // Content library (view=content).
  const songFilters = useMemo(() => songFiltersFromParams(searchParams), [searchParams]);
  const songCursor = searchParams.get('cursor');
  const [songs, setSongs] = useState<AdminSong[]>([]);
  const [songsTotal, setSongsTotal] = useState<number | undefined>(undefined);
  const [songsLoading, setSongsLoading] = useState(true);
  const [songsError, setSongsError] = useState(false);
  const [songHasNext, setSongHasNext] = useState(false);
  const [songHasPrev, setSongHasPrev] = useState(false);
  const [songNextCursor, setSongNextCursor] = useState<string | null>(null);
  const songPrevStack = useRef<string[]>([]);

  // People (view=people).
  const userFilters = useMemo(() => userFiltersFromParams(searchParams), [searchParams]);
  const userCursor = searchParams.get('cursor');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState<number | undefined>(undefined);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState(false);
  const [userHasNext, setUserHasNext] = useState(false);
  const [userHasPrev, setUserHasPrev] = useState(false);
  const [userNextCursor, setUserNextCursor] = useState<string | null>(null);
  const userPrevStack = useRef<string[]>([]);

  // Dialogs / confirmations.
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUser | null>(null);
  const [deleteSongTarget, setDeleteSongTarget] = useState<AdminSong | null>(null);
  const [blockUserTarget, setBlockUserTarget] = useState<AdminUser | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [previewSong, setPreviewSong] = useState<AdminSong | null>(null);
  const previewScrollPosition = useRef({ x: 0, y: 0 });

  const { session } = useAuthSession();
  const isAdmin = session?.user?.isAdmin === true;
  const currentUserId = session?.user?.email || '';

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleOpenPreview = useCallback((song: AdminSong) => {
    previewScrollPosition.current = { x: window.scrollX, y: window.scrollY };
    setPreviewSong(song);
  }, []);

  const handleClosePreview = useCallback(() => {
    const { x, y } = previewScrollPosition.current;
    setPreviewSong(null);
    requestAnimationFrame(() => window.scrollTo(x, y));
  }, []);

  // Opening the fixed dialog must not move the content list underneath it.
  // This defensive restore happens before paint; AdminTabs separately avoids
  // vertically scrolling the page when unrelated parent state changes.
  useLayoutEffect(() => {
    if (!previewSong) return;
    const { x, y } = previewScrollPosition.current;
    window.scrollTo(x, y);
  }, [previewSong]);

  // --- URL helpers -----------------------------------------------------------

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    // Changing filters resets pagination unless explicitly preserved.
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const setView = useCallback((next: AdminView) => {
    // Wipe the previous view's filters so shared query keys never leak across
    // tabs (content's q/status/sort vs people's q/role, etc.).
    setParam({
      view: next,
      cursor: null,
      prev: null,
      q: null,
      status: null,
      review: null,
      sort: null,
      order: null,
      role: null,
    });
  }, [setParam]);

  // --- Pending queue ---------------------------------------------------------

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) setQueueLoading(true);
    setQueueError(false);
    try {
      const res = await fetch(`/api/admin/songs?mode=queue&limit=${PAGE_LIMIT}&total=1`);
      if (!res.ok) throw new Error('queue_load_failed');
      const data = (await res.json()) as AdminPage<AdminSong>;
      setQueueSongs(data.items);
      if (typeof data.total === 'number') setQueueTotal(data.total);
      if (data.items.length > 0) {
        setSelectedSongId((prev) => prev ?? data.items[0]!.id);
      }
    } catch {
      setQueueError(true);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session === null) return;
    if (!isAdmin) {
      router.replace('/');
      return;
    }
    if (view === 'queue') void loadQueue();
  }, [session, isAdmin, router, view, loadQueue]);

  const advanceQueue = useCallback((doneSong: AdminSong, opts?: { keep?: boolean }) => {
    if (opts?.keep) {
      // Undo-approve: the song returns to the queue — reload to refresh state.
      void loadQueue(true);
      return;
    }
    setQueueSongs((prev) => {
      const next = prev.filter((s) => s.id !== doneSong.id);
      if (next.length > 0) {
        setSelectedSongId((sel) => (sel === doneSong.id ? next[0]!.id : sel));
      } else {
        setSelectedSongId(null);
      }
      setQueueTotal((n) => Math.max(0, n - 1));
      return next;
    });
  }, [loadQueue]);

  const runSongAction = useCallback(async (song: AdminSong, action: string): Promise<boolean> => {
    try {
      const body: Record<string, string> = { action };
      // Undo-approve is a short-time reversal by the same admin right after an
      // approve (whose server write changed updated_at); carrying the old
      // optimistic lock would reject the legitimate undo with a false 409.
      if (action !== 'undo_approve') body.expected_updated_at = song.updated_at;
      const res = await fetch(`/api/admin/songs/${encodeURIComponent(song.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const updated = data as AdminSong;
        // Update the content list in place with the merged summary so quality
        // fields never disappear; the queue advances via advanceQueue().
        setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, ...updated } : s)));
        if (action === 'approve_public') showToast('success', t('admin.approved'));
        else if (action === 'reject_public') showToast('success', t('admin.rejected'));
        else if (action === 'undo_approve') showToast('success', t('admin.undone'));
        return true;
      }
      if (res.status === 409) {
        showToast('error', t('admin.staleResource'));
        return false;
      }
      const fallback = action === 'approve_public' ? t('admin.approveFailed') : action === 'reject_public' ? t('admin.rejectFailed') : t('admin.updateSongFailed');
      showToast('error', adminErrorMessage(t, (data as { error?: string }).error, fallback));
      return false;
    } catch {
      showToast('error', action === 'approve_public' ? t('admin.approveFailed') : action === 'reject_public' ? t('admin.rejectFailed') : t('admin.updateSongFailed'));
      return false;
    }
  }, [showToast, t]);

  // --- Content library -------------------------------------------------------

  useEffect(() => {
    if (session === null || !isAdmin || view !== 'content') return;
    let cancelled = false;
    setSongsLoading(true);
    setSongsError(false);
    const params = new URLSearchParams({
      mode: 'content',
      limit: String(PAGE_LIMIT),
      total: '1',
      sort: songFilters.sort,
      order: songFilters.order,
    });
    if (songFilters.q) params.set('q', songFilters.q);
    if (songFilters.status !== 'all') params.set('status', songFilters.status);
    if (songFilters.review !== 'all') params.set('review', songFilters.review);
    if (songCursor) params.set('cursor', songCursor);

    fetch(`/api/admin/songs?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('songs_load_failed');
        return (await res.json()) as AdminPage<AdminSong>;
      })
      .then((data) => {
        if (cancelled) return;
        setSongs(data.items);
        setSongsTotal(data.total);
        setSongNextCursor(data.next_cursor);
        setSongHasNext(!!data.next_cursor);
        const stack = searchParams.getAll('prev');
        songPrevStack.current = stack;
        setSongHasPrev(stack.length > 0);
        setSongsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSongsError(true);
        setSongsLoading(false);
      });
    return () => { cancelled = true; };
  }, [session, isAdmin, view, searchParams, songFilters, songCursor]);

  const applySongFilters = useCallback((updates: Record<string, string | null>) => {
    setParam({ ...updates, cursor: null, prev: null });
  }, [setParam]);

  // Debounce free-text search so each keystroke doesn't fire a server round trip.
  const songSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSongSearch = useCallback((q: string) => {
    if (songSearchTimer.current) clearTimeout(songSearchTimer.current);
    songSearchTimer.current = setTimeout(() => applySongFilters({ q: q || null }), 300);
  }, [applySongFilters]);

  const songNext = useCallback(() => {
    if (!songNextCursor) return;
    const next = songNextCursor;
    // Record the current page's position ('' = page 1) so Previous works.
    const stack = [...songPrevStack.current, songCursor ?? ''];
    const params = new URLSearchParams(searchParams.toString());
    params.set('cursor', next);
    params.delete('prev');
    stack.forEach((c) => params.append('prev', c));
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [songNextCursor, songCursor, searchParams, router]);

  const songPrev = useCallback(() => {
    const stack = [...songPrevStack.current];
    const prevCursor = stack.pop();
    if (!prevCursor) return;
    const params = new URLSearchParams(searchParams.toString());
    if (prevCursor) params.set('cursor', prevCursor);
    else params.delete('cursor');
    params.delete('prev');
    stack.forEach((c) => params.append('prev', c));
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // --- People ----------------------------------------------------------------

  useEffect(() => {
    if (session === null || !isAdmin || view !== 'people') return;
    let cancelled = false;
    setUsersLoading(true);
    setUsersError(false);
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), total: '1' });
    if (userFilters.q) params.set('q', userFilters.q);
    if (userFilters.role !== 'all') params.set('role', userFilters.role);
    if (userFilters.status !== 'all') params.set('status', userFilters.status);
    if (userCursor) params.set('cursor', userCursor);

    fetch(`/api/admin/users?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('users_load_failed');
        return (await res.json()) as AdminPage<AdminUser>;
      })
      .then((data) => {
        if (cancelled) return;
        setUsers(data.items);
        setUsersTotal(data.total);
        setUserNextCursor(data.next_cursor);
        setUserHasNext(!!data.next_cursor);
        const stack = searchParams.getAll('prev');
        userPrevStack.current = stack;
        setUserHasPrev(stack.length > 0);
        setUsersLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUsersError(true);
        setUsersLoading(false);
      });
    return () => { cancelled = true; };
  }, [session, isAdmin, view, searchParams, userFilters, userCursor]);

  const applyUserFilters = useCallback((updates: Record<string, string | null>) => {
    setParam({ ...updates, cursor: null, prev: null });
  }, [setParam]);

  const userSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleUserSearch = useCallback((q: string) => {
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current);
    userSearchTimer.current = setTimeout(() => applyUserFilters({ q: q || null }), 300);
  }, [applyUserFilters]);

  const userNext = useCallback(() => {
    if (!userNextCursor) return;
    const cursor = userNextCursor;
    // Record the current page's position ('' = page 1) so Previous works.
    const stack = [...userPrevStack.current, userCursor ?? ''];
    const params = new URLSearchParams(searchParams.toString());
    params.set('cursor', cursor);
    params.delete('prev');
    stack.forEach((c) => params.append('prev', c));
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [userNextCursor, userCursor, searchParams, router]);

  const userPrev = useCallback(() => {
    const stack = [...userPrevStack.current];
    const prevCursor = stack.pop();
    if (!prevCursor) return;
    const params = new URLSearchParams(searchParams.toString());
    if (prevCursor) params.set('cursor', prevCursor);
    else params.delete('cursor');
    params.delete('prev');
    stack.forEach((c) => params.append('prev', c));
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // --- User actions ----------------------------------------------------------

  const runUserAction = useCallback(async (user: AdminUser, action: string, reason = ''): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, expected_updated_at: user.updated_at }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const updated = data as AdminUser;
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
        return true;
      }
      if (res.status === 409) {
        showToast('error', t('admin.staleResource'));
        return false;
      }
      showToast('error', adminErrorMessage(t, (data as { error?: string }).error, t('admin.updateUserFailed')));
      return false;
    } catch {
      showToast('error', t('admin.updateUserFailed'));
      return false;
    }
  }, [showToast, t]);

  const handlePromote = useCallback(async (user: AdminUser) => {
    const ok = await runUserAction(user, 'promote');
    if (ok) showToast('success', t('admin.promoted'));
  }, [runUserAction, showToast, t]);

  const handleDemote = useCallback(async (user: AdminUser) => {
    if (user.id === currentUserId) return;
    const ok = await runUserAction(user, 'demote');
    if (ok) showToast('success', t('admin.demoted'));
  }, [runUserAction, currentUserId, showToast, t]);

  const handleBlockUser = useCallback(async () => {
    if (!blockUserTarget) return;
    if (blockUserTarget.id === currentUserId) return;
    const ok = await runUserAction(blockUserTarget, blockUserTarget.is_blocked === 1 ? 'unblock' : 'block', blockUserTarget.is_blocked === 1 ? '' : blockReason);
    if (ok) showToast('success', blockUserTarget.is_blocked === 1 ? t('admin.unblocked') : t('admin.blocked'));
    setBlockUserTarget(null);
    setBlockReason('');
  }, [blockUserTarget, blockReason, currentUserId, runUserAction, showToast, t]);

  const handleDeleteUser = useCallback(async () => {
    if (!deleteUserTarget) return;
    if (deleteUserTarget.id === currentUserId) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(deleteUserTarget.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== deleteUserTarget.id));
        showToast('success', t('admin.userDeleted'));
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('error', adminErrorMessage(t, (err as { error?: string }).error, t('admin.deleteUserFailed')));
      }
    } catch {
      showToast('error', t('admin.deleteUserFailed'));
    }
    setDeleteUserTarget(null);
  }, [deleteUserTarget, currentUserId, showToast, t]);

  // --- Song actions (content view) ------------------------------------------

  const handlePublish = useCallback(async (song: AdminSong) => {
    const ok = await runSongAction(song, 'publish');
    if (ok) showToast('success', t('admin.published'));
  }, [runSongAction, showToast, t]);

  const handleUnpublish = useCallback(async (song: AdminSong) => {
    const ok = await runSongAction(song, 'unpublish');
    if (ok) showToast('success', t('admin.unpublished'));
  }, [runSongAction, showToast, t]);

  const handleDeleteSong = useCallback(async () => {
    if (!deleteSongTarget) return;
    try {
      const res = await fetch(`/api/admin/songs/${encodeURIComponent(deleteSongTarget.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSongs((prev) => prev.filter((s) => s.id !== deleteSongTarget.id));
        showToast('success', t('admin.songDeleted'));
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('error', adminErrorMessage(t, (err as { error?: string }).error, t('admin.deleteSongFailed')));
      }
    } catch {
      showToast('error', t('admin.deleteSongFailed'));
    }
    setDeleteSongTarget(null);
  }, [deleteSongTarget, showToast, t]);

  if (!isAdmin) return null;

  const selectedSong = queueSongs.find((s) => s.id === selectedSongId) ?? queueSongs[0] ?? null;

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('admin.backToHome')}
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">{t('admin.title')}</h1>
      </div>

      <AdminTabs view={view} onViewChange={setView} pendingCount={queueTotal} />

      {/* Queue: list-detail workflow */}
      {view === 'queue' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto pr-1">
            {queueLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : queueError ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-[var(--destructive)]">{t('admin.queueLoadFailed')}</p>
                <button
                  type="button"
                  onClick={() => void loadQueue()}
                  className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  {t('admin.retry')}
                </button>
              </div>
            ) : (
              <AdminQueueList
                songs={queueSongs}
                locale={locale}
                selectedId={selectedSongId}
                onSelect={(s) => setSelectedSongId(s.id)}
              />
            )}
          </div>
          <div>
            {selectedSong ? (
              <AdminQueueDetail
                key={selectedSong.id}
                song={selectedSong}
                locale={locale}
                onDone={advanceQueue}
                onApprove={(s) => runSongAction(s, 'approve_public')}
                onReject={(s) => runSongAction(s, 'reject_public')}
                onUndoApprove={(s) => runSongAction(s, 'undo_approve')}
              />
            ) : (
              !queueLoading && !queueError && (
                <div className="flex items-center justify-center py-16 text-[var(--muted-foreground)] text-sm">
                  {t('admin.noPending')}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Content library */}
      {view === 'content' && (
        songsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : songsError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-[var(--destructive)]">{t('admin.songsLoadFailed')}</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              {t('admin.retry')}
            </button>
          </div>
        ) : (
          <AdminSongList
            songs={songs}
            total={songsTotal}
            q={songFilters.q}
            status={songFilters.status}
            review={songFilters.review}
            sort={songFilters.sort}
            order={songFilters.order}
            hasNext={songHasNext}
            hasPrev={songHasPrev}
            onQChange={handleSongSearch}
            onStatusChange={(s) => applySongFilters({ status: s === 'all' ? null : s })}
            onReviewChange={(r) => applySongFilters({ review: r === 'all' ? null : r })}
            onSortChange={(s) => applySongFilters({ sort: s })}
            onOrderChange={(o) => applySongFilters({ order: o })}
            onNext={songNext}
            onPrev={songPrev}
            onPreview={handleOpenPreview}
            onPublish={handlePublish}
            onUnpublish={handleUnpublish}
            onDelete={setDeleteSongTarget}
            locale={locale}
          />
        )
      )}

      {/* People */}
      {view === 'people' && (
        usersLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : usersError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-[var(--destructive)]">{t('admin.usersLoadFailed')}</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              {t('admin.retry')}
            </button>
          </div>
        ) : (
          <AdminUserList
            users={users}
            total={usersTotal}
            q={userFilters.q}
            role={userFilters.role}
            status={userFilters.status}
            hasNext={userHasNext}
            hasPrev={userHasPrev}
            onQChange={handleUserSearch}
            onRoleChange={(r) => applyUserFilters({ role: r === 'all' ? null : r })}
            onStatusChange={(s) => applyUserFilters({ status: s === 'all' ? null : s })}
            onNext={userNext}
            onPrev={userPrev}
            currentUserId={currentUserId}
            locale={locale}
            onPromote={(u) => void handlePromote(u)}
            onDemote={(u) => void handleDemote(u)}
            onBlock={(u) => { setBlockUserTarget(u); setBlockReason(''); }}
            onUnblock={(u) => void runUserAction(u, 'unblock').then((ok) => { if (ok) showToast('success', t('admin.unblocked')); })}
            onDelete={setDeleteUserTarget}
          />
        )
      )}

      {/* System */}
      {view === 'system' && (
        <AdminSystemPanel />
      )}


      {/* Delete User Confirmation */}
      <ConfirmDialog
        open={!!deleteUserTarget}
        title={t('admin.confirmDeleteUser')}
        body={deleteUserTarget
          ? `${deleteUserTarget.display_name || deleteUserTarget.id}\n${t('admin.deleteUserImpact', {
              songs: String(deleteUserTarget.song_count ?? 0),
              favorites: String(deleteUserTarget.favorite_count ?? 0),
              collections: String(deleteUserTarget.collection_count ?? 0),
            })}`
          : undefined}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteUserTarget(null)}
      />

      {/* Delete Song Confirmation */}
      <ConfirmDialog
        open={!!deleteSongTarget}
        title={t('admin.confirmDeleteSong')}
        body={deleteSongTarget?.title}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={handleDeleteSong}
        onCancel={() => setDeleteSongTarget(null)}
      />

      {/* Song content preview */}
      <SongPreviewDialog
        key={previewSong?.id ?? 'none'}
        song={previewSong}
        locale={locale}
        onClose={handleClosePreview}
      />

      {/* Block/Unblock User Dialog */}
      <BlockUserDialog
        target={blockUserTarget}
        reason={blockReason}
        onReasonChange={setBlockReason}
        onConfirm={handleBlockUser}
        onCancel={() => setBlockUserTarget(null)}
      />

      {toast && <Toast type={toast.type} message={toast.msg} />}
    </div>
  );
}
