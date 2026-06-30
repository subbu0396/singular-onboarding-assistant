export const runtime = 'edge';

import {
  buildClearGitHubStateCookie,
  buildGitHubSessionCookie,
  readGitHubStateCookie,
} from '@/lib/server/session';
import {
  buildSessionFromTokenResponse,
  exchangeCodeForToken,
  fetchGitHubIdentity,
  getGitHubRedirectUri,
  isGitHubOAuthConfigured,
} from '@/lib/server/github';

function errorRedirect(req, message) {
  const url = new URL('/', req.url);
  url.searchParams.set('github_error', message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': buildClearGitHubStateCookie(),
    },
  });
}

async function handleCallback(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) return errorRedirect(req, `github_${oauthError}`);
  if (!code || !state) return errorRedirect(req, 'missing_code_or_state');

  const expectedState = await readGitHubStateCookie(req);
  if (!expectedState || expectedState !== state) {
    return errorRedirect(req, 'state_mismatch');
  }

  if (!isGitHubOAuthConfigured()) {
    return errorRedirect(req, 'oauth_not_configured');
  }

  const redirectUri = getGitHubRedirectUri(req);
  const token = await exchangeCodeForToken({ code, redirectUri });
  if (!token?.access_token) return errorRedirect(req, 'token_exchange_failed');

  const identity = await fetchGitHubIdentity(token.access_token);
  const sessionPayload = buildSessionFromTokenResponse(token, identity);
  const sessionCookie = await buildGitHubSessionCookie(sessionPayload);
  const clearStateCookie = buildClearGitHubStateCookie();

  const home = new URL('/', req.url);
  home.searchParams.set('github_connected', '1');

  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearStateCookie);
  headers.set('Location', home.toString());

  return new Response(null, { status: 302, headers });
}

export async function GET(req) {
  try {
    return await handleCallback(req);
  } catch (err) {
    console.error('GitHub callback route error:', err);
    return Response.json(
      {
        error: 'GitHub callback failed.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, OAuth app callback URL mismatch.',
      },
      { status: 500 }
    );
  }
}
