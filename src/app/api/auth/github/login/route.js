export const runtime = 'edge';

import {
  buildGitHubStateCookie,
  generateRandomState,
} from '@/lib/server/session';
import {
  getGitHubRedirectUri,
  getGitHubScopes,
  isGitHubOAuthConfigured,
} from '@/lib/server/github';

const AUTH_URL = 'https://github.com/login/oauth/authorize';

export async function GET(req) {
  try {
    if (!isGitHubOAuthConfigured()) {
      return Response.json(
        {
          error:
            'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Vercel.',
        },
        { status: 500 }
      );
    }

    const clientId = process.env.GITHUB_CLIENT_ID.trim();
    const redirectUri = getGitHubRedirectUri(req);
    const state = generateRandomState();
    const stateCookie = await buildGitHubStateCookie(state);

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', getGitHubScopes());
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('allow_signup', 'false');

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        'Set-Cookie': stateCookie,
      },
    });
  } catch (err) {
    console.error('GitHub login route error:', err);
    return Response.json(
      {
        error: 'GitHub login failed before redirect.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, GITHUB_* env vars missing for this deployment environment.',
      },
      { status: 500 }
    );
  }
}
