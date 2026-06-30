export const runtime = 'edge';

import { readGitHubSession } from '@/lib/server/session';

export async function GET(req) {
  const session = await readGitHubSession(req);
  if (!session?.access_token) return Response.json({ connected: false });
  return Response.json({
    connected: true,
    identity: session.identity || null,
    expiresAt: session.expires_at || null,
  });
}
