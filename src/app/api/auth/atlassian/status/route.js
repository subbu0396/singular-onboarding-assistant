export const runtime = 'edge';

import { readAtlassianSession } from '@/lib/server/session';

export async function GET(req) {
  const session = await readAtlassianSession(req);
  if (!session) return Response.json({ connected: false });
  return Response.json({
    connected: true,
    siteUrl: session.site_url || null,
    cloudId: session.cloud_id || null,
    identity: session.identity || null,
    issuedAt: session.issued_at,
    expiresAt: session.expires_at,
  });
}
