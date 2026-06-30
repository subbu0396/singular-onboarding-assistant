export const runtime = 'edge';

import { readAtlassianSession } from '@/lib/server/session';

export async function GET(req) {
  const session = await readAtlassianSession(req);
  if (!session) return Response.json({ connected: false });
  return Response.json({
    connected: true,
    identityName: session.identity_name || null,
    expiresAt: session.expires_at,
  });
}
