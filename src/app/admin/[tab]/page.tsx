import { redirect } from 'next/navigation';

const ADMIN_TABS = new Set(['todo', 'content', 'users', 'system']);

export default async function AdminTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  if (tab === 'queue') redirect('/admin/todo');
  if (tab === 'people') redirect('/admin/users');
  if (!ADMIN_TABS.has(tab)) redirect('/admin/todo');
  return null;
}
