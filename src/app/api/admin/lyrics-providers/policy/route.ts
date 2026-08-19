import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getNetworkPolicy } from '@/lib/lyrics-provider/policy';
import { getBudgetConfig } from '@/lib/lyrics-provider/budget';
import { hasProviderSecretKey } from '@/lib/lyrics-provider/secret';

// GET /api/admin/lyrics-providers/policy — deployment policy snapshot (admin only,
// read-only). Never exposes env var values; only the effective boolean policy,
// the valid timeout ranges and whether a secret key is configured (which gates
// saving bearer providers).
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    policy: getNetworkPolicy(),
    budgets: getBudgetConfig(),
    secret_key_configured: hasProviderSecretKey(),
  });
}
