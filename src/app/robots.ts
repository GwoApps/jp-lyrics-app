import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';
import { resolveSiteOrigin } from '@/app/layout';
import { buildRobots, isSeoEnabled } from '@/lib/seo';

// Read the switch per request: it must not be frozen into a static build.
export const dynamic = 'force-dynamic';

/** ISSUE #494: discovery is opt-in — without the switch these routes do not exist. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!isSeoEnabled()) notFound();
  return buildRobots(await resolveSiteOrigin());
}
