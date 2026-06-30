export const runtime = 'edge';

import { buildClearAtlassianSessionCookies } from '@/lib/server/session';

export async function POST() {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of buildClearAtlassianSessionCookies()) {
    headers.append('Set-Cookie', cookie);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
