export const runtime = 'edge';

import { buildClearSessionCookie, readSession } from '@/lib/server/session';

const DEFAULT_LOGIN_HOST = 'https://login.salesforce.com';

export async function POST(req) {
  // Best-effort: revoke the token at Salesforce so the access_token is invalidated immediately.
  const session = await readSession(req);
  if (session?.access_token) {
    const loginHost = process.env.SALESFORCE_LOGIN_HOST || DEFAULT_LOGIN_HOST;
    try {
      await fetch(`${loginHost}/services/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: session.access_token }).toString(),
      });
    } catch {
      // Non-fatal — cookie clear below still ends the local session.
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearSessionCookie(),
    },
  });
}
