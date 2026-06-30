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
  isAtlassianOAuthConfigured,
} from '@/lib/server/atlassian';

function errorRedirect(req, message) {
  const url = new URL('/', req.url);
  url.searchParams.set('atl_error', message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': buildClearAtlassianStateCookie(),
    },
  });
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

  const redirectUri = process.env.ATLASSIAN_REDIRECT_URI;
  const token = await exchangeCodeForToken({ code, redirectUri });
  if (!token?.access_token) return errorRedirect(req, 'token_exchange_failed');

  // Best-effort identity + accessible-resources lookups for the UI badge
  // and so we know which cloud_id to surface. Both are non-fatal.
  const [identity, resources] = await Promise.all([
    fetchIdentity(token.access_token),
    fetchAccessibleResources(token.access_token),
  ]);

  const sessionPayload = buildSessionFromTokenResponse(token, identity, resources);
  const sessionCookie = await buildAtlassianSessionCookie(sessionPayload);
  const clearStateCookie = buildClearAtlassianStateCookie();

  const home = new URL('/', req.url);
  home.searchParams.set('atl_connected', '1');

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
