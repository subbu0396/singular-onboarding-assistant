export const runtime = 'edge';

import { buildClearGoogleSessionCookie, readGoogleSession } from '@/lib/server/session';

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Best-effort revoke at Google so the refresh token is invalidated server-side
// the moment the SE disconnects. Failure here is non-fatal — clearing the
// cookie still ends the local session.
export async function POST(req) {
  const session = await readGoogleSession(req);
  if (session?.refresh_token || session?.access_token) {
    const token = session.refresh_token || session.access_token;
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch {
      // ignore — cookie clear below still ends the local session
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearGoogleSessionCookie(),
    },
  });
}
