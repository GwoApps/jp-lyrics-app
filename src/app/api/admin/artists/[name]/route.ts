import type { NextRequest } from 'next/server';
import { artistProfileAdminHandlers } from '@/lib/artist-profile-server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ name: string }> };
export async function GET(request: NextRequest, context: Context) {
  return artistProfileAdminHandlers.get(request, (await context.params).name);
}
export async function PUT(request: NextRequest, context: Context) {
  return artistProfileAdminHandlers.put(request, (await context.params).name);
}
export async function DELETE(request: NextRequest, context: Context) {
  return artistProfileAdminHandlers.delete(request, (await context.params).name);
}
