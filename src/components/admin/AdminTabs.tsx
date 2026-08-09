'use client';

import { useEffect, useRef } from 'react';
import { Activity, ListChecks, ListMusic, Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { AdminView } from './admin-types';

interface AdminTabsProps {
  view: AdminView;
  onViewChange: (view: AdminView) => void;
  /** Pending-queue count (shown on the 待办 tab, hidden when 0). */
  pendingCount: number;
}

/**
 * Admin console tab navigation. Keeps the top four-zone navigation (ISSUE #82):
 * 待办 (default) / 内容 / 用户 / 系统. The pending count badge only appears
 * when non-zero, staying quiet at zero. On mobile the row scrolls horizontally
 * and the active tab is scrolled into view.
 */
export default function AdminTabs({ view, onViewChange, pendingCount }: AdminTabsProps) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<AdminView, HTMLButtonElement>>>({});

  // Scroll only the horizontal tab strip, and only when the active view really
  // changes. The old inline ref callback ran scrollIntoView() on every parent
  // render, so opening a preview dialog pulled the whole page back to the tabs.
  useEffect(() => {
    const nav = navRef.current;
    const tab = tabRefs.current[view];
    if (!nav || !tab) return;

    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < nav.scrollLeft) {
      nav.scrollTo({ left, behavior: 'smooth' });
    } else if (right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: right - nav.clientWidth, behavior: 'smooth' });
    }
  }, [view]);

  const tabCls = (active: boolean, activeColor = 'border-[var(--primary)] text-[var(--primary)]') =>
    `inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
      active ? activeColor : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
    }`;

  const items: Array<{ key: AdminView; label: string; icon: React.ReactNode; badge?: number }> = [
    { key: 'queue', label: t('admin.viewQueue'), icon: <ListChecks className="h-3.5 w-3.5" />, badge: pendingCount },
    { key: 'content', label: t('admin.viewContent'), icon: <ListMusic className="h-3.5 w-3.5" /> },
    { key: 'people', label: t('admin.viewPeople'), icon: <Users className="h-3.5 w-3.5" /> },
    { key: 'system', label: t('admin.viewSystem'), icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  return (
    <nav
      ref={navRef}
      className="mb-6 border-b border-[var(--border)] overflow-x-auto scrollbar-thin"
      aria-label={t('admin.title')}
      role="tablist"
    >
      <div className="flex gap-1 min-w-max">
        {items.map((item) => {
          const active = view === item.key;
          const activeColor = item.key === 'queue'
            ? 'border-[var(--warning)] text-[var(--warning)]'
            : undefined;
          return (
            <button
              key={item.key}
              ref={(el) => { if (el) tabRefs.current[item.key] = el; }}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(item.key)}
              className={tabCls(active, activeColor)}
            >
              {item.icon}
              {item.label}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ml-0.5 rounded-full bg-[var(--warning)]/20 text-[var(--warning)] px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
