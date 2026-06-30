export const runtime = 'edge';

import { buildClearGitHubSessionCookie, readGitHubSession } from '@/lib/server/session';

// Best-effort delete of the OAuth authorization at GitHub so the access
// token is invalidated server-side immediately. Failure is non-fatal —
// clearing the cookie still ends the local session.
async function revokeAtGitHub(accessToken) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !accessToken) return;
  try {
    await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
  } catch {
    // ignore
  }
}

export async function POST(req) {
  const session = await readGitHubSession(req);
  if (session?.access_token) await revokeAtGitHub(session.access_token);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearGitHubSessionCookie(),
    },
  });
}
