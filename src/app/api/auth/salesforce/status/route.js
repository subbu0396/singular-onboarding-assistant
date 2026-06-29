export const runtime = 'edge';

import { readSession } from '@/lib/server/session';

export async function GET(req) {
  const session = await readSession(req);
  if (!session) {
    return Response.json({ connected: false });
  }
  return Response.json({
    connected: true,
    instanceUrl: session.instance_url,
    identity: session.identity || null,
    issuedAt: session.issued_at,
  });
}
