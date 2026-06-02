import { NextRequest } from 'next/server';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** Extract authenticated user from kazusa-auth forward headers */
export function getAuthUser(request: NextRequest): AuthUser | null {
  const email = request.headers.get('X-User-Email');
  if (!email) return null;
  return {
    id: request.headers.get('X-User-Id') || '',
    email,
    name: decodeURIComponent(request.headers.get('X-User-Name') || ''),
    role: request.headers.get('X-User-Role') || 'user',
  };
}
