'use client';

import { Users, Music, Clock, Languages } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { AdminTab } from './admin-types';

interface AdminTabsProps {
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  usersCount: number;
  songsCount: number;
  pendingCount: number;
}

/** Admin console tab navigation: users / songs / pending approval / translation. */
export default function AdminTabs({ tab, onTabChange, usersCount, songsCount, pendingCount }: AdminTabsProps) {
  const { t } = useI18n();

  const tabCls = (active: boolean, activeColor = 'border-[var(--primary)] text-[var(--primary)]') =>
    `inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
      active ? activeColor : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
    }`;

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--border)]">
      <button onClick={() => onTabChange('users')} className={tabCls(tab === 'users')}>
        <Users className="h-3.5 w-3.5" />
        {t('admin.users')} ({usersCount})
      </button>
      <button onClick={() => onTabChange('songs')} className={tabCls(tab === 'songs')}>
        <Music className="h-3.5 w-3.5" />
        {t('admin.songs')} ({songsCount})
      </button>
      <button onClick={() => onTabChange('pending')} className={tabCls(tab === 'pending', 'border-[var(--warning)] text-[var(--warning)]')}>
        <Clock className="h-3.5 w-3.5" />
        {t('admin.pending')} ({pendingCount})
      </button>
      <button onClick={() => onTabChange('translation')} className={tabCls(tab === 'translation')}>
        <Languages className="h-3.5 w-3.5" />
        {t('admin.translationTab')}
      </button>
    </div>
  );
}
