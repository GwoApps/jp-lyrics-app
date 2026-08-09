export type AdminRouteView = 'queue' | 'content' | 'people' | 'system';

export const ADMIN_VIEW_SLUG: Record<AdminRouteView, string> = {
  queue: 'todo',
  content: 'content',
  people: 'users',
  system: 'system',
};

export function viewFromAdminPathname(pathname: string): AdminRouteView {
  const value = pathname.split('/').filter(Boolean)[1];
  if (value === 'content') return 'content';
  if (value === 'users' || value === 'people') return 'people';
  if (value === 'system') return 'system';
  return 'queue';
}

export function buildAdminUrl(view: AdminRouteView, params = new URLSearchParams()): string {
  const query = params.toString();
  return `/admin/${ADMIN_VIEW_SLUG[view]}${query ? `?${query}` : ''}`;
}
