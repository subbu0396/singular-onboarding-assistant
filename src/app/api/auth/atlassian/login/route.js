export const runtime = 'edge';

import {
  buildAtlassianStateCookie,
  generateRandomState,
} from '@/lib/server/session';
import {
  getOAuthScopes,
  isAtlassianOAuthConfigured,
} from '@/lib/server/atlassian';

const AUTH_URL = 'https://auth.atlassian.com/authorize';

export async function GET() {
  try {
    if (!isAtlassianOAuthConfigured()) {
      return Response.json(
        {
          error:
            'Atlassian OAuth is not configured. Set ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET, and ATLASSIAN_REDIRECT_URI in Vercel.',
        },
        { status: 500 }
      );
    }

    const clientId = process.env.ATLASSIAN_CLIENT_ID;
    const redirectUri = process.env.ATLASSIAN_REDIRECT_URI;

    const state = generateRandomState();
    const stateCookie = await buildAtlassianStateCookie(state);

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('audience', 'api.atlassian.com');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('scope', getOAuthScopes());
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('prompt', 'consent');

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        'Set-Cookie': stateCookie,
      },
    });
  } catch (err) {
    console.error('Atlassian login route error:', err);
    return Response.json(
      {
        error: 'Atlassian login failed before redirect.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, ATLASSIAN_* env vars missing for this deployment environment.',
      },
      { status: 500 }
    );
  }
}
