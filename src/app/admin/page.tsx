'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Music, Shield, ShieldOff, Ban, Trash2, ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';

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
  created_at: string;
  updated_at: string;
}

type Tab = 'users' | 'songs';

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
  const [isAdmin, setIsAdmin] = useState(false);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    // Check admin status
    fetch('/api/me')
      .then(r => r.json())
      .then(data => {
        if (!data.authenticated || !data.isAdmin) {
          router.push('/');
          return;
        }
        setIsAdmin(true);
        loadData();
      })
      .catch(() => router.push('/'));
  }, []);

  const loadData = async () => {
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
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_admin: user.is_admin === 1 ? 0 : 1 }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUsers(prev => prev.map(u => u.id === user.id ? updated : u));
      }
    } catch {
      showToast('error', 'Failed to update user');
    }
  };

  const handleBlockUser = async () => {
    if (!blockUserTarget) return;
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

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6">
        <a href="/" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('admin.backToHome')}
        </a>
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
            {users.map((u) => (
              <div key={u.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
                {/* Mobile layout */}
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
                      className={`rounded p-2 transition-colors ${
                        u.is_admin === 1
                          ? 'text-[var(--primary)] hover:bg-[var(--primary)]/10'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--accent)]'
                      }`}
                      title={u.is_admin === 1 ? t('admin.demote') : t('admin.promote')}
                    >
                      {u.is_admin === 1 ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => {
                        if (u.is_blocked === 1) {
                          setBlockUserTarget(u);
                          setBlockReason('');
                        } else {
                          setBlockUserTarget(u);
                          setBlockReason('');
                        }
                      }}
                      className={`rounded p-2 transition-colors ${
                        u.is_blocked === 1
                          ? 'text-[var(--warning)] hover:bg-[var(--warning)]/10'
                          : 'text-[var(--muted-foreground)] hover:text-[var(--warning)] hover:bg-[var(--accent)]'
                      }`}
                      title={u.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteUserTarget(u)}
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
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

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
