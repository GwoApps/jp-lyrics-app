import type { ReactNode } from 'react';
import AdminPageClient from './AdminPageClient';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminPageClient />
      {children}
    </>
  );
}
