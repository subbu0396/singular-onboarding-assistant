export const runtime = 'edge';

import {
  buildAtlassianSessionCookie,
  buildClearAtlassianStateCookie,
  readAtlassianStateCookie,
} from '@/lib/server/session';
import {
  buildSessionFromTokenResponse,
  exchangeCodeForToken,
  fetchAccessibleResources,
  fetchIdentity,
  getAtlassianRedirectUri,
  isAtlassianOAuthConfigured,
} from '@/lib/server/atlassian';

function redirectWithCookies(location, cookieHeaders) {
  const headers = new Headers();
  for (const cookie of cookieHeaders) {
    headers.append('Set-Cookie', cookie);
  }
  headers.set('Location', location);
  return new Response(null, { status: 302, headers });
}

async function errorRedirect(req, message) {
  const url = new URL('/', req.url);
  url.searchParams.set('atl_error', message);
  return redirectWithCookies(url.toString(), [buildClearAtlassianStateCookie()]);
}

async function handleCallback(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) return errorRedirect(req, `atlassian_${oauthError}`);
  if (!code || !state) return errorRedirect(req, 'missing_code_or_state');

  const expectedState = await readAtlassianStateCookie(req);
  if (!expectedState || expectedState !== state) {
    return errorRedirect(req, 'state_mismatch');
  }

  if (!isAtlassianOAuthConfigured()) {
    return errorRedirect(req, 'oauth_not_configured');
  }

  const redirectUri = getAtlassianRedirectUri(req);
  const token = await exchangeCodeForToken({ code, redirectUri });
  if (!token?.access_token) return errorRedirect(req, 'token_exchange_failed');

  const [identity, resources] = await Promise.all([
    fetchIdentity(token.access_token),
    fetchAccessibleResources(token.access_token),
  ]);

  const sessionPayload = buildSessionFromTokenResponse(token, identity, resources);
  const sessionCookie = await buildAtlassianSessionCookie(sessionPayload);

  const home = new URL('/', req.url);
  home.searchParams.set('atl_connected', '1');

  return redirectWithCookies(home.toString(), [
    sessionCookie,
    buildClearAtlassianStateCookie(),
  ]);
}

export async function GET(req) {
  try {
    return await handleCallback(req);
  } catch (err) {
    console.error('Atlassian callback route error:', err);
    return Response.json(
      {
        error: 'Atlassian callback failed.',
        detail: err?.message || String(err),
        hint: 'Common causes: SESSION_SECRET not set or wrong size, OAuth app callback URL mismatch.',
      },
      { status: 500 }
    );
  }
}
