export const runtime = 'edge';

import { buildClearAtlassianSessionCookie } from '@/lib/server/session';

// Atlassian does not expose a documented token revoke endpoint for OAuth 2.0
// (3LO) bearer tokens — clearing the cookie ends the local session. The
// access token expires on its own within an hour; the refresh token can be
// invalidated by the user in their Atlassian account settings.
export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearAtlassianSessionCookie(),
    },
  });
}
