'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import TranslationConfigPanel from '@/components/admin/TranslationConfigPanel';
import AdminTabs from '@/components/admin/AdminTabs';
import AdminUserList from '@/components/admin/AdminUserList';
import AdminSongList from '@/components/admin/AdminSongList';
import AdminPendingList from '@/components/admin/AdminPendingList';
import SongPreviewDialog from '@/components/admin/SongPreviewDialog';
import BlockUserDialog from '@/components/admin/BlockUserDialog';
import { adminErrorMessage, type AdminSong, type AdminTab, type AdminUser } from '@/components/admin/admin-types';
import { useI18n } from '@/lib/i18n';
import { useAuthSession } from '@/lib/auth-session';

export default function AdminPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [songs, setSongs] = useState<AdminSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUser | null>(null);
  const [deleteSongTarget, setDeleteSongTarget] = useState<AdminSong | null>(null);
  const [blockUserTarget, setBlockUserTarget] = useState<AdminUser | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [previewSong, setPreviewSong] = useState<AdminSong | null>(null);
  const [approveTarget, setApproveTarget] = useState<AdminSong | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminSong | null>(null);
  const { session } = useAuthSession();
  const isAdmin = session?.user?.isAdmin === true;
  const currentUserId = session?.user?.email || '';

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [usersRes, songsRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/songs'),
      ]);
      if (!usersRes.ok || !songsRes.ok) throw new Error('admin_load_failed');
      setUsers(await usersRes.json());
      setSongs(await songsRes.json());
    } catch {
      showToast('error', t('admin.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    // Wait for the first server revalidation only when no cached state exists.
    if (session === null) return;
    if (!isAdmin) {
      router.replace('/');
      return;
    }
    const loadTimer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [session, isAdmin, router, loadData]);

  const handleToggleAdmin = async (user: AdminUser) => {
    if (user.id === currentUserId) return; // Self-protection
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_admin: user.is_admin === 1 ? 0 : 1 }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.updateUserFailed'));
      }
    } catch {
      showToast('error', t('admin.updateUserFailed'));
    }
  };

  const handleBlockUser = async () => {
    if (!blockUserTarget) return;
    if (blockUserTarget.id === currentUserId) return; // Self-protection
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(blockUserTarget.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_blocked: blockUserTarget.is_blocked === 1 ? 0 : 1,
          blocked_reason: blockUserTarget.is_blocked === 1 ? '' : blockReason,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUsers(prev => prev.map(u => u.id === blockUserTarget.id ? updated : u));
        showToast('success', blockUserTarget.is_blocked === 1 ? t('admin.unblocked') : t('admin.blocked'));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.updateUserFailed'));
      }
    } catch {
      showToast('error', t('admin.updateUserFailed'));
    }
    setBlockUserTarget(null);
    setBlockReason('');
  };

  const handleDeleteUser = async () => {
    if (!deleteUserTarget) return;
    if (deleteUserTarget.id === currentUserId) return; // Self-protection
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(deleteUserTarget.id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.id !== deleteUserTarget.id));
        showToast('success', t('admin.userDeleted'));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.deleteUserFailed'));
      }
    } catch {
      showToast('error', t('admin.deleteUserFailed'));
    }
    setDeleteUserTarget(null);
  };

  const handleToggleVisibility = async (song: AdminSong) => {
    try {
      const res = await fetch(`/api/admin/songs/${song.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: song.is_public === 1 ? 0 : 1 }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSongs(prev => prev.map(s => s.id === song.id ? updated : s));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.updateSongFailed'));
      }
    } catch {
      showToast('error', t('admin.updateSongFailed'));
    }
  };

  const handleApprovePublic = async (song: AdminSong) => {
    setApproveTarget(null);
    try {
      const res = await fetch(`/api/admin/songs/${song.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: 1 }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSongs(prev => prev.map(s => s.id === song.id ? updated : s));
        showToast('success', t('admin.approved'));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.approveFailed'));
      }
    } catch {
      showToast('error', t('admin.approveFailed'));
    }
  };

  const handleRejectPublic = async (song: AdminSong) => {
    setRejectTarget(null);
    try {
      const res = await fetch(`/api/admin/songs/${song.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: 0 }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSongs(prev => prev.map(s => s.id === song.id ? updated : s));
        showToast('success', t('admin.rejected'));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.rejectFailed'));
      }
    } catch {
      showToast('error', t('admin.rejectFailed'));
    }
  };

  const handleDeleteSong = async () => {
    if (!deleteSongTarget) return;
    try {
      const res = await fetch(`/api/admin/songs/${deleteSongTarget.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSongs(prev => prev.filter(s => s.id !== deleteSongTarget.id));
        showToast('success', t('admin.songDeleted'));
      } else {
        const err = await res.json();
        showToast('error', adminErrorMessage(t, err.error, 'admin.deleteSongFailed'));
      }
    } catch {
      showToast('error', t('admin.deleteSongFailed'));
    }
    setDeleteSongTarget(null);
  };

  if (!isAdmin) return null;


  const pendingSongs = songs.filter(s => s.public_requested === 1 && s.is_public === 0);

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

      <AdminTabs
        tab={tab}
        onTabChange={setTab}
        usersCount={users.length}
        songsCount={songs.length}
        pendingCount={pendingSongs.length}
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : tab === 'users' ? (
        <AdminUserList
          users={users}
          currentUserId={currentUserId}
          locale={locale}
          onToggleAdmin={handleToggleAdmin}
          onBlock={(u) => { setBlockUserTarget(u); setBlockReason(''); }}
          onDelete={setDeleteUserTarget}
        />
      ) : tab === 'songs' ? (
        <AdminSongList
          songs={songs}
          locale={locale}
          onPreview={setPreviewSong}
          onToggleVisibility={handleToggleVisibility}
          onApprove={(song) => setApproveTarget(song)}
          onReject={(song) => setRejectTarget(song)}
          onDelete={setDeleteSongTarget}
        />
      ) : tab === 'pending' ? (
        <AdminPendingList
          songs={pendingSongs}
          locale={locale}
          onPreview={setPreviewSong}
          onApprove={(song) => setApproveTarget(song)}
          onReject={(song) => setRejectTarget(song)}
        />
      ) : (
        <TranslationConfigPanel />
      )}
      {/* Delete User Confirmation */}
      <ConfirmDialog
        open={!!deleteUserTarget}
        title={t('admin.confirmDeleteUser')}
        body={deleteUserTarget?.display_name || deleteUserTarget?.id}
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

      {/* Approve Public Confirmation */}
      <ConfirmDialog
        open={!!approveTarget}
        title={t('admin.confirmApproveTitle', { title: approveTarget?.title || '' })}
        body={t('admin.confirmApproveBody', { title: approveTarget?.title || '' })}
        confirmLabel={t('admin.approve')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => approveTarget && handleApprovePublic(approveTarget)}
        onCancel={() => setApproveTarget(null)}
      />

      {/* Reject Public Confirmation */}
      <ConfirmDialog
        open={!!rejectTarget}
        title={t('admin.confirmRejectTitle', { title: rejectTarget?.title || '' })}
        body={t('admin.confirmRejectBody', { title: rejectTarget?.title || '' })}
        confirmLabel={t('admin.reject')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => rejectTarget && handleRejectPublic(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
      />

      {/* Song content preview */}
      <SongPreviewDialog
        key={previewSong?.id ?? 'none'}
        song={previewSong}
        locale={locale}
        onClose={() => setPreviewSong(null)}
        onApprove={(song) => { setPreviewSong(null); setApproveTarget(song); }}
        onReject={(song) => { setPreviewSong(null); setRejectTarget(song); }}
      />

      {/* Block/Unblock User Dialog */}
      <BlockUserDialog
        target={blockUserTarget}
        reason={blockReason}
        onReasonChange={setBlockReason}
        onConfirm={handleBlockUser}
        onCancel={() => setBlockUserTarget(null)}
      />
    </div>
  );
}
