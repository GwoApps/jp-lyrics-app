'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Users, Music, Shield, ShieldOff, Ban, Trash2, ArrowLeft, Eye, EyeOff, Loader2, Clock, Check, X } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useAuthSession } from '@/lib/auth-session';

interface AdminUser {
  id: string;
  display_name: string;
  is_admin: number;
  is_blocked: number;
  blocked_reason: string;
  created_at: string;
  updated_at: string;
}

interface AdminSong {
  id: string;
  title: string;
  artist: string;
  created_by: string;
  created_by_name: string;
  is_public: number;
  public_requested: number;
  created_at: string;
  updated_at: string;
}

type Tab = 'users' | 'songs' | 'pending';

export default function AdminPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [songs, setSongs] = useState<AdminSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUser | null>(null);
  const [deleteSongTarget, setDeleteSongTarget] = useState<AdminSong | null>(null);
  const [blockUserTarget, setBlockUserTarget] = useState<AdminUser | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const { session } = useAuthSession();
  const isAdmin = session?.user?.isAdmin === true;
  const currentUserId = session?.user?.email || '';

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    // Wait for the first server revalidation only when no cached state exists.
    if (session === null) return;
    if (!isAdmin) {
      router.replace('/');
      return;
    }
    void loadData();
  }, [session, isAdmin, router]);

  async function loadData() {
    setLoading(true);
    try {
      const [usersRes, songsRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/songs'),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json());
      if (songsRes.ok) setSongs(await songsRes.json());
    } catch {
      showToast('error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

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
        showToast('error', err.error || 'Failed to update user');
      }
    } catch {
      showToast('error', 'Failed to update user');
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
      }
    } catch {
      showToast('error', 'Failed to update user');
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
      }
    } catch {
      showToast('error', 'Failed to delete user');
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
      }
    } catch {
      showToast('error', 'Failed to update song');
    }
  };

  const handleApprovePublic = async (song: AdminSong) => {
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
      }
    } catch {
      showToast('error', 'Failed to approve');
    }
  };

  const handleRejectPublic = async (song: AdminSong) => {
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
      }
    } catch {
      showToast('error', 'Failed to reject');
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
      }
    } catch {
      showToast('error', 'Failed to delete song');
    }
    setDeleteSongTarget(null);
  };

  if (!isAdmin) return null;

  const localeMap: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' };
  const bcp47 = localeMap[locale] || 'ja-JP';

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

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border)]">
        <button
          onClick={() => setTab('users')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'users'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          {t('admin.users')} ({users.length})
        </button>
        <button
          onClick={() => setTab('songs')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'songs'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          <Music className="h-3.5 w-3.5" />
          {t('admin.songs')} ({songs.length})
        </button>
        <button
          onClick={() => setTab('pending')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'pending'
              ? 'border-[var(--warning)] text-[var(--warning)]'
              : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          {t('admin.pending')} ({pendingSongs.length})
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : tab === 'users' ? (
        /* Users Tab */
        users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
            <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noUsers')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <div key={u.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{u.display_name || u.id}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          u.is_admin === 1
                            ? 'bg-[var(--primary)]/20 text-[var(--primary)]'
                            : 'bg-[var(--accent)] text-[var(--muted-foreground)]'
                        }`}>
                          {u.is_admin === 1 ? t('admin.adminRole') : t('admin.userRole')}
                        </span>
                        {isSelf && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--accent)] text-[var(--muted-foreground)]">
                            {t('admin.you')}
                          </span>
                        )}
                        {u.is_blocked === 1 && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--destructive)]/20 text-[var(--destructive)]">
                            {t('admin.blocked')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{u.id}</div>
                      {u.is_blocked === 1 && u.blocked_reason && (
                        <div className="text-[10px] text-[var(--destructive)] mt-0.5">{t('admin.blockReason')}: {u.blocked_reason}</div>
                      )}
                      <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                        {new Date(u.created_at).toLocaleDateString(bcp47)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleAdmin(u)}
                        disabled={isSelf}
                        className={`rounded p-2 transition-colors ${
                          isSelf
                            ? 'text-[var(--muted-foreground)]/30 cursor-not-allowed'
                            : u.is_admin === 1
                              ? 'text-[var(--primary)] hover:bg-[var(--primary)]/10'
                              : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--accent)]'
                        }`}
                        title={isSelf ? t('admin.cannotDemoteSelf') : u.is_admin === 1 ? t('admin.demote') : t('admin.promote')}
                      >
                        {u.is_admin === 1 ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => {
                          if (isSelf) return;
                          if (u.is_blocked === 1) {
                            setBlockUserTarget(u);
                            setBlockReason('');
                          } else {
                            setBlockUserTarget(u);
                            setBlockReason('');
                          }
                        }}
                        disabled={isSelf}
                        className={`rounded p-2 transition-colors ${
                          isSelf
                            ? 'text-[var(--muted-foreground)]/30 cursor-not-allowed'
                            : u.is_blocked === 1
                              ? 'text-[var(--warning)] hover:bg-[var(--warning)]/10'
                              : 'text-[var(--muted-foreground)] hover:text-[var(--warning)] hover:bg-[var(--accent)]'
                        }`}
                        title={isSelf ? t('admin.cannotBlockSelf') : u.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => !isSelf && setDeleteUserTarget(u)}
                        disabled={isSelf}
                        className={`rounded p-2 transition-colors ${
                          isSelf
                            ? 'text-[var(--muted-foreground)]/30 cursor-not-allowed'
                            : 'text-[var(--destructive)] hover:bg-[var(--destructive)]/10'
                        }`}
                        title={isSelf ? t('admin.cannotDeleteSelf') : t('common.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'songs' ? (
        /* Songs Tab */
        songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Music className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
            <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noSongs')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {songs.map((s) => (
              <div key={s.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{s.title}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        s.is_public === 1
                          ? 'bg-[var(--success)]/20 text-[var(--success)]'
                          : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                      }`}>
                        {s.is_public === 1 ? t('admin.public') : t('admin.private')}
                      </span>
                      {s.public_requested === 1 && s.is_public === 0 && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)]">
                          <Clock className="h-3 w-3 mr-0.5" />
                          {t('admin.pendingApproval')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{s.artist}</div>
                    {s.created_by_name && (
                      <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{t('home.createdBy')}: {s.created_by_name}</div>
                    )}
                    <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                      {new Date(s.created_at).toLocaleDateString(bcp47)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {s.public_requested === 1 && s.is_public === 0 && (
                      <>
                        <button
                          onClick={() => handleApprovePublic(s)}
                          className="rounded p-2 text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
                          title={t('admin.approve')}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRejectPublic(s)}
                          className="rounded p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
                          title={t('admin.reject')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleToggleVisibility(s)}
                      className={`rounded p-2 transition-colors ${
                        s.is_public === 1
                          ? 'text-[var(--success)] hover:bg-[var(--success)]/10'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--success)] hover:bg-[var(--accent)]'
                      }`}
                      title={t('admin.toggleVisibility')}
                    >
                      {s.is_public === 1 ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setDeleteSongTarget(s)}
                      className="rounded p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Pending Approval Tab */
        pendingSongs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
            <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noPending')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingSongs.map((s) => (
              <div key={s.id} className="rounded-lg bg-[var(--card)] border border-[var(--warning)]/30 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{s.title}</span>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)]">
                        <Clock className="h-3 w-3 mr-0.5" />
                        {t('admin.pendingApproval')}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{s.artist}</div>
                    {s.created_by_name && (
                      <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{t('home.createdBy')}: {s.created_by_name}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApprovePublic(s)}
                      className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/30 transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t('admin.approve')}
                    </button>
                    <button
                      onClick={() => handleRejectPublic(s)}
                      className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--destructive)]/10 text-[var(--destructive)] hover:bg-[var(--destructive)]/20 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t('admin.reject')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {toast && <Toast type={toast.type} message={toast.msg} />}

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

      {/* Block/Unblock User Dialog */}
      {blockUserTarget && (
        <div className="confirm-overlay" onClick={() => setBlockUserTarget(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog-icon">{blockUserTarget.is_blocked === 1 ? '✅' : '🚫'}</div>
            <div className="confirm-dialog-title">
              {blockUserTarget.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
              {' '}{blockUserTarget.display_name || blockUserTarget.id}
            </div>
            {blockUserTarget.is_blocked === 0 && (
              <div className="mt-3">
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder={t('admin.blockReason')}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)] transition-colors"
                />
              </div>
            )}
            <div className="confirm-dialog-actions">
              <button className="confirm-dialog-btn confirm-dialog-btn--cancel" onClick={() => setBlockUserTarget(null)}>
                {t('common.cancel')}
              </button>
              <button
                className={`confirm-dialog-btn ${blockUserTarget.is_blocked === 1 ? 'confirm-dialog-btn--confirm' : 'confirm-dialog-btn--danger'}`}
                onClick={handleBlockUser}
              >
                {blockUserTarget.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
